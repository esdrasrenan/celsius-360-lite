import { parseArgs } from 'node:util'
import { type Config, loadConfig, registryPath } from './config'
import { createClickHouse, createLogger, createPool, type Logger, waitFor } from './infra'
import { buildQualityReport } from './jobs/quality'
import { loadOutdoorTemperature } from './jobs/weather'
import { IngestMetrics } from './metrics'
import { migrateClickHouse, migratePostgres } from './migrate'
import { replay } from './pipeline/replay'
import { registryFileSchema, seedRegistry } from './registry'

const USAGE = `Uso: bun run src/main.ts <comando> [opções]

Comandos:
  migrate   aplica as migrações do Postgres/TimescaleDB e do ClickHouse
  seed      valida e grava o cadastro (dados/cadastro.json)
  weather   carrega a temperatura externa horária (Open-Meteo) de cada loja
  setup     migrate + seed + weather
  replay    reproduz dados/telemetrias.jsonl como se chegasse do broker
  quality   recalcula o relatório de qualidade dos dados
  all       setup + replay + quality

Opções do replay:
  --rate <n>     pacotes por segundo (padrão: INGEST_RATE; 0 = sem limite)
  --from-start   relê a fonte desde o início (idempotente: não duplica nada)
  --rebuild      apaga a série tratada e o estado e reprocessa tudo (use ao mudar uma regra)
  --update-cache grava o cache da temperatura externa (comando weather)`

const TELEMETRY_TABLES = [
  'telemetry.reading',
  'state.device',
  'state.unknown_device',
  'state.environment_snapshot',
  'state.environment_indicator',
  'state.store_snapshot',
  'state.ingestion',
  'state.quality_report',
]

async function main() {
  const { positionals, values } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      rate: { type: 'string' },
      'from-start': { type: 'boolean', default: false },
      rebuild: { type: 'boolean', default: false },
      'update-cache': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })
  const command = positionals[0] ?? 'all'
  if (values.help || !['migrate', 'seed', 'weather', 'setup', 'replay', 'quality', 'all'].includes(command)) {
    console.info(USAGE)
    process.exit(values.help ? 0 : 1)
  }

  const config = loadConfig()
  const logger = createLogger(config.LOG_LEVEL)
  const pool = createPool(config.DATABASE_URL)
  const clickhouse = createClickHouse(config.CLICKHOUSE_URL)

  try {
    await waitFor('Postgres', () => pool.query('SELECT 1'), logger)
    await waitFor(
      'ClickHouse',
      () => clickhouse.ping().then((result) => result.success || Promise.reject(result)),
      logger,
    )

    const steps: Record<string, () => Promise<unknown>> = {
      migrate: async () => {
        await migratePostgres(pool, config.MIGRATIONS_DIR, logger)
        await migrateClickHouse(clickhouse, config.MIGRATIONS_DIR, logger)
      },
      seed: () => seed(config, pool, logger),
      weather: () => loadOutdoorTemperature(pool, config, logger, values['update-cache']),
      replay: async () => {
        if (values.rebuild) {
          await pool.query(`TRUNCATE ${TELEMETRY_TABLES.join(', ')}`)
          logger.warn('série tratada e estado apagados para reprocessamento completo')
        }
        const metrics = new IngestMetrics()
        const server = metrics.serve(config.METRICS_PORT, logger)
        try {
          const summary = await replay({ pool, clickhouse, logger, metrics }, config, {
            fromStart: values['from-start'] || values.rebuild,
            rate: values.rate !== undefined ? Number(values.rate) : config.INGEST_RATE,
            batchSize: config.BATCH_SIZE,
            refreshIntervalMs: config.REFRESH_INTERVAL_MS,
          })
          await buildQualityReport(pool, clickhouse, summary.source, logger)
        } finally {
          server?.stop()
        }
      },
      quality: () => buildQualityReport(pool, clickhouse, config.TELEMETRY_FILE.replace(/\.gz$/, ''), logger),
    }

    const plan: Record<string, string[]> = {
      setup: ['migrate', 'seed', 'weather'],
      all: ['migrate', 'seed', 'weather', 'replay'],
    }
    for (const step of plan[command] ?? [command]) await steps[step]?.()
  } finally {
    await pool.end()
    await clickhouse.close()
  }
}

async function seed(config: Config, pool: ReturnType<typeof createPool>, logger: Logger) {
  const file = Bun.file(registryPath(config))
  if (!(await file.exists())) {
    throw new Error(
      `Cadastro não encontrado em ${registryPath(config)}. Copie os dados do desafio para a pasta dados/.`,
    )
  }
  const parsed = registryFileSchema.safeParse(await file.json())
  if (!parsed.success) {
    throw new Error(
      `Cadastro inválido:\n${parsed.error.issues.map((issue) => `- ${issue.message}`).join('\n')}`,
    )
  }
  await seedRegistry(pool, parsed.data, config.DEMO_PASSWORD, logger)
}

main().catch((error: Error) => {
  console.error(error.message)
  process.exit(1)
})
