import type { ComfortRange, DiscardReason, GapKind, Series, SeriesBucket } from '@celsius/contracts'
import { type GapInfo, gapState } from '../../../lib/states'
import { HOUR_MS } from './axis'

/**
 * Modelo do gráfico: a série da API convertida para milissegundos e cruzada com o expediente e as
 * lacunas. Tudo que as camadas, o tooltip, a tira de situação e o resumo acessível leem sai daqui,
 * então os quatro sempre concordam.
 */

export const BUCKET_MS: Record<SeriesBucket, number> = {
  raw: 30_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': HOUR_MS,
}

/** Amplitude média mínima para a banda mín–máx valer a tinta (seção 5.1). */
const MIN_SPREAD = 0.3

export type Classification = 'within' | 'above' | 'below'

export function classify(value: number, range: ComfortRange): Classification {
  if (value > range.max) return 'above'
  if (value < range.min) return 'below'
  return 'within'
}

/** Distância até a faixa: positiva acima, negativa abaixo e zero dentro. */
export function deviation(value: number, range: ComfortRange): number {
  if (value > range.max) return value - range.max
  if (value < range.min) return value - range.min
  return 0
}

export type Span = readonly [from: number, to: number]

export interface ChartGap {
  from: number
  to: number
  kind: GapKind
  reason: DiscardReason | null
  info: GapInfo
}

export interface ChartPoint {
  /** Início do bucket. */
  t: number
  avg: number | null
  min: number | null
  max: number | null
  /** A loja estava aberta no meio do bucket. */
  open: boolean
  /** Lacuna que encosta no bucket, se houver. */
  gap: ChartGap | null
}

export type StripState = Classification | 'closed' | 'no_data' | 'discarded'

export interface StripSegment {
  from: number
  to: number
  state: StripState
  gap: ChartGap | null
}

/** Por que a banda mín–máx está desligada: bucket fino demais ou amplitude pequena. */
export type SpreadAvailability = 'available' | 'bucket' | 'flat'

export interface PreviousPeriod {
  /** Quanto os instantes do período anterior andam para cair sobre o atual. */
  shift: number
  /** Média do período anterior por instante já deslocado. */
  byTime: Map<number, number | null>
  points: Array<[number, number | null]>
}

export interface ChartModel {
  from: number
  to: number
  now: number | null
  bucket: SeriesBucket
  bucketMs: number
  range: ComfortRange
  points: ChartPoint[]
  /** Externa horária dentro do período. */
  outdoor: Array<[number, number]>
  outdoorByHour: Map<number, number>
  open: Span[]
  closed: Span[]
  gaps: ChartGap[]
  previous: PreviousPeriod | null
  spread: SpreadAvailability
  strip: StripSegment[]
  /** Último ponto válido quando o período chega ao "agora" da ingestão. */
  latest: ChartPoint | null
}

const ms = (iso: string) => Date.parse(iso)

/** Complemento dos intervalos abertos dentro de [from, to). */
export function closedSpans(from: number, to: number, open: readonly Span[]): Span[] {
  const out: Span[] = []
  let cursor = from
  for (const [start, end] of [...open].sort((a, b) => a[0] - b[0])) {
    if (start > cursor) out.push([cursor, Math.min(start, to)])
    cursor = Math.max(cursor, end)
    if (cursor >= to) break
  }
  if (cursor < to) out.push([cursor, to])
  return out.filter(([start, end]) => end > start)
}

const inside = (t: number, spans: readonly Span[]) => spans.some(([start, end]) => t >= start && t < end)

function spreadAvailability(bucket: SeriesBucket, points: Series['points']): SpreadAvailability {
  if (bucket === 'raw' || bucket === '5m') return 'bucket'
  const widths = points.flatMap((point) =>
    point.min != null && point.max != null ? [point.max - point.min] : [],
  )
  if (widths.length === 0) return 'flat'
  const mean = widths.reduce((sum, width) => sum + width, 0) / widths.length
  return mean < MIN_SPREAD ? 'flat' : 'available'
}

/**
 * Tira de situação (seção 5.6): o período fatiado nos limites de bucket, de expediente e de
 * lacuna, com trechos iguais seguidos fundidos. Lacuna vence expediente: a falha aparece mesmo de
 * madrugada. Bucket nulo fora de lacuna (o último, ainda parcial) não vira trecho.
 */
export function situationStrip(
  model: Pick<ChartModel, 'from' | 'to' | 'bucketMs' | 'points' | 'open' | 'gaps' | 'range'>,
): StripSegment[] {
  const { from, to, points } = model
  const marks = new Set<number>([from, to])
  for (const point of points) marks.add(point.t)
  for (const [start, end] of model.open) marks.add(start).add(end)
  for (const gap of model.gaps) marks.add(gap.from).add(gap.to)
  const sorted = [...marks].filter((t) => t >= from && t <= to).sort((a, b) => a - b)

  const segments: StripSegment[] = []
  let index = 0
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i] as number
    const end = sorted[i + 1] as number
    const middle = (start + end) / 2
    while (index + 1 < points.length && (points[index + 1] as ChartPoint).t <= middle) index++
    const point = points[index]
    const gap = model.gaps.find((item) => middle >= item.from && middle < item.to) ?? null
    let state: StripState | null
    if (gap) state = gap.kind === 'no_data' ? 'no_data' : 'discarded'
    else if (!inside(middle, model.open)) state = 'closed'
    else if (point && point.avg != null && middle < point.t + model.bucketMs)
      state = classify(point.avg, model.range)
    else state = null
    if (!state) continue
    const last = segments.at(-1)
    if (last && last.to === start && last.state === state && last.gap === gap) last.to = end
    else segments.push({ from: start, to: end, state, gap })
  }
  return segments
}

export function buildModel(series: Series, previous: Series | null = null): ChartModel {
  const from = ms(series.from)
  const to = ms(series.to)
  const bucketMs = BUCKET_MS[series.bucket]
  const open: Span[] = series.openIntervals
    .map((interval): Span => [Math.max(from, ms(interval.from)), Math.min(to, ms(interval.to))])
    .filter(([start, end]) => end > start)
  const gaps: ChartGap[] = series.gaps.map((gap) => ({
    from: ms(gap.from),
    to: ms(gap.to),
    kind: gap.kind,
    reason: gap.reason,
    info: gapState(gap),
  }))
  const points: ChartPoint[] = series.points.map((point) => {
    const t = ms(point.t)
    return {
      t,
      avg: point.avg,
      min: point.min,
      max: point.max,
      open: inside(t + bucketMs / 2, open),
      gap: gaps.find((gap) => gap.from < t + bucketMs && gap.to > t) ?? null,
    }
  })
  const outdoor = series.outdoor
    .map((point): [number, number] => [ms(point.t), point.value])
    .filter(([t]) => t >= from && t <= to)
  const now = series.now ? ms(series.now) : null

  let latest: ChartPoint | null = null
  if (now != null && now >= from && now <= to) {
    const last = points.findLast((point) => point.avg != null)
    // Só é "agora" se a última leitura válida for recente; offline não ganha a pílula
    if (last && last.t + bucketMs >= now - Math.max(bucketMs, 15 * 60_000)) latest = last
  }

  let previousPeriod: PreviousPeriod | null = null
  if (previous) {
    const shift = from - ms(previous.from)
    const shifted = previous.points
      .map((point): [number, number | null] => [ms(point.t) + shift, point.avg])
      .filter(([t]) => t >= from && t < to)
    previousPeriod = { shift, points: shifted, byTime: new Map(shifted) }
  }

  const model = {
    from,
    to,
    now,
    bucket: series.bucket,
    bucketMs,
    range: series.comfortRange,
    points,
    outdoor,
    outdoorByHour: new Map(outdoor.map(([t, value]) => [Math.floor(t / HOUR_MS) * HOUR_MS, value])),
    open,
    closed: closedSpans(from, to, open),
    gaps,
    previous: previousPeriod,
    spread: spreadAvailability(series.bucket, series.points),
    latest,
  }
  return { ...model, strip: situationStrip(model) }
}

/** Índice do bucket que contém `t` (o mais próximo nas pontas). */
export function pointIndexAt(model: Pick<ChartModel, 'points'>, t: number): number {
  const { points } = model
  let low = 0
  let high = points.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((points[middle] as ChartPoint).t <= t) low = middle
    else high = middle - 1
  }
  return Math.max(0, low)
}
