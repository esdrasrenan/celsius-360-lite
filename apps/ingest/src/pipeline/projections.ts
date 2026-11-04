import {
  COMFORT_TARGET_PCT,
  type ComfortCounts,
  type ComfortIndicator,
  comfortIndicator,
  type DeviceStatus,
  deviceStatus,
  EXPECTED_SAMPLING_MS,
  isOpenAt,
  nextOpenAt,
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
  openNow: boolean
  nextOpenAt: number | null
  indicators: Map<PeriodKey, { counts: ComfortCounts; indicator: ComfortIndicator }>
}

// Colunas gravadas em cada projeção, com o tipo do Postgres
const ENVIRONMENT_SNAPSHOT = {
  environment_id: 'text',
  status: 'text',
  situation: 'text',
  last_value: 'real',
  last_valid_at: 'timestamptz',
  last_contact_at: 'timestamptz',
  open_now: 'boolean',
  next_open_at: 'timestamptz',
  now_ts: 'timestamptz',
}

const ENVIRONMENT_INDICATOR = {
  environment_id: 'text',
  period: 'text',
  from_ts: 'timestamptz',
  to_ts: 'timestamptz',
  samples_in_hours: 'int',
  samples_within: 'int',
  samples_above: 'int',
  samples_below: 'int',
  samples_expected: 'int',
  samples_discarded: 'int',
  value_avg: 'real',
  value_min: 'real',
  value_max: 'real',
  comfort_pct: 'real',
  above_pct: 'real',
  below_pct: 'real',
  coverage_pct: 'real',
}

const STORE_SNAPSHOT = {
  store_id: 'text',
  period: 'text',
  status: 'text',
  status_rank: 'smallint',
  environments: 'int',
  env_online: 'int',
  env_sensor_fault: 'int',
  env_offline: 'int',
  env_no_data: 'int',
  env_out_of_range: 'int',
  env_above: 'int',
  env_below: 'int',
  env_open_now: 'int',
  env_below_target: 'int',
  samples_in_hours: 'int',
  samples_within: 'int',
  samples_above: 'int',
  samples_below: 'int',
  samples_expected: 'int',
  comfort_pct: 'real',
  above_pct: 'real',
  below_pct: 'real',
  coverage_pct: 'real',
  next_open_at: 'timestamptz',
  worst_env_id: 'text',
  worst_env_comfort: 'real',
  now_ts: 'timestamptz',
}

const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString())

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
      const openNow = isOpenAt(context.schedule, now, context.timeZone)
      const situation = situationNow({
        status,
        lastValue: device?.lastValidValue ?? null,
        range: context.range,
        openNow,
      })
      views.set(context.environmentId, {
        context,
        status,
        situation,
        openNow,
        nextOpenAt: openNow ? null : nextOpenAt(context.schedule, now, context.timeZone),
        indicators: new Map(),
      })
    }

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.writeEnvironmentSnapshots(client, views, devices, now)
      for (const period of PERIOD_KEYS) await this.writeEnvironmentIndicators(client, views, period, now)
      await this.writeStoreSnapshots(client, views, now)
      // Sem ids de loja: o NOTIFY tem teto de 8.000 bytes, e a interface refaz as próprias consultas
      await client.query('SELECT pg_notify($1, $2)', [
        EVENTS_CHANNEL,
        JSON.stringify({ type: 'state_updated', now: iso(now), lastSeq }),
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
    const rows = [...views.values()].map((view) => {
      const device = view.context.deviceId ? devices.get(view.context.deviceId) : undefined
      return {
        environment_id: view.context.environmentId,
        status: view.status,
        situation: view.situation,
        last_value: device?.lastValidValue ?? null,
        last_valid_at: iso(device?.lastValidAt),
        last_contact_at: iso(device?.lastContactAt),
        open_now: view.openNow,
        next_open_at: iso(view.nextOpenAt),
        now_ts: iso(now),
      }
    })
    await upsert(client, 'state.environment_snapshot', ['environment_id'], ENVIRONMENT_SNAPSHOT, rows, [
      'updated_at = now()',
    ])
  }

  private async writeEnvironmentIndicators(
    client: pg.PoolClient,
    views: Map<string, EnvironmentView>,
    period: PeriodKey,
    now: number,
  ) {
    const { from, to } = periodRange(period, now)
    const { rows: aggregates } = await client.query<PeriodRow>(
      `SELECT device_id,
         sum(in_hours) AS in_hours, sum(within) AS within, sum(above) AS above, sum(below) AS below,
         sum(samples - samples_ok) AS discarded,
         (sum(value_sum) / nullif(sum(samples_ok), 0))::real AS value_avg,
         min(value_min) AS value_min, max(value_max) AS value_max
       FROM ${VIEW_BY_BUCKET[PERIODS[period].bucket]}
       WHERE bucket >= $1 AND bucket < $2
       GROUP BY device_id`,
      [iso(from), iso(to)],
    )
    const byDevice = new Map(aggregates.map((row) => [row.device_id, row]))

    const rows = [...views.values()].map((view) => {
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
      view.indicators.set(period, { counts, indicator })
      return {
        environment_id: view.context.environmentId,
        period,
        from_ts: iso(from),
        to_ts: iso(to),
        samples_in_hours: counts.inHours,
        samples_within: counts.within,
        samples_above: counts.above,
        samples_below: counts.below,
        samples_expected: counts.expected,
        samples_discarded: row?.discarded ?? 0,
        value_avg: row?.value_avg ?? null,
        value_min: row?.value_min ?? null,
        value_max: row?.value_max ?? null,
        comfort_pct: indicator.comfortPct,
        above_pct: indicator.abovePct,
        below_pct: indicator.belowPct,
        coverage_pct: indicator.coveragePct,
      }
    })
    await upsert(
      client,
      'state.environment_indicator',
      ['environment_id', 'period'],
      ENVIRONMENT_INDICATOR,
      rows,
    )
  }

  private async writeStoreSnapshots(client: pg.PoolClient, views: Map<string, EnvironmentView>, now: number) {
    const byStore = Map.groupBy(views.values(), (view) => view.context.storeId)

    const rows = [...byStore.entries()].flatMap(([storeId, list]) => {
      const status = storeStatus(list.map((view) => view.status))
      const count = (predicate: (view: EnvironmentView) => boolean) => list.filter(predicate).length
      const openNow = count((view) => view.openNow)
      const nextOpenings = list.flatMap((view) => (view.nextOpenAt === null ? [] : [view.nextOpenAt]))

      return PERIOD_KEYS.map((period) => {
        const counts = sumCounts(list.map((view) => view.indicators.get(period)?.counts ?? emptyCounts))
        const indicator = comfortIndicator(counts)
        const worst = worstEnvironment(list, period)
        return {
          store_id: storeId,
          period,
          status,
          status_rank: STORE_STATUS_RANK[status],
          environments: list.length,
          env_online: count((view) => view.status === 'online'),
          env_sensor_fault: count((view) => view.status === 'sensor_fault'),
          env_offline: count((view) => view.status === 'offline'),
          env_no_data: count((view) => view.status === 'no_data'),
          env_out_of_range: count((view) => view.situation === 'above' || view.situation === 'below'),
          env_above: count((view) => view.situation === 'above'),
          env_below: count((view) => view.situation === 'below'),
          env_open_now: openNow,
          env_below_target: count((view) => {
            const pct = view.indicators.get(period)?.indicator.comfortPct
            return pct != null && pct < COMFORT_TARGET_PCT
          }),
          samples_in_hours: counts.inHours,
          samples_within: counts.within,
          samples_above: counts.above,
          samples_below: counts.below,
          samples_expected: counts.expected,
          comfort_pct: indicator.comfortPct,
          above_pct: indicator.abovePct,
          below_pct: indicator.belowPct,
          coverage_pct: indicator.coveragePct,
          // A loja só "abre às ..." quando todos os ambientes estão fechados
          next_open_at: openNow > 0 || nextOpenings.length === 0 ? null : iso(Math.min(...nextOpenings)),
          worst_env_id: worst?.environmentId ?? null,
          worst_env_comfort: worst?.comfortPct ?? null,
          now_ts: iso(now),
        }
      })
    })
    await upsert(client, 'state.store_snapshot', ['store_id', 'period'], STORE_SNAPSHOT, rows)
  }
}

/**
 * Grava as linhas num comando só: vão como um parâmetro JSON e viram registros com
 * jsonb_to_recordset. Tabela e colunas são constantes deste arquivo, nunca entrada externa.
 */
async function upsert<C extends Record<string, string>>(
  client: pg.PoolClient,
  table: string,
  key: ReadonlyArray<keyof C & string>,
  columns: C,
  rows: ReadonlyArray<Record<keyof C, unknown>>,
  alsoOnUpdate: readonly string[] = [],
) {
  if (rows.length === 0) return
  const names = Object.keys(columns)
  const update = [
    ...names.filter((name) => !key.includes(name)).map((name) => `${name} = EXCLUDED.${name}`),
    ...alsoOnUpdate,
  ]
  await client.query(
    `INSERT INTO ${table} (${names.join(', ')})
     SELECT ${names.join(', ')}
     FROM jsonb_to_recordset($1::jsonb) AS t(${names.map((name) => `${name} ${columns[name]}`).join(', ')})
     ON CONFLICT (${key.join(', ')}) DO UPDATE SET ${update.join(', ')}`,
    [JSON.stringify(rows)],
  )
}

/** Ambiente de menor conforto no período, entre os que têm conforto definido (desempate pelo id). */
function worstEnvironment(list: readonly EnvironmentView[], period: PeriodKey) {
  let worst: { environmentId: string; comfortPct: number } | null = null
  for (const view of list) {
    const comfortPct = view.indicators.get(period)?.indicator.comfortPct
    if (comfortPct == null) continue
    const environmentId = view.context.environmentId
    if (
      !worst ||
      comfortPct < worst.comfortPct ||
      (comfortPct === worst.comfortPct && environmentId < worst.environmentId)
    ) {
      worst = { environmentId, comfortPct }
    }
  }
  return worst
}

const emptyCounts: ComfortCounts = { inHours: 0, within: 0, above: 0, below: 0, expected: 0 }
