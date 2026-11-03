import {
  COMFORT_TARGET_PCT,
  type ComfortCounts,
  comfortIndicator,
  type DeviceStatus,
  deviceStatus,
  EXPECTED_SAMPLING_MS,
  isOpenAt,
  openDurationMs,
  PERIOD_KEYS,
  PERIODS,
  type PeriodKey,
  periodRange,
  type Situation,
  STORE_STATUS_RANK,
  situationNow,
  storeStatus,
  sumCounts,
} from '@celsius/domain'
import type pg from 'pg'
import type { EnvironmentContext } from '../registry'
import type { DeviceMemory } from './processor'
import { EVENTS_CHANNEL } from './sinks'

const VIEW_BY_BUCKET = {
  '5m': 'telemetry.reading_5m',
  '15m': 'telemetry.reading_15m',
  '1h': 'telemetry.reading_1h',
} as const

interface PeriodRow {
  device_id: string
  in_hours: number
  within: number
  above: number
  below: number
  discarded: number
  value_avg: number | null
  value_min: number | null
  value_max: number | null
}

interface EnvironmentView {
  context: EnvironmentContext
  status: DeviceStatus
  situation: Situation
  indicators: Map<PeriodKey, { counts: ComfortCounts; comfortPct: number | null }>
}

/**
 * Lado de leitura (CQRS): a cada ciclo, recalcula com as regras do domínio o status e a situação
 * de cada ambiente, os indicadores dos três períodos e o resumo de cada loja. A API só lê essas
 * tabelas, então a visão da rede filtra, ordena e pagina no banco, com centenas de lojas ou mais.
 */
export class Projector {
  constructor(
    private readonly pool: pg.Pool,
    private readonly environments: readonly EnvironmentContext[],
  ) {}

  async refresh(
    now: number | null,
    devices: ReadonlyMap<string, DeviceMemory>,
    lastSeq: number,
  ): Promise<void> {
    if (now === null) return
    const views = new Map<string, EnvironmentView>()
    for (const context of this.environments) {
      const device = context.deviceId ? devices.get(context.deviceId) : undefined
      const status = deviceStatus(device ?? null, now)
      const situation = situationNow({
        status,
        lastValue: device?.lastValidValue ?? null,
        range: context.range,
        openNow: isOpenAt(context.schedule, now, context.timeZone),
      })
      views.set(context.environmentId, { context, status, situation, indicators: new Map() })
    }

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.writeEnvironmentSnapshots(client, views, devices, now)
      for (const period of PERIOD_KEYS) await this.writeEnvironmentIndicators(client, views, period, now)
      await this.writeStoreSnapshots(client, views, now)
      await client.query('SELECT pg_notify($1, $2)', [
        EVENTS_CHANNEL,
        JSON.stringify({
          type: 'state_updated',
          now: new Date(now).toISOString(),
          lastSeq,
          storeIds: [...new Set(this.environments.map((environment) => environment.storeId))],
        }),
      ])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async writeEnvironmentSnapshots(
    client: pg.PoolClient,
    views: Map<string, EnvironmentView>,
    devices: ReadonlyMap<string, DeviceMemory>,
    now: number,
  ) {
    const list = [...views.values()]
    const device = (view: EnvironmentView) =>
      view.context.deviceId ? devices.get(view.context.deviceId) : undefined
    const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString())
    await client.query(
      `INSERT INTO state.environment_snapshot
         (environment_id, status, situation, last_value, last_valid_at, last_contact_at, now_ts, updated_at)
       SELECT *, now() FROM unnest($1::text[], $2::text[], $3::text[], $4::real[], $5::timestamptz[], $6::timestamptz[], $7::timestamptz[])
       ON CONFLICT (environment_id) DO UPDATE SET status = EXCLUDED.status, situation = EXCLUDED.situation,
         last_value = EXCLUDED.last_value, last_valid_at = EXCLUDED.last_valid_at,
         last_contact_at = EXCLUDED.last_contact_at, now_ts = EXCLUDED.now_ts, updated_at = now()`,
      [
        list.map((view) => view.context.environmentId),
        list.map((view) => view.status),
        list.map((view) => view.situation),
        list.map((view) => device(view)?.lastValidValue ?? null),
        list.map((view) => iso(device(view)?.lastValidAt)),
        list.map((view) => iso(device(view)?.lastContactAt)),
        list.map(() => iso(now)),
      ],
    )
  }

  private async writeEnvironmentIndicators(
    client: pg.PoolClient,
    views: Map<string, EnvironmentView>,
    period: PeriodKey,
    now: number,
  ) {
    const { from, to } = periodRange(period, now)
    const { rows } = await client.query<PeriodRow>(
      `SELECT device_id,
         sum(in_hours) AS in_hours, sum(within) AS within, sum(above) AS above, sum(below) AS below,
         sum(samples - samples_ok) AS discarded,
         (sum(value_sum) / nullif(sum(samples_ok), 0))::real AS value_avg,
         min(value_min) AS value_min, max(value_max) AS value_max
       FROM ${VIEW_BY_BUCKET[PERIODS[period].bucket]}
       WHERE bucket >= $1 AND bucket < $2
       GROUP BY device_id`,
      [new Date(from).toISOString(), new Date(to).toISOString()],
    )
    const byDevice = new Map(rows.map((row) => [row.device_id, row]))

    const values = [...views.values()].map((view) => {
      const row = view.context.deviceId ? byDevice.get(view.context.deviceId) : undefined
      const expected = Math.floor(
        openDurationMs(view.context.schedule, from, Math.min(to, now), view.context.timeZone) /
          EXPECTED_SAMPLING_MS,
      )
      const counts: ComfortCounts = {
        inHours: row?.in_hours ?? 0,
        within: row?.within ?? 0,
        above: row?.above ?? 0,
        below: row?.below ?? 0,
        expected,
      }
      const indicator = comfortIndicator(counts)
      view.indicators.set(period, { counts, comfortPct: indicator.comfortPct })
      return { view, row, counts, indicator }
    })

    await client.query(
      `INSERT INTO state.environment_indicator (environment_id, period, from_ts, to_ts, samples_in_hours,
         samples_within, samples_above, samples_below, samples_expected, samples_discarded,
         value_avg, value_min, value_max, comfort_pct, coverage_pct)
       SELECT e, $2, $3, $4, ih, w, a, b, ex, d, avg, mn, mx, cp, cv
       FROM unnest($1::text[], $5::int[], $6::int[], $7::int[], $8::int[], $9::int[], $10::int[],
                   $11::real[], $12::real[], $13::real[], $14::real[], $15::real[])
         AS t(e, ih, w, a, b, ex, d, avg, mn, mx, cp, cv)
       ON CONFLICT (environment_id, period) DO UPDATE SET from_ts = EXCLUDED.from_ts, to_ts = EXCLUDED.to_ts,
         samples_in_hours = EXCLUDED.samples_in_hours, samples_within = EXCLUDED.samples_within,
         samples_above = EXCLUDED.samples_above, samples_below = EXCLUDED.samples_below,
         samples_expected = EXCLUDED.samples_expected, samples_discarded = EXCLUDED.samples_discarded,
         value_avg = EXCLUDED.value_avg, value_min = EXCLUDED.value_min, value_max = EXCLUDED.value_max,
         comfort_pct = EXCLUDED.comfort_pct, coverage_pct = EXCLUDED.coverage_pct`,
      [
        values.map((item) => item.view.context.environmentId),
        period,
        new Date(from).toISOString(),
        new Date(to).toISOString(),
        values.map((item) => item.counts.inHours),
        values.map((item) => item.counts.within),
        values.map((item) => item.counts.above),
        values.map((item) => item.counts.below),
        values.map((item) => item.counts.expected),
        values.map((item) => item.row?.discarded ?? 0),
        values.map((item) => item.row?.value_avg ?? null),
        values.map((item) => item.row?.value_min ?? null),
        values.map((item) => item.row?.value_max ?? null),
        values.map((item) => item.indicator.comfortPct),
        values.map((item) => item.indicator.coveragePct),
      ],
    )
  }

  private async writeStoreSnapshots(client: pg.PoolClient, views: Map<string, EnvironmentView>, now: number) {
    const byStore = new Map<string, EnvironmentView[]>()
    for (const view of views.values()) {
      const list = byStore.get(view.context.storeId) ?? []
      list.push(view)
      byStore.set(view.context.storeId, list)
    }

    const rows = [...byStore.entries()].flatMap(([storeId, list]) =>
      PERIOD_KEYS.map((period) => {
        const statuses = list.map((view) => view.status)
        const status = storeStatus(statuses)
        const counts = sumCounts(list.map((view) => view.indicators.get(period)?.counts ?? emptyCounts))
        const indicator = comfortIndicator(counts)
        const count = (value: DeviceStatus) => statuses.filter((item) => item === value).length
        return {
          storeId,
          period,
          status,
          rank: STORE_STATUS_RANK[status],
          environments: list.length,
          online: count('online'),
          sensorFault: count('sensor_fault'),
          offline: count('offline'),
          noData: count('no_data'),
          outOfRange: list.filter((view) => view.situation === 'above' || view.situation === 'below').length,
          belowTarget: list.filter((view) => {
            const pct = view.indicators.get(period)?.comfortPct
            return pct !== null && pct !== undefined && pct < COMFORT_TARGET_PCT
          }).length,
          inHours: counts.inHours,
          within: counts.within,
          comfortPct: indicator.comfortPct,
          coveragePct: indicator.coveragePct,
        }
      }),
    )

    await client.query(
      `INSERT INTO state.store_snapshot (store_id, period, status, status_rank, environments, env_online,
         env_sensor_fault, env_offline, env_no_data, env_out_of_range, env_below_target, samples_in_hours,
         samples_within, comfort_pct, coverage_pct, now_ts)
       SELECT *, $16::timestamptz FROM unnest($1::text[], $2::text[], $3::text[], $4::smallint[], $5::int[], $6::int[],
         $7::int[], $8::int[], $9::int[], $10::int[], $11::int[], $12::int[], $13::int[], $14::real[], $15::real[])
       ON CONFLICT (store_id, period) DO UPDATE SET status = EXCLUDED.status, status_rank = EXCLUDED.status_rank,
         environments = EXCLUDED.environments, env_online = EXCLUDED.env_online,
         env_sensor_fault = EXCLUDED.env_sensor_fault, env_offline = EXCLUDED.env_offline,
         env_no_data = EXCLUDED.env_no_data, env_out_of_range = EXCLUDED.env_out_of_range,
         env_below_target = EXCLUDED.env_below_target, samples_in_hours = EXCLUDED.samples_in_hours,
         samples_within = EXCLUDED.samples_within, comfort_pct = EXCLUDED.comfort_pct,
         coverage_pct = EXCLUDED.coverage_pct, now_ts = EXCLUDED.now_ts`,
      [
        rows.map((row) => row.storeId),
        rows.map((row) => row.period),
        rows.map((row) => row.status),
        rows.map((row) => row.rank),
        rows.map((row) => row.environments),
        rows.map((row) => row.online),
        rows.map((row) => row.sensorFault),
        rows.map((row) => row.offline),
        rows.map((row) => row.noData),
        rows.map((row) => row.outOfRange),
        rows.map((row) => row.belowTarget),
        rows.map((row) => row.inHours),
        rows.map((row) => row.within),
        rows.map((row) => row.comfortPct),
        rows.map((row) => row.coveragePct),
        new Date(now).toISOString(),
      ],
    )
  }
}

const emptyCounts: ComfortCounts = { inHours: 0, within: 0, above: 0, below: 0, expected: 0 }
