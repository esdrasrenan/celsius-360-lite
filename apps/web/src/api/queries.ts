import type {
  ClientListItem,
  DailySeries,
  DemoUser,
  EnvironmentSummary,
  PeriodKey,
  QualityReport,
  Series,
  SeriesBucket,
  SessionUser,
  StoreList,
  StoreSort,
  StoreStatus,
  WeeklyProfile,
} from '@celsius/contracts'
import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from './client'

/** Período nomeado ou intervalo explícito (ISO 8601 com fuso), como a API aceita. */
export type Range = { period: PeriodKey } | { from: string; to: string }
type RangeInput = PeriodKey | Range

const toRange = (range: RangeInput): Range => (typeof range === 'string' ? { period: range } : range)

export interface StoresParams {
  period: PeriodKey
  search?: string
  clientId?: string
  /** Filtro exato por loja (link do breadcrumb). */
  storeId?: string
  status?: StoreStatus[]
  /** Só lojas com algum ambiente abaixo da meta de conforto no período. */
  belowTarget?: boolean
  /** Só lojas com algum ambiente aberto fora da faixa agora. */
  outOfRange?: boolean
  sort: StoreSort
  page: number
  pageSize: number
}

export type SeriesBucketParam = SeriesBucket | 'auto'

/**
 * Chaves das consultas. Os prefixos 'stores' e 'environment' são os que lib/live.ts invalida a
 * cada atualização da ingestão.
 */
export const keys = {
  session: ['session'] as const,
  demoUsers: ['demo-users'] as const,
  clients: ['clients'] as const,
  quality: ['quality'] as const,
  stores: (params: StoresParams) => ['stores', params] as const,
  summary: (id: string, range: Range) => ['environment', id, 'summary', range] as const,
  series: (id: string, range: Range, bucket: SeriesBucketParam) =>
    ['environment', id, 'series', range, bucket] as const,
  profile: (id: string, range: Range) => ['environment', id, 'profile', range] as const,
  daily: (id: string, range: Range) => ['environment', id, 'daily', range] as const,
}

/** Flags falsas saem da URL: a API só recebe o filtro quando ele está ligado. */
function storesQuery(params: StoresParams) {
  return {
    ...params,
    belowTarget: params.belowTarget || undefined,
    outOfRange: params.outOfRange || undefined,
  }
}

/** Fábricas de opções, usadas pelos hooks e pela pré-carga. */
export const queries = {
  session: () =>
    queryOptions({
      queryKey: keys.session,
      queryFn: async () => {
        try {
          return await api<SessionUser>('/auth/me')
        } catch (error) {
          // Sem sessão não é erro: a casca manda para o login
          if (error instanceof ApiError && error.status === 401) return null
          throw error
        }
      },
      staleTime: 60_000,
    }),
  stores: (params: StoresParams) =>
    queryOptions({
      queryKey: keys.stores(params),
      queryFn: ({ signal }) => api<StoreList>('/stores', { query: storesQuery(params), signal }),
    }),
  summary: (id: string, range: RangeInput) =>
    queryOptions({
      queryKey: keys.summary(id, toRange(range)),
      queryFn: ({ signal }) =>
        api<EnvironmentSummary>(`/environments/${encodeURIComponent(id)}/summary`, {
          query: toRange(range),
          signal,
        }),
    }),
  series: (id: string, range: RangeInput, bucket: SeriesBucketParam = 'auto') =>
    queryOptions({
      queryKey: keys.series(id, toRange(range), bucket),
      queryFn: ({ signal }) =>
        api<Series>(`/environments/${encodeURIComponent(id)}/series`, {
          query: { ...toRange(range), bucket: bucket === 'auto' ? undefined : bucket },
          signal,
        }),
    }),
  profile: (id: string, range: RangeInput) =>
    queryOptions({
      queryKey: keys.profile(id, toRange(range)),
      queryFn: ({ signal }) =>
        api<WeeklyProfile>(`/environments/${encodeURIComponent(id)}/profile`, {
          query: toRange(range),
          signal,
        }),
    }),
  daily: (id: string, range: RangeInput) =>
    queryOptions({
      queryKey: keys.daily(id, toRange(range)),
      queryFn: ({ signal }) =>
        api<DailySeries>(`/environments/${encodeURIComponent(id)}/daily`, { query: toRange(range), signal }),
    }),
}

export function useSession() {
  return useQuery(queries.session())
}

export function useLogin() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api<SessionUser>('/auth/login', { method: 'POST', body }),
    // Senha errada também é 401, e isso não é sessão expirada
    meta: { skipSessionExpiry: true },
    onSuccess: (user) => {
      client.clear()
      client.setQueryData(keys.session, user)
    },
  })
}

/** Sair nunca marca a sessão como expirada: a casca navega para /entrar sem "voltar". */
export function useLogout() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    meta: { skipSessionExpiry: true },
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

export function useClients(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.clients,
    queryFn: () => api<ClientListItem[]>('/clients'),
    staleTime: 300_000,
    enabled: options.enabled,
  })
}

/** Lista de lojas. Mantém a página anterior enquanto a nova carrega (recarga sem skeleton). */
export function useStores(params: StoresParams) {
  return useQuery({ ...queries.stores(params), placeholderData: keepPreviousData })
}

export function useEnvironmentSummary(id: string, range: RangeInput) {
  return useQuery({ ...queries.summary(id, range), placeholderData: keepPreviousData })
}

export function useEnvironmentSeries(id: string, range: RangeInput, bucket: SeriesBucketParam = 'auto') {
  return useQuery({ ...queries.series(id, range, bucket), placeholderData: keepPreviousData })
}

/** Perfil semanal (heatmap hora × dia), só em 7 e 30 dias. */
export function useEnvironmentProfile(id: string, range: RangeInput, options: { enabled?: boolean } = {}) {
  return useQuery({
    ...queries.profile(id, range),
    placeholderData: keepPreviousData,
    enabled: options.enabled,
  })
}

/** Conforto por dia (colunas empilhadas). */
export function useEnvironmentDaily(id: string, range: RangeInput, options: { enabled?: boolean } = {}) {
  return useQuery({
    ...queries.daily(id, range),
    placeholderData: keepPreviousData,
    enabled: options.enabled,
  })
}

/** Relatório de qualidade dos dados; a API só responde ao administrador da Diel. */
export function useQuality(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.quality,
    queryFn: ({ signal }) => api<QualityReport>('/quality', { signal }),
    staleTime: 300_000,
    enabled: options.enabled,
  })
}

/** Pré-carga da lista (hover em "Próxima", foco num segmento de período). */
export function usePrefetchStores() {
  const client = useQueryClient()
  return (params: StoresParams) => void client.prefetchQuery(queries.stores(params))
}

/** Pré-carga do detalhe num período: resumo e série juntos, para a troca não piscar. */
export function usePrefetchEnvironment() {
  const client = useQueryClient()
  return (id: string, range: RangeInput) => {
    void client.prefetchQuery(queries.summary(id, range))
    void client.prefetchQuery(queries.series(id, range))
  }
}
