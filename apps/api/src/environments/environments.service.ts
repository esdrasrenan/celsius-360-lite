import type { DeviceStatus, Situation } from '@celsius/contracts'
import {
  alignDown,
  BUCKET_MS,
  type Bucket,
  type BucketCounts,
  chooseBucket,
  comfortIndicator,
  compileSchedule,
  EXPECTED_SAMPLING_MS,
  findGaps,
  type Gap,
  gapsWithin,
  localDays,
  MAX_SERIES_POINTS,
  type OpeningHours,
  openDurationMs,
  openIntervals,
  opensDuringHour,
  PERIODS,
  Quality,
} from '@celsius/domain'
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type pg from 'pg'
import type { UserScope } from '../auth/session'
import { iso, NowService, type RangeQueryDto, type ResolvedRange, resolveRange } from '../common/time'
import { PG_POOL } from '../database/database.module'
import type {
  DailySeriesDto,
  EnvironmentSummaryDto,
  ProfileCellDto,
  SeriesDto,
  SeriesPointDto,
  SeriesQueryDto,
  WeeklyProfileDto,
} from './environments.dto'

const VIEW: Record<Exclude<Bucket, 'raw'>, string> = {
  '5m': 'telemetry.reading_5m',
  '15m': 'telemetry.reading_15m',
  '1h': 'telemetry.reading_1h',
}
const GAP_MIN_MS = 10 * 60_000
const HOUR_MS = BUCKET_MS['1h']
const SAMPLE_MINUTES = EXPECTED_SAMPLING_MS / 60_000

// Mesmas colunas dos agregados contínuos, calculadas direto da série (intervalos de até 8 h)
const RAW_AGGREGATE = `
  SELECT count(*) AS samples, count(*) FILTER (WHERE quality = ${Quality.Ok}) AS samples_ok,
    count(*) FILTER (WHERE quality = ${Quality.Ok} AND in_hours) AS in_hours,
    count(*) FILTER (WHERE comfort = 0) AS within, count(*) FILTER (WHERE comfort = 1) AS above,
    count(*) FILTER (WHERE comfort = -1) AS below,
    avg(value) FILTER (WHERE quality = ${Quality.Ok})::real AS value_avg,
    min(value) FILTER (WHERE quality = ${Quality.Ok}) AS value_min,
    max(value) FILTER (WHERE quality = ${Quality.Ok}) AS value_max,
    count(*) FILTER (WHERE quality = ${Quality.SensorError}) AS sensor_error,
    count(*) FILTER (WHERE quality = ${Quality.OutOfRange}) AS out_of_range,
    count(*) FILTER (WHERE quality = ${Quality.Spike}) AS spike,
    count(*) FILTER (WHERE quality = ${Quality.Stuck}) AS stuck
  FROM telemetry.reading WHERE device_id = $1 AND ts >= $2 AND ts < $3`

const viewAggregate = (view: string) => `
  SELECT coalesce(sum(samples), 0) AS samples, coalesce(sum(samples_ok), 0) AS samples_ok,
    coalesce(sum(in_hours), 0) AS in_hours, coalesce(sum(within), 0) AS within,
    coalesce(sum(above), 0) AS above, coalesce(sum(below), 0) AS below,
    (sum(value_sum) / nullif(sum(samples_ok), 0))::real AS value_avg,
    min(value_min) AS value_min, max(value_max) AS value_max,
    coalesce(sum(sensor_error), 0) AS sensor_error, coalesce(sum(out_of_range), 0) AS out_of_range,
    coalesce(sum(spike), 0) AS spike, coalesce(sum(stuck), 0) AS stuck
  FROM ${view} WHERE device_id = $1 AND bucket >= $2 AND bucket < $3`

// Leituras válidas com a loja aberta: o predicado é o do índice parcial reading_valid_in_hours_idx
const VALID_IN_HOURS = `quality = ${Quality.Ok} AND in_hours`

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
  status: DeviceStatus | null
  situation: Situation | null
  last_value: number | null
  last_valid_at: Date | null
  last_contact_at: Date | null
  open_now: boolean | null
  next_open_at: Date | null
  now_ts: Date | null
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

interface ComfortRow {
  in_hours: number
  within: number
  above: number
  below: number
  value_avg: number | null
}

/**
 * Janela dos indicadores. Até 8 h, a série direto, com os limites pedidos. Acima disso, o agregado:
 * a janela se alinha aos buckets dele, para nenhum bucket entrar pela metade.
 */
function indicatorWindow(range: ResolvedRange): ResolvedRange & { bucket: Bucket } {
  const bucket = range.period ? PERIODS[range.period].bucket : chooseBucket(range.from, range.to)
  if (bucket === 'raw') return { ...range, bucket }
  const size = BUCKET_MS[bucket]
  return {
    period: range.period,
    from: alignDown(range.from, size),
    to: Math.ceil(range.to / size) * size,
    bucket,
  }
}

const counts = (row: ComfortRow | null | undefined, expected: number) => ({
  inHours: row?.in_hours ?? 0,
  within: row?.within ?? 0,
  above: row?.above ?? 0,
  below: row?.below ?? 0,
  expected,
})

const round = (value: number | null | undefined) => (value == null ? null : Math.round(value * 10) / 10)

@Injectable()
export class EnvironmentsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly nowService: NowService,
  ) {}

  async summary(id: string, query: RangeQueryDto, scope: UserScope): Promise<EnvironmentSummaryDto> {
    const [environment, latest] = await Promise.all([this.find(id, scope), this.nowService.current()])
    // O agora da mesma linha do status: as duas consultas podem pegar atualizações diferentes
    const now = environment.now_ts?.getTime() ?? latest
    const window = indicatorWindow(resolveRange(query, now ?? Date.now()))
    const end = Math.min(window.to, now ?? window.to)
    const open = openIntervals(
      compileSchedule(environment.opening_hours),
      window.from,
      end,
      environment.timezone,
    )
    const deviceId = environment.device_id

    const [aggregate, inHours, gaps] = await Promise.all([
      deviceId ? this.aggregate(deviceId, window) : null,
      deviceId ? this.statsInHours(deviceId, window) : null,
      this.gaps(deviceId, window.from, end),
    ])
    const expected = Math.floor(
      open.reduce((total, [start, finish]) => total + finish - start, 0) / EXPECTED_SAMPLING_MS,
    )
    const gapsInHours = gapsWithin(gaps, open)

    return {
      environment: toEnvironmentInfo(environment),
      store: toStoreRef(environment),
      status: {
        device: environment.status ?? 'no_data',
        situation: environment.situation ?? 'unknown',
        lastValue: environment.last_value,
        lastValidAt: iso(environment.last_valid_at?.getTime()),
        lastContactAt: iso(environment.last_contact_at?.getTime()),
        openNow: environment.open_now ?? false,
        nextOpenAt: iso(environment.next_open_at?.getTime()),
      },
      period: { key: window.period, from: iso(window.from) as string, to: iso(window.to) as string },
      indicators: {
        ...comfortIndicator(counts(aggregate, expected)),
        minutesInHours: (aggregate?.in_hours ?? 0) * SAMPLE_MINUTES,
        minutesWithin: (aggregate?.within ?? 0) * SAMPLE_MINUTES,
        minutesAbove: (aggregate?.above ?? 0) * SAMPLE_MINUTES,
        minutesBelow: (aggregate?.below ?? 0) * SAMPLE_MINUTES,
        minutesExpected: expected * SAMPLE_MINUTES,
        valueAvg: round(aggregate?.value_avg),
        valueMin: round(aggregate?.value_min),
        valueMax: round(aggregate?.value_max),
        valueAvgInHours: round(inHours?.value_avg),
        valueMinInHours: round(inHours?.value_min),
        valueMaxInHours: round(inHours?.value_max),
        samplesDiscarded: (aggregate?.samples ?? 0) - (aggregate?.samples_ok ?? 0),
        discarded: {
          sensorError: aggregate?.sensor_error ?? 0,
          outOfRange: aggregate?.out_of_range ?? 0,
          spike: aggregate?.spike ?? 0,
          stuck: aggregate?.stuck ?? 0,
        },
        gapCount: gaps.length,
        gapMinutes: Math.round(gaps.reduce((total, gap) => total + gap.to - gap.from, 0) / 60_000),
        gapCountInHours: gapsInHours.count,
        gapMinutesInHours: Math.round(gapsInHours.ms / 60_000),
      },
      now: iso(now),
    }
  }

  /** Série do ambiente com a agregação adequada ao intervalo, densa (buckets vazios vêm nulos). */
  async series(id: string, query: SeriesQueryDto, scope: UserScope): Promise<SeriesDto> {
    const [environment, now] = await Promise.all([this.find(id, scope), this.nowService.current()])
    const range = resolveRange(query, now ?? Date.now())
    if (query.bucket !== 'auto' && (range.to - range.from) / BUCKET_MS[query.bucket] > MAX_SERIES_POINTS) {
      throw new BadRequestException(
        `Intervalo grande demais para bucket=${query.bucket}: passaria de ${MAX_SERIES_POINTS.toLocaleString('pt-BR')} pontos. Use bucket=auto ou um intervalo menor.`,
      )
    }
    const bucket: Bucket = query.bucket === 'auto' ? chooseBucket(range.from, range.to) : query.bucket
    const end = Math.min(range.to, now ?? range.to)
    const outdoorFrom = iso(range.from - HOUR_MS)
    const to = iso(range.to)

    const [points, outdoor, gaps] = await Promise.all([
      environment.device_id ? this.points(environment.device_id, bucket, range.from, end) : [],
      this.pool.query<{ ts: Date; value: number }>(
        `SELECT ts, value FROM telemetry.outdoor_temperature
         WHERE store_id = $1 AND ts >= $2 AND ts <= $3 ORDER BY ts`,
        [environment.store_id, outdoorFrom, to],
      ),
      this.gaps(environment.device_id, range.from, end),
    ])
    const schedule = compileSchedule(environment.opening_hours)

    return {
      bucket,
      from: iso(range.from) as string,
      to: to as string,
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

  /**
   * Perfil semanal: hora local × dia da semana, a partir do agregado de 1 h. Fusos com deslocamento
   * de hora cheia (todos os do Brasil) casam cada bucket com uma hora local.
   */
  async profile(id: string, query: RangeQueryDto, scope: UserScope): Promise<WeeklyProfileDto> {
    const [environment, now] = await Promise.all([this.find(id, scope), this.nowService.current()])
    const range = resolveRange(query, now ?? Date.now())
    const from = alignDown(range.from, HOUR_MS)
    const to = Math.ceil(range.to / HOUR_MS) * HOUR_MS
    const { rows } = environment.device_id
      ? await this.pool.query<ComfortRow & { weekday: number; hour: number; days: number }>(
          `SELECT extract(isodow FROM bucket AT TIME ZONE $4)::int AS weekday,
             extract(hour FROM bucket AT TIME ZONE $4)::int AS hour,
             count(*) FILTER (WHERE samples_ok > 0) AS days,
             sum(in_hours) AS in_hours, sum(within) AS within, sum(above) AS above, sum(below) AS below,
             (sum(value_sum) / nullif(sum(samples_ok), 0))::real AS value_avg
           FROM telemetry.reading_1h
           WHERE device_id = $1 AND bucket >= $2 AND bucket < $3
           GROUP BY 1, 2`,
          [environment.device_id, iso(from), iso(to), environment.timezone],
        )
      : { rows: [] }
    const byCell = new Map(rows.map((row) => [`${row.weekday}:${row.hour}`, row]))
    const schedule = compileSchedule(environment.opening_hours)

    const cells: ProfileCellDto[] = []
    for (let weekday = 1; weekday <= 7; weekday++) {
      for (let hour = 0; hour < 24; hour++) {
        const row = byCell.get(`${weekday}:${hour}`)
        const indicator = comfortIndicator(counts(row, 0))
        cells.push({
          weekday,
          hour,
          // O cronograma compilado começa no domingo (0); a ISO, na segunda (1)
          open: opensDuringHour(schedule, weekday % 7, hour),
          days: row?.days ?? 0,
          minutesInHours: (row?.in_hours ?? 0) * SAMPLE_MINUTES,
          withinPct: indicator.comfortPct,
          abovePct: indicator.abovePct,
          belowPct: indicator.belowPct,
          valueAvg: round(row?.value_avg),
        })
      }
    }
    return {
      period: { key: range.period, from: iso(from) as string, to: iso(to) as string },
      timezone: environment.timezone,
      comfortRange: { min: environment.comfort_min, max: environment.comfort_max },
      cells,
    }
  }

  /** Conforto por dia local da loja, com limites exatos, a partir das leituras válidas no horário. */
  async daily(id: string, query: RangeQueryDto, scope: UserScope): Promise<DailySeriesDto> {
    const [environment, now] = await Promise.all([this.find(id, scope), this.nowService.current()])
    const range = resolveRange(query, now ?? Date.now())
    const end = Math.min(range.to, now ?? range.to)
    const { rows } = environment.device_id
      ? await this.pool.query<ComfortRow & { day: string }>(
          `SELECT to_char(ts AT TIME ZONE $4, 'YYYY-MM-DD') AS day, count(*) AS in_hours,
             count(*) FILTER (WHERE comfort = 0) AS within, count(*) FILTER (WHERE comfort = 1) AS above,
             count(*) FILTER (WHERE comfort = -1) AS below, avg(value)::real AS value_avg
           FROM telemetry.reading
           WHERE device_id = $1 AND ts >= $2 AND ts < $3 AND ${VALID_IN_HOURS}
           GROUP BY 1`,
          [environment.device_id, iso(range.from), iso(range.to), environment.timezone],
        )
      : { rows: [] }
    const byDay = new Map(rows.map((row) => [row.day, row]))
    const schedule = compileSchedule(environment.opening_hours)

    return {
      period: { key: range.period, from: iso(range.from) as string, to: iso(range.to) as string },
      timezone: environment.timezone,
      days: localDays(range.from, range.to, environment.timezone).map(({ day, from, to }) => {
        const row = byDay.get(day)
        const expected = Math.floor(
          openDurationMs(schedule, from, Math.min(to, end), environment.timezone) / EXPECTED_SAMPLING_MS,
        )
        const indicator = comfortIndicator(counts(row, expected))
        return {
          day,
          minutesExpected: expected * SAMPLE_MINUTES,
          minutesInHours: (row?.in_hours ?? 0) * SAMPLE_MINUTES,
          minutesWithin: (row?.within ?? 0) * SAMPLE_MINUTES,
          minutesAbove: (row?.above ?? 0) * SAMPLE_MINUTES,
          minutesBelow: (row?.below ?? 0) * SAMPLE_MINUTES,
          comfortPct: indicator.comfortPct,
          coveragePct: indicator.coveragePct,
          valueAvgInHours: round(row?.value_avg),
        }
      }),
    }
  }

  private async find(id: string, scope: UserScope): Promise<EnvironmentRow> {
    // O Postgres recusa o caractere nulo no parâmetro (erro 500); nenhum id cadastrado tem um
    if (id.includes('\u0000')) throw new NotFoundException('Ambiente não encontrado')
    const { rows } = await this.pool.query<EnvironmentRow>(
      `SELECT e.id, e.name, e.comfort_min, e.comfort_max, e.opening_hours, e.device_id,
         s.id AS store_id, s.name AS store_name, s.city, s.state_code, s.timezone,
         c.id AS client_id, c.name AS client_name,
         es.status, es.situation, es.last_value, es.last_valid_at, es.last_contact_at, es.open_now, es.next_open_at,
         es.now_ts
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

  private async aggregate(deviceId: string, window: { bucket: Bucket; from: number; to: number }) {
    const sql = window.bucket === 'raw' ? RAW_AGGREGATE : viewAggregate(VIEW[window.bucket])
    const { rows } = await this.pool.query<AggregateRow>(sql, [deviceId, iso(window.from), iso(window.to)])
    return rows[0] ?? null
  }

  /** Média, mínima e máxima só com a loja aberta, coerentes com o conforto ao lado. */
  private async statsInHours(deviceId: string, window: { from: number; to: number }) {
    const { rows } = await this.pool.query<{
      value_avg: number | null
      value_min: number | null
      value_max: number | null
    }>(
      `SELECT avg(value)::real AS value_avg, min(value) AS value_min, max(value) AS value_max
       FROM telemetry.reading
       WHERE device_id = $1 AND ts >= $2 AND ts < $3 AND ${VALID_IN_HOURS}`,
      [deviceId, iso(window.from), iso(window.to)],
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
         WHERE device_id = $1 AND ts >= $2 AND ts < $3 AND quality = ${Quality.Ok} ORDER BY ts`,
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
      [deviceId, iso(alignDown(from, size)), iso(to)],
    )
    const byBucket = new Map(rows.map((row) => [row.bucket.getTime(), row]))
    const points: SeriesPointDto[] = []
    for (let t = alignDown(from, size); t < to; t += size) {
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
      [deviceId, iso(alignDown(from, size)), iso(to)],
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
    return this.withReadingEdges(deviceId, findGaps(counts, from, to, size, GAP_MIN_MS), from, to)
  }

  /**
   * Leva as bordas de cada indisponibilidade (leituras descartadas) dos blocos de 5 min às próprias
   * leituras: do primeiro ao último descarte da sequência. Assim o trecho tem os mesmos horários e a
   * mesma duração do episódio no relatório de qualidade, que conta pelas leituras. As bordas ficam
   * a menos de um bloco da lacuna, então basta ler 5 min para cada lado delas.
   */
  private async withReadingEdges(deviceId: string, gaps: Gap[], from: number, to: number): Promise<Gap[]> {
    const edges = gaps.flatMap((gap) => (gap.kind === 'discarded' ? [gap.from, gap.to] : []))
    if (edges.length === 0) return gaps
    const size = BUCKET_MS['5m']
    const { rows } = await this.pool.query<{ ts: Date; ok: boolean }>(
      `SELECT DISTINCT r.ts, r.quality = ${Quality.Ok} AS ok
       FROM unnest($2::timestamptz[]) AS edge(at)
       JOIN telemetry.reading r ON r.device_id = $1
         AND r.ts >= edge.at - interval '5 minutes' AND r.ts < edge.at + interval '5 minutes'
       ORDER BY r.ts`,
      [deviceId, edges.map(iso)],
    )
    const readings = rows.map((row) => ({ ts: row.ts.getTime(), ok: row.ok }))
    const around = (at: number) =>
      readings.filter((reading) => reading.ts >= at - size && reading.ts < at + size)

    return gaps.map((gap) => {
      if (gap.kind !== 'discarded') return gap
      const lead = around(gap.from)
      const validBefore = lead.findLast((reading) => reading.ok && reading.ts < gap.from)?.ts ?? -Infinity
      const first = lead.find((reading) => !reading.ok && reading.ts > validBefore)?.ts
      const tail = around(gap.to)
      const validAfter = tail.find((reading) => reading.ok && reading.ts >= gap.to)?.ts ?? Infinity
      const last = tail.findLast((reading) => !reading.ok && reading.ts < validAfter)?.ts
      if (first === undefined || last === undefined) return gap
      return { ...gap, from: Math.max(from, first), to: Math.min(to, last) }
    })
  }
}

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
