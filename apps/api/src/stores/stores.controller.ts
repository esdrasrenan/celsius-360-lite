import { Controller, Get, Query } from '@nestjs/common'
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser, SESSION_COOKIE, type SessionUser } from '../auth/session'
import { ClientListItemDto, ListStoresQueryDto, StoreListDto } from './stores.dto'
import { StoresService } from './stores.service'

@ApiTags('Rede')
@ApiCookieAuth(SESSION_COOKIE)
@Controller({ version: '1' })
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get('stores')
  @ApiOperation({
    summary: 'Lojas com status e indicadores do período, com filtros, ordenação e paginação',
    description:
      'Cada loja traz seus ambientes (status, situação agora e conforto do período). ' +
      'O resultado respeita o escopo do usuário: gestor vê as lojas do cliente; gerente, só as suas.',
  })
  @ApiOkResponse({ type: StoreListDto })
  list(@Query() query: ListStoresQueryDto, @CurrentUser() user: SessionUser) {
    return this.stores.list(query, user.scope)
  }

  @Get('clients')
  @ApiOperation({ summary: 'Clientes visíveis para o usuário (para o filtro da visão da rede)' })
  @ApiOkResponse({ type: [ClientListItemDto] })
  clients(@CurrentUser() user: SessionUser) {
    return this.stores.clients(user.scope)
  }
}
