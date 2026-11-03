import { randomBytes } from 'node:crypto'
import { z } from 'zod'

const optional = (schema: z.ZodString) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional())

const schema = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().default('postgres://celsius@localhost:55432/celsius'),
  /** Sem segredo configurado, um aleatório é gerado a cada subida (as sessões caem ao reiniciar). */
  JWT_SECRET: optional(z.string().min(32)),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(8),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  CORS_ORIGIN: optional(z.string()),
  /** Lista os usuários do cadastro na tela de login (sem senha), para facilitar a avaliação local */
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export type AppConfig = Omit<z.infer<typeof schema>, 'JWT_SECRET'> & {
  JWT_SECRET: string
  generatedSecret: boolean
}

export const APP_CONFIG = Symbol('APP_CONFIG')

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = schema.parse(env)
  return {
    ...parsed,
    JWT_SECRET: parsed.JWT_SECRET ?? randomBytes(48).toString('base64url'),
    generatedSecret: parsed.JWT_SECRET === undefined,
  }
}
