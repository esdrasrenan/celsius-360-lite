import {
  BUCKET_MS,
  type Bucket,
  type BucketCounts,
  chooseBucket,
  comfortIndicator,
  compileSchedule,
  EXPECTED_SAMPLING_MS,
  findGaps,
  type OpeningHours,
  openDurationMs,
  openIntervals,
  PERIODS,
} from '@celsius/domain'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import type pg from 'pg'
import type { UserScope } from '../auth/session'
import { iso, NowService, type RangeQueryDto, type ResolvedRange, resolveRange } from '../common/time'
import { PG_POOL } from '../database/database.module'
import type { EnvironmentSummaryDto, SeriesDto, SeriesPointDto, SeriesQueryDto } from './environments.dto'

const VIEW: Record<Exclude<Bucket, 'raw'>, string> = {
  '5m': 'telemetry.reading_5m',
  '15m': 'telemetry.reading_15m',
  '1h': 'telemetry.reading_1h',
}
const GAP_MIN_MS = 10 * 60_000
const SAMPLE_MINUTES = EXPECTED_SAMPLING_MS / 60_000

interface EnvironmentRow {
  id: string
  name: string
  comfort_min: number
  comfort_max: number
  opening_hours: OpeningHours
  device_id: string | null
  store_id: string
  store_name: string
  city: string
  state_code: string
  timezone: string
  client_id: string
  client_name: string
  status: string | null
  situation: string | null
  last_value: number | null
  last_valid_at: Date | null
  last_contact_at: Date | null
}

interface AggregateRow {
  samples: number
  samples_ok: number
  in_hours: number
  within: number
  above: number
  below: number
  value_avg: number | null
  value_min: number | null
  value_max: number | null
  sensor_error: number
  out_of_range: number
  spike: number
  stuck: number
}

@Injectable()
export class EnvironmentsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly nowService: NowService,
  ) {}

  async summary(id: string, query: RangeQueryDto, scope: UserScope): Promise<EnvironmentSummaryDto> {
    const [environment, now] = await Promise.all([this.find(id, scope), this.nowService.current()])
    const range = resolveRange(query, now ?? Date.now())
    const viewBucket = range.period ? PERIODS[range.period].bucket : indicatorBucket(range)
    const end = Math.min(range.to, now ?? range.to)

    const [aggregate, gaps] = await Promise.all([
      environment.device_id ? this.aggregate(environment.device_id, viewBucket, range) : null,
      this.gaps(environment.device_id, range.from, end),
    ])
    const schedule = compileSchedule(environment.opening_hours)
    const expected = Math.floor(
      openDurationMs(schedule, range.from, end, environment.timezone) / EXPECTED_SAMPLING_MS,
    )
    const indicator = comfortIndicator({
      inHours: aggregate?.in_hours ?? 0,
      within: aggregate?.within ?? 0,
      above: aggregate?.above ?? 0,
      below: aggregate?.below ?? 0,
      expected,
    })

    return {
      environment: toEnvironmentInfo(environment),
      store: toStoreRef(environment),
      status: {
        device: environment.status ?? 'no_data',
        situation: environment.situation ?? 'unknown',
        lastValue: environment.last_value,
        lastValidAt: iso(environment.last_valid_at?.getTime()),
        lastContactAt: iso(environment.last_contact_at?.getTime()),
      },
      period: { key: range.period, from: iso(range.from) as string, to: iso(range.to) as string },
      indicators: {
        ...indicator,
        minutesInHours: (aggregate?.in_hours ?? 0) * SAMPLE_MINUTES,
        minutesWithin: (aggregate?.within ?? 0) * SAMPLE_MINUTES,
        minutesAbove: (aggregate?.above ?? 0) * SAMPLE_MINUTES,
        minutesBelow: (aggregate?.below ?? 0) * SAMPLE_MINUTES,
        valueAvg: round(aggregate?.value_avg),
        valueMin: round(aggregate?.value_min),
        valueMax: round(aggregate?.value_max),
        samplesDiscarded: (aggregate?.samples ?? 0) - (aggregate?.samples_ok ?? 0),
        discarded: {
          sensorError: aggregate?.sensor_error ?? 0,
          outOfRange: aggregate?.out_of_range ?? 0,
          spike: aggregate?.spike ?? 0,
          stuck: aggregate?.stuck ?? 0,
        },
        gapCount: gaps.length,
        gapMinutes: Math.round(gaps.reduce((total, gap) => total + gap.to - gap.from, 0) / 60_000),
      },
      now: iso(now),
    }
  }

  /** Série do ambiente com a agregação adequada ao intervalo, densa (buckets vazios vêm nulos). */
  async series(id: string, query: SeriesQueryDto, scope: UserScope): Promise<SeriesDto> {
    const [environment, now] = await Promise.all([this.find(id, scope), this.nowService.current()])
    const range = resolveRange(query, now ?? Date.now())
    const bucket: Bucket = query.bucket === 'auto' ? chooseBucket(range.from, range.to) : query.bucket
    const end = Math.min(range.to, now ?? range.to)

    const [points, outdoor, gaps] = await Promise.all([
      environment.device_id ? this.points(environment.device_id, bucket, range.from, end) : [],
      this.pool.query<{ ts: Date; value: number }>(
        `SELECT ts, value FROM telemetry.outdoor_temperature
         WHERE store_id = $1 AND ts >= $2 AND ts <= $3 ORDER BY ts`,
        [environment.store_id, iso(range.from - 3_600_000), iso(range.to)],
      ),
      this.gaps(environment.device_id, range.from, end),
    ])
    const schedule = compileSchedule(environment.opening_hours)

    return {
      bucket,
      from: iso(range.from) as string,
      to: iso(range.to) as string,
      now: iso(now),
      comfortRange: { min: environment.comfort_min, max: environment.comfort_max },
      points,
      outdoor: outdoor.rows.map((row) => ({ t: row.ts.toISOString(), value: row.value })),
      gaps: gaps.map((gap) => ({
        from: iso(gap.from) as string,
        to: iso(gap.to) as string,
        kind: gap.kind,
        reason: gap.reason,
      })),
      openIntervals: openIntervals(schedule, range.from, range.to, environment.timezone).map(
        ([from, to]) => ({
          from: iso(from) as string,
          to: iso(to) as string,
        }),
      ),
    }
  }

  private async find(id: string, scope: UserScope): Promise<EnvironmentRow> {
    const { rows } = await this.pool.query<EnvironmentRow>(
      `SELECT e.id, e.name, e.comfort_min, e.comfort_max, e.opening_hours, e.device_id,
         s.id AS store_id, s.name AS store_name, s.city, s.state_code, s.timezone,
         c.id AS client_id, c.name AS client_name,
         es.status, es.situation, es.last_value, es.last_valid_at, es.last_contact_at
       FROM registry.environment e
       JOIN registry.store s ON s.id = e.store_id
       JOIN registry.client c ON c.id = s.client_id
       LEFT JOIN state.environment_snapshot es ON es.environment_id = e.id
       WHERE e.id = $1 AND ($2 OR s.id = ANY($3::text[]))`,
      [id, scope.all, scope.storeIds],
    )
    // Fora do escopo responde 404, como se não existisse: não revela ambientes de outros clientes
    if (!rows[0]) throw new NotFoundException(`Ambiente ${id} não encontrado`)
    return rows[0]
  }

  private async aggregate(deviceId: string, bucket: Exclude<Bucket, 'raw'>, range: ResolvedRange) {
    const { rows } = await this.pool.query<AggregateRow>(
      `SELECT coalesce(sum(samples), 0) AS samples, coalesce(sum(samples_ok), 0) AS samples_ok,
         coalesce(sum(in_hours), 0) AS in_hours, coalesce(sum(within), 0) AS within,
         coalesce(sum(above), 0) AS above, coalesce(sum(below), 0) AS below,
         (sum(value_sum) / nullif(sum(samples_ok), 0))::real AS value_avg,
         min(value_min) AS value_min, max(value_max) AS value_max,
         coalesce(sum(sensor_error), 0) AS sensor_error, coalesce(sum(out_of_range), 0) AS out_of_range,
         coalesce(sum(spike), 0) AS spike, coalesce(sum(stuck), 0) AS stuck
       FROM ${VIEW[bucket]} WHERE device_id = $1 AND bucket >= $2 AND bucket < $3`,
      [deviceId, iso(range.from), iso(range.to)],
    )
    return rows[0] ?? null
  }

  private async points(
    deviceId: string,
    bucket: Bucket,
    from: number,
    to: number,
  ): Promise<SeriesPointDto[]> {
    if (bucket === 'raw') {
      const { rows } = await this.pool.query<{ ts: Date; value: number }>(
        `SELECT ts, value FROM telemetry.reading
         WHERE device_id = $1 AND ts >= $2 AND ts < $3 AND quality = 0 ORDER BY ts`,
        [deviceId, iso(from), iso(to)],
      )
      const points: SeriesPointDto[] = []
      let previous: number | null = null
      for (const row of rows) {
        const ts = row.ts.getTime()
        // Mais de três amostras faltando: quebra a linha no gráfico
        if (previous !== null && ts - previous > 3 * BUCKET_MS.raw) {
          points.push({ t: iso(previous + BUCKET_MS.raw) as string, avg: null, min: null, max: null })
        }
        const value = round(row.value)
        points.push({ t: row.ts.toISOString(), avg: value, min: value, max: value })
        previous = ts
      }
      return points
    }

    const size = BUCKET_MS[bucket]
    const { rows } = await this.pool.query<{
      bucket: Date
      avg: number | null
      min: number | null
      max: number | null
    }>(
      `SELECT bucket, (value_sum / nullif(samples_ok, 0))::real AS avg, value_min AS min, value_max AS max
       FROM ${VIEW[bucket]} WHERE device_id = $1 AND bucket >= $2 AND bucket < $3 ORDER BY bucket`,
      [deviceId, iso(Math.floor(from / size) * size), iso(to)],
    )
    const byBucket = new Map(rows.map((row) => [row.bucket.getTime(), row]))
    const points: SeriesPointDto[] = []
    for (let t = Math.floor(from / size) * size; t < to; t += size) {
      const row = byBucket.get(t)
      points.push({ t: iso(t) as string, avg: round(row?.avg), min: round(row?.min), max: round(row?.max) })
    }
    return points
  }

  private async gaps(deviceId: string | null, from: number, to: number) {
    if (to <= from) return []
    if (!deviceId) return [{ from, to, kind: 'no_data' as const, reason: null }]
    const size = BUCKET_MS['5m']
    const { rows } = await this.pool.query<{
      bucket: Date
      samples: number
      samples_ok: number
      sensor_error: number
      out_of_range: number
      spike: number
      stuck: number
    }>(
      `SELECT bucket, samples, samples_ok, sensor_error, out_of_range, spike, stuck
       FROM telemetry.reading_5m WHERE device_id = $1 AND bucket >= $2 AND bucket < $3 ORDER BY bucket`,
      [deviceId, iso(Math.floor(from / size) * size), iso(to)],
    )
    const counts: BucketCounts[] = rows.map((row) => ({
      bucket: row.bucket.getTime(),
      samples: row.samples,
      samplesOk: row.samples_ok,
      sensorError: row.sensor_error,
      outOfRange: row.out_of_range,
      spike: row.spike,
      stuck: row.stuck,
    }))
    return findGaps(counts, from, to, size, GAP_MIN_MS)
  }
}

function indicatorBucket(range: ResolvedRange): Exclude<Bucket, 'raw'> {
  const bucket = chooseBucket(range.from, range.to)
  return bucket === 'raw' ? '5m' : bucket
}

const round = (value: number | null | undefined) => (value == null ? null : Math.round(value * 10) / 10)

function toEnvironmentInfo(row: EnvironmentRow) {
  return {
    id: row.id,
    name: row.name,
    comfortRange: { min: row.comfort_min, max: row.comfort_max },
    openingHours: row.opening_hours as unknown as Record<string, [string, string] | null>,
    deviceId: row.device_id,
  }
}

function toStoreRef(row: EnvironmentRow) {
  return {
    id: row.store_id,
    name: row.store_name,
    city: row.city,
    state: row.state_code,
    timezone: row.timezone,
    client: { id: row.client_id, name: row.client_name },
  }
}
