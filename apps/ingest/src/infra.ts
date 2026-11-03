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

export function createPool(connectionString: string, applicationName = 'celsius-ingest'): pg.Pool {
  return new pg.Pool({ connectionString, max: 5, application_name: applicationName })
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
