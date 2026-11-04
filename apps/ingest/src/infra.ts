import { type ClickHouseClient, createClient } from '@clickhouse/client'
import pg from 'pg'
import pino from 'pino'

// Contagens e somas vêm como bigint/numeric; os valores daqui cabem com folga em Number
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value))
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value))

export type Logger = pino.Logger

export function createLogger(level: string, service = 'ingest'): Logger {
  return pino({ level, base: { service }, timestamp: pino.stdTimeFunctions.isoTime })
}

export function createPool(
  connectionString: string,
  logger: Logger,
  applicationName = 'celsius-ingest',
): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    application_name: applicationName,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
  })
  // Sem ouvinte, a queda de uma conexão (reinício do banco) vira exceção não tratada e derruba o
  // processo: a ociosa avisa pelo pool; a que está em uso numa transação, pelo próprio cliente, e o
  // erro volta na consulta seguinte, que a ingestão repete a partir do checkpoint
  pool.on('error', (error) => logger.warn({ err: error.message }, 'conexão ociosa com o Postgres caiu'))
  pool.on('connect', (client) =>
    client.on('error', (error) => logger.debug({ err: error.message }, 'conexão com o Postgres caiu')),
  )
  return pool
}

export function createClickHouse(url: string): ClickHouseClient {
  return createClient({
    url,
    clickhouse_settings: { date_time_input_format: 'best_effort', async_insert: 0 },
  })
}

/** Espera o banco aceitar conexões; útil fora do Compose, que já espera o healthcheck. */
export async function waitFor(name: string, check: () => Promise<unknown>, logger: Logger, attempts = 30) {
  for (let attempt = 1; ; attempt++) {
    try {
      await check()
      return
    } catch (error) {
      if (attempt >= attempts) throw error
      logger.warn({ attempt, err: (error as Error).message }, `aguardando ${name}`)
      await Bun.sleep(1000)
    }
  }
}

const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
])

/** Banco reiniciando, conexão derrubada ou recusada: vale tentar de novo. Erro de SQL ou de dados, não. */
export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && (CONNECTION_CODES.has(code) || /^(08|57P0)/.test(code))) return true
  return /Connection terminated|not queryable|timeout exceeded when trying to connect|socket hang up/i.test(
    error.message,
  )
}

/**
 * Repete a tarefa quando o banco cai no meio dela. A ingestão grava o checkpoint na mesma transação
 * da série, então cada nova tentativa retoma de onde parou, sem duplicar nada.
 */
export async function retryOnConnectionError<T>(
  task: () => Promise<T>,
  logger: Logger,
  { attempts = 30, delayMs = 2000 } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task()
    } catch (error) {
      if (attempt >= attempts || !isConnectionError(error)) throw error
      logger.warn({ attempt, err: (error as Error).message }, 'banco indisponível; retomando do checkpoint')
      await Bun.sleep(delayMs)
    }
  }
}
