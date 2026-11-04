import { describe, expect, test } from 'bun:test'
import { type LiveState, liveStatus, reconnectDelay } from './live'

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
})
