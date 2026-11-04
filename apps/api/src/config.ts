import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { z } from 'zod'

const optional = (schema: z.ZodString) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional())

const SECRET_MIN = 32

const schema = z
  .object({
    PORT: z.coerce.number().int().default(3000),
    DATABASE_URL: z.string().default('postgres://celsius@127.0.0.1:55432/celsius'),
    JWT_SECRET: optional(
      z.string().min(SECRET_MIN, `JWT_SECRET precisa ter ao menos ${SECRET_MIN} caracteres`),
    ),
    /** Arquivo com o segredo (o setup do Compose gera um, uma vez, num volume). Vale quando JWT_SECRET está vazio. */
    JWT_SECRET_FILE: optional(z.string()),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(8),
    /** Força o cookie Secure; sem isso, ele segue o protocolo da requisição (X-Forwarded-Proto). */
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
  .transform(({ JWT_SECRET_FILE, ...env }, context) => {
    let secret = env.JWT_SECRET
    if (!secret && JWT_SECRET_FILE) {
      try {
        secret = readFileSync(JWT_SECRET_FILE, 'utf8').trim()
      } catch (error) {
        const reason = (error as NodeJS.ErrnoException).code ?? (error as Error).message
        context.addIssue({
          code: 'custom',
          path: ['JWT_SECRET_FILE'],
          message: `não foi possível ler ${JWT_SECRET_FILE} (${reason})`,
        })
        return z.NEVER
      }
      if (secret.length < SECRET_MIN) {
        context.addIssue({
          code: 'custom',
          path: ['JWT_SECRET_FILE'],
          message: `o segredo em ${JWT_SECRET_FILE} precisa ter ao menos ${SECRET_MIN} caracteres`,
        })
        return z.NEVER
      }
    }
    // Segredo gerado a cada subida derruba as sessões num reinício: só se aceita na demonstração
    if (!secret && !env.DEMO_MODE) {
      context.addIssue({
        code: 'custom',
        message: `defina JWT_SECRET (mínimo ${SECRET_MIN} caracteres) ou JWT_SECRET_FILE`,
      })
      return z.NEVER
    }
    return {
      ...env,
      JWT_SECRET: secret ?? randomBytes(48).toString('base64url'),
      generatedSecret: !secret,
    }
  })

export type AppConfig = z.output<typeof schema>

export const APP_CONFIG = Symbol('APP_CONFIG')

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const result = schema.safeParse(env, { error: z.locales.ptBR().localeError })
  if (!result.success) throw new ConfigError(`Configuração inválida:\n${z.prettifyError(result.error)}`)
  return result.data
}
