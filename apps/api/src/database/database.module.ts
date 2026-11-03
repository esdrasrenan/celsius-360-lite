import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common'
import pg from 'pg'
import { APP_CONFIG, type AppConfig } from '../config'

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value))
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value))

export const PG_POOL = Symbol('PG_POOL')

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
      useFactory: (config: AppConfig) =>
        new pg.Pool({ connectionString: config.DATABASE_URL, max: 10, application_name: 'celsius-api' }),
    },
    PoolLifecycle,
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
