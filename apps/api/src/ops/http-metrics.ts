import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common'
import type { Request, Response } from 'express'
import client from 'prom-client'
import { type Observable, tap } from 'rxjs'

@Injectable()
export class HttpMetrics {
  readonly registry = new client.Registry()
  readonly duration = new client.Histogram({
    name: 'celsius_http_request_duration_seconds',
    help: 'Latência das requisições HTTP, por rota',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  })

  constructor() {
    client.collectDefaultMetrics({ register: this.registry })
  }
}

/** Mede cada requisição pela rota declarada (não pela URL), para não explodir a cardinalidade. */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: HttpMetrics) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle()
    const http = context.switchToHttp()
    const request = http.getRequest<Request>()
    const stop = this.metrics.duration.startTimer({ method: request.method })
    const label = () => ({
      route: (request.route as { path?: string } | undefined)?.path ?? 'desconhecida',
      status: String(http.getResponse<Response>().statusCode),
    })
    return next.handle().pipe(
      tap({
        next: () => undefined,
        complete: () => stop(label()),
        error: () => stop({ ...label(), status: 'erro' }),
      }),
    )
  }
}
