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

export type GapKind = 'no_data' | 'invalid'
export type InvalidReason = 'sensor_error' | 'out_of_range' | 'spike' | 'stuck'

export interface Gap {
  from: number
  to: number
  /** no_data: nenhum pacote; invalid: houve pacote, mas nenhuma leitura válida */
  kind: GapKind
  reason: InvalidReason | null
}

function dominantReason(rows: BucketCounts[]): InvalidReason {
  const totals: Record<InvalidReason, number> = { sensor_error: 0, out_of_range: 0, spike: 0, stuck: 0 }
  for (const row of rows) {
    totals.sensor_error += row.sensorError
    totals.out_of_range += row.outOfRange
    totals.spike += row.spike
    totals.stuck += row.stuck
  }
  return (
    (Object.entries(totals) as Array<[InvalidReason, number]>).sort((a, b) => b[1] - a[1])[0]?.[0] ??
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
      !row || row.samples === 0 ? 'no_data' : row.samplesOk === 0 ? 'invalid' : null
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
      reason: run.kind === 'invalid' ? dominantReason(run.rows) : null,
    }))
}
