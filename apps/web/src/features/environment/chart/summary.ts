import type { Indicators } from '@celsius/contracts'
import {
  formatDateTime,
  formatDuration,
  formatPercent,
  formatRange,
  formatTemperature,
  formatTime,
  plural,
} from '../../../lib/format'
import { type ChartModel, classify } from './model'
import { BUCKET_TITLE, shortTimeZoneLabel } from './tooltip'

/** O que o resumo repete dos KPIs do período. */
export type ChartIndicators = Pick<Indicators, 'comfortPct' | 'minutesAbove' | 'minutesBelow'>

/**
 * Resumo do gráfico para leitor de tela (seção 5.10). Com os indicadores do período, a parte na
 * faixa e o tempo acima e abaixo são os números dos KPIs, contados em minutos de leitura; sem
 * eles, saem dos buckets com a loja aberta, e o texto diz que são médias. Máxima e lacunas vêm
 * sempre dos buckets.
 */
export function describeChart(
  model: ChartModel,
  timeZone: string,
  indicators: ChartIndicators | null = null,
): string {
  const where = shortTimeZoneLabel(timeZone, model.from)
  const head = `${BUCKET_TITLE[model.bucket]} de ${formatDateTime(model.from, timeZone)} a ${formatDateTime(model.to, timeZone)}, ${where}.`

  const parts: string[] = []
  if (indicators?.comfortPct != null) {
    parts.push(`${formatPercent(indicators.comfortPct)} do horário na faixa de ${formatRange(model.range)}`)
    if (indicators.minutesAbove > 0) parts.push(`${formatDuration(indicators.minutesAbove)} acima`)
    if (indicators.minutesBelow > 0) parts.push(`${formatDuration(indicators.minutesBelow)} abaixo`)
  } else {
    const open = model.points.filter((point) => point.open && point.avg != null)
    const counts = { within: 0, above: 0, below: 0 }
    for (const point of open) counts[classify(point.avg as number, model.range)]++
    if (open.length === 0) parts.push('Nenhuma média válida com a loja aberta')
    else {
      const share = (count: number) => formatPercent((count / open.length) * 100)
      const hours = (count: number) => formatDuration((count * model.bucketMs) / 60_000)
      parts.push(
        `com a loja aberta, ${share(counts.within)} das médias na faixa de ${formatRange(model.range)}`,
      )
      if (counts.above) parts.push(`${hours(counts.above)} acima`)
      if (counts.below) parts.push(`${hours(counts.below)} abaixo`)
    }
  }

  const peak = model.points.reduce<{ t: number; value: number } | null>((best, point) => {
    const value = point.max ?? point.avg
    return value != null && (!best || value > best.value) ? { t: point.t, value } : best
  }, null)
  if (peak) {
    parts.push(
      `máxima de ${formatTemperature(peak.value)} em ${formatDateTime(peak.t, timeZone).slice(0, 5)} às ${formatTime(peak.t, timeZone)}`,
    )
  }

  const gapMinutes = model.gaps.reduce((sum, gap) => sum + (gap.to - gap.from) / 60_000, 0)
  parts.push(
    model.gaps.length === 0
      ? 'nenhuma lacuna'
      : `${plural(model.gaps.length, 'lacuna', 'lacunas')} somando ${formatDuration(gapMinutes, 'calendar')}`,
  )
  const [first = '', ...rest] = parts
  return `${head} ${first.charAt(0).toUpperCase()}${first.slice(1)}${rest.length ? `; ${rest.join('; ')}` : ''}.`
}
