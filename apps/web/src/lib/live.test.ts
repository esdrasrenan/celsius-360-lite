import { afterEach, beforeEach, describe, expect, jest, mock, spyOn, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import {
  connect,
  LIVE_QUERY_PREFIXES,
  type LiveState,
  liveStatus,
  reconnectDelay,
  retrySeconds,
} from './live'

const base: LiveState = { connected: true, now: '2026-02-11T02:59:56Z', lastEventAt: null, retryAt: null }

describe('estado do chip ao vivo', () => {
  test('ao vivo só enquanto chegam eventos (10 s)', () => {
    expect(liveStatus({ ...base, lastEventAt: 1_000 }, false, 10_999)).toBe('live')
    expect(liveStatus({ ...base, lastEventAt: 1_000 }, false, 11_000)).toBe('idle')
  })

  test('conectado e sem eventos: dados até o último pacote', () => {
    expect(liveStatus(base, false, 0)).toBe('idle')
  })

  test('primeira conexão e reconexão se distinguem pela próxima tentativa', () => {
    expect(liveStatus({ ...base, connected: false }, false, 0)).toBe('connecting')
    expect(liveStatus({ ...base, connected: false, retryAt: 5_000 }, false, 0)).toBe('reconnecting')
  })

  test('sessão expirada vence qualquer outro estado', () => {
    expect(liveStatus({ ...base, lastEventAt: 0 }, true, 1)).toBe('expired')
    expect(liveStatus({ ...base, connected: false, retryAt: 5_000 }, true, 0)).toBe('expired')
  })
})

describe('espera entre reconexões', () => {
  test('1, 2, 5 e depois 30 s', () => {
    expect([0, 1, 2, 3, 4, 10].map(reconnectDelay)).toEqual([1_000, 2_000, 5_000, 30_000, 30_000, 30_000])
  })

  test('a contagem mostra a espera inteira, sem arredondar 1 s para 2', () => {
    expect(retrySeconds(11_000, 10_000)).toBe(1)
    expect(retrySeconds(15_000, 10_000)).toBe(5)
    expect(retrySeconds(10_400, 10_000)).toBe(1)
    expect(retrySeconds(9_000, 10_000)).toBe(0)
  })
})

/** SSE falso: guarda cada conexão aberta e entrega eventos como o EventSource do navegador. */
class FakeEventSource {
  static opened: FakeEventSource[] = []
  closed = false
  onerror: (() => void) | null = null
  private readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>()

  constructor(readonly url: string) {
    FakeEventSource.opened.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close() {
    this.closed = true
  }

  emit(type: 'snapshot' | 'state_updated', data: object) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) })
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

const latest = () => FakeEventSource.opened.at(-1) as FakeEventSource
/** Deixa a conferência da sessão (uma promessa) terminar; setImmediate não é falsificado. */
const settle = () => new Promise((resolve) => setImmediate(resolve))
const snapshot = (lastSeq: number) => ({ now: '2026-02-11T02:59:56Z', lastSeq, ingesting: false })
const stateUpdated = (lastSeq: number) => ({ now: '2026-02-11T02:59:56Z', lastSeq })

describe('conexão de tempo real', () => {
  const realEventSource = globalThis.EventSource
  const realFetch = globalThis.fetch
  let sessionStatus = 200
  let client: QueryClient
  let stop: () => void

  beforeEach(() => {
    jest.useFakeTimers()
    FakeEventSource.opened = []
    sessionStatus = 200
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
    globalThis.fetch = mock(async () =>
      Response.json(sessionStatus === 200 ? { id: 'u1' } : { status: 401, title: 'Unauthorized' }, {
        status: sessionStatus,
      }),
    ) as unknown as typeof fetch
    client = new QueryClient()
    stop = connect(client)
  })

  afterEach(() => {
    stop()
    client.clear()
    jest.useRealTimers()
    globalThis.EventSource = realEventSource
    globalThis.fetch = realFetch
  })

  /** Derruba a conexão e confere que a próxima só abre depois de `delay` ms. */
  async function expectReopenAfter(delay: number) {
    const count = FakeEventSource.opened.length
    latest().onerror?.()
    await settle()
    jest.advanceTimersByTime(delay - 1)
    expect(FakeEventSource.opened).toHaveLength(count)
    jest.advanceTimersByTime(1)
    expect(FakeEventSource.opened).toHaveLength(count + 1)
  }

  test('quedas seguidas reabrem em 1, 2, 5 e 30 s, e o snapshot zera a espera', async () => {
    expect(latest().url).toBe('/api/v1/events')
    for (const delay of [1_000, 2_000, 5_000, 30_000, 30_000]) await expectReopenAfter(delay)
    expect(FakeEventSource.opened.slice(0, -1).every((source) => source.closed)).toBe(true)

    latest().emit('snapshot', snapshot(1))
    await expectReopenAfter(1_000)
  })

  test('sessão expirada (401 em /auth/me) não reabre a conexão', async () => {
    sessionStatus = 401
    latest().onerror?.()
    await settle()
    jest.advanceTimersByTime(120_000)
    expect(FakeEventSource.opened).toHaveLength(1)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  test('uma rajada de atualizações refaz cada prefixo uma vez a cada 1,5 s', () => {
    const invalidate = spyOn(client, 'invalidateQueries')
    latest().emit('snapshot', snapshot(1))
    for (let seq = 2; seq <= 6; seq++) {
      latest().emit('state_updated', stateUpdated(seq))
      jest.advanceTimersByTime(250)
    }
    expect(invalidate).not.toHaveBeenCalled()
    jest.advanceTimersByTime(250)
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
      LIVE_QUERY_PREFIXES.map((prefix) => [prefix]),
    )

    latest().emit('state_updated', stateUpdated(7))
    jest.advanceTimersByTime(1_500)
    expect(invalidate).toHaveBeenCalledTimes(2 * LIVE_QUERY_PREFIXES.length)
  })

  test('ao reconectar, refaz as consultas só se algo mudou durante a queda', async () => {
    const invalidate = spyOn(client, 'invalidateQueries')
    latest().emit('snapshot', snapshot(10))
    jest.advanceTimersByTime(1_500)
    expect(invalidate).not.toHaveBeenCalled()

    await expectReopenAfter(1_000)
    latest().emit('snapshot', snapshot(10))
    jest.advanceTimersByTime(1_500)
    expect(invalidate).not.toHaveBeenCalled()

    await expectReopenAfter(1_000)
    latest().emit('snapshot', snapshot(12))
    jest.advanceTimersByTime(1_500)
    expect(invalidate).toHaveBeenCalledTimes(LIVE_QUERY_PREFIXES.length)
  })

  test('fechar cancela a reconexão agendada', async () => {
    latest().onerror?.()
    await settle()
    stop()
    jest.advanceTimersByTime(60_000)
    expect(FakeEventSource.opened).toHaveLength(1)
  })
})
