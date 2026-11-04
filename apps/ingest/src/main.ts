import { parseArgs } from 'node:util'
import { type Config, loadConfig, registryPath } from './config'
import {
  createClickHouse,
  createLogger,
  createPool,
  type Logger,
  retryOnConnectionError,
  waitFor,
} from './infra'
import { buildQualityReport } from './jobs/quality'
import { ensureSessionSecret } from './jobs/session-secret'
import { clearSyntheticNetwork, createSyntheticNetwork, measureNetworkView } from './jobs/synthetic-network'
import { loadOutdoorTemperature } from './jobs/weather'
import { IngestMetrics } from './metrics'
import { migrateClickHouse, migratePostgres } from './migrate'
import { replay } from './pipeline/replay'
import { type DemoAccess, formatAccess, registryFileSchema, seedRegistry } from './registry'

const USAGE = `Uso: bun run apps/ingest/src/main.ts <comando> [opções]

Comandos:
  migrate         aplica as migrações do Postgres/TimescaleDB e do ClickHouse
  seed            valida e grava o cadastro (dados/cadastro.json)
  weather         carrega a temperatura externa horária (Open-Meteo) de cada loja
  setup           migrate + seed + weather + segredo da sessão; termina com o quadro de acesso
  replay          reproduz dados/telemetrias.jsonl como se chegasse do broker
  quality         recalcula o relatório de qualidade dos dados
  rede-sintetica  grava lojas sintéticas (LOJA-SINT-...) para ver a visão da rede com centenas de lojas
  all             setup + replay + quality

Opções do replay:
  --rate <n>      pacotes por segundo (padrão: INGEST_RATE; 0 = sem limite)
  --from-start    relê a fonte desde o início (idempotente: não duplica nada)
  --rebuild       apaga a série tratada e o estado e reprocessa tudo (use ao mudar uma regra)
  --update-cache  grava o cache da temperatura externa (comando weather)

Opções de rede-sintetica (sem opção, grava 500 lojas):
  --lojas <n>     quantas lojas gravar, com 6 ambientes e dispositivos cada (substitui a rede anterior)
  --limpar        remove só as lojas sintéticas; o conjunto real não é tocado
  --medir         entra na API (API_URL) com DEMO_PASSWORD e mede p50 e p95 da listagem

No Docker: docker compose run --rm ingest bun run apps/ingest/src/main.ts rede-sintetica --lojas 500`

const COMMANDS = ['migrate', 'seed', 'weather', 'setup', 'replay', 'quality', 'rede-sintetica', 'all']

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
      lojas: { type: 'string' },
      limpar: { type: 'boolean', default: false },
      medir: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })
  const command = positionals[0] ?? 'all'
  if (values.help || !COMMANDS.includes(command)) {
    console.info(USAGE)
    process.exit(values.help ? 0 : 1)
  }
  const stores = Number(values.lojas ?? 500)
  if (!Number.isInteger(stores) || stores < 1 || stores > 5000) {
    throw new Error('--lojas precisa ser um número inteiro entre 1 e 5000')
  }

  const config = loadConfig()
  const logger = createLogger(config.LOG_LEVEL)
  const pool = createPool(config.DATABASE_URL, logger)
  const clickhouse = createClickHouse(config.CLICKHOUSE_URL)
  // Preenchido pelo passo seed; o quadro de acesso sai depois do último passo
  let access = null as DemoAccess | null

  try {
    await waitFor('Postgres', () => pool.query('SELECT 1'), logger)
    if (command !== 'rede-sintetica') {
      await waitFor(
        'ClickHouse',
        () => clickhouse.ping().then((result) => result.success || Promise.reject(result)),
        logger,
      )
    }

    const steps: Record<string, () => Promise<unknown>> = {
      migrate: async () => {
        await migratePostgres(pool, config.MIGRATIONS_DIR, logger)
        await migrateClickHouse(clickhouse, config.MIGRATIONS_DIR, logger)
      },
      seed: async () => {
        access = await seed(config, pool, logger)
      },
      weather: () => loadOutdoorTemperature(pool, config, logger, values['update-cache']),
      secret: () => ensureSessionSecret(config, logger),
      replay: async () => {
        if (values.rebuild) {
          await pool.query(`TRUNCATE ${TELEMETRY_TABLES.join(', ')}`)
          logger.warn('série tratada e estado apagados para reprocessamento completo')
        }
        const metrics = new IngestMetrics()
        const server = metrics.serve(config.METRICS_PORT, logger)
        // Só a primeira tentativa relê desde o início; depois de uma queda do banco, retoma do checkpoint
        let fromStart = values['from-start'] || values.rebuild
        try {
          await retryOnConnectionError(async () => {
            const options = {
              fromStart,
              rate: values.rate !== undefined ? Number(values.rate) : config.INGEST_RATE,
              batchSize: config.BATCH_SIZE,
              refreshIntervalMs: config.REFRESH_INTERVAL_MS,
            }
            fromStart = false
            const summary = await replay({ pool, clickhouse, logger, metrics }, config, options)
            await buildQualityReport(pool, clickhouse, summary.source, logger)
          }, logger)
        } finally {
          server?.stop()
        }
      },
      quality: () => buildQualityReport(pool, clickhouse, config.TELEMETRY_FILE.replace(/\.gz$/, ''), logger),
      'rede-sintetica': async () => {
        if (values.limpar) {
          const removed = await clearSyntheticNetwork(pool)
          console.info(`${removed} lojas sintéticas removidas; o conjunto real não foi tocado.`)
          return
        }
        if (values.lojas !== undefined || !values.medir) {
          const created = await createSyntheticNetwork(pool, stores)
          console.info(
            `${created.stores} lojas sintéticas, ${created.environments} ambientes e dispositivos gravados ` +
              `(prefixo LOJA-SINT-, cliente "Rede Sintética"). Recarregue a visão da rede. ` +
              'Para remover: rede-sintetica --limpar',
          )
        }
        if (values.medir) console.info(await measureNetworkView(pool, config))
      },
    }

    const plan: Record<string, string[]> = {
      setup: ['migrate', 'seed', 'weather', 'secret'],
      all: ['migrate', 'seed', 'weather', 'secret', 'replay'],
    }
    for (const step of plan[command] ?? [command]) await steps[step]?.()
    if (access) console.info(formatAccess(access, config.APP_URL))
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
  return seedRegistry(pool, parsed.data, config.DEMO_PASSWORD, logger)
}

main().catch((error: Error) => {
  console.error(error.message)
  process.exit(1)
})
