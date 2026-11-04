import type { SnapshotEvent, StateUpdatedEvent } from '@celsius/contracts'
import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common'
import pg from 'pg'
import { Observable, Subject, share } from 'rxjs'
import { z } from 'zod'
import { APP_CONFIG, type AppConfig } from '../config'
import { PG_POOL } from '../database/database.module'

export const EVENTS_CHANNEL = 'celsius_events'

/** Só o que o contrato publica; campos a mais no NOTIFY (como storeIds) ficam de fora. */
const notification = z.object({ now: z.string(), lastSeq: z.number() })

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
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

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
  ) {}

  onModuleInit() {
    void this.connect()
  }

  async onApplicationShutdown() {
    this.stopped = true
    this.subject.complete()
    await this.client?.end().catch(() => undefined)
  }

  /** Estado da ingestão agora; "ingesting" se ela atualizou as projeções nos últimos 10 s. */
  async snapshot(): Promise<SnapshotEvent> {
    const { rows } = await this.pool.query<{ now: Date | null; last_seq: number; ingesting: boolean }>(
      `SELECT now_ts AS now, last_seq,
         (SELECT max(updated_at) FROM state.ingestion) > now() - interval '10 seconds' AS ingesting
       FROM state.ingestion ORDER BY now_ts DESC NULLS LAST LIMIT 1`,
    )
    const row = rows[0]
    return {
      type: 'snapshot',
      now: row?.now?.toISOString() ?? null,
      lastSeq: row?.last_seq ?? 0,
      ingesting: row?.ingesting ?? false,
    }
  }

  private publish(payload: string) {
    const parsed = notification.safeParse(parseJson(payload))
    if (parsed.success) this.subject.next({ type: 'state_updated', ...parsed.data })
    else this.logger.warn('evento com payload inválido ignorado')
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    const client = new pg.Client({
      connectionString: this.config.DATABASE_URL,
      application_name: 'celsius-api-listen',
    })
    client.on('notification', (message) => {
      if (message.channel === EVENTS_CHANNEL && message.payload) this.publish(message.payload)
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
