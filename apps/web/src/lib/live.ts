import type { SnapshotEvent, StateUpdatedEvent } from '@celsius/contracts'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { ApiError, api } from '../api/client'
import { useSessionExpired } from '../api/query-client'

/** Esperas entre tentativas de reconexão do SSE: 1, 2, 5 e, daí em diante, 30 s. */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 30_000] as const
/** Sem evento da ingestão por este tempo, o chip sai de "Ao vivo" para "Dados até…". */
export const LIVE_WINDOW_MS = 10_000
const INVALIDATE_EVERY_MS = 1_500
/**
 * Prefixos das chaves de api/queries.ts refeitos a cada atualização da ingestão. A qualidade fica
 * fora: o relatório só é gravado depois da reprodução, quando nenhum evento sai mais.
 */
export const LIVE_QUERY_PREFIXES = ['stores', 'environment'] as const

export interface LiveState {
  /** SSE aberto e com o snapshot inicial recebido. */
  connected: boolean
  /** "Agora" da ingestão: o horário do último pacote processado. */
  now: string | null
  /** Date.now() do último sinal de ingestão ativa (state_updated, ou snapshot com ingesting). */
  lastEventAt: number | null
  /** Date.now() da próxima tentativa de reconexão; null quando conectado ou na primeira conexão. */
  retryAt: number | null
}

export type LiveStatus = 'connecting' | 'live' | 'idle' | 'reconnecting' | 'expired'

let state: LiveState = { connected: false, now: null, lastEventAt: null, retryAt: null }
const listeners = new Set<() => void>()

function update(patch: Partial<LiveState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLiveState(): LiveState {
  return useSyncExternalStore(subscribe, () => state)
}

export function reconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] as number
}

/** Os quatro estados do chip (mais "conectando", que dura o tempo do primeiro snapshot). */
export function liveStatus(live: LiveState, expired: boolean, at: number): LiveStatus {
  if (expired) return 'expired'
  if (!live.connected) return live.retryAt === null ? 'connecting' : 'reconnecting'
  return live.lastEventAt !== null && at - live.lastEventAt < LIVE_WINDOW_MS ? 'live' : 'idle'
}

/** Segundos inteiros até a próxima tentativa, arredondados para cima. */
export function retrySeconds(retryAt: number, at: number): number {
  return Math.max(0, Math.ceil((retryAt - at) / 1_000))
}

/**
 * Estado do chip ao vivo, reavaliado a cada segundo: "Ao vivo" expira sozinho quando os eventos
 * param, e a contagem de "Reconectando em N s" anda.
 */
export function useLiveStatus(): { status: LiveStatus; now: string | null; retryInSeconds: number | null } {
  const live = useLiveState()
  const expired = useSessionExpired()
  const [at, setAt] = useState(Date.now)
  const { retryAt } = live
  // Cada tentativa recomeça o relógio, com os tiques alinhados à espera: com o tique anterior (até
  // 1 s velho), a espera de 1 s apareceria como "2 s". O layout effect troca o número antes da pintura
  useLayoutEffect(() => {
    if (retryAt !== null) setAt(Date.now())
    const timer = setInterval(() => setAt(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [retryAt])
  const status = liveStatus(live, expired, at)
  const retryInSeconds = status === 'reconnecting' && retryAt !== null ? retrySeconds(retryAt, at) : null
  return { status, now: live.now, retryInSeconds }
}

const parse = <T>(message: Event) => JSON.parse((message as MessageEvent<string>).data) as T

/**
 * Confere a sessão por uma consulta do cache: um 401 passa pelo tratamento global de
 * api/query-client.ts, que marca a sessão como expirada e leva a casca ao login.
 */
async function sessionIsValid(client: QueryClient): Promise<boolean> {
  try {
    await client.fetchQuery({
      queryKey: ['live', 'session-check'],
      queryFn: ({ signal }) => api('/auth/me', { signal }),
      retry: false,
      staleTime: 0,
      gcTime: 0,
    })
    return true
  } catch (error) {
    // Falha de rede ou 5xx não diz nada da sessão: tenta de novo
    return !(error instanceof ApiError && error.status === 401)
  }
}

/** Abre o SSE e cuida da reconexão; devolve a função que fecha tudo. Exportada para o teste. */
export function connect(client: QueryClient): () => void {
  let source: EventSource | null = null
  let attempt = 0
  let lastSeq: number | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let invalidateTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  // Agrupa as atualizações: uma rajada de eventos refaz cada consulta uma vez a cada 1,5 s
  const invalidateSoon = () => {
    invalidateTimer ??= setTimeout(() => {
      invalidateTimer = null
      for (const prefix of LIVE_QUERY_PREFIXES) void client.invalidateQueries({ queryKey: [prefix] })
    }, INVALIDATE_EVERY_MS)
  }

  const open = () => {
    retryTimer = null
    source = new EventSource('/api/v1/events')

    source.addEventListener('snapshot', (message) => {
      const event = parse<SnapshotEvent>(message)
      attempt = 0
      // Voltou de uma queda: o que mudou enquanto a conexão estava fora é refeito uma vez
      if (lastSeq !== null && event.lastSeq !== lastSeq) invalidateSoon()
      lastSeq = event.lastSeq
      update({
        connected: true,
        retryAt: null,
        now: event.now,
        lastEventAt: event.ingesting ? Date.now() : state.lastEventAt,
      })
    })

    source.addEventListener('state_updated', (message) => {
      const event = parse<StateUpdatedEvent>(message)
      lastSeq = event.lastSeq
      update({ connected: true, now: event.now, lastEventAt: Date.now() })
      invalidateSoon()
    })

    // O navegador só retenta sozinho falha de rede; resposta HTTP (401, 5xx) fecha o SSE de vez.
    // Nos dois casos a reconexão fica aqui: fecha, confere a sessão e reabre com espera crescente.
    source.onerror = () => {
      source?.close()
      source = null
      const retryAt = Date.now() + reconnectDelay(attempt++)
      update({ connected: false, retryAt })
      void sessionIsValid(client).then((valid) => {
        if (stopped || !valid) return
        retryTimer = setTimeout(open, Math.max(0, retryAt - Date.now()))
      })
    }
  }

  open()
  return () => {
    stopped = true
    if (retryTimer) clearTimeout(retryTimer)
    if (invalidateTimer) clearTimeout(invalidateTimer)
    source?.close()
    update({ connected: false, retryAt: null })
  }
}

/**
 * Assina o SSE da API enquanto há sessão: o snapshot inicial dá o "agora" e diz se a ingestão está
 * rodando; cada state_updated refaz as consultas da rede e do ambiente.
 */
export function useLiveUpdates(enabled: boolean) {
  const client = useQueryClient()
  useEffect(() => (enabled ? connect(client) : undefined), [client, enabled])
}
