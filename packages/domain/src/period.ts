export type PeriodKey = '1d' | '7d' | '30d'

export type Bucket = 'raw' | '5m' | '15m' | '1h'

export const BUCKET_MS: Record<Bucket, number> = {
  raw: 30_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

export const PERIODS: Record<
  PeriodKey,
  { label: string; durationMs: number; bucket: Exclude<Bucket, 'raw'> }
> = {
  '1d': { label: 'Último dia', durationMs: DAY_MS, bucket: '5m' },
  '7d': { label: 'Última semana', durationMs: 7 * DAY_MS, bucket: '15m' },
  '30d': { label: '30 dias', durationMs: 30 * DAY_MS, bucket: '1h' },
}

export const PERIOD_KEYS = Object.keys(PERIODS) as PeriodKey[]

/**
 * Janela de um período terminando em "agora", alinhada ao agregado usado para calculá-lo:
 * o fim sobe para a borda seguinte do bucket, assim o bucket corrente entra inteiro.
 */
export function periodRange(key: PeriodKey, now: number): { from: number; to: number } {
  const { durationMs, bucket } = PERIODS[key]
  const size = BUCKET_MS[bucket]
  const to = Math.ceil(now / size) * size
  return { from: to - durationMs, to }
}

/** Teto de pontos de uma série com agregação escolhida pelo cliente (bucket explícito). */
export const MAX_SERIES_POINTS = 5_000

/**
 * Agregação adequada ao intervalo pedido, para o gráfico ter no máximo cerca de mil pontos:
 * até 8 h, amostras de 30 s; até 3,5 dias, 5 min; até 10 dias, 15 min; acima disso, 1 h.
 */
export function chooseBucket(from: number, to: number): Bucket {
  const span = to - from
  if (span <= 8 * HOUR_MS) return 'raw'
  if (span <= 3.5 * DAY_MS) return '5m'
  if (span <= 10 * DAY_MS) return '15m'
  return '1h'
}

export function alignDown(ts: number, size: number): number {
  return Math.floor(ts / size) * size
}
