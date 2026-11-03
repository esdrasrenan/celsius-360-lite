import type {
  ClientListItem,
  DemoUser,
  EnvironmentSummary,
  PeriodKey,
  Series,
  SessionUser,
  StoreList,
  StoreSort,
  StoreStatus,
} from '@celsius/contracts'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from './client'

export const keys = {
  session: ['session'] as const,
  demoUsers: ['demo-users'] as const,
  clients: ['clients'] as const,
  stores: (params: StoresParams) => ['stores', params] as const,
  environment: (id: string, period: PeriodKey) => ['environment', id, period] as const,
  series: (id: string, period: PeriodKey) => ['environment', id, period, 'series'] as const,
}

export function useSession() {
  return useQuery({
    queryKey: keys.session,
    queryFn: async () => {
      try {
        return await api<SessionUser>('/auth/me')
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    staleTime: 60_000,
  })
}

export function useLogin() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api<SessionUser>('/auth/login', { method: 'POST', body }),
    onSuccess: (user) => {
      client.clear()
      client.setQueryData(keys.session, user)
    },
  })
}

export function useLogout() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      client.clear()
      client.setQueryData(keys.session, null)
    },
  })
}

export function useDemoUsers() {
  return useQuery({
    queryKey: keys.demoUsers,
    queryFn: () => api<DemoUser[]>('/auth/demo-users').catch(() => []),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export interface StoresParams {
  period: PeriodKey
  search?: string
  clientId?: string
  status?: StoreStatus[]
  sort: StoreSort
  page: number
  pageSize: number
}

export function useStores(params: StoresParams) {
  return useQuery({
    queryKey: keys.stores(params),
    queryFn: ({ signal }) => api<StoreList>('/stores', { query: { ...params }, signal }),
    placeholderData: keepPreviousData,
  })
}

export function useClients() {
  return useQuery({
    queryKey: keys.clients,
    queryFn: () => api<ClientListItem[]>('/clients'),
    staleTime: 300_000,
  })
}

export function useEnvironmentSummary(id: string, period: PeriodKey) {
  return useQuery({
    queryKey: keys.environment(id, period),
    queryFn: ({ signal }) =>
      api<EnvironmentSummary>(`/environments/${id}/summary`, { query: { period }, signal }),
    placeholderData: keepPreviousData,
  })
}

export function useEnvironmentSeries(id: string, period: PeriodKey) {
  return useQuery({
    queryKey: keys.series(id, period),
    queryFn: ({ signal }) => api<Series>(`/environments/${id}/series`, { query: { period }, signal }),
    placeholderData: keepPreviousData,
  })
}
