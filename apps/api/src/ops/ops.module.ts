import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { HttpMetrics, HttpMetricsInterceptor } from './http-metrics'
import { OpsController, QualityController } from './ops.controller'

@Module({
  controllers: [OpsController, QualityController],
  providers: [HttpMetrics, { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor }],
})
export class OpsModule {}
