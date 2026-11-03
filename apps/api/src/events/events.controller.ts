import { Controller, type MessageEvent, Sse } from '@nestjs/common'
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { filter, interval, map, merge, type Observable } from 'rxjs'
import { CurrentUser, SESSION_COOKIE, type SessionUser } from '../auth/session'
import { EventsService } from './events.service'

const HEARTBEAT_MS = 15_000

@ApiTags('Tempo real')
@ApiCookieAuth(SESSION_COOKIE)
@Controller({ path: 'events', version: '1' })
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Sse()
  @ApiOperation({
    summary: 'Server-Sent Events: avisa quando a ingestão atualiza o estado das lojas',
    description:
      'Evento "state_updated" com o novo "agora" e as lojas afetadas (só as do escopo do usuário). ' +
      'Um "ping" a cada 15 s mantém a conexão aberta através de proxies.',
  })
  @ApiOkResponse({ description: 'text/event-stream' })
  stream(@CurrentUser() user: SessionUser): Observable<MessageEvent> {
    const updates = this.events.events$.pipe(
      map((event) => ({
        ...event,
        storeIds: user.scope.all
          ? event.storeIds
          : event.storeIds.filter((id) => user.scope.storeIds.includes(id)),
      })),
      filter((event) => event.storeIds.length > 0),
      map((event): MessageEvent => ({ type: 'state_updated', data: event })),
    )
    const heartbeat = interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ type: 'ping', data: {} })))
    return merge(updates, heartbeat)
  }
}
