import type { EnvironmentSummary, PeriodKey } from '@celsius/contracts'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import { Link, useParams, useSearchParams } from 'react-router'
import { ApiError } from '../../api/client'
import { useEnvironmentSeries, useEnvironmentSummary } from '../../api/queries'
import { Badge, Choice, EmptyState, Icon, Skeleton } from '../../components/ui'
import {
  formatAgo,
  formatDateTime,
  formatDuration,
  formatInteger,
  formatPercent,
  formatTemperature,
} from '../../lib/format'
import { DEVICE_STATUS, GAP_REASON, PERIOD_LABEL, SITUATION } from '../../lib/labels'
import { TemperatureChart } from './TemperatureChart'

const PERIODS = (['1d', '7d', '30d'] as const).map((value) => ({ value, label: PERIOD_LABEL[value] }))
const DAYS: Array<[string, string]> = [
  ['seg', 'Seg'],
  ['ter', 'Ter'],
  ['qua', 'Qua'],
  ['qui', 'Qui'],
  ['sex', 'Sex'],
  ['sab', 'Sáb'],
  ['dom', 'Dom'],
]

/** "Seg–Sex 09:00–20:00 · Sáb 09:00–18:00 · Dom fechado", agrupando dias iguais seguidos. */
function describeHours(hours: EnvironmentSummary['environment']['openingHours']): string {
  const groups: Array<{ from: string; to: string; label: string }> = []
  for (const [key, name] of DAYS) {
    const window = hours[key]
    const label = window ? `${window[0]}–${window[1]}`.replace('00:00–24:00', '24 h') : 'fechado'
    const last = groups.at(-1)
    if (last && last.label === label) last.to = name
    else groups.push({ from: name, to: name, label })
  }
  return groups
    .map((group) => `${group.from === group.to ? group.from : `${group.from}–${group.to}`} ${group.label}`)
    .join(' · ')
}

function Indicator({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="cartao flex min-w-0 flex-col gap-2.5 p-5">
      <span className="t-rotulo text-tinta-3">{label}</span>
      <span className="t-numero text-[1.75rem]">{value}</span>
      {children && <div className="text-[0.84rem] text-tinta-3">{children}</div>}
    </div>
  )
}

export function EnvironmentPage() {
  const { id = '' } = useParams()
  const [search, setSearch] = useSearchParams()
  const period = (
    ['1d', '7d', '30d'].includes(search.get('periodo') ?? '') ? search.get('periodo') : '1d'
  ) as PeriodKey
  const summary = useEnvironmentSummary(id, period)
  const series = useEnvironmentSeries(id, period)

  if (summary.isError) {
    const notFound = summary.error instanceof ApiError && summary.error.status === 404
    return (
      <EmptyState title={notFound ? 'Ambiente não encontrado' : 'Não foi possível carregar o ambiente'}>
        {notFound
          ? 'Ele não existe ou não faz parte das lojas que você acompanha.'
          : (summary.error as Error).message}
        <div className="mt-4">
          <Link to="/" className="font-medium text-celsius">
            Voltar para a visão da rede
          </Link>
        </div>
      </EmptyState>
    )
  }

  const data = summary.data
  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-28 rounded-[22px]" />
        <Skeleton className="h-[460px] rounded-[22px]" />
      </div>
    )
  }

  const { environment, store, status, indicators } = data
  const device = DEVICE_STATUS[status.device] ?? (DEVICE_STATUS.no_data as (typeof DEVICE_STATUS)[string])
  const situation = SITUATION[status.situation] ?? (SITUATION.unknown as (typeof SITUATION)[string])
  const temperatureTone =
    status.situation === 'above' ? 'text-calor' : status.situation === 'below' ? 'text-frio' : 'text-tinta'
  const discarded = indicators.discarded
  const discardedParts = [
    discarded.sensorError && `${formatInteger(discarded.sensorError)} erro do sensor`,
    discarded.stuck && `${formatInteger(discarded.stuck)} sensor travado`,
    discarded.spike && `${formatInteger(discarded.spike)} picos`,
    discarded.outOfRange && `${formatInteger(discarded.outOfRange)} fora da faixa física`,
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Navegação" className="flex items-center gap-2 text-[0.88rem] text-tinta-3">
        <Link
          to={`/?periodo=${period}`}
          className="inline-flex items-center gap-1 font-medium text-celsius hover:text-celsius-escuro"
        >
          <Icon icon={ArrowLeft01Icon} size={16} /> Visão da rede
        </Link>
        <span>/</span>
        <Link to={`/?periodo=${period}&busca=${encodeURIComponent(store.name)}`} className="hover:text-tinta">
          {store.name}
        </Link>
        <span>/</span>
        <span className="text-tinta">{environment.name}</span>
      </nav>

      <section className="cartao grid gap-6 p-6 md:grid-cols-[minmax(0,1fr)_auto] md:p-7">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={device.tone} title={device.hint}>
              {device.label}
            </Badge>
            <Badge tone={situation.tone}>{situation.label}</Badge>
          </div>
          <h1 className="t-titulo text-[2rem] leading-[1.05]">{environment.name}</h1>
          <p className="text-tinta-3">
            {store.name} · {store.client.name} · {store.city}/{store.state}
          </p>
          <dl className="mt-1 grid gap-x-8 gap-y-2 text-[0.86rem] sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-tinta-3">Faixa de conforto</dt>
              <dd className="font-medium text-tinta">
                {formatTemperature(environment.comfortRange.min)} a{' '}
                {formatTemperature(environment.comfortRange.max)}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-tinta-3">Dispositivo</dt>
              <dd className="font-mono text-tinta">{environment.deviceId ?? '—'}</dd>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <dt className="text-tinta-3">Funcionamento</dt>
              <dd className="text-tinta">{describeHours(environment.openingHours)}</dd>
            </div>
          </dl>
        </div>
        <div className="flex flex-col items-start gap-1 md:items-end">
          <span className="t-rotulo text-tinta-3">Última leitura válida</span>
          <span className={clsx('t-numero text-[3.2rem]', temperatureTone)}>
            {formatTemperature(status.lastValue)}
          </span>
          <span className="text-[0.84rem] text-tinta-3">
            {formatDateTime(status.lastValidAt, store.timezone)} · contato{' '}
            {formatAgo(status.lastContactAt, data.now)}
          </span>
        </div>
      </section>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-[0.9rem] text-tinta-3">
          {formatDateTime(data.period.from, store.timezone)} a{' '}
          {formatDateTime(data.period.to, store.timezone)} · horário local da loja
        </p>
        <Choice
          label="Período"
          value={period}
          options={PERIODS}
          onChange={(value) => setSearch({ periodo: value }, { replace: true })}
        />
      </div>

      <section aria-label="Indicadores do período" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Indicator label="Conforto no horário" value={formatPercent(indicators.comfortPct)}>
          {formatDuration(indicators.minutesAbove)} acima · {formatDuration(indicators.minutesBelow)} abaixo
        </Indicator>
        <Indicator label="Cobertura de dados" value={formatPercent(indicators.coveragePct)}>
          do horário de funcionamento com leitura válida
        </Indicator>
        <Indicator label="Temperatura média" value={formatTemperature(indicators.valueAvg)}>
          mín. {formatTemperature(indicators.valueMin)} · máx. {formatTemperature(indicators.valueMax)}
        </Indicator>
        <Indicator
          label="Indisponibilidade"
          value={indicators.gapCount ? formatDuration(indicators.gapMinutes) : 'Nenhuma'}
        >
          {indicators.gapCount === 0
            ? 'Nenhum trecho de 10 min ou mais sem leitura válida'
            : `${indicators.gapCount} ${indicators.gapCount === 1 ? 'trecho' : 'trechos'} sem leitura válida`}
          {indicators.samplesDiscarded > 0 &&
            ` · ${formatInteger(indicators.samplesDiscarded)} ${indicators.samplesDiscarded === 1 ? 'leitura descartada' : 'leituras descartadas'}`}
        </Indicator>
      </section>

      <section className="cartao flex flex-col gap-4 p-5 md:p-6" aria-label="Temperatura no período">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="t-titulo text-[1.15rem]">Temperatura no período</h2>
          <span className="text-[0.8rem] text-tinta-3">
            {series.data
              ? `agregação: ${series.data.bucket === 'raw' ? 'amostras de 30 s' : series.data.bucket}`
              : ''}
            {' · '}faixa de conforto em ciano · horário de funcionamento sombreado
          </span>
        </div>
        {series.data ? (
          <div className={clsx('transition-opacity', series.isPlaceholderData && 'opacity-50')}>
            <TemperatureChart series={series.data} timeZone={store.timezone} />
          </div>
        ) : (
          <Skeleton className="h-[380px]" />
        )}
      </section>

      {series.data && series.data.gaps.length > 0 && (
        <section className="cartao flex flex-col gap-3 p-5 md:p-6" aria-label="Lacunas e indisponibilidades">
          <h2 className="t-titulo text-[1.15rem]">Lacunas e indisponibilidades</h2>
          <ul className="flex flex-col divide-y divide-linha">
            {series.data.gaps.map((gap) => (
              <li
                key={gap.from}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[0.9rem]"
              >
                <span className="text-tinta">
                  {formatDateTime(gap.from, store.timezone)} a {formatDateTime(gap.to, store.timezone)}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-tinta-3 tabular-nums">
                    {formatDuration((Date.parse(gap.to) - Date.parse(gap.from)) / 60_000)}
                  </span>
                  <Badge tone={gap.kind === 'no_data' ? 'neutro' : 'alerta'}>
                    {gap.kind === 'no_data'
                      ? 'Sem dados'
                      : (GAP_REASON[gap.reason ?? ''] ?? 'Leitura descartada')}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
          {discardedParts.length > 0 && (
            <p className="text-[0.84rem] text-tinta-3">
              Leituras descartadas no período: {discardedParts.join(' · ')}.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
