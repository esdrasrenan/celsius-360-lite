import type { StateUpdatedEvent } from '@celsius/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'

interface LiveState {
  connected: boolean
  lastEventAt: number | null
  now: string | null
}

let state: LiveState = { connected: false, lastEventAt: null, now: null }
const listeners = new Set<() => void>()

function update(patch: Partial<LiveState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function useLiveState(): LiveState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}

const INVALIDATE_EVERY_MS = 1500

/**
 * Assina o SSE da API e, a cada atualização da ingestão, invalida as consultas da rede e do ambiente.
 * As invalidações são agrupadas para não refazer consultas a cada evento.
 */
export function useLiveUpdates(enabled: boolean) {
  const client = useQueryClient()

  useEffect(() => {
    if (!enabled) return
    const source = new EventSource('/api/v1/events')
    let timer: ReturnType<typeof setTimeout> | null = null

    source.onopen = () => update({ connected: true })
    source.onerror = () => update({ connected: false })
    source.addEventListener('state_updated', (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as StateUpdatedEvent
      update({ connected: true, lastEventAt: Date.now(), now: event.now })
      timer ??= setTimeout(() => {
        timer = null
        void client.invalidateQueries({ queryKey: ['stores'] })
        void client.invalidateQueries({ queryKey: ['environment'] })
      }, INVALIDATE_EVERY_MS)
    })

    return () => {
      if (timer) clearTimeout(timer)
      source.close()
      update({ connected: false })
    }
  }, [client, enabled])
}
