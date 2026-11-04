import { Global, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { LoggerModule } from 'nestjs-pino'
import { AuthModule } from './auth/auth.module'
import { ProblemDetailsFilter } from './common/problem.filter'
import { requestIdFrom } from './common/request-id'
import { APP_CONFIG, type AppConfig, loadConfig } from './config'
import { DatabaseModule } from './database/database.module'
import { EnvironmentsModule } from './environments/environments.module'
import { EventsModule } from './events/events.module'
import { OpsModule } from './ops/ops.module'
import { StoresModule } from './stores/stores.module'

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: loadConfig }],
  exports: [APP_CONFIG],
})
class ConfigModule {}

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.LOG_LEVEL,
          genReqId: (request, response) => {
            const id = requestIdFrom(request.headers['x-request-id'])
            response.setHeader('x-request-id', id)
            return id
          },
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          autoLogging: {
            ignore: (request) => ['/health/live', '/health/ready', '/metrics'].includes(request.url ?? ''),
          },
          customProps: () => ({ service: 'api' }),
        },
      }),
    }),
    DatabaseModule,
    AuthModule,
    StoresModule,
    EnvironmentsModule,
    EventsModule,
    OpsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
