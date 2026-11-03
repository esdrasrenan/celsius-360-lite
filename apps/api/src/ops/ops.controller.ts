import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger'
import type pg from 'pg'
import { Public, Roles, SESSION_COOKIE } from '../auth/session'
import { PG_POOL } from '../database/database.module'
import { HttpMetrics } from './http-metrics'

@ApiTags('Operação')
@Controller()
export class OpsController {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly metrics: HttpMetrics,
  ) {}

  @Public()
  @Get('health/live')
  @ApiOperation({ summary: 'Liveness: o processo responde' })
  live() {
    return { status: 'ok' }
  }

  @Public()
  @Get('health/ready')
  @ApiOperation({ summary: 'Readiness: banco acessível e migrado; informa o "agora" da ingestão' })
  @ApiServiceUnavailableResponse({ description: 'Banco indisponível ou não migrado' })
  async ready() {
    try {
      const { rows } = await this.pool.query<{ now: Date | null; stores: number }>(
        'SELECT (SELECT max(now_ts) FROM state.ingestion) AS now, (SELECT count(*) FROM registry.store) AS stores',
      )
      return { status: 'ok', ingestionNow: rows[0]?.now?.toISOString() ?? null, stores: rows[0]?.stores ?? 0 }
    } catch (error) {
      throw new ServiceUnavailableException(`Banco indisponível: ${(error as Error).message}`)
    }
  }

  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  @ApiOperation({ summary: 'Métricas no formato Prometheus (latência por rota, processo)' })
  metricsText() {
    return this.metrics.registry.metrics()
  }
}

@ApiTags('Operação')
@ApiCookieAuth(SESSION_COOKIE)
@Controller({ path: 'quality', version: '1' })
export class QualityController {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  @Get()
  @Roles('admin_diel')
  @ApiOperation({
    summary: 'Relatório de qualidade da telemetria: o que chegou no dado cru e como foi tratado',
    description:
      'Gerado pela ingestão a partir do ClickHouse (cru) e do TimescaleDB (série). Só administrador da Diel.',
  })
  @ApiOkResponse({ description: 'Pacotes, dispositivos, amostras descartadas, sensor travado e lacunas' })
  @ApiForbiddenResponse({ description: 'Perfil sem acesso' })
  async quality() {
    const { rows } = await this.pool.query<{ generated_at: Date; report: unknown }>(
      'SELECT generated_at, report FROM state.quality_report WHERE id = 1',
    )
    if (!rows[0]) throw new NotFoundException('Relatório ainda não gerado: rode a ingestão')
    return { generatedAt: rows[0].generated_at.toISOString(), ...(rows[0].report as object) }
  }
}
