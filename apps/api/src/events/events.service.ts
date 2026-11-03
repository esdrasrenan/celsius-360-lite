import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common'
import pg from 'pg'
import { Observable, Subject, share } from 'rxjs'
import { APP_CONFIG, type AppConfig } from '../config'

export const EVENTS_CHANNEL = 'celsius_events'

export interface StateUpdatedEvent {
  type: 'state_updated'
  now: string
  lastSeq: number
  storeIds: string[]
}

/**
 * Escuta o canal NOTIFY que a ingestão dispara a cada atualização das projeções e redistribui para
 * as conexões SSE. Uma conexão dedicada por instância da API, com reconexão automática.
 */
@Injectable()
export class EventsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EventsService.name)
  private readonly subject = new Subject<StateUpdatedEvent>()
  private client: pg.Client | null = null
  private stopped = false
  readonly events$: Observable<StateUpdatedEvent> = this.subject.asObservable().pipe(share())

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  onModuleInit() {
    void this.connect()
  }

  async onApplicationShutdown() {
    this.stopped = true
    this.subject.complete()
    await this.client?.end().catch(() => undefined)
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    const client = new pg.Client({
      connectionString: this.config.DATABASE_URL,
      application_name: 'celsius-api-listen',
    })
    client.on('notification', (message) => {
      if (message.channel !== EVENTS_CHANNEL || !message.payload) return
      try {
        this.subject.next(JSON.parse(message.payload) as StateUpdatedEvent)
      } catch {
        this.logger.warn('evento com payload inválido ignorado')
      }
    })
    client.on('error', (error) => {
      this.logger.warn(`conexão LISTEN caiu: ${error.message}; reconectando`)
      void this.retry(client)
    })
    try {
      await client.connect()
      await client.query(`LISTEN ${EVENTS_CHANNEL}`)
      this.client = client
      this.logger.log(`escutando ${EVENTS_CHANNEL}`)
    } catch (error) {
      this.logger.warn(`não foi possível escutar eventos: ${(error as Error).message}`)
      await this.retry(client)
    }
  }

  private async retry(client: pg.Client) {
    await client.end().catch(() => undefined)
    if (this.client === client) this.client = null
    if (this.stopped) return
    await Bun.sleep(2000)
    await this.connect()
  }
}
