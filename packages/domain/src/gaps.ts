import { alignDown } from './period'

export interface BucketCounts {
  bucket: number
  samples: number
  samplesOk: number
  sensorError: number
  outOfRange: number
  spike: number
  stuck: number
}

export type GapKind = 'no_data' | 'discarded'
export type DiscardReason = 'sensor_error' | 'out_of_range' | 'spike' | 'stuck'

export interface Gap {
  from: number
  to: number
  /** no_data: nenhum pacote; discarded: houve pacote, mas todas as leituras foram descartadas */
  kind: GapKind
  reason: DiscardReason | null
}

function dominantReason(rows: BucketCounts[]): DiscardReason {
  const totals: Record<DiscardReason, number> = { sensor_error: 0, out_of_range: 0, spike: 0, stuck: 0 }
  for (const row of rows) {
    totals.sensor_error += row.sensorError
    totals.out_of_range += row.outOfRange
    totals.spike += row.spike
    totals.stuck += row.stuck
  }
  return (
    (Object.entries(totals) as Array<[DiscardReason, number]>).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    'sensor_error'
  )
}

/**
 * Percorre os buckets esperados entre from e to e devolve os trechos sem leitura válida,
 * juntando buckets vizinhos do mesmo tipo. Trechos menores que `minDurationMs` são ignorados.
 */
export function findGaps(
  rows: readonly BucketCounts[],
  from: number,
  to: number,
  bucketMs: number,
  minDurationMs = 2 * bucketMs,
): Gap[] {
  const byBucket = new Map(rows.map((row) => [row.bucket, row]))
  const runs: Array<{ from: number; to: number; kind: GapKind; rows: BucketCounts[] }> = []

  for (let bucket = alignDown(from, bucketMs); bucket < to; bucket += bucketMs) {
    const row = byBucket.get(bucket)
    const kind: GapKind | null =
      !row || row.samples === 0 ? 'no_data' : row.samplesOk === 0 ? 'discarded' : null
    if (!kind) continue
    const last = runs.at(-1)
    if (last && last.kind === kind && last.to === bucket) {
      last.to = bucket + bucketMs
      if (row) last.rows.push(row)
    } else {
      runs.push({ from: Math.max(bucket, from), to: bucket + bucketMs, kind, rows: row ? [row] : [] })
    }
  }

  return runs
    .map((run) => ({ ...run, to: Math.min(run.to, to) }))
    .filter((run) => run.to - run.from >= minDurationMs)
    .map((run) => ({
      from: run.from,
      to: run.to,
      kind: run.kind,
      reason: run.kind === 'discarded' ? dominantReason(run.rows) : null,
    }))
}

/**
 * Parte das lacunas que cai no horário de funcionamento: quantas lacunas tocam o expediente e
 * quanto tempo elas somam dentro dele. Os intervalos vêm ordenados e sem sobreposição.
 */
export function gapsWithin(
  gaps: ReadonlyArray<Pick<Gap, 'from' | 'to'>>,
  intervals: ReadonlyArray<readonly [number, number]>,
): { count: number; ms: number } {
  let count = 0
  let ms = 0
  for (const gap of gaps) {
    let overlap = 0
    for (const [start, end] of intervals) {
      overlap += Math.max(0, Math.min(gap.to, end) - Math.max(gap.from, start))
    }
    if (overlap > 0) count++
    ms += overlap
  }
  return { count, ms }
}
