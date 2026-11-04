import type { ComfortRange, SeriesPoint } from '@celsius/contracts'
import {
  formatAxisTick,
  formatDecimal,
  formatInteger,
  formatTime,
  isLocalMidnight,
  NBSP,
} from '../../../lib/format'

export const HOUR_MS = 3_600_000
export const DAY_MS = 24 * HOUR_MS

const hourFormatters = new Map<string, Intl.DateTimeFormat>()

function hourFormatter(timeZone: string): Intl.DateTimeFormat {
  let value = hourFormatters.get(timeZone)
  if (!value) {
    value = new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    hourFormatters.set(timeZone, value)
  }
  return value
}

/**
 * Horas cheias do fuso da loja múltiplas de `everyHours`, em [from, to). O fim fica de fora: a
 * meia-noite que fecha o período não ganha rótulo (o último dia de 7 dias é "ter 10/02"). A
 * contagem parte da primeira hora cheia local, que num fuso de meia hora não é a hora cheia UTC.
 */
export function localTicks(from: number, to: number, timeZone: string, everyHours: number): number[] {
  const format = hourFormatter(timeZone)
  const out: number[] = []
  const start = Math.ceil(from / 60_000) * 60_000
  const minute = Number(format.format(start).split(':')[1])
  for (let t = start + ((60 - minute) % 60) * 60_000; t < to; t += HOUR_MS) {
    const [hour = -1, minute = -1] = format.format(t).split(':').map(Number)
    if (minute === 0 && hour % everyHours === 0) out.push(t)
  }
  return out
}

export type TickFormat = 'hour' | 'weekday' | 'date'

export interface AxisTicks {
  /** Marcas com rótulo. */
  labels: number[]
  /** Todas as marcas (com as menores, sem rótulo). */
  ticks: number[]
  /** Meias-noites locais: as únicas linhas verticais da grade. */
  midnights: number[]
  format: TickFormat
}

/** Espaço mínimo entre rótulos, por formato: "15h", "05/02" (72 px, seção 5.4) e "qua 05/02". */
const LABEL_SPACING: Record<TickFormat, number> = { hour: 48, date: 72, weekday: 80 }

/**
 * Marcas do eixo X para a janela visível, no fuso da loja (seção 5.4). Até 36 h, horas cheias a
 * cada 1, 3, 6 ou 12 h, conforme a largura; acima disso, meias-noites. Com um dia por rótulo (7
 * dias), o rótulo leva o dia da semana e há uma marca menor ao meio-dia; com mais dias (30 dias),
 * os rótulos pulam de n em n contando do fim, para a última data sempre aparecer.
 */
export function axisTicks(from: number, to: number, timeZone: string, plotWidth: number): AxisTicks {
  const hours = (to - from) / HOUR_MS
  const midnights = localTicks(from, to, timeZone, 24)
  if (hours <= 36) {
    const fits = Math.max(1, Math.floor(plotWidth / LABEL_SPACING.hour))
    const every = [1, 3, 6, 12].find((step) => hours / step <= fits) ?? 24
    const labels = localTicks(from, to, timeZone, every)
    return { labels, ticks: labels, midnights, format: 'hour' }
  }
  const days = hours / 24
  const daily = days <= Math.floor(plotWidth / LABEL_SPACING.weekday)
  if (daily)
    return { labels: midnights, ticks: localTicks(from, to, timeZone, 12), midnights, format: 'weekday' }
  const step = Math.ceil(days / Math.max(1, Math.floor(plotWidth / LABEL_SPACING.date)))
  const labels = midnights.filter((_, index) => (midnights.length - 1 - index) % step === 0)
  return { labels, ticks: labels, midnights, format: 'date' }
}

const TICK_PERIOD = { hour: '1d', weekday: '7d', date: '30d' } as const

/**
 * Rótulo de uma marca: "15h", "qua 05/02" ou "05/02". Na meia-noite das marcas de hora, a data
 * vai no estilo rico `strong` (peso 600).
 */
export function formatTick(value: number, timeZone: string, format: TickFormat): string {
  const text = formatAxisTick(value, timeZone, TICK_PERIOD[format])
  return format === 'hour' && isLocalMidnight(value, timeZone) ? `{strong|${text}}` : text
}

/** Pílula do cursor no eixo X: "sex 30/01 22:00". */
export function formatPointer(value: number, timeZone: string): string {
  return `${formatAxisTick(value, timeZone, '7d')} ${formatTime(value, timeZone)}`
}

/** Número do eixo Y sem unidade: "22" ou "22,5". */
export function formatScaleValue(value: number): string {
  return Number.isInteger(value) ? formatInteger(value) : formatDecimal(value)
}

/** Limite da faixa à direita do plot: "25 °C". */
export function formatLimit(value: number): string {
  return `${formatScaleValue(value)}${NBSP}°C`
}

export interface YScale {
  min: number
  max: number
  interval: number
}

/**
 * Escala Y com as séries visíveis e a faixa, mais 1 °C de folga (seção 5.4). A externa só entra
 * em `extras` quando o usuário pede, então nunca comanda a escala sozinha.
 */
export function yScale(
  points: readonly Pick<SeriesPoint, 'avg' | 'min' | 'max'>[],
  range: ComfortRange,
  withSpread: boolean,
  extras: readonly (number | null)[] = [],
): YScale {
  const values = points
    .flatMap((point) => (withSpread ? [point.min ?? point.avg, point.max ?? point.avg] : [point.avg]))
    .concat(extras)
    .filter((value): value is number => value != null && Number.isFinite(value))
  const low = Math.min(range.min, ...values) - 1
  const high = Math.max(range.max, ...values) + 1
  const interval = [1, 2, 2.5, 5, 10].find((step) => (high - low) / step <= 6) ?? 10
  return {
    min: Math.floor(low / interval) * interval,
    max: Math.ceil(high / interval) * interval,
    interval,
  }
}

/** Quanto do período está na tela: "2 de 30 dias", "6 de 24 horas". */
export function formatWindow(span: number, total: number): string {
  const inHours = total <= 1.5 * DAY_MS
  const unit = inHours ? HOUR_MS : DAY_MS
  const part = Math.round((span / unit) * 10) / 10
  const whole = Math.round(total / unit)
  return `${formatScaleValue(part)} de ${formatInteger(whole)} ${inHours ? 'horas' : 'dias'}`
}
