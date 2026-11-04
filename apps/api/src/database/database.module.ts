import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common'
import pg from 'pg'
import { APP_CONFIG, type AppConfig } from '../config'

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value))
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value))

export const PG_POOL = Symbol('PG_POOL')

function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    application_name: 'celsius-api',
    // Com o banco fora, a requisição falha em 5 s em vez de esperar sem fim
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5_000,
  })
  // Sem este ouvinte, a queda de uma conexão ociosa (reinício do banco, corte do proxy) vira
  // exceção não tratada e encerra o processo. O pool descarta o cliente e abre outro no próximo uso.
  const logger = new Logger('Postgres')
  pool.on('error', (error) => logger.warn(`conexão ociosa caiu e foi descartada: ${error.message}`))
  return pool
}

@Injectable()
class PoolLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown() {
    await this.pool.end()
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createPool(config.DATABASE_URL),
    },
    PoolLifecycle,
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
