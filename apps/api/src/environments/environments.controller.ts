import { Controller, Get, Param, Query } from '@nestjs/common'
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'
import { CurrentUser, SESSION_COOKIE, type SessionUser } from '../auth/session'
import { RangeQueryDto } from '../common/time'
import {
  DailySeriesDto,
  EnvironmentSummaryDto,
  SeriesDto,
  SeriesQueryDto,
  WeeklyProfileDto,
} from './environments.dto'
import { EnvironmentsService } from './environments.service'

@ApiTags('Ambientes')
@ApiCookieAuth(SESSION_COOKIE)
@ApiParam({ name: 'id', example: 'AMB-003' })
@ApiNotFoundResponse({ description: 'Ambiente inexistente ou fora do escopo do usuário' })
@Controller({ path: 'environments', version: '1' })
export class EnvironmentsController {
  constructor(private readonly environments: EnvironmentsService) {}

  @Get(':id/summary')
  @ApiOperation({
    summary: 'Resumo do ambiente: cadastro, status agora e indicadores do período',
    description:
      'Use period (1d, 7d, 30d) ou um intervalo from/to. Até 8 h, os indicadores saem da série com os ' +
      'limites pedidos; acima, dos agregados contínuos, com a janela alinhada aos buckets (devolvida em period).',
  })
  @ApiOkResponse({ type: EnvironmentSummaryDto })
  summary(@Param('id') id: string, @Query() query: RangeQueryDto, @CurrentUser() user: SessionUser) {
    return this.environments.summary(id, query, user.scope)
  }

  @Get(':id/series')
  @ApiOperation({
    summary: 'Série de temperatura do ambiente num intervalo, com agregação adequada ao tamanho do intervalo',
    description:
      'Traz média, mínima e máxima por bucket, lacunas e indisponibilidades, temperatura externa e o horário de funcionamento.',
  })
  @ApiOkResponse({ type: SeriesDto })
  series(@Param('id') id: string, @Query() query: SeriesQueryDto, @CurrentUser() user: SessionUser) {
    return this.environments.series(id, query, user.scope)
  }

  @Get(':id/profile')
  @ApiOperation({
    summary: 'Perfil semanal: conforto por hora do dia e dia da semana, no fuso da loja',
    description:
      'Responde "que hora e que dia saem da faixa?". 168 células (segunda a domingo × 0 h a 23 h) a partir do ' +
      'agregado de 1 h; células sem leitura vêm com percentuais nulos, nunca zero.',
  })
  @ApiOkResponse({ type: WeeklyProfileDto })
  profile(@Param('id') id: string, @Query() query: RangeQueryDto, @CurrentUser() user: SessionUser) {
    return this.environments.profile(id, query, user.scope)
  }

  @Get(':id/daily')
  @ApiOperation({
    summary: 'Conforto por dia, no fuso da loja',
    description:
      'Um item por dia local do período: minutos no horário dentro, acima e abaixo da faixa, cobertura e ' +
      'temperatura média com a loja aberta.',
  })
  @ApiOkResponse({ type: DailySeriesDto })
  daily(@Param('id') id: string, @Query() query: RangeQueryDto, @CurrentUser() user: SessionUser) {
    return this.environments.daily(id, query, user.scope)
  }
}
