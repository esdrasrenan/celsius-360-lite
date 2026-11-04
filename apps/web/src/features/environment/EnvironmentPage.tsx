import './print.css'
import type { EnvironmentSummary, Gap, PeriodKey, Series } from '@celsius/contracts'
import { Search01Icon } from '@hugeicons/core-free-icons'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { type ReactNode, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { ApiError } from '../../api/client'
import {
  queries,
  useEnvironmentDaily,
  useEnvironmentProfile,
  useEnvironmentSeries,
  useEnvironmentSummary,
  usePrefetchEnvironment,
} from '../../api/queries'
import { buttonClass } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ProgressBar } from '../../components/ProgressBar'
import { Skeleton } from '../../components/Skeleton'
import { prefersReducedMotion } from '../../lib/chart-theme'
import { formatPeriod, formatTimeZoneLabel } from '../../lib/format'
import { PERIOD_LABEL } from '../../lib/states'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { TemperatureChart, type TemperatureChartHandle } from './chart/TemperatureChart'
import { DailyComfort } from './DailyComfort'
import { DataTable } from './DataTable'
import { ChartSkeleton, DetailSkeleton } from './DetailSkeleton'
import {
  compareAvailability,
  csvFileName,
  gapsCsv,
  parsePeriod,
  previousRange,
  seriesCsv,
  trendPerHour,
} from './detail'
import { Breadcrumb, EnvironmentHeader } from './EnvironmentHeader'
import { GapsList } from './GapsList'
import { PeriodKpis } from './PeriodKpis'
import { PeriodToolbar } from './PeriodToolbar'
import { WeeklyProfile } from './WeeklyProfile'

const HOUR_MS = 3_600_000
const CHART_ID = 'grafico-temperatura'

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? 'auto' : 'smooth')

/** Cartão com título, subtítulo e o conteúdo de uma visualização abaixo do gráfico. */
function Panel({
  id,
  title,
  description,
  busy,
  className,
  children,
}: {
  id: string
  title: string
  description: string
  busy?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className={clsx('cartao relative flex flex-col gap-4 p-4 md:p-5', className)}
    >
      <div className="flex flex-col gap-0.5">
        <h2 id={`${id}-titulo`} className="text-texto text-titulo-3">
          {title}
        </h2>
        <p id={`${id}-descricao`} className="text-apoio text-texto-3">
          {description}
        </p>
      </div>
      <div
        className={clsx('transition-opacity duration-100', busy && 'opacity-60')}
        aria-busy={busy || undefined}
      >
        {children}
      </div>
    </section>
  )
}

/**
 * Detalhe do ambiente (seção 4.3): cabeçalho sem cartão, cartão do período com os 4 KPIs e o
 * gráfico, perfil semanal e conforto por dia (7 e 30 dias), lacunas e descartes e a tabela.
 */
export function EnvironmentPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const [search, setSearch] = useSearchParams()
  const period = parsePeriod(search.get('periodo'))
  const weekly = period !== '1d'

  const summary = useEnvironmentSummary(id, period)
  const series = useEnvironmentSeries(id, period)
  const profile = useEnvironmentProfile(id, period, { enabled: weekly })
  const daily = useEnvironmentDaily(id, period, { enabled: weekly })
  const prefetch = usePrefetchEnvironment()

  const chart = useRef<TemperatureChartHandle>(null)
  const [compare, setCompare] = useState(false)
  const [tableOpen, setTableOpen] = useState(false)

  // Período anterior: só com o resumo do período atual já carregado (não o da troca em curso)
  const settled = summary.data && !summary.isPlaceholderData ? summary.data : undefined
  const previous = settled ? previousRange(settled.period) : { from: '', to: '' }
  const previousSummary = useQuery({ ...queries.summary(id, previous), enabled: settled != null })
  const timeZone = summary.data?.store.timezone ?? 'America/Sao_Paulo'
  const availability = compareAvailability(
    settled ? previousSummary.data : undefined,
    series.isPlaceholderData ? undefined : series.data,
    timeZone,
  )
  const comparing = compare && availability.ok
  const previousSeries = useQuery({ ...queries.series(id, previous), enabled: comparing })

  // "<Ambiente> · <Loja> · Celsius 360"
  const notFound = summary.error instanceof ApiError && summary.error.status === 404
  useDocumentTitle(
    ...(summary.data
      ? [summary.data.environment.name, summary.data.store.name]
      : [notFound ? 'Ambiente não encontrado' : id]),
  )

  if (!summary.data) {
    if (notFound)
      return (
        <EmptyState
          heading="h1"
          icon={Search01Icon}
          title="Ambiente não encontrado"
          description="Ele não existe ou não faz parte das lojas que você acompanha."
          actions={
            <Link to="/" className={buttonClass('primary')}>
              Ir para a visão da rede
            </Link>
          }
          className="min-h-96"
        />
      )
    if (summary.isError)
      return (
        <ErrorState error={summary.error} heading="h1" onRetry={() => summary.refetch()} className="py-16" />
      )
    return <DetailSkeleton brush={period !== '1d'} />
  }

  const data: EnvironmentSummary = summary.data
  const { store, indicators } = data
  const zoneLabel = formatTimeZoneLabel(store.timezone, data.period.to)
  const busy = summary.isPlaceholderData || series.isPlaceholderData
  const nowAt = data.now ?? data.period.to

  const changePeriod = (next: PeriodKey) => {
    if (next === period) return
    const params = new URLSearchParams(search)
    params.set('periodo', next)
    // Push (o voltar do navegador desfaz) e mantém o estado com a query da lista, para o breadcrumb
    setSearch(params, { state: location.state, preventScrollReset: true })
  }

  const showGap = (gap: Gap) => {
    const start = Math.max(Date.parse(gap.from) - 2 * HOUR_MS, Date.parse(data.period.from))
    const end = Math.min(Date.parse(gap.to) + 2 * HOUR_MS, Date.parse(data.period.to))
    // O gráfico amplia e rola até ele; o foco vai para a figura, que responde às setas
    chart.current?.zoomTo(new Date(start).toISOString(), new Date(end).toISOString())
    document.querySelector<HTMLElement>(`#${CHART_ID} figure`)?.focus({ preventScroll: true })
  }

  const showTable = () => {
    setTableOpen(true)
    requestAnimationFrame(() => {
      const table = document.getElementById('tabela-dados')
      table?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
      table?.querySelector('summary')?.focus({ preventScroll: true })
    })
  }

  const downloadSeries = (current: Series) =>
    download(
      csvFileName(data.environment.id, period, nowAt, store.timezone),
      seriesCsv(current, store.timezone, zoneLabel),
    )
  const downloadGaps = (current: Series) =>
    download(
      csvFileName(data.environment.id, period, nowAt, store.timezone, 'lacunas'),
      gapsCsv(current, store.timezone, zoneLabel),
    )

  const comparison =
    comparing && previousSummary.data
      ? {
          period,
          range: formatPeriod(previous.from, previous.to, store.timezone),
          indicators: previousSummary.data.indicators,
        }
      : null

  return (
    <div className="detalhe-impressao flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Breadcrumb
          summary={data}
          period={period}
          from={(location.state as { from?: unknown } | null)?.from}
        />
        <EnvironmentHeader
          summary={data}
          trend={
            series.data && !series.isPlaceholderData
              ? trendPerHour(series.data, data.status.lastValidAt)
              : null
          }
        />
      </div>

      <section aria-labelledby="periodo-titulo" className="cartao relative overflow-clip">
        <ProgressBar active={busy} label="Atualizando o período" />
        <h2 id="periodo-titulo" className="so-leitor">
          Indicadores e temperatura: {PERIOD_LABEL[period]}
        </h2>
        <PeriodToolbar
          period={period}
          range={data.period}
          timeZone={store.timezone}
          onPeriodChange={changePeriod}
          onPeriodIntent={(next) => next !== period && prefetch(id, next)}
          compare={comparing}
          compareAvailability={availability}
          onCompareChange={setCompare}
          onShowTable={showTable}
          onDownloadSeries={() => series.data && downloadSeries(series.data)}
          onDownloadGaps={() => series.data && downloadGaps(series.data)}
          gapCount={series.data?.gaps.length ?? 0}
          onPrint={() => setTimeout(() => window.print(), 150)}
        />
        <PeriodKpis indicators={indicators} comparison={comparison} busy={busy} />
        <div
          id={CHART_ID}
          className={clsx(
            'border-borda border-t p-4 transition-opacity duration-100 md:p-5',
            series.isPlaceholderData && 'opacity-60',
          )}
        >
          {series.data ? (
            <TemperatureChart
              ref={chart}
              series={series.data}
              previous={comparing ? (previousSeries.data ?? null) : null}
              timeZone={store.timezone}
              title="Temperatura"
            />
          ) : series.isError ? (
            <ErrorState error={series.error} onRetry={() => series.refetch()} />
          ) : (
            <ChartSkeleton brush={period !== '1d'} />
          )}
        </div>
      </section>

      {weekly && (
        <div className="grid gap-6 print:break-before-page print:grid-cols-12 lg:grid-cols-12">
          <Panel
            id="perfil"
            title="Perfil semanal"
            description={`Parte do horário fora da faixa por dia da semana e hora · ${PERIOD_LABEL[period]} · ${zoneLabel}`}
            busy={profile.isPlaceholderData}
            className="print:col-span-7 lg:col-span-7"
          >
            {profile.data ? (
              <WeeklyProfile profile={profile.data} />
            ) : profile.isError ? (
              <ErrorState error={profile.error} onRetry={() => profile.refetch()} className="-m-4" />
            ) : (
              <Skeleton className="h-52 w-full" />
            )}
          </Panel>
          <Panel
            id="diario"
            title="Conforto por dia"
            description="Parte do horário de funcionamento na faixa, abaixo e acima"
            busy={daily.isPlaceholderData}
            className="print:col-span-5 lg:col-span-5"
          >
            {daily.data ? (
              <DailyComfort days={daily.data.days} />
            ) : daily.isError ? (
              <ErrorState error={daily.error} onRetry={() => daily.refetch()} className="-m-4" />
            ) : (
              <Skeleton className="h-52 w-full" />
            )}
          </Panel>
        </div>
      )}

      {series.data && (
        <GapsList
          series={series.data}
          discarded={indicators.discarded}
          timeZone={store.timezone}
          onShow={showGap}
        />
      )}

      {series.data && (
        <DataTable
          key={period}
          series={series.data}
          timeZone={store.timezone}
          timeZoneLabel={zoneLabel}
          open={tableOpen}
          onOpenChange={setTableOpen}
          onDownload={() => series.data && downloadSeries(series.data)}
        />
      )}
    </div>
  )
}
