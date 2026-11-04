import type { QualityReport } from '@celsius/contracts'
import {
  Controller,
  Get,
  Header,
  Inject,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger'
import type pg from 'pg'
import { Public, Roles, SESSION_COOKIE } from '../auth/session'
import { PG_POOL } from '../database/database.module'
import { HttpMetrics } from './http-metrics'

export class ReadinessDto {
  @ApiProperty({ enum: ['ok'] }) status: 'ok'
  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description: '"Agora" da ingestão; nulo antes do primeiro pacote',
  })
  ingestionNow: string | null
  @ApiProperty({ type: 'integer', description: 'Lojas no cadastro' }) stores: number
}

@ApiTags('Operação')
@Controller()
export class OpsController {
  private readonly logger = new Logger(OpsController.name)

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
  @ApiOkResponse({ type: ReadinessDto })
  @ApiServiceUnavailableResponse({ description: 'Banco indisponível ou não migrado' })
  async ready(): Promise<ReadinessDto> {
    try {
      const { rows } = await this.pool.query<{ now: Date | null; stores: number }>(
        'SELECT (SELECT max(now_ts) FROM state.ingestion) AS now, (SELECT count(*) FROM registry.store) AS stores',
      )
      return { status: 'ok', ingestionNow: rows[0]?.now?.toISOString() ?? null, stores: rows[0]?.stores ?? 0 }
    } catch (error) {
      // A rota é pública: o detalhe do erro do banco fica só no log
      this.logger.warn(`readiness: banco indisponível: ${(error as Error).message}`)
      throw new ServiceUnavailableException('Banco indisponível ou não migrado.')
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
  @ApiNotFoundResponse({ description: 'A ingestão ainda não gerou o relatório' })
  async quality(): Promise<QualityReport> {
    const { rows } = await this.pool.query<{
      generated_at: Date
      report: Omit<QualityReport, 'generatedAt'>
    }>('SELECT generated_at, report FROM state.quality_report WHERE id = 1')
    const row = rows[0]
    if (!row) {
      throw new NotFoundException(
        'O relatório de qualidade ainda não foi gerado: ele sai quando a ingestão termina de reproduzir a telemetria.',
      )
    }
    // Campo a campo: o JSON salvo pela ingestão pode ter mais do que o contrato publica
    const { source, packets, devices, samples, stuckEpisodes, gaps } = row.report
    return {
      generatedAt: row.generated_at.toISOString(),
      source,
      packets,
      devices,
      samples,
      stuckEpisodes,
      gaps,
    }
  }
}
