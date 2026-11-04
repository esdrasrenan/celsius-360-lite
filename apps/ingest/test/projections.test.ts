import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import pg from 'pg'
import { Projector } from '../src/pipeline/projections'
import { EVENTS_CHANNEL } from '../src/pipeline/sinks'
import { loadEnvironments } from '../src/registry'
import { createTestEnvironment, expected, type TestEnvironment } from './support'

let env: TestEnvironment

const rows = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await env.pool.query<T>(sql, params)).rows

beforeAll(async () => {
  env = await createTestEnvironment()
  await env.replay()
}, 120_000)

afterAll(async () => {
  await env?.cleanup()
})

describe('projeções da visão da rede', () => {
  test('à meia-noite de São Paulo, só a sala técnica 24 h está aberta; cada ambiente fechado sabe quando abre', async () => {
    const environments = await rows<{ environment_id: string; open_now: boolean; next_open_at: Date | null }>(
      'SELECT environment_id, open_now, next_open_at FROM state.environment_snapshot ORDER BY environment_id',
    )
    expect(
      environments.map((row) => [row.environment_id, row.open_now, row.next_open_at?.toISOString()]),
    ).toEqual([
      ['AMB-T1', false, '2026-03-04T12:00:00.000Z'],
      ['AMB-T2', true, undefined],
      ['AMB-T3', false, '2026-03-04T11:00:00.000Z'],
    ])
  })

  test('a loja guarda nome, distribuição, abertos agora, próxima abertura e pior ambiente', async () => {
    const stores = await rows<Record<string, unknown>>(
      `SELECT store_id, store_name, env_open_now, next_open_at, worst_env_id, worst_env_comfort, comfort_pct,
         above_pct, below_pct, samples_in_hours, samples_within, samples_above, samples_below, samples_expected
       FROM state.store_snapshot WHERE period = '1d' ORDER BY store_id`,
    )
    const [recife, centro] = stores
    expect(recife).toMatchObject({ store_id: 'LOJA-T-PE', store_name: 'Agência Recife', env_open_now: 0 })
    expect(recife?.next_open_at).toEqual(new Date('2026-03-04T11:00:00.000Z'))
    expect(recife).toMatchObject({ worst_env_id: 'AMB-T3', worst_env_comfort: recife?.comfort_pct })
    expect(centro).toMatchObject({ store_id: 'LOJA-T-SP', env_open_now: 1, next_open_at: null })
    for (const store of stores) {
      expect(Number(store.samples_within) + Number(store.samples_above) + Number(store.samples_below)).toBe(
        Number(store.samples_in_hours),
      )
      expect(Number(store.samples_expected)).toBeGreaterThan(0)
    }
  })

  test('subir a ingestão sem pacote novo preenche colunas que uma migração acabou de criar', async () => {
    await env.pool.query(
      `UPDATE state.store_snapshot SET env_open_now = 0, samples_expected = 0, above_pct = NULL,
         next_open_at = NULL, worst_env_id = NULL, worst_env_comfort = NULL`,
    )
    await env.pool.query('UPDATE state.environment_snapshot SET open_now = false, next_open_at = NULL')

    const summary = await env.replay()
    expect(summary.packets).toBe(0)
    const [store] = await rows<{
      env_open_now: number
      samples_expected: number
      worst_env_id: string | null
    }>(
      "SELECT env_open_now, samples_expected, worst_env_id FROM state.store_snapshot WHERE store_id = 'LOJA-T-SP' AND period = '7d'",
    )
    expect(store).toMatchObject({ env_open_now: 1, worst_env_id: 'AMB-T1' })
    expect(store?.samples_expected).toBeGreaterThan(0)
    const [open] = await rows<{ open_now: boolean }>(
      "SELECT open_now FROM state.environment_snapshot WHERE environment_id = 'AMB-T2'",
    )
    expect(open?.open_now).toBe(true)
  })

  test('o nome da loja na projeção acompanha o cadastro, seja quem for que grave a linha', async () => {
    await env.pool.query("UPDATE registry.store SET name = 'Loja Centro Novo' WHERE id = 'LOJA-T-SP'")
    await env.replay()
    const names = await rows<{ store_name: string }>(
      "SELECT DISTINCT store_name FROM state.store_snapshot WHERE store_id = 'LOJA-T-SP'",
    )
    expect(names).toEqual([{ store_name: 'Loja Centro Novo' }])
  })

  test('com 600 lojas, a projeção grava tudo e o NOTIFY continua pequeno (teto de 8.000 bytes)', async () => {
    await env.pool.query(`
      INSERT INTO registry.store (id, client_id, name, kind, city, state_code, latitude, longitude, timezone, opening_hours)
      SELECT format('LOJA-SINT-%s', lpad(n::text, 4, '0')), 'CLI-T1', format('Loja %s', n), 'loja de shopping',
        'Campinas', 'SP', -22.9, -47.1, 'America/Sao_Paulo', s.opening_hours
      FROM generate_series(1, 600) AS n, (SELECT opening_hours FROM registry.store WHERE id = 'LOJA-T-SP') s;
      INSERT INTO registry.environment (id, store_id, name, comfort_min, comfort_max, opening_hours)
      SELECT format('AMB-SINT-%s', n), format('LOJA-SINT-%s', lpad(n::text, 4, '0')), 'Salão', 21, 25, s.opening_hours
      FROM generate_series(1, 600) AS n, (SELECT opening_hours FROM registry.store WHERE id = 'LOJA-T-SP') s;
    `)
    const listener = new pg.Client({ connectionString: env.databaseUrl })
    await listener.connect()
    const payloads: string[] = []
    listener.on('notification', (message) => payloads.push(message.payload ?? ''))
    await listener.query(`LISTEN ${EVENTS_CHANNEL}`)
    try {
      const projector = new Projector(env.pool, await loadEnvironments(env.pool))
      await projector.refresh(Date.parse(expected.now), new Map(), 42)
      const deadline = Date.now() + 2000
      while (payloads.length === 0 && Date.now() < deadline) await Bun.sleep(20)
    } finally {
      await listener.end()
    }

    expect(payloads).toHaveLength(1)
    expect(JSON.parse(payloads[0] as string)).toEqual({
      type: 'state_updated',
      now: expected.now,
      lastSeq: 42,
    })
    const [count] = await rows<{ stores: number }>(
      "SELECT count(DISTINCT store_id) AS stores FROM state.store_snapshot WHERE store_id LIKE 'LOJA-SINT-%'",
    )
    expect(count?.stores).toBe(600)
  })
})
