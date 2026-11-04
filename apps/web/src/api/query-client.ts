import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { ApiError } from './client'
import { keys } from './queries'

/*
 * "Sessão expirada": um 401 com o usuário logado. A casca observa useSessionExpired() e leva a
 * /entrar?voltar=…&motivo=expirada. O estado volta a falso quando a sessão é recarregada com um
 * usuário (depois do login).
 */
let expired = false
const listeners = new Set<() => void>()

function setExpired(value: boolean) {
  if (expired === value) return
  expired = value
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isSessionExpired(): boolean {
  return expired
}

export function useSessionExpired(): boolean {
  return useSyncExternalStore(subscribe, isSessionExpired)
}

/** Erro de sessão, de permissão ou de parâmetro não melhora com nova tentativa. */
function shouldRetry(count: number, error: unknown) {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  return count < 2
}

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error) => onUnauthorized(error) }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (!mutation.meta?.skipSessionExpiry) onUnauthorized(error)
      },
    }),
    defaultOptions: {
      queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: shouldRetry },
    },
  })

  function onUnauthorized(error: unknown) {
    if (!(error instanceof ApiError) || error.status !== 401) return
    // Só expira quem estava logado: um 401 sem sessão é só "não entrou ainda"
    if (client.getQueryData(keys.session)) setExpired(true)
    client.setQueryData(keys.session, null)
  }

  client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.query.queryKey[0] === keys.session[0] && event.query.state.data) {
      setExpired(false)
    }
  })

  return client
}
