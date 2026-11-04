import type { PeriodKey, StoreList, StoreListItem } from '@celsius/contracts'
import { PERIOD_KEYS, periodRange } from '@celsius/domain'
import { Download04Icon, FilterRemoveIcon, SearchRemoveIcon, Store01Icon } from '@hugeicons/core-free-icons'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import {
  queries,
  type StoresParams,
  useClients,
  usePrefetchStores,
  useSession,
  useStores,
} from '../../api/queries'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Pagination } from '../../components/Pagination'
import { SegmentedControl } from '../../components/SegmentedControl'
import { Skeleton } from '../../components/Skeleton'
import { downloadCsv } from '../../lib/csv'
import { formatPeriod, NETWORK_TIME_ZONE, NETWORK_TIME_ZONE_LABEL, plural } from '../../lib/format'
import { PERIOD_FULL_LABEL, PERIOD_LABEL } from '../../lib/states'
import { csvFileName, storesCsv } from './csv'
import { FilterBar } from './FilterBar'
import { NetworkKpis } from './NetworkKpis'
import {
  CLEARED_FILTERS,
  defaultOpen,
  filterCount,
  type NetworkView,
  toStoresParams,
  useNetworkView,
} from './params'
import { StoreTable } from './StoreTable'

/** Dica do segmento com a janela exata do período, a mesma que a API usa para calculá-lo. */
function periodHint(period: PeriodKey, now: string | null): string | undefined {
  if (!now) return undefined
  const { from, to } = periodRange(period, Date.parse(now))
  return `${formatPeriod(from, to, NETWORK_TIME_ZONE)} · ${NETWORK_TIME_ZONE_LABEL}`
}

const EXPORT_PAGE_SIZE = 100

/** A lista filtrada inteira, página a página (a API limita 100 por página). */
async function fetchAllStores(
  fetchPage: (params: StoresParams) => Promise<StoreList>,
  params: StoresParams,
): Promise<StoreListItem[]> {
  const items: StoreListItem[] = []
  for (let page = 1; ; page++) {
    const data = await fetchPage({ ...params, page, pageSize: EXPORT_PAGE_SIZE })
    items.push(...data.items)
    if (data.items.length === 0 || page * EXPORT_PAGE_SIZE >= data.total) return items
  }
}

/**
 * Visão da rede (seção 4.2): cabeçalho com o período, os 4 indicadores, a barra de filtros e a
 * tabela de lojas paginada. Todo o estado mora na URL (params.ts).
 */
export function NetworkPage() {
  const { view, update: updateView } = useNetworkView()
  const location = useLocation()
  const client = useQueryClient()
  const prefetch = usePrefetchStores()
  const searchRef = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportFailed, setExportFailed] = useState(false)

  const user = useSession().data
  const singleStore = !!user && !user.allStores && user.storeIds.length === 1
  const params = toStoresParams(view)
  const stores = useStores(params)
  // O gerente não tem o seletor, mas um ?cliente= no link ainda precisa do nome ou do saneamento
  const clients = useClients({ enabled: !singleStore || view.clientId !== null })
  const filtered = filterCount(view) > 0
  // Sem filtro, a própria lista dá o tamanho do acesso; com filtro, uma consulta de 1 item
  const scope = useQuery({
    ...queries.stores({ period: view.period, sort: 'status', page: 1, pageSize: 1 }),
    enabled: filtered,
    placeholderData: keepPreviousData,
  })

  const data = stores.data
  const reloading = stores.isPlaceholderData
  const firstLoad = stores.isPending
  const error = stores.isError ? stores.error : null
  const scopeTotals = filtered ? scope.data?.totals : data?.totals
  const items = !error && data ? data.items : []
  const now = data?.now ?? null
  // Com filtro (uma busca sem resultado), a loja do gerente vem da consulta do escopo
  const singleStoreItem = singleStore ? (filtered ? scope.data?.items[0] : items[0]) : undefined

  const update = (patch: Partial<NetworkView>, mode?: 'push' | 'replace') => {
    setNotice(null)
    updateView(patch, mode)
  }
  const clearFilters = () => update(CLEARED_FILTERS)

  // URL normalizada: parâmetro inválido sai e página além do fim vira a última, sem novo histórico
  useEffect(() => {
    updateView({}, 'replace')
  })
  useEffect(() => {
    if (data && !reloading && data.page !== view.page) updateView({ page: data.page }, 'replace')
  }, [data, reloading, view.page, updateView])
  useEffect(() => {
    const list = clients.data
    if (!list || !view.clientId || list.some((item) => item.id === view.clientId)) return
    updateView({ clientId: null }, 'replace')
    setNotice('O cliente do link não existe ou não está no seu acesso, e o filtro foi removido.')
  }, [clients.data, view.clientId, updateView])

  // Pré-carga da próxima página: a troca não pisca
  useEffect(() => {
    if (!data || reloading || data.page * data.pageSize >= data.total) return
    prefetch({ ...params, page: data.page + 1 })
  })

  const open = new Set(view.open ?? defaultOpen(items, view.search))
  const toggle = (storeId: string) => {
    const next = new Set(open)
    if (!next.delete(storeId)) next.add(storeId)
    update({ open: [...next] }, 'replace')
  }

  const exportCsv = async () => {
    setExporting(true)
    setExportFailed(false)
    try {
      const all = await fetchAllStores((page) => client.fetchQuery(queries.stores(page)), params)
      downloadCsv(csvFileName(view.period, now), storesCsv(all))
    } catch {
      setExportFailed(true)
    } finally {
      setExporting(false)
    }
  }

  const search = view.search.trim()
  const ofScope = scopeTotals ? `0 de ${plural(scopeTotals.stores, 'loja', 'lojas')}.` : ''
  const otherFilters = filterCount({ ...view, search: '' }) > 0
  const empty =
    data && data.items.length === 0 ? (
      data.now === null ? (
        <EmptyState
          title="Aguardando a primeira telemetria"
          description="A ingestão ainda não processou nenhum pacote. A tela se atualiza sozinha."
        />
      ) : !filtered ? (
        <EmptyState
          icon={Store01Icon}
          title="Nenhuma loja no seu acesso"
          description="Peça a um administrador da Diel para vincular lojas ao seu usuário."
        />
      ) : search ? (
        <EmptyState
          icon={SearchRemoveIcon}
          title={`Nenhuma loja para "${search}"`}
          description={`${ofScope} A busca considera loja, ambiente, cidade, UF, cliente e dispositivo.`}
          actions={
            <>
              <Button
                variant="primary"
                onClick={() => {
                  update({ search: '' })
                  searchRef.current?.focus()
                }}
              >
                Limpar busca
              </Button>
              {otherFilters && <Button onClick={clearFilters}>Limpar filtros</Button>}
            </>
          }
        />
      ) : (
        <EmptyState
          icon={FilterRemoveIcon}
          title="Nenhuma loja com esses filtros"
          description={ofScope}
          actions={
            <Button variant="primary" onClick={clearFilters}>
              Limpar filtros
            </Button>
          }
        />
      )
    ) : null

  const count = error
    ? 'Lojas indisponíveis'
    : !data
      ? 'Carregando lojas…'
      : data.items.length === 0
        ? search
          ? `Nenhuma loja para "${search}"`
          : 'Nenhuma loja'
        : `${plural(data.total, 'loja', 'lojas')} · ${plural(data.totals.environments, 'ambiente', 'ambientes')}`

  const subtitle = singleStoreItem
    ? `${singleStoreItem.client.name} · ${singleStoreItem.city}/${singleStoreItem.state}`
    : scopeTotals
      ? `${plural(scopeTotals.stores, 'loja', 'lojas')} · ${plural(scopeTotals.environments, 'ambiente', 'ambientes')} · ${NETWORK_TIME_ZONE_LABEL}`
      : error
        ? NETWORK_TIME_ZONE_LABEL
        : null

  const cannotExport = !data || data.total === 0 || !!error

  return (
    <div className="flex flex-col gap-8">
      <title>Visão da rede · Celsius 360</title>

      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-texto text-titulo-1">
              {singleStore
                ? (singleStoreItem?.name ??
                  (error ? 'Visão da rede' : <Skeleton className="my-1 h-6 w-48" />))
                : 'Visão da rede'}
            </h1>
            <p className="flex min-h-5 items-center text-corpo text-texto-3">
              {subtitle ?? <Skeleton className="h-3 w-56" />}
            </p>
          </div>
          <Button
            icon={Download04Icon}
            busy={exporting}
            disabled={cannotExport}
            aria-label="Baixar CSV"
            onClick={exportCsv}
            className="w-9 px-0 md:hidden pointer-coarse:w-controle-toque"
          />
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Button
            icon={Download04Icon}
            busy={exporting}
            busyLabel="Exportando…"
            disabled={cannotExport}
            onClick={exportCsv}
            className="max-md:hidden"
          >
            Baixar CSV
          </Button>
          <SegmentedControl
            legend="Período"
            value={view.period}
            options={PERIOD_KEYS.map((period) => ({
              value: period,
              label: PERIOD_LABEL[period],
              accessibleLabel: PERIOD_FULL_LABEL[period],
              hint: periodHint(period, now),
            }))}
            onValueChange={(period) => update({ period })}
            onIntent={(period) => period !== view.period && prefetch({ ...params, period, page: 1 })}
          />
        </div>
      </header>
      {exportFailed && (
        <p role="alert" className="-mt-5 text-apoio text-falha-texto">
          Não foi possível gerar o CSV. Tente de novo em instantes.
        </p>
      )}

      <NetworkKpis
        totals={data?.totals}
        loading={firstLoad}
        error={!!error}
        reloading={reloading}
        view={view}
        scopeStores={filtered ? (scope.data?.totals.stores ?? null) : null}
        filtered={filtered}
        singleStore={singleStore}
        onFilter={update}
      />

      <div className="flex flex-col gap-4">
        <FilterBar
          view={view}
          update={update}
          clients={clients.data}
          facets={data?.facets}
          storeName={items.find((store) => store.id === view.storeId)?.name}
          busy={reloading}
          loading={firstLoad}
          singleStore={singleStore}
          notice={notice}
          searchRef={searchRef}
        />
        <StoreTable
          items={items}
          open={open}
          onToggle={toggle}
          onToggleAll={(all) => update({ open: all ? items.map((store) => store.id) : [] }, 'replace')}
          sort={view.sort}
          onSort={(sort) => update({ sort })}
          search={view.search}
          now={now}
          period={view.period}
          from={location.search}
          count={count}
          loading={firstLoad}
          reloading={reloading}
          message={
            error ? (
              <ErrorState
                error={error}
                onRetry={() => stores.refetch()}
                onClearFilters={() => update({ ...CLEARED_FILTERS, sort: 'status', pageSize: 20 })}
              />
            ) : (
              empty
            )
          }
          footer={
            data &&
            !error &&
            !singleStore &&
            data.total > 0 && (
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPageChange={(page) => update({ page })}
                onPageSizeChange={(pageSize) => update({ pageSize })}
                onPageIntent={(page) => prefetch({ ...params, page })}
              />
            )
          }
        />
      </div>
    </div>
  )
}
