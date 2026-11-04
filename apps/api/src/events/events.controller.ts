import { Controller, type MessageEvent, Sse } from '@nestjs/common'
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger'
import { concat, interval, map, merge, type Observable, of } from 'rxjs'
import { SESSION_COOKIE } from '../auth/session'
import { EventsService } from './events.service'

const HEARTBEAT_MS = 15_000

@ApiTags('Tempo real')
@ApiCookieAuth(SESSION_COOKIE)
@Controller({ path: 'events', version: '1' })
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Sse()
  @ApiOperation({
    summary: 'Server-Sent Events: estado da ingestão ao conectar e aviso a cada atualização',
    description:
      'Primeiro evento "snapshot" {type, now, lastSeq, ingesting}: "agora" da ingestão e se ela atualizou as ' +
      'projeções nos últimos 10 s. Depois, "state_updated" {type, now, lastSeq} a cada atualização; a interface ' +
      'refaz as próprias consultas, que já respeitam o escopo do usuário. Um "ping" a cada 15 s mantém a ' +
      'conexão aberta através de proxies.',
  })
  @ApiOkResponse({
    description: 'Fluxo de eventos snapshot, state_updated e ping',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  @ApiUnauthorizedResponse({ description: 'Sem sessão válida' })
  async stream(): Promise<Observable<MessageEvent>> {
    // Consulta antes de abrir o fluxo: com o banco fora, a resposta é um erro HTTP, não um fluxo vazio
    const snapshot = await this.events.snapshot()
    const updates = this.events.events$.pipe(
      map((event): MessageEvent => ({ type: event.type, data: event })),
    )
    const heartbeat = interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ type: 'ping', data: {} })))
    return concat(of<MessageEvent>({ type: snapshot.type, data: snapshot }), merge(updates, heartbeat))
  }
}
