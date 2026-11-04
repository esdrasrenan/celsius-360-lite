import type { EnvironmentSummary, PeriodKey } from '@celsius/contracts'
import {
  ArrowDown02Icon,
  ArrowDownRight01Icon,
  ArrowLeft01Icon,
  ArrowUp02Icon,
  ArrowUpRight01Icon,
} from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import { Link } from 'react-router'
import { StateBadge } from '../../components/Badge'
import { Hint } from '../../components/Hint'
import { Icon } from '../../components/Icon'
import { StatusDot } from '../../components/StatusDot'
import {
  formatAgo,
  formatDateTime,
  formatDecimal,
  formatNextOpen,
  formatOpeningHours,
  formatRange,
  formatTemperature,
  formatTimeZoneLabel,
  NBSP,
} from '../../lib/format'
import { DEVICE_STATE, SITUATION_STATE } from '../../lib/states'
import { deviation, networkHref, storeHref } from './detail'

const LINK = 'rounded-xs text-acento decoration-1 underline-offset-4 hover:underline'

/** Breadcrumb (seção 3.15): a rede volta com os filtros da lista; no celular, só "‹ Loja". */
export function Breadcrumb({
  summary,
  period,
  from,
}: {
  summary: EnvironmentSummary
  period: PeriodKey
  /** location.state.from: a query da lista de onde o usuário veio. */
  from: unknown
}) {
  const store = storeHref(summary.store.id, period)
  return (
    <nav aria-label="Trilha de navegação" className="nao-imprimir flex h-8 min-w-0 items-center text-apoio">
      <ol className="hidden min-w-0 items-center gap-2 sm:flex">
        <li className="shrink-0">
          <Link to={networkHref(from, period)} className={LINK}>
            Visão da rede
          </Link>
        </li>
        <li className="flex shrink-0 items-center gap-2">
          <span aria-hidden="true" className="text-texto-3">
            /
          </span>
          <Link to={store} className={LINK}>
            {summary.store.name}
          </Link>
        </li>
        <li className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="text-texto-3">
            /
          </span>
          <span aria-current="page" className="truncate text-texto">
            {summary.environment.name}
          </span>
        </li>
      </ol>
      <Link to={store} className={clsx(LINK, 'inline-flex items-center gap-1 sm:hidden')}>
        <Icon icon={ArrowLeft01Icon} />
        {summary.store.name}
      </Link>
    </nav>
  )
}

/** Situação da última leitura: cor, seta e a linha de desvio (seção 4.3). */
function readingTone(summary: EnvironmentSummary) {
  const { status, environment } = summary
  const value = status.lastValue
  if (value == null) return { className: 'text-texto-3', icon: null, line: 'Sem leitura válida recente' }
  if (status.situation === 'closed')
    return { className: 'text-texto-2', icon: null, line: 'Loja fechada · fora do cálculo de conforto' }
  const off = deviation(value, environment.comfortRange)
  if (off != null && value > environment.comfortRange.max)
    return {
      className: 'text-quente-texto',
      icon: ArrowUp02Icon,
      line: `${formatDecimal(off)}${NBSP}°C acima da faixa`,
    }
  if (off != null)
    return {
      className: 'text-frio-texto',
      icon: ArrowDown02Icon,
      line: `${formatDecimal(off)}${NBSP}°C abaixo da faixa`,
    }
  return { className: 'text-texto', icon: null, line: 'Na faixa' }
}

function Trend({ perHour }: { perHour: number }) {
  const rounded = Math.round(perHour * 10) / 10
  if (rounded === 0) return <span>estável</span>
  const amount = `${formatDecimal(Math.abs(rounded))}${NBSP}°C/h`
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
      <Icon icon={rounded > 0 ? ArrowUpRight01Icon : ArrowDownRight01Icon} size={12} />
      <span aria-hidden="true">{amount}</span>
      <span className="so-leitor">
        {rounded > 0 ? 'subindo' : 'caindo'} {formatDecimal(Math.abs(rounded))} °C por hora
      </span>
    </span>
  )
}

/**
 * Cabeçalho sem cartão (seção 4.3): identidade, estado e metadados à esquerda; a última leitura
 * válida à direita, em destaque, com o desvio da faixa e a tendência quando couber.
 */
export function EnvironmentHeader({
  summary,
  trend,
}: {
  summary: EnvironmentSummary
  /** °C por hora sobre os últimos buckets; null quando não se aplica. */
  trend: number | null
}) {
  const { environment, store, status } = summary
  const device = DEVICE_STATE[status.device]
  const situation = SITUATION_STATE[status.situation]
  const nextOpen = formatNextOpen(status.nextOpenAt, summary.now, store.timezone)
  const reading = readingTone(summary)
  const timeZone = formatTimeZoneLabel(store.timezone, summary.now ?? undefined)
  // Mais de 24 h atrás, o relativo já é a data absoluta: não repete
  const ago = formatAgo(status.lastValidAt, summary.now, store.timezone)
  const at = formatDateTime(status.lastValidAt, store.timezone)

  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between md:gap-10">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="line-clamp-2 break-words text-texto text-titulo-1">{environment.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {device.presentation === 'silent' ? (
            <Hint content={device.hint}>
              <span className="inline-flex h-6 items-center gap-1.5 text-apoio text-texto-2">
                <StatusDot tone={device.tone} />
                {device.label}
              </span>
            </Hint>
          ) : (
            <StateBadge state={device} />
          )}
          {(status.situation === 'closed' || status.situation === 'unknown') && (
            <StateBadge
              state={situation}
              label={
                status.situation === 'closed' && nextOpen ? `${situation.label} · ${nextOpen}` : undefined
              }
            />
          )}
        </div>
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-apoio text-texto-3">
          {/* Separador no fim do item: numa quebra de linha ele nunca abre a linha seguinte */}
          {(
            [
              ['loja', store.name],
              ['cliente', store.client.name],
              ['cidade', `${store.city}/${store.state}`],
            ] as const
          ).map(([key, part], index) => (
            <span key={key}>
              {part}
              {(index < 2 || environment.deviceId) && (
                <span aria-hidden="true" className="ms-1.5">
                  ·
                </span>
              )}
            </span>
          ))}
          {environment.deviceId && <span className="id-tecnico">{environment.deviceId}</span>}
        </p>
        <dl className="flex flex-col gap-0.5 text-apoio sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-1.5">
          <div className="flex gap-1.5">
            <dt className="text-texto-3">Faixa</dt>
            <dd className="num font-medium text-texto-2">{formatRange(environment.comfortRange)}</dd>
          </div>
          <span aria-hidden="true" className="hidden text-texto-3 sm:inline">
            ·
          </span>
          <div className="flex gap-1.5">
            <dt className="text-texto-3">Horário</dt>
            {/* Cada grupo de dias inteiro numa linha: "Sáb 09:00–18:00" nunca quebra no meio */}
            <dd className="flex flex-wrap gap-x-1.5 text-texto-2">
              {formatOpeningHours(environment.openingHours)
                .split(' · ')
                .map((part, index, parts) => (
                  <span key={part} className="whitespace-nowrap">
                    {part}
                    {index < parts.length - 1 && (
                      <span aria-hidden="true" className="ms-1.5 text-texto-3">
                        ·
                      </span>
                    )}
                  </span>
                ))}
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex shrink-0 flex-col gap-0.5 md:items-end md:text-end">
        <p className="font-medium text-apoio text-texto-3">Última leitura válida</p>
        <p className={clsx('flex items-center gap-1', reading.className)}>
          {reading.icon && <Icon icon={reading.icon} size={20} />}
          <span className="num whitespace-nowrap text-kpi md:text-destaque">
            {status.lastValue == null ? formatTemperature(null) : formatDecimal(status.lastValue)}
            {status.lastValue != null && (
              <span className="ms-1 font-medium text-corpo-lg text-texto-3 tracking-normal md:text-titulo-2">
                °C
              </span>
            )}
          </span>
        </p>
        <p
          className={clsx(
            'font-medium text-corpo',
            reading.className === 'text-texto' ? 'text-texto-2' : reading.className,
          )}
        >
          {reading.line}
        </p>
        <p className="num flex flex-wrap items-center gap-x-1.5 text-legenda text-texto-3 md:justify-end">
          {trend != null && (
            <>
              <Trend perHour={trend} />
              <span aria-hidden="true">·</span>
            </>
          )}
          <Hint content={`Data e hora no ${timeZone}`}>
            <span>{ago === at ? at : `${ago} · ${at}`}</span>
          </Hint>
        </p>
      </div>
    </div>
  )
}
