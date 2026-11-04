import type { PeriodKey, StoreListItem, StoreSort, StoreStatus } from '@celsius/contracts'
import { useSearchParams } from 'react-router'
import type { StoresParams } from '../../api/queries'
import { SORT_LABEL } from '../../lib/states'
import { foldText, searchTerms } from '../../lib/text'

/*
 * Estado da visão da rede, todo na URL: um link reproduz a tela e o voltar do navegador desfaz.
 * A leitura valida cada parâmetro com Object.hasOwn (o `in` aceitaria "toString") e descarta o que
 * for inválido; a tela então reescreve a URL normalizada com replace.
 */

export const PERIODS = ['1d', '7d', '30d'] as const satisfies readonly PeriodKey[]
export const PAGE_SIZES = [20, 50, 100] as const
export const SEARCH_MAX = 80

const DEFAULT_PERIOD: PeriodKey = '1d'
const DEFAULT_SORT: StoreSort = 'status'
const DEFAULT_PAGE_SIZE = 20

/** Pílulas de telemetria: valor na URL → status da API. */
export const STATUS_FILTERS = {
  todas: [],
  atencao: ['degraded', 'offline', 'no_data'],
  online: ['online'],
  degraded: ['degraded'],
  offline: ['offline'],
  no_data: ['no_data'],
} as const satisfies Record<string, readonly StoreStatus[]>

export type StatusFilter = keyof typeof STATUS_FILTERS

export interface NetworkView {
  period: PeriodKey
  search: string
  clientId: string | null
  /** Filtro exato por loja (link "Loja Boa Viagem" do breadcrumb do detalhe). */
  storeId: string | null
  status: StatusFilter
  belowTarget: boolean
  outOfRange: boolean
  sort: StoreSort
  page: number
  pageSize: number
  /** Lojas abertas; null segue a abertura padrão por exceção. */
  open: string[] | null
}

const PARAM = {
  period: 'periodo',
  search: 'busca',
  clientId: 'cliente',
  storeId: 'loja',
  status: 'status',
  belowTarget: 'abaixoDaMeta',
  outOfRange: 'foraDaFaixa',
  sort: 'ordem',
  page: 'pagina',
  pageSize: 'porPagina',
  open: 'abertas',
} as const satisfies Record<keyof NetworkView, string>

const PERIOD_SET: Record<PeriodKey, true> = { '1d': true, '7d': true, '30d': true }

const pick = <K extends string>(record: Record<K, unknown>, value: string | null): K | null =>
  value !== null && Object.hasOwn(record, value) ? (value as K) : null

const positiveInt = (value: string | null): number | null =>
  value !== null && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : null

const id = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? ''
  return trimmed && trimmed.length <= 64 ? trimmed : null
}

export function parseView(params: URLSearchParams): NetworkView {
  const open = params.get(PARAM.open)
  const pageSize = positiveInt(params.get(PARAM.pageSize))
  return {
    period: pick(PERIOD_SET, params.get(PARAM.period)) ?? DEFAULT_PERIOD,
    // Sem trim: o espaço no fim é o usuário no meio da digitação ("rio |"), e a API ignora
    search: (params.get(PARAM.search) ?? '').slice(0, SEARCH_MAX),
    clientId: id(params.get(PARAM.clientId)),
    storeId: id(params.get(PARAM.storeId)),
    status: pick(STATUS_FILTERS, params.get(PARAM.status)) ?? 'todas',
    belowTarget: params.get(PARAM.belowTarget) === '1',
    outOfRange: params.get(PARAM.outOfRange) === '1',
    sort: pick(SORT_LABEL, params.get(PARAM.sort)) ?? DEFAULT_SORT,
    page: positiveInt(params.get(PARAM.page)) ?? 1,
    pageSize:
      pageSize !== null && (PAGE_SIZES as readonly number[]).includes(pageSize)
        ? pageSize
        : DEFAULT_PAGE_SIZE,
    open: open === null ? null : open.split(',').flatMap((value) => id(value) ?? []),
  }
}

/** URL canônica: só o que difere do padrão, sempre na mesma ordem. */
export function serializeView(view: NetworkView): URLSearchParams {
  const out = new URLSearchParams()
  const set = (key: keyof NetworkView, value: string | null | false, fallback?: string) => {
    if (value !== null && value !== false && value !== '' && value !== fallback) out.set(PARAM[key], value)
  }
  set('period', view.period, DEFAULT_PERIOD)
  set('search', view.search)
  set('clientId', view.clientId)
  set('storeId', view.storeId)
  set('status', view.status, 'todas')
  set('belowTarget', view.belowTarget && '1')
  set('outOfRange', view.outOfRange && '1')
  set('sort', view.sort, DEFAULT_SORT)
  set('page', String(view.page), '1')
  set('pageSize', String(view.pageSize), String(DEFAULT_PAGE_SIZE))
  // Lista vazia é "todas recolhidas" e precisa ficar na URL (abertas=)
  if (view.open) out.set(PARAM.open, view.open.join(','))
  return out
}

/** Busca, cliente, loja, telemetria, meta e faixa. Período, ordem e página não filtram. */
export function filterCount(view: NetworkView): number {
  return [
    view.search.trim() !== '',
    view.clientId !== null,
    view.storeId !== null,
    view.status !== 'todas',
    view.belowTarget,
    view.outOfRange,
  ].filter(Boolean).length
}

export const CLEARED_FILTERS = {
  search: '',
  clientId: null,
  storeId: null,
  status: 'todas',
  belowTarget: false,
  outOfRange: false,
} as const satisfies Partial<NetworkView>

export function toStoresParams(view: NetworkView): StoresParams {
  return {
    period: view.period,
    search: view.search.trim() || undefined,
    clientId: view.clientId ?? undefined,
    storeId: view.storeId ?? undefined,
    status: [...STATUS_FILTERS[view.status]],
    belowTarget: view.belowTarget,
    outOfRange: view.outOfRange,
    sort: view.sort,
    page: view.page,
    pageSize: view.pageSize,
  }
}

/**
 * Próxima visão a partir de uma mudança. Mudar um filtro, a ordem ou o tamanho da página volta à
 * página 1 e devolve a abertura ao padrão (as lojas na tela mudam); trocar o período mantém as
 * lojas abertas e volta à página 1, porque a ordem pode mudar.
 */
export function nextView(view: NetworkView, patch: Partial<NetworkView>): NetworkView {
  const keys = Object.keys(patch) as Array<keyof NetworkView>
  const reshapes = keys.some((key) => key !== 'page' && key !== 'open' && key !== 'period')
  return {
    ...view,
    ...(reshapes ? { page: 1, open: null } : {}),
    ...(Object.hasOwn(patch, 'period') ? { page: 1 } : {}),
    ...patch,
  }
}

/** O termo da busca casa com o próprio ambiente (nome, código ou dispositivo), não só com a loja. */
export function environmentMatches(
  environment: { id: string; name: string; deviceId: string | null },
  search: string,
): boolean {
  const terms = searchTerms(search)
  if (terms.length === 0) return false
  const text = foldText(`${environment.name} ${environment.id} ${environment.deviceId ?? ''}`)
  return terms.some((term) => text.includes(term))
}

/** Loja com exceção: algum ambiente fora da meta ou fora da faixa, ou telemetria com problema. */
export function hasException(store: StoreListItem): boolean {
  const counts = store.environmentCounts
  return counts.belowTarget > 0 || counts.outOfRange > 0 || store.status !== 'online'
}

/**
 * Abertura padrão (seção 3.11): abrem as lojas com exceção e as que têm um ambiente encontrado
 * pela busca. Com até 3 lojas na página, todas abrem.
 */
export function defaultOpen(items: readonly StoreListItem[], search: string): string[] {
  if (items.length <= 3) return items.map((store) => store.id)
  return items
    .filter(
      (store) =>
        hasException(store) ||
        store.environments.some((environment) => environmentMatches(environment, search)),
    )
    .map((store) => store.id)
}

export type UpdateMode = 'push' | 'replace'

/**
 * Visão atual e a função que a muda. Mudanças discretas fazem push no histórico (o voltar
 * desfaz); só a digitação da busca e a normalização usam replace.
 */
export function useNetworkView(): {
  view: NetworkView
  search: URLSearchParams
  update: (patch: Partial<NetworkView>, mode?: UpdateMode) => void
} {
  const [search, setSearch] = useSearchParams()
  const view = parseView(search)
  const update = (patch: Partial<NetworkView>, mode: UpdateMode = 'push') => {
    const next = serializeView(nextView(view, patch))
    if (next.toString() === search.toString()) return
    setSearch(next, { replace: mode === 'replace', preventScrollReset: true })
  }
  return { view, search, update }
}
