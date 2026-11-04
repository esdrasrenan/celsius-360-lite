import { afterAll, beforeAll, expect, test } from 'bun:test'
import { join } from 'node:path'
import pg from 'pg'
import { retryOnConnectionError } from '../src/infra'
import { createTestEnvironment, expected, type TestEnvironment } from './support'

let env: TestEnvironment

beforeAll(async () => {
  env = await createTestEnvironment()
}, 60_000)

afterAll(async () => {
  await env?.cleanup()
})

test('a ingestão retoma do checkpoint depois de uma queda do banco no meio da reprodução', async () => {
  // A quinta transação (pool.connect sem callback) recebe uma conexão que cai logo depois de entregue,
  // como num reinício do banco; pool.query usa a forma com callback e segue intacto
  const connect = env.pool.connect.bind(env.pool) as (...args: unknown[]) => unknown
  let transactions = 0
  env.pool.connect = ((...args: unknown[]) => {
    if (args.length > 0) return connect(...args)
    return (async () => {
      const client = (await connect()) as pg.PoolClient & { processID: number }
      if (++transactions === 5) {
        const admin = new pg.Client({ connectionString: env.databaseUrl })
        await admin.connect()
        await admin.query('SELECT pg_terminate_backend($1)', [client.processID])
        await admin.end()
      }
      return client
    })()
  }) as typeof env.pool.connect

  let attempts = 0
  const summary = await retryOnConnectionError(
    () => {
      attempts++
      return env.replay()
    },
    env.logger,
    { delayMs: 50 },
  )
  expect(attempts).toBe(2)
  expect(summary.now).toBe(expected.now)

  const { rows } = await env.pool.query<{ readings: number; last_seq: number }>(
    'SELECT (SELECT count(*) FROM telemetry.reading) AS readings, (SELECT last_seq FROM state.ingestion) AS last_seq',
  )
  const totalPackets = Object.values(expected.devices).reduce((sum, count) => sum + count, 0)
  expect(rows[0]).toEqual({ readings: totalPackets * 12, last_seq: expected.lines })

  // Sem FINAL: nenhum pacote foi gravado duas vezes no cru
  const raw = await env.clickhouse.query({
    query: 'SELECT count() AS total FROM raw.telemetry_packet WHERE source = {source:String}',
    query_params: { source: env.source },
    format: 'JSONEachRow',
  })
  const [counted] = await raw.json<{ total: string }>()
  expect(Number(counted?.total)).toBe(expected.lines)
}, 120_000)

test('retomar no meio de uma sequência repetida mantém o último valor válido de antes do travamento', async () => {
  // DEV-A repete 22,4 °C a partir das 22:00 locais (01:00Z); a leitura anterior é 23,1 °C às 00:59:30Z
  const stuck = await createTestEnvironment()
  try {
    const path = join(stuck.config.DATA_DIR, stuck.source)
    const lines = (await Bun.file(path).text()).trimEnd().split('\n')
    const through = (local: string) =>
      `${lines.slice(0, lines.findIndex((line) => line.includes(`"DEV-A","timestamp":"${local}`)) + 1).join('\n')}\n`

    // 42 min de sequência: ainda não é travamento; a ingestão para aqui
    await Bun.write(path, through('2026-03-02T22:42:00'))
    await stuck.replay()
    // Retoma do checkpoint; às 23:00 a sequência passa de 60 min e vira falha no sensor
    await Bun.write(path, through('2026-03-02T23:12:00'))
    await stuck.replay()

    const { rows } = await stuck.pool.query<{ last_valid_at: Date; last_valid_value: number }>(
      "SELECT last_valid_at, last_valid_value FROM state.device WHERE device_id = 'DEV-A'",
    )
    expect(rows[0]?.last_valid_at.toISOString()).toBe('2026-03-03T00:59:30.000Z')
    expect(rows[0]?.last_valid_value).toBe(23.1)
  } finally {
    await stuck.cleanup()
  }
}, 120_000)
