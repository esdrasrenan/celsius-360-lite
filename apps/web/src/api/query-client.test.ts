import { describe, expect, test } from 'bun:test'
import type { SessionUser } from '@celsius/contracts'
import { MutationObserver } from '@tanstack/react-query'
import { ApiError } from './client'
import { keys } from './queries'
import { createQueryClient, isSessionExpired } from './query-client'

const user: SessionUser = {
  id: 'USR-001',
  name: 'Ana Ribeiro',
  email: 'ana.ribeiro@diel.example',
  role: 'admin_diel',
  clientId: null,
  allStores: true,
  storeIds: [],
}

const unauthorized = () => Promise.reject(new ApiError(401, 'Sessão inválida'))

describe('401 global (P0, item 4)', () => {
  test('um 401 com usuário logado zera a sessão e marca a expiração', async () => {
    const client = createQueryClient()
    client.setQueryData(keys.session, user)
    expect(isSessionExpired()).toBe(false)

    await client.fetchQuery({ queryKey: ['stores', {}], queryFn: unauthorized }).catch(() => null)

    expect(client.getQueryData(keys.session)).toBeNull()
    expect(isSessionExpired()).toBe(true)

    // Entrar de novo limpa a marca
    client.setQueryData(keys.session, user)
    expect(isSessionExpired()).toBe(false)
  })

  test('um 401 sem sessão não é expiração', async () => {
    const client = createQueryClient()
    await client.fetchQuery({ queryKey: ['stores', {}], queryFn: unauthorized }).catch(() => null)
    expect(isSessionExpired()).toBe(false)
  })

  test('senha errada no login e o logout não marcam expiração', async () => {
    const client = createQueryClient()
    client.setQueryData(keys.session, user)
    const login = new MutationObserver(client, {
      mutationFn: unauthorized,
      meta: { skipSessionExpiry: true },
    })
    await login.mutate().catch(() => null)
    expect(isSessionExpired()).toBe(false)
    expect(client.getQueryData(keys.session)).toEqual(user)

    const other = new MutationObserver(client, { mutationFn: unauthorized })
    await other.mutate().catch(() => null)
    expect(isSessionExpired()).toBe(true)
    client.setQueryData(keys.session, user)
  })

  // fetchQuery não repete por padrão: o teste passa a política do cliente explicitamente
  test('erros 4xx não são repetidos; falha de rede é', async () => {
    const client = createQueryClient()
    let calls = 0
    await client
      .fetchQuery({
        queryKey: ['x'],
        queryFn: () => {
          calls++
          return Promise.reject(new ApiError(400, 'Parâmetro inválido'))
        },
        retry: client.getDefaultOptions().queries?.retry,
        retryDelay: 0,
      })
      .catch(() => null)
    expect(calls).toBe(1)

    calls = 0
    await client
      .fetchQuery({
        queryKey: ['y'],
        queryFn: () => {
          calls++
          return Promise.reject(new ApiError(0, 'Sem conexão'))
        },
        retry: client.getDefaultOptions().queries?.retry,
        retryDelay: 0,
      })
      .catch(() => null)
    expect(calls).toBe(3)
  })
})
