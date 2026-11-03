import type { PeriodKey, StoreSort, StoreStatus } from '@celsius/contracts'
import { ArrowLeft01Icon, ArrowRight01Icon, Search01Icon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { type StoresParams, useClients, useStores } from '../../api/queries'
import { Button, Choice, EmptyState, Icon, Skeleton, Stat } from '../../components/ui'
import { formatFullDateTime, formatInteger, formatPercent } from '../../lib/format'
import { COMFORT_TARGET, PERIOD_LABEL, SORT_LABEL, STORE_STATUS } from '../../lib/labels'
import { StoreCard } from './StoreCard'

const PERIODS = (['1d', '7d', '30d'] as const).map((value) => ({ value, label: PERIOD_LABEL[value] }))
const STATUS_FILTERS: Array<{ value: string; label: string; statuses?: StoreStatus[] }> = [
  { value: 'todas', label: 'Todas' },
  { value: 'atencao', label: 'Com problema', statuses: ['offline', 'degraded', 'no_data'] },
  ...(['online', 'degraded', 'offline', 'no_data'] as const).map((status) => ({
    value: status,
    label: STORE_STATUS[status]?.label ?? status,
    statuses: [status],
  })),
]
const PAGE_SIZE = 20

/** Filtros na URL: dá para compartilhar o link e voltar com o navegador. */
function useNetworkParams(): [
  StoresParams & { statusFilter: string },
  (patch: Record<string, string | null>) => void,
] {
  const [search, setSearch] = useSearchParams()
  const statusFilter = search.get('status') ?? 'todas'
  const params = {
    period: (['1d', '7d', '30d'].includes(search.get('periodo') ?? '')
      ? search.get('periodo')
      : '1d') as PeriodKey,
    search: search.get('busca') ?? undefined,
    clientId: search.get('cliente') ?? undefined,
    status: STATUS_FILTERS.find((filter) => filter.value === statusFilter)?.statuses,
    sort: ((search.get('ordem') ?? 'status') in SORT_LABEL ? search.get('ordem') : 'status') as StoreSort,
    page: Math.max(1, Number(search.get('pagina') ?? 1) || 1),
    pageSize: PAGE_SIZE,
    statusFilter,
  }
  const update = (patch: Record<string, string | null>) =>
    setSearch(
      (current) => {
        const next = new URLSearchParams(current)
        for (const [key, value] of Object.entries(patch)) {
          if (value === null || value === '') next.delete(key)
          else next.set(key, value)
        }
        if (!('pagina' in patch)) next.delete('pagina')
        return next
      },
      { replace: true },
    )
  return [params, update]
}

export function NetworkPage() {
  const [params, update] = useNetworkParams()
  const { statusFilter, ...query } = params
  const stores = useStores(query)
  const clients = useClients()
  const [searchText, setSearchText] = useState(params.search ?? '')

  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.search ?? '') !== searchText) update({ busca: searchText })
    }, 300)
    return () => clearTimeout(id)
  })

  const data = stores.data
  const totals = data?.totals
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const withoutReading = totals ? totals.offline + totals.noData + totals.sensorFault : 0

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <span className="t-rotulo text-celsius">Celsius 360</span>
          <h1 className="t-titulo text-[2.1rem] leading-[1.05]">Visão da rede</h1>
          <p className="text-tinta-3">
            {data?.now ? (
              <>
                Agora: <span className="text-tinta">{formatFullDateTime(data.now)}</span> (horário de
                Brasília), o último pacote processado
              </>
            ) : (
              'Aguardando a primeira telemetria da ingestão'
            )}
          </p>
        </div>
        <Choice
          label="Período"
          value={params.period}
          options={PERIODS}
          onChange={(value) => update({ periodo: value })}
        />
      </div>

      <section aria-label="Indicadores da rede" className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {totals ? (
          <>
            <Stat
              label="Conforto da rede"
              value={formatPercent(totals.comfortPct)}
              hint={`do horário de funcionamento na faixa · ${PERIOD_LABEL[params.period].toLowerCase()}`}
              emphasis
            />
            <Stat
              label="Ambientes online"
              value={`${formatInteger(totals.online)}/${formatInteger(totals.environments)}`}
              hint={`em ${formatInteger(totals.stores)} ${totals.stores === 1 ? 'loja' : 'lojas'}`}
            />
            <Stat
              label="Fora da faixa agora"
              value={formatInteger(totals.outOfRange)}
              hint="ambientes em horário de funcionamento"
              tone={totals.outOfRange > 0 ? 'alerta' : undefined}
            />
            <Stat
              label="Abaixo da meta"
              value={formatInteger(totals.belowTarget)}
              hint={`ambientes com conforto abaixo de ${COMFORT_TARGET}%`}
              tone={totals.belowTarget > 0 ? 'alerta' : undefined}
            />
            <Stat
              label="Sem leitura"
              value={formatInteger(withoutReading)}
              hint="offline, falha no sensor ou sem dados"
              tone={withoutReading > 0 ? 'falha' : undefined}
            />
          </>
        ) : (
          ['conforto', 'online', 'fora', 'meta', 'leitura'].map((key) => (
            <Skeleton key={key} className="h-[132px] rounded-[22px]" />
          ))
        )}
      </section>

      <section aria-label="Lojas" className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative flex-1">
            <span className="sr-only">Buscar loja, cidade ou cliente</span>
            <Icon
              icon={Search01Icon}
              className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-tinta-3"
            />
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Buscar loja, cidade ou cliente"
              className="h-10 w-full rounded-[11px] bg-branco pr-3 pl-10 text-[0.92rem] text-tinta outline-none ring-1 ring-linha-forte ring-inset placeholder:text-tinta-3 focus:ring-2 focus:ring-celsius"
            />
          </label>
          <select
            aria-label="Cliente"
            value={params.clientId ?? ''}
            onChange={(event) => update({ cliente: event.target.value })}
            className="h-10 rounded-[11px] bg-branco px-3 text-[0.9rem] text-tinta ring-1 ring-linha-forte ring-inset"
          >
            <option value="">Todos os clientes</option>
            {clients.data?.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name} ({client.stores})
              </option>
            ))}
          </select>
          <select
            aria-label="Ordenar por"
            value={params.sort}
            onChange={(event) => update({ ordem: event.target.value })}
            className="h-10 rounded-[11px] bg-branco px-3 text-[0.9rem] text-tinta ring-1 ring-linha-forte ring-inset"
          >
            {Object.entries(SORT_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                Ordenar: {label}
              </option>
            ))}
          </select>
        </div>
        <Choice
          variant="pills"
          label="Status da loja"
          value={statusFilter}
          options={STATUS_FILTERS}
          onChange={(value) => update({ status: value === 'todas' ? null : value })}
        />

        {stores.isPending ? (
          <div className="flex flex-col gap-3">
            {['a', 'b', 'c', 'd'].map((key) => (
              <Skeleton key={key} className="h-20 rounded-[22px]" />
            ))}
          </div>
        ) : stores.isError ? (
          <EmptyState title="Não foi possível carregar as lojas">
            {(stores.error as Error).message}
          </EmptyState>
        ) : data && data.items.length === 0 ? (
          <EmptyState title="Nenhuma loja encontrada">Ajuste a busca ou os filtros.</EmptyState>
        ) : (
          <div
            className={clsx(
              'flex flex-col gap-3 transition-opacity',
              stores.isPlaceholderData && 'opacity-60',
            )}
          >
            {data?.items.map((store) => (
              <StoreCard
                key={store.id}
                store={store}
                period={params.period}
                defaultOpen={data.items.length <= 8}
              />
            ))}
          </div>
        )}

        {data && data.total > 0 && (
          <nav
            aria-label="Paginação"
            className="flex items-center justify-between pt-2 text-[0.88rem] text-tinta-3"
          >
            <span>
              {formatInteger((data.page - 1) * data.pageSize + 1)}–
              {formatInteger(Math.min(data.page * data.pageSize, data.total))} de {formatInteger(data.total)}{' '}
              lojas
            </span>
            <span className="flex items-center gap-2">
              <Button
                variant="secundario"
                className="h-9 px-3"
                disabled={data.page <= 1}
                onClick={() => update({ pagina: String(data.page - 1) })}
                aria-label="Página anterior"
              >
                <Icon icon={ArrowLeft01Icon} />
              </Button>
              <span className="tabular-nums">
                {data.page} / {pages}
              </span>
              <Button
                variant="secundario"
                className="h-9 px-3"
                disabled={data.page >= pages}
                onClick={() => update({ pagina: String(data.page + 1) })}
                aria-label="Próxima página"
              >
                <Icon icon={ArrowRight01Icon} />
              </Button>
            </span>
          </nav>
        )}
      </section>
    </div>
  )
}
