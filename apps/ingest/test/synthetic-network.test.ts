import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import {
  comfortIndicator,
  type DeviceStatus,
  deviceStatus,
  type PeriodKey,
  type Situation,
  storeStatus,
} from '@celsius/domain'
import { percentile } from '../src/jobs/synthetic-network'
import { storeSnapshotRows } from '../src/pipeline/projections'
import { loadEnvironments, SYNTHETIC_CLIENT_ID } from '../src/registry'
import { createTestEnvironment, type TestEnvironment } from './support'

const MAIN = resolve(import.meta.dir, '../src/main.ts')
let env: TestEnvironment

/** Roda a CLI como no Docker (docker compose run --rm ingest bun run apps/ingest/src/main.ts ...). */
async function cli(...args: string[]) {
  const child = Bun.spawn(['bun', 'run', MAIN, 'rede-sintetica', ...args], {
    env: {
      ...process.env,
      DATABASE_URL: env.databaseUrl,
      CLICKHOUSE_URL: env.config.CLICKHOUSE_URL,
      LOG_LEVEL: 'silent',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`rede-sintetica saiu com ${code}: ${stderr}`)
  return stdout
}

const realState = async () =>
  (
    await env.pool.query(
      `SELECT (SELECT json_agg(ss ORDER BY store_id, period) FROM state.store_snapshot ss
               WHERE store_id NOT LIKE 'LOJA-SINT-%') AS stores,
              (SELECT jsonb_agg(to_jsonb(es) - 'updated_at' ORDER BY environment_id) FROM state.environment_snapshot es
               WHERE environment_id NOT LIKE 'AMB-SINT-%') AS environments,
              (SELECT count(*) FROM telemetry.reading) AS readings,
              (SELECT count(*) FROM registry.store WHERE client_id <> $1) AS registry`,
      [SYNTHETIC_CLIENT_ID],
    )
  ).rows[0]
const syntheticState = async () =>
  (
    await env.pool.query(
      `SELECT json_agg(ss ORDER BY store_id, period) AS stores FROM state.store_snapshot ss
       WHERE store_id LIKE 'LOJA-SINT-%'`,
    )
  ).rows[0]

beforeAll(async () => {
  env = await createTestEnvironment()
  await env.replay()
}, 120_000)

afterAll(async () => {
  await env?.cleanup()
})

describe('rede sintética', () => {
  let before: unknown

  test('grava lojas, ambientes e dispositivos com prefixo próprio', async () => {
    before = await realState()
    expect(await cli('--lojas', '30')).toContain('30 lojas sintéticas, 180 ambientes')
    const { rows } = await env.pool.query<{
      stores: number
      environments: number
      devices: number
      snapshots: number
    }>(
      `SELECT (SELECT count(*) FROM registry.store WHERE id LIKE 'LOJA-SINT-%' AND client_id = $1) AS stores,
              (SELECT count(*) FROM registry.environment WHERE id LIKE 'AMB-SINT-%') AS environments,
              (SELECT count(*) FROM registry.environment WHERE device_id LIKE 'IOT-SINT-%') AS devices,
              (SELECT count(*) FROM state.store_snapshot WHERE store_id LIKE 'LOJA-SINT-%') AS snapshots`,
      [SYNTHETIC_CLIENT_ID],
    )
    expect(rows[0]).toEqual({ stores: 30, environments: 180, devices: 180, snapshots: 90 })
  })

  test('o estado é coerente com as regras do domínio', async () => {
    const { rows: environments } = await env.pool.query<{
      store_id: string
      status: string
      last_contact_at: Date | null
      last_valid_at: Date | null
      now_ts: Date
    }>(
      `SELECT e.store_id, es.status, d.last_contact_at, d.last_valid_at, es.now_ts
       FROM registry.environment e
       JOIN state.environment_snapshot es ON es.environment_id = e.id
       LEFT JOIN state.device d ON d.device_id = e.device_id
       WHERE e.id LIKE 'AMB-SINT-%'`,
    )
    const { rows: ingestion } = await env.pool.query<{ now_ts: Date }>('SELECT now_ts FROM state.ingestion')
    const now = ingestion[0]?.now_ts.getTime() ?? 0
    for (const row of environments) {
      expect(row.now_ts.getTime()).toBe(now)
      const device = row.last_contact_at
        ? { lastContactAt: row.last_contact_at.getTime(), lastValidAt: row.last_valid_at?.getTime() ?? null }
        : null
      expect(row.status).toBe(deviceStatus(device, now))
    }
    expect(new Set(environments.map((row) => row.status)).size).toBeGreaterThan(1)

    const { rows: stores } = await env.pool.query<{
      store_id: string
      status: string
      env_online: number
      env_sensor_fault: number
      env_offline: number
      env_no_data: number
    }>("SELECT * FROM state.store_snapshot WHERE store_id LIKE 'LOJA-SINT-%' AND period = '7d'")
    for (const store of stores) {
      const statuses = environments.filter((row) => row.store_id === store.store_id).map((row) => row.status)
      expect(store.status).toBe(storeStatus(statuses as Parameters<typeof storeStatus>[0]))
      expect(store.env_online + store.env_sensor_fault + store.env_offline + store.env_no_data).toBe(6)
    }

    // Colunas do modelo de leitura da visão da rede: pior ambiente, abertos agora, acima e abaixo
    const { rows: mismatches } = await env.pool.query<{ count: number }>(
      `SELECT count(*) AS count FROM state.store_snapshot ss
       WHERE ss.store_id LIKE 'LOJA-SINT-%' AND (
         ss.env_out_of_range <> ss.env_above + ss.env_below
         OR ss.env_open_now <> (SELECT count(*) FROM state.environment_snapshot es
                                JOIN registry.environment e ON e.id = es.environment_id
                                WHERE e.store_id = ss.store_id AND es.open_now)
         OR ss.worst_env_comfort IS DISTINCT FROM (SELECT min(ei.comfort_pct) FROM state.environment_indicator ei
                                                  JOIN registry.environment e ON e.id = ei.environment_id
                                                  WHERE e.store_id = ss.store_id AND ei.period = ss.period))`,
    )
    expect(mismatches[0]?.count).toBe(0)
  })

  test('o resumo de cada loja é o que a projeção da ingestão calcula a partir dos ambientes gravados', async () => {
    const { rows: environments } = await env.pool.query<{
      id: string
      store_id: string
      status: DeviceStatus
      situation: Situation
      open_now: boolean
      next_open_at: Date | null
      now_ts: Date
    }>(
      `SELECT e.id, e.store_id, es.status, es.situation, es.open_now, es.next_open_at, es.now_ts
       FROM registry.environment e JOIN state.environment_snapshot es ON es.environment_id = e.id
       WHERE e.id LIKE 'AMB-SINT-%'`,
    )
    const { rows: indicators } = await env.pool.query<{
      environment_id: string
      period: PeriodKey
      in_hours: number
      within: number
      above: number
      below: number
      expected: number
    }>(
      `SELECT environment_id, period, samples_in_hours AS in_hours, samples_within AS within,
         samples_above AS above, samples_below AS below, samples_expected AS expected
       FROM state.environment_indicator WHERE environment_id LIKE 'AMB-SINT-%'`,
    )
    const byEnvironment = Map.groupBy(indicators, (row) => row.environment_id)
    const now = environments[0]?.now_ts.getTime() ?? 0
    const projected = [...Map.groupBy(environments, (row) => row.store_id)].flatMap(([storeId, list]) =>
      storeSnapshotRows(
        storeId,
        list.map((row) => ({
          environmentId: row.id,
          status: row.status,
          situation: row.situation,
          openNow: row.open_now,
          nextOpenAt: row.next_open_at?.getTime() ?? null,
          indicators: new Map(
            (byEnvironment.get(row.id) ?? []).map(({ period, in_hours, within, above, below, expected }) => {
              const counts = { inHours: in_hours, within, above, below, expected }
              return [period, { counts, indicator: comfortIndicator(counts) }]
            }),
          ),
        })),
        now,
      ),
    )
    const columns = Object.keys(projected[0] ?? {})
    const { rows: stored } = await env.pool.query<Record<string, unknown>>(
      `SELECT ${columns.join(', ')} FROM state.store_snapshot WHERE store_id LIKE 'LOJA-SINT-%'`,
    )
    const normalized = (rows: Array<Record<string, unknown>>) =>
      rows
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              value instanceof Date ? value.toISOString() : value,
            ]),
          ),
        )
        .sort((a, b) => `${a.store_id}${a.period}`.localeCompare(`${b.store_id}${b.period}`))
    expect(projected).toHaveLength(90)
    expect(normalized(stored)).toEqual(normalized(projected))
  })

  test('não toca no conjunto real, e a ingestão continua ignorando as lojas sintéticas', async () => {
    expect(await realState()).toEqual(before)
    expect((await loadEnvironments(env.pool)).map((item) => item.environmentId)).toEqual([
      'AMB-T1',
      'AMB-T2',
      'AMB-T3',
    ])
    const synthetic = await syntheticState()
    await env.replay()
    expect(await syntheticState()).toEqual(synthetic)
    expect((await env.qualityReport()).devices.registered).toBe(3)
  }, 60_000)

  test('--limpar remove só o sintético', async () => {
    expect(await cli('--limpar')).toContain('30 lojas sintéticas removidas')
    const { rows } = await env.pool.query<{ count: number }>(
      `SELECT (SELECT count(*) FROM registry.store WHERE client_id = $1)
            + (SELECT count(*) FROM registry.device WHERE id LIKE 'IOT-SINT-%')
            + (SELECT count(*) FROM state.environment_snapshot WHERE environment_id LIKE 'AMB-SINT-%')
            + (SELECT count(*) FROM registry.client WHERE id = $1) AS count`,
      [SYNTHETIC_CLIENT_ID],
    )
    expect(rows[0]?.count).toBe(0)
    expect(await realState()).toEqual(before)
  })
})

test('percentil pelo posto mais próximo', () => {
  const values = Array.from({ length: 30 }, (_, index) => index + 1)
  expect(percentile(values, 0.5)).toBe(15)
  expect(percentile(values, 0.95)).toBe(29)
  expect(percentile([7], 0.95)).toBe(7)
})
