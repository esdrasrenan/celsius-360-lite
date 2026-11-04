import { resolve } from 'node:path'
import { z } from 'zod'

export const ROOT_DIR = resolve(import.meta.dir, '../../..')

/** Variável vazia no .env (DEMO_PASSWORD=) vale como não definida. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional())

const schema = z.object({
  DATABASE_URL: z.string().default('postgres://celsius@127.0.0.1:55432/celsius'),
  CLICKHOUSE_URL: z.string().default('http://127.0.0.1:58123'),
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
  DEMO_PASSWORD: optional(
    z.string().min(8, 'precisa ter ao menos 8 caracteres').max(256, 'pode ter no máximo 256 caracteres'),
  ),
  /** Segredo da sessão vindo do .env; com ele, o setup não gera o arquivo JWT_SECRET_FILE */
  JWT_SECRET: optional(z.string().min(32, 'precisa ter ao menos 32 caracteres')),
  /** Onde o setup grava o segredo gerado (volume compartilhado com a API, só leitura lá) */
  JWT_SECRET_FILE: optional(z.string()),
  /** Endereço da aplicação mostrado no fim do setup */
  APP_URL: z.string().default('http://127.0.0.1:8080'),
  /** API usada por `rede-sintetica --medir` */
  API_URL: z.string().default('http://127.0.0.1:3000'),
  METRICS_PORT: z.coerce.number().int().min(0).default(9464),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export type Config = z.infer<typeof schema>

/** Lança um erro legível (sem stack) que a CLI mostra antes de sair com código 1. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env, { error: z.locales.pt().localeError })
  if (!result.success) throw new Error(`Configuração inválida:\n${z.prettifyError(result.error)}`)
  return result.data
}

export function telemetryPath(config: Config): string {
  return resolve(config.DATA_DIR, config.TELEMETRY_FILE)
}

export function registryPath(config: Config): string {
  return resolve(config.DATA_DIR, config.REGISTRY_FILE)
}
