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
import { EnvironmentSummaryDto, SeriesDto, SeriesQueryDto } from './environments.dto'
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
      'Use period (1d, 7d, 30d) ou um intervalo from/to. Os indicadores vêm dos agregados contínuos.',
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
}
