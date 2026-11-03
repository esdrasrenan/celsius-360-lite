import { resolve } from 'node:path'
import { z } from 'zod'

export const ROOT_DIR = resolve(import.meta.dir, '../../..')

const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(8).optional(),
)

const schema = z.object({
  DATABASE_URL: z.string().default('postgres://celsius@localhost:55432/celsius'),
  CLICKHOUSE_URL: z.string().default('http://localhost:58123'),
  DATA_DIR: z.string().default(resolve(ROOT_DIR, 'dados')),
  TELEMETRY_FILE: z.string().default('telemetrias.jsonl'),
  REGISTRY_FILE: z.string().default('cadastro.json'),
  MIGRATIONS_DIR: z.string().default(resolve(ROOT_DIR, 'db')),
  WEATHER_CACHE_FILE: z.string().default(resolve(ROOT_DIR, 'db/seed/temperatura-externa.json')),
  /** Pacotes por segundo na reprodução "em tempo real"; 0 processa o mais rápido possível */
  INGEST_RATE: z.coerce.number().min(0).default(0),
  BATCH_SIZE: z.coerce.number().int().min(1).max(20_000).default(1000),
  /** Intervalo entre atualizações dos agregados e das projeções durante a ingestão */
  REFRESH_INTERVAL_MS: z.coerce.number().int().min(100).default(2000),
  DEMO_PASSWORD: optionalSecret,
  METRICS_PORT: z.coerce.number().int().min(0).default(9464),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export type Config = z.infer<typeof schema>

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env)
}

export function telemetryPath(config: Config): string {
  return resolve(config.DATA_DIR, config.TELEMETRY_FILE)
}

export function registryPath(config: Config): string {
  return resolve(config.DATA_DIR, config.REGISTRY_FILE)
}
