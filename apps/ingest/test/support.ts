import { resolve } from 'node:path'
import pg from 'pg'
import { type Config, loadConfig } from '../src/config'
import { createClickHouse, createLogger, createPool } from '../src/infra'
import { buildQualityReport } from '../src/jobs/quality'
import { IngestMetrics } from '../src/metrics'
import { migrateClickHouse, migratePostgres } from '../src/migrate'
import { type ReplayOptions, replay } from '../src/pipeline/replay'
import { registryFileSchema, seedRegistry } from '../src/registry'

export const FIXTURES = resolve(import.meta.dir, '../../../test/fixtures')
export const FIXTURE_SOURCE = 'telemetria-fixture.jsonl'
export const TEST_PASSWORD = 'senha-de-teste-123'
export const expected = (await Bun.file(resolve(FIXTURES, 'esperado.json')).json()) as {
  devices: Record<string, number>
  sensorErrorSamples: number
  stuckSamples: number
  savedDataPackets: number
  exactDuplicates: number
  invalidLines: number
  unknownDevicePackets: number
  offlineAtEnd: string[]
  lines: number
  now: string
}

/**
 * Banco Postgres descartável (um por arquivo de teste) e uma fonte própria no ClickHouse.
 * Usa os mesmos serviços do Compose (ou do CI): TEST_DATABASE_URL e TEST_CLICKHOUSE_URL.
 */
export async function createTestEnvironment() {
  const baseUrl = process.env.TEST_DATABASE_URL ?? 'postgres://celsius@localhost:55432/celsius'
  const name = `celsius_test_${process.pid}_${Date.now()}`
  const admin = new pg.Client({ connectionString: baseUrl })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${name}`)
  await admin.end()

  const config: Config = loadConfig({
    DATABASE_URL: baseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${name}`),
    CLICKHOUSE_URL: process.env.TEST_CLICKHOUSE_URL ?? 'http://localhost:58123',
    DATA_DIR: FIXTURES,
    TELEMETRY_FILE: FIXTURE_SOURCE,
    REGISTRY_FILE: 'cadastro.json',
    DEMO_PASSWORD: TEST_PASSWORD,
    LOG_LEVEL: 'silent',
    METRICS_PORT: '0',
  })
  const pool = createPool(config.DATABASE_URL, 'celsius-test')
  const clickhouse = createClickHouse(config.CLICKHOUSE_URL)
  const logger = createLogger('silent', 'test')

  await migratePostgres(pool, config.MIGRATIONS_DIR, logger)
  await migrateClickHouse(clickhouse, config.MIGRATIONS_DIR, logger)
  await clickhouse.command({
    query: 'DELETE FROM raw.telemetry_packet WHERE source = {source:String}',
    query_params: { source: FIXTURE_SOURCE },
  })
  const registry = registryFileSchema.parse(await Bun.file(resolve(FIXTURES, 'cadastro.json')).json())
  await seedRegistry(pool, registry, TEST_PASSWORD, logger)

  const options: ReplayOptions = { fromStart: false, rate: 0, batchSize: 200, refreshIntervalMs: 100 }
  return {
    config,
    pool,
    clickhouse,
    databaseUrl: config.DATABASE_URL,
    replay: (overrides: Partial<ReplayOptions> = {}) =>
      replay({ pool, clickhouse, logger, metrics: new IngestMetrics() }, config, {
        ...options,
        ...overrides,
      }),
    qualityReport: () => buildQualityReport(pool, clickhouse, FIXTURE_SOURCE, logger),
    async cleanup() {
      await pool.end()
      await clickhouse.close()
      const client = new pg.Client({ connectionString: baseUrl })
      await client.connect()
      await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await client.end()
    },
  }
}

export type TestEnvironment = Awaited<ReturnType<typeof createTestEnvironment>>
