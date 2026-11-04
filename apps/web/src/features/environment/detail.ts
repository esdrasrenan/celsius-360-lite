import type {
  DailyComfort,
  EnvironmentSummary,
  Gap,
  Interval,
  Period,
  PeriodKey,
  ProfileCell,
  Series,
  SeriesBucket,
  SeriesPoint,
} from '@celsius/contracts'
import { formatDuration, formatPercent, NBSP } from '../../lib/format'
import { gapState, PERIOD_LABEL } from '../../lib/states'

/**
 * Regras do detalhe do ambiente que não dependem de React: links, período anterior, situação de
 * cada bucket, CSV, tendência, perfil semanal e conforto por dia. Tudo no fuso da loja.
 */

const HOUR_MS = 3_600_000
const BUCKET_MS: Record<SeriesBucket, number> = { raw: 30_000, '5m': 300_000, '15m': 900_000, '1h': HOUR_MS }

export const PERIODS: readonly PeriodKey[] = ['1d', '7d', '30d']

/** Período da URL; valor ausente ou inválido cai em 24 horas. */
export function parsePeriod(value: string | null): PeriodKey {
  return value != null && Object.hasOwn(PERIOD_LABEL, value) ? (value as PeriodKey) : '1d'
}

const DAY_MS = 86_400_000
const PERIOD_DAYS: Record<PeriodKey, number> = { '1d': 1, '7d': 7, '30d': 30 }

/** Intervalo de um período nomeado que termina em `to` (os três terminam no mesmo instante). */
export function periodRangeEndingAt(key: PeriodKey, to: string): { from: string; to: string } {
  const end = Date.parse(to)
  return { from: new Date(end - PERIOD_DAYS[key] * DAY_MS).toISOString(), to: new Date(end).toISOString() }
}

/** Período anterior: o mesmo comprimento, terminando onde o atual começa (seção 5.8). */
export function previousRange(period: Pick<Period, 'from' | 'to'>): { from: string; to: string } {
  const from = Date.parse(period.from)
  const length = Date.parse(period.to) - from
  return { from: new Date(from - length).toISOString(), to: new Date(from).toISOString() }
}

/**
 * "Visão da rede" do breadcrumb: restaura a query da lista (location.state.from) e troca só o
 * período. Sem estado, como num link aberto direto, volta para a rede no mesmo período.
 */
export function networkHref(from: unknown, period: PeriodKey): string {
  const params = new URLSearchParams(typeof from === 'string' && from.startsWith('?') ? from : '')
  params.set('periodo', period)
  return `/?${params}`
}

/** Link da loja: filtro exato por id, nunca por substring do nome. */
export function storeHref(storeId: string, period: PeriodKey): string {
  return `/?${new URLSearchParams({ loja: storeId, periodo: period })}`
}

const within = (t: number, interval: Interval) =>
  Date.parse(interval.from) <= t && t < Date.parse(interval.to)

/** Minutos de [from, to) que caem dentro dos intervalos de funcionamento. */
export function overlapMinutes(from: string, to: string, intervals: readonly Interval[]): number {
  const start = Date.parse(from)
  const end = Date.parse(to)
  let total = 0
  for (const interval of intervals) {
    const a = Math.max(start, Date.parse(interval.from))
    const b = Math.min(end, Date.parse(interval.to))
    if (b > a) total += b - a
  }
  return total / 60_000
}

/** Duração que nunca quebra no meio: "16 h 35 min" fica numa linha só (achado 17). */
export const unbrokenDuration = (minutes: number, mode?: 'hours' | 'calendar') =>
  formatDuration(minutes, mode).replaceAll(' ', NBSP)

export const gapMinutes = (gap: Pick<Gap, 'from' | 'to'>) =>
  (Date.parse(gap.to) - Date.parse(gap.from)) / 60_000

export type PointSituation = 'within' | 'above' | 'below' | 'closed' | 'gap' | 'missing'

export interface PointState {
  situation: PointSituation
  label: string
  gap?: Gap
}

/** Situação de um bucket: lacuna, loja fechada ou a posição da média em relação à faixa. */
export function pointState(
  point: SeriesPoint,
  series: Pick<Series, 'comfortRange' | 'openIntervals' | 'gaps'>,
): PointState {
  const t = Date.parse(point.t)
  if (point.avg == null) {
    const gap = series.gaps.find((item) => within(t, item))
    return gap
      ? { situation: 'gap', label: gapState(gap).label, gap }
      : { situation: 'missing', label: 'Sem leitura válida' }
  }
  if (!series.openIntervals.some((interval) => within(t, interval)))
    return { situation: 'closed', label: 'Loja fechada' }
  if (point.avg > series.comfortRange.max) return { situation: 'above', label: 'Acima da faixa' }
  if (point.avg < series.comfortRange.min) return { situation: 'below', label: 'Abaixo da faixa' }
  return { situation: 'within', label: 'Na faixa' }
}

export interface SeriesRow {
  t: string
  avg: number | null
  min: number | null
  max: number | null
  outdoor: number | null
  state: PointState
}

/** Linhas da tabela e do CSV. A externa é horária: cada bucket recebe a da hora em que começa. */
export function seriesRows(series: Series): SeriesRow[] {
  const outdoor = new Map(
    series.outdoor.map((point) => [Math.floor(Date.parse(point.t) / HOUR_MS), point.value]),
  )
  return series.points.map((point) => ({
    t: point.t,
    avg: point.avg,
    min: point.min,
    max: point.max,
    outdoor: outdoor.get(Math.floor(Date.parse(point.t) / HOUR_MS)) ?? null,
    state: pointState(point, series),
  }))
}

/* -------------------------------------------------------------------------------------------
   CSV: separador ";", vírgula decimal e BOM UTF-8, para abrir certo no Excel em pt-BR.
   ------------------------------------------------------------------------------------------- */

const csvDecimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2, useGrouping: false })

function csvCell(value: string | number | null): string {
  if (value == null) return ''
  const text = typeof value === 'number' ? csvDecimal.format(value) : value
  return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null>>): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`
}

const csvDateFormatters = new Map<string, Intl.DateTimeFormat>()

/** "12/01/2026 00:00" no fuso da loja: o Excel em pt-BR reconhece como data. */
export function csvDateTime(value: string, timeZone: string): string {
  let format = csvDateFormatters.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    csvDateFormatters.set(timeZone, format)
  }
  return format.format(Date.parse(value)).replace(',', '')
}

export function seriesCsv(series: Series, timeZone: string, timeZoneLabel: string): string {
  return toCsv([
    [`Data e hora · ${timeZoneLabel}`, 'Média (°C)', 'Mín. (°C)', 'Máx. (°C)', 'Externa (°C)', 'Situação'],
    ...seriesRows(series).map((row) => [
      csvDateTime(row.t, timeZone),
      row.avg,
      row.min,
      row.max,
      row.outdoor,
      row.state.label,
    ]),
  ])
}

export function gapsCsv(series: Series, timeZone: string, timeZoneLabel: string): string {
  return toCsv([
    [`Início · ${timeZoneLabel}`, 'Fim', 'Duração (min)', 'No horário (min)', 'Motivo'],
    ...series.gaps.map((gap) => [
      csvDateTime(gap.from, timeZone),
      csvDateTime(gap.to, timeZone),
      Math.round(gapMinutes(gap)),
      Math.round(overlapMinutes(gap.from, gap.to, series.openIntervals)),
      gapState(gap).label,
    ]),
  ])
}

/** Data local AAAA-MM-DD, para o nome do arquivo ("AMB-014_30d_2026-02-10.csv"). */
export function localDate(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .formatToParts(Date.parse(value))
    .reduce<Record<string, string>>((acc, part) => Object.assign(acc, { [part.type]: part.value }), {})
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function csvFileName(
  environmentId: string,
  period: PeriodKey,
  at: string,
  timeZone: string,
  suffix = '',
) {
  return `${environmentId}_${period}${suffix ? `_${suffix}` : ''}_${localDate(at, timeZone)}.csv`
}

/* -------------------------------------------------------------------------------------------
   Última leitura: desvio e tendência
   ------------------------------------------------------------------------------------------- */

/** Graus fora da faixa (positivo), ou null quando a leitura está dentro dela. */
export function deviation(value: number, range: { min: number; max: number }): number | null {
  if (value > range.max) return value - range.max
  if (value < range.min) return range.min - value
  return null
}

/**
 * Tendência em °C por hora: inclinação por mínimos quadrados dos 4 últimos buckets válidos. Só
 * vale quando o período inclui o "agora", a última leitura tem menos de 15 min e os buckets são
 * recentes e seguidos (sem uma lacuna no meio).
 */
export function trendPerHour(
  series: Pick<Series, 'points' | 'bucket' | 'from' | 'to' | 'now'>,
  lastValidAt: string | null,
): number | null {
  if (series.now == null || lastValidAt == null) return null
  const now = Date.parse(series.now)
  if (now < Date.parse(series.from) || now > Date.parse(series.to)) return null
  if (now - Date.parse(lastValidAt) >= 15 * 60_000) return null
  const valid = series.points.filter((point) => point.avg != null).slice(-4)
  if (valid.length < 4) return null
  const times = valid.map((point) => Date.parse(point.t) / HOUR_MS)
  const step = BUCKET_MS[series.bucket] / HOUR_MS
  const first = times[0] ?? 0
  const last = times.at(-1) ?? 0
  if (last - first > 4 * step || now / HOUR_MS - last > 2 * step) return null
  const values = valid.map((point) => point.avg ?? 0)
  const meanT = times.reduce((sum, t) => sum + t, 0) / times.length
  const meanV = values.reduce((sum, v) => sum + v, 0) / values.length
  let num = 0
  let den = 0
  times.forEach((t, index) => {
    num += (t - meanT) * ((values[index] ?? 0) - meanV)
    den += (t - meanT) ** 2
  })
  return den === 0 ? null : num / den
}

/* -------------------------------------------------------------------------------------------
   Comparação com o período anterior (P1, seção 5.8)
   ------------------------------------------------------------------------------------------- */

export const COMPARE_MIN_COVERAGE = 80

export type Availability = { ok: true } | { ok: false; reason: string }

const dayMonth = (value: string, timeZone: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit' }).format(Date.parse(value))

/**
 * A comparação só existe com base: o período anterior precisa de 80% de cobertura. Sem leitura
 * nenhuma antes, a dica diz onde os dados começam.
 */
export function compareAvailability(
  previous: Pick<EnvironmentSummary, 'indicators'> | undefined,
  series: Pick<Series, 'points' | 'from'> | undefined,
  timeZone: string,
): Availability {
  if (!previous) return { ok: false, reason: 'Carregando o período anterior…' }
  const coverage = previous.indicators.coveragePct
  if (coverage != null && coverage >= COMPARE_MIN_COVERAGE) return { ok: true }
  if (coverage == null || coverage === 0) {
    const first = series?.points.find((point) => point.avg != null)?.t ?? series?.from
    return {
      ok: false,
      reason: first
        ? `Sem base de comparação: os dados começam em ${dayMonth(first, timeZone)}`
        : 'Sem base de comparação: não há leituras no período anterior',
    }
  }
  return {
    ok: false,
    reason: `Sem base de comparação: o período anterior tem só ${formatPercent(coverage)} de cobertura`,
  }
}

export function difference(current: number | null, previous: number | null | undefined): number | null {
  return current == null || previous == null ? null : current - previous
}

/* -------------------------------------------------------------------------------------------
   Perfil semanal (heatmap 7 × 24, seção 5.12)
   ------------------------------------------------------------------------------------------- */

export type ProfileSide = 'quente' | 'frio'

/**
 * Degrau da célula. Hora fechada e hora sem leitura têm tipo próprio e nunca usam a cor de
 * "≤ 5% fora": ausência não vira 0.
 */
export type ProfileStep =
  | { kind: 'closed' }
  | { kind: 'empty' }
  | { kind: 'value'; side: ProfileSide; level: 0 | 1 | 2 | 3 | 4; outPct: number }

/** Limites dos degraus pelo lado dominante: ≤ 5, 5–15, 15–30, 30–50 e ≥ 50% fora da faixa. */
export const PROFILE_LEVELS = [5, 15, 30, 50] as const

export function profileStep(cell: ProfileCell): ProfileStep {
  if (!cell.open) return { kind: 'closed' }
  if (cell.withinPct == null || cell.minutesInHours <= 0) return { kind: 'empty' }
  const above = cell.abovePct ?? 0
  const below = cell.belowPct ?? 0
  const side: ProfileSide = above >= below ? 'quente' : 'frio'
  const outPct = side === 'quente' ? above : below
  const level = outPct <= 5 ? 0 : outPct < 15 ? 1 : outPct < 30 ? 2 : outPct < 50 ? 3 : 4
  return { kind: 'value', side, level, outPct }
}

export const WEEKDAYS = [
  { short: 'Seg', long: 'Segunda', plural: ['segunda', 'segundas'] },
  { short: 'Ter', long: 'Terça', plural: ['terça', 'terças'] },
  { short: 'Qua', long: 'Quarta', plural: ['quarta', 'quartas'] },
  { short: 'Qui', long: 'Quinta', plural: ['quinta', 'quintas'] },
  { short: 'Sex', long: 'Sexta', plural: ['sexta', 'sextas'] },
  { short: 'Sáb', long: 'Sábado', plural: ['sábado', 'sábados'] },
  { short: 'Dom', long: 'Domingo', plural: ['domingo', 'domingos'] },
] as const

/* -------------------------------------------------------------------------------------------
   Conforto por dia (colunas empilhadas a 100%)
   ------------------------------------------------------------------------------------------- */

export type DailyState =
  | { kind: 'closed' }
  | { kind: 'empty' }
  | { kind: 'value'; within: number; below: number; above: number }

/** Partes do horário com leitura válida. Dia sem expediente ou sem leitura não vira 0%. */
export function dailyState(day: DailyComfort): DailyState {
  if (day.minutesExpected <= 0) return { kind: 'closed' }
  if (day.minutesInHours <= 0) return { kind: 'empty' }
  const share = (minutes: number) => (minutes / day.minutesInHours) * 100
  return {
    kind: 'value',
    within: share(day.minutesWithin),
    below: share(day.minutesBelow),
    above: share(day.minutesAbove),
  }
}

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const

/** "2026-02-04" (dia local) → { weekday: 'qua', day: '04', date: '04/02' }. */
export function localDay(day: string): { weekday: string; day: string; date: string; monday: boolean } {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  const index = new Date(Date.UTC(year, month - 1, date)).getUTCDay()
  const dd = String(date).padStart(2, '0')
  return {
    weekday: WEEKDAY_SHORT[index] ?? '',
    day: dd,
    date: `${dd}/${String(month).padStart(2, '0')}`,
    monday: index === 1,
  }
}

export interface DailyAxisLabel {
  align: 'start' | 'end'
  /** false: só a partir de sm; no celular a coluna é estreita demais para o rótulo caber. */
  mobile: boolean
}

/**
 * Rótulos do eixo do conforto por dia com muitas colunas: as segundas-feiras, alinhadas pelo
 * início da coluna, e o último dia, alinhado pelo fim, para nunca passar da borda. Uma segunda
 * perto demais do fim sai, para os dois rótulos não se encostarem.
 */
export function dailyAxisLabels(days: readonly string[]): Array<DailyAxisLabel | null> {
  const last = days.length - 1
  return days.map((day, index) => {
    if (index === last) return { align: 'end', mobile: true }
    if (!localDay(day).monday || last - index < 5) return null
    return { align: 'start', mobile: last - index >= 9 }
  })
}
