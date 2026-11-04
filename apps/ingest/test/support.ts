import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
 * Banco Postgres descartável (um por arquivo de teste) e uma fonte própria no ClickHouse: o fixture
 * é copiado com um nome único, então execuções simultâneas não apagam os pacotes umas das outras.
 * Usa os mesmos serviços do Compose (ou do CI): TEST_DATABASE_URL e TEST_CLICKHOUSE_URL.
 * `telemetry` permite alterar as linhas do fixture (ex.: inserir pacotes com relógio adiantado).
 */
export async function createTestEnvironment({
  telemetry,
}: {
  telemetry?: (lines: string[]) => string[]
} = {}) {
  const baseUrl = process.env.TEST_DATABASE_URL ?? 'postgres://celsius@127.0.0.1:55432/celsius'
  const name = `celsius_test_${process.pid}_${Date.now()}`
  const admin = new pg.Client({ connectionString: baseUrl })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${name}`)
  await admin.end()

  const dataDir = await mkdtemp(join(tmpdir(), 'celsius-test-'))
  const source = `${name}.jsonl`
  const fixture = resolve(FIXTURES, FIXTURE_SOURCE)
  if (telemetry) {
    const lines = (await Bun.file(fixture).text()).trimEnd().split('\n')
    await writeFile(join(dataDir, source), `${telemetry(lines).join('\n')}\n`)
  } else {
    await copyFile(fixture, join(dataDir, source))
  }
  await copyFile(resolve(FIXTURES, 'cadastro.json'), join(dataDir, 'cadastro.json'))

  const config: Config = loadConfig({
    DATABASE_URL: baseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${name}`),
    CLICKHOUSE_URL: process.env.TEST_CLICKHOUSE_URL ?? 'http://127.0.0.1:58123',
    DATA_DIR: dataDir,
    TELEMETRY_FILE: source,
    REGISTRY_FILE: 'cadastro.json',
    DEMO_PASSWORD: TEST_PASSWORD,
    LOG_LEVEL: 'silent',
    METRICS_PORT: '0',
  })
  const logger = createLogger('silent', 'test')
  const pool = createPool(config.DATABASE_URL, logger, 'celsius-test')
  const clickhouse = createClickHouse(config.CLICKHOUSE_URL)

  await migratePostgres(pool, config.MIGRATIONS_DIR, logger)
  await migrateClickHouse(clickhouse, config.MIGRATIONS_DIR, logger)
  const registry = registryFileSchema.parse(await Bun.file(resolve(FIXTURES, 'cadastro.json')).json())
  await seedRegistry(pool, registry, TEST_PASSWORD, logger)

  const options: ReplayOptions = { fromStart: false, rate: 0, batchSize: 200, refreshIntervalMs: 100 }
  return {
    config,
    pool,
    clickhouse,
    source,
    logger,
    databaseUrl: config.DATABASE_URL,
    replay: (overrides: Partial<ReplayOptions> = {}) =>
      replay({ pool, clickhouse, logger, metrics: new IngestMetrics() }, config, {
        ...options,
        ...overrides,
      }),
    qualityReport: () => buildQualityReport(pool, clickhouse, source, logger),
    async cleanup() {
      // Não deixa pacotes de teste no ClickHouse da demo (a tabela crua é compartilhada)
      await clickhouse.command({
        query: 'DELETE FROM raw.telemetry_packet WHERE source = {source:String}',
        query_params: { source },
      })
      await pool.end()
      await clickhouse.close()
      await rm(dataDir, { recursive: true, force: true })
      const client = new pg.Client({ connectionString: baseUrl })
      await client.connect()
      await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await client.end()
    },
  }
}

export type TestEnvironment = Awaited<ReturnType<typeof createTestEnvironment>>
