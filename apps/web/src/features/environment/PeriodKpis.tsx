import type { Indicators, PeriodKey } from '@celsius/contracts'
import { clsx } from 'clsx'
import { ComfortBar } from '../../components/ComfortBar'
import { Hint } from '../../components/Hint'
import {
  formatDecimal,
  formatDuration,
  formatPercent,
  formatTemperature,
  NBSP,
  plural,
} from '../../lib/format'
import { COMFORT_TARGET_PCT, comfortTone, DEFINITIONS, PERIOD_LABEL } from '../../lib/states'
import { difference, unbrokenDuration } from './detail'
import { KpiCell, type KpiChange, KpiDuration, KpiNumber } from './KpiCell'

/** Número do percentual sem o "%" (que vira unidade): "82,4", "<0,1". */
const percentNumber = (value: number) => formatPercent(value).replace('%', '')

/** Bordas da grade 2 × 2 no celular e 1 × 4 a partir de lg, sem cartão dentro de cartão. */
const CELL_BORDER = [
  '',
  'border-s',
  'border-t lg:border-s lg:border-t-0 print:border-s print:border-t-0',
  'border-s border-t lg:border-t-0 print:border-t-0',
] as const

interface Comparison {
  period: PeriodKey
  /** "28/01 00:00 – 04/02 00:00", para a dica do chip. */
  range: string
  indicators: Indicators
}

/**
 * Chip de variação: a seta segue o sinal do valor exibido (arredondado em `step`); abaixo de
 * `flatBelow` o chip fica neutro, sem juízo de melhora ou piora.
 */
function change(
  delta: number | null,
  amount: (value: number) => string,
  step: number,
  flatBelow: number,
  higherIsBetter: boolean | null,
  comparison: Comparison,
): KpiChange | null {
  if (delta == null) return null
  const shown = Math.round(delta / step) * step
  const flat = Math.abs(delta) < flatBelow
  const direction = shown > 0 ? 'up' : shown < 0 ? 'down' : 'flat'
  const anteriores =
    comparison.period === '1d' ? 'as 24 horas anteriores' : `os ${PERIOD_LABEL[comparison.period]} anteriores`
  return {
    amount: amount(Math.abs(shown)),
    direction,
    verdict: flat || higherIsBetter == null ? 'neutral' : delta > 0 === higherIsBetter ? 'good' : 'bad',
    comparison: `vs ${PERIOD_LABEL[comparison.period]} anteriores`,
    hint: `Diferença para ${anteriores} (${comparison.range})`,
  }
}

const points = (value: number) => `${formatDecimal(value)}${NBSP}p.p.`
const degrees = (value: number) => `${formatDecimal(value)}${NBSP}°C`
const minutes = (value: number) => formatDuration(value)

/** Contexto do conforto: o tempo fora da faixa em horas, com a parte do horário (seção 2.3). */
function comfortContext(indicators: Indicators): string {
  const { minutesAbove, minutesBelow, abovePct, belowPct } = indicators
  if (indicators.comfortPct == null) return 'Sem leitura válida no horário'
  if (minutesAbove > 0 && minutesBelow > 0)
    return `${unbrokenDuration(minutesAbove)} acima · ${unbrokenDuration(minutesBelow)} abaixo`
  if (minutesAbove > 0)
    return `${unbrokenDuration(minutesAbove)} acima · ${formatPercent(abovePct)} do horário`
  if (minutesBelow > 0)
    return `${unbrokenDuration(minutesBelow)} abaixo · ${formatPercent(belowPct)} do horário`
  return `Todo o horário na faixa · meta ${COMFORT_TARGET_PCT}%`
}

/** Barra de cobertura com a marca da meta; a parte sem leitura fica hachurada. */
function CoverageBar({ coverage }: { coverage: number }) {
  return (
    <Hint content={`${formatPercent(coverage)} do horário com leitura válida · meta ${COMFORT_TARGET_PCT}%`}>
      <div
        role="img"
        aria-label={`${formatPercent(coverage)} do horário com leitura válida; meta ${COMFORT_TARGET_PCT}%`}
        className="relative h-1 w-full"
      >
        <div className="hachura-sem-dados flex size-full overflow-hidden rounded-xs">
          <span className="h-full bg-na-faixa" style={{ width: `${Math.min(100, coverage)}%` }} />
        </div>
        <span
          aria-hidden="true"
          className="absolute top-1/2 h-2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-texto"
          style={{ left: `${COMFORT_TARGET_PCT}%` }}
        />
      </div>
    </Hint>
  )
}

/**
 * Os 4 indicadores do período (seção 4.3), como células separadas por divisórias no topo do
 * cartão. Com "Comparar" ligado e base suficiente, cada um ganha o chip de variação.
 */
export function PeriodKpis({
  indicators,
  comparison,
  busy,
}: {
  indicators: Indicators
  comparison: Comparison | null
  busy: boolean
}) {
  const previous = comparison?.indicators
  const comfortLevel = comfortTone(indicators.comfortPct)
  const lowCoverage = indicators.coveragePct != null && indicators.coveragePct < COMFORT_TARGET_PCT
  const closedGapMinutes = Math.max(0, indicators.gapMinutes - indicators.gapMinutesInHours)
  const gapContext = [
    closedGapMinutes > 0 && `+${unbrokenDuration(closedGapMinutes)} com a loja fechada`,
    indicators.gapCount > 0 && plural(indicators.gapCount, 'trecho', 'trechos'),
  ]
    .filter(Boolean)
    .join(' · ')

  const cells = [
    <KpiCell
      key="comfort"
      label="Conforto no horário"
      definition={DEFINITIONS.comfortInHours}
      value={
        indicators.comfortPct == null ? null : (
          <KpiNumber value={percentNumber(indicators.comfortPct)} unit="%" />
        )
      }
      tone={comfortLevel === 'neutro' ? 'neutro' : comfortLevel === 'alerta' ? 'alerta' : 'falha'}
      context={comfortContext(indicators)}
      change={
        comparison &&
        change(difference(indicators.comfortPct, previous?.comfortPct), points, 0.1, 0.5, true, comparison)
      }
    >
      <ComfortBar
        size="kpi"
        within={indicators.comfortPct}
        below={indicators.belowPct}
        above={indicators.abovePct}
        coverage={indicators.coveragePct}
        belowMinutes={indicators.minutesBelow}
        aboveMinutes={indicators.minutesAbove}
      />
    </KpiCell>,
    <KpiCell
      key="temperature"
      label="Temperatura no horário"
      definition={DEFINITIONS.temperatureInHours}
      value={
        indicators.valueAvgInHours == null ? null : (
          <KpiNumber value={formatDecimal(indicators.valueAvgInHours)} unit="°C" />
        )
      }
      context={
        indicators.valueAvg == null
          ? 'Sem leitura válida nas 24 h'
          : `24 h: média ${formatDecimal(indicators.valueAvg)} · máx. ${formatTemperature(indicators.valueMax)}`
      }
      change={
        comparison &&
        change(
          difference(indicators.valueAvgInHours, previous?.valueAvgInHours),
          degrees,
          0.1,
          0.1,
          null,
          comparison,
        )
      }
    />,
    <KpiCell
      key="coverage"
      label="Cobertura de dados"
      definition={DEFINITIONS.coverage}
      value={
        indicators.coveragePct == null ? null : (
          <KpiNumber value={percentNumber(indicators.coveragePct)} unit="%" />
        )
      }
      tone={lowCoverage ? 'alerta' : 'neutro'}
      context={
        indicators.minutesExpected > 0
          ? `${unbrokenDuration(indicators.minutesInHours)} de ${unbrokenDuration(indicators.minutesExpected)} do horário com leitura`
          : 'Sem horário de funcionamento no período'
      }
      change={
        comparison &&
        change(difference(indicators.coveragePct, previous?.coveragePct), points, 0.1, 0.5, true, comparison)
      }
    >
      {indicators.coveragePct != null && <CoverageBar coverage={indicators.coveragePct} />}
    </KpiCell>,
    <KpiCell
      key="unavailability"
      label="Indisponibilidade no horário"
      definition={DEFINITIONS.unavailabilityInHours}
      {...(indicators.gapMinutesInHours > 0
        ? {
            value: <KpiDuration text={formatDuration(indicators.gapMinutesInHours)} />,
            tone: 'alerta' as const,
          }
        : { text: 'Nenhuma' })}
      context={gapContext || 'Nenhum trecho de 10 min ou mais sem leitura'}
      change={
        comparison &&
        change(
          difference(indicators.gapMinutesInHours, previous?.gapMinutesInHours),
          minutes,
          1,
          10,
          false,
          comparison,
        )
      }
    />,
  ]

  return (
    <div
      aria-busy={busy || undefined}
      className={clsx(
        'grid grid-cols-2 border-borda border-t transition-opacity duration-100 lg:grid-cols-4 print:grid-cols-4',
        busy && 'opacity-60',
      )}
    >
      {cells.map((cell, index) => (
        <div key={cell.key} className={clsx('flex min-w-0 border-borda', CELL_BORDER[index])}>
          {cell}
        </div>
      ))}
    </div>
  )
}
