import type { DeviceStatus, Situation, StoreStatus, WorstEnvironment } from '@celsius/contracts'
import { periodRange } from '@celsius/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import type { UserScope } from '../auth/session'
import { iso } from '../common/time'
import { PG_POOL } from '../database/database.module'
import { searchPatterns, storeMatches } from './search'
import type {
  ClientListItemDto,
  EnvironmentListItemDto,
  ListStoresQueryDto,
  StoreListDto,
  StoreListItemDto,
  StoreSort,
} from './stores.dto'

// Lista fechada: "sort" nunca chega ao SQL como texto livre. Cada entrada termina no id, para a
// paginação ser estável, e tem um índice com as mesmas colunas (migração 0004).
const ORDER_BY: Record<StoreSort, string> = {
  status:
    'ss.status_rank DESC, ss.env_out_of_range DESC, ss.comfort_pct ASC NULLS LAST, ss.store_name, ss.store_id',
  comfort: 'ss.comfort_pct ASC NULLS LAST, ss.store_name, ss.store_id',
  comfort_desc: 'ss.comfort_pct DESC NULLS LAST, ss.store_name, ss.store_id',
  out_of_range: 'ss.env_out_of_range DESC, ss.env_below_target DESC, ss.store_name, ss.store_id',
  worst_env: 'ss.worst_env_comfort ASC NULLS LAST, ss.store_name, ss.store_id',
  name: 'ss.store_name, ss.store_id',
}

interface SummaryRow {
  now: Date | null
  stores: number
  environments: number | null
  online: number | null
  sensor_fault: number | null
  offline: number | null
  no_data: number | null
  out_of_range: number | null
  above: number | null
  below: number | null
  below_target: number | null
  open_now: number | null
  comfort_pct: number | null
  above_pct: number | null
  below_pct: number | null
  coverage_pct: number | null
  worst_env_id: string | null
  worst_env_name: string | null
  worst_store_id: string | null
  worst_store_name: string | null
  worst_env_comfort: number | null
  facet_online: number
  facet_degraded: number
  facet_offline: number
  facet_no_data: number
  facet_below_target: number
  facet_out_of_range: number
}

interface StoreRow {
  id: string
  name: string
  kind: string
  city: string
  state_code: string
  timezone: string
  client_id: string
  client_name: string
  status: StoreStatus
  environments: number
  env_online: number
  env_sensor_fault: number
  env_offline: number
  env_no_data: number
  env_out_of_range: number
  env_above: number
  env_below: number
  env_below_target: number
  env_open_now: number
  comfort_pct: number | null
  above_pct: number | null
  below_pct: number | null
  coverage_pct: number | null
  next_open_at: Date | null
  worst_env_id: string | null
  worst_env_name: string | null
  worst_env_comfort: number | null
}

interface EnvironmentRow {
  id: string
  store_id: string
  name: string
  device_id: string | null
  comfort_min: number
  comfort_max: number
  status: DeviceStatus | null
  situation: Situation | null
  last_value: number | null
  last_valid_at: Date | null
  last_contact_at: Date | null
  open_now: boolean | null
  next_open_at: Date | null
  comfort_pct: number | null
  above_pct: number | null
  below_pct: number | null
  coverage_pct: number | null
}

/**
 * Condições da listagem. "base" escolhe as lojas (escopo, cliente, loja e busca) e vale também para
 * as contagens das pílulas; "narrow" são os filtros que as pílulas aplicam (status, meta e faixa).
 */
function buildFilter(query: ListStoresQueryDto, scope: UserScope) {
  const params: unknown[] = [query.period, scope.all, scope.storeIds]
  const param = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }
  const base = ['ss.period = $1', '($2 OR ss.store_id = ANY($3::text[]))']
  if (query.clientId) base.push(`s.client_id = ${param(query.clientId)}`)
  if (query.storeId) base.push(`ss.store_id = ${param(query.storeId)}`)
  for (const pattern of searchPatterns(query.search)) base.push(storeMatches(param(pattern)))

  const narrow: string[] = []
  if (query.status?.length) narrow.push(`ss.status = ANY(${param(query.status)}::text[])`)
  if (query.belowTarget) narrow.push('ss.env_below_target > 0')
  if (query.outOfRange) narrow.push('ss.env_out_of_range > 0')
  return { params, base: base.join(' AND '), narrow: narrow.join(' AND ') || 'true' }
}

const count = (value: number | null) => Number(value ?? 0)

@Injectable()
export class StoresService {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  /**
   * Visão da rede: lê só as projeções mantidas pela ingestão (state.store_snapshot), então filtro,
   * ordenação, paginação e totais acontecem no banco. Totais, pílulas e página saem do mesmo
   * instantâneo (REPEATABLE READ), coerentes mesmo com a ingestão gravando no meio.
   */
  async list(query: ListStoresQueryDto, scope: UserScope): Promise<StoreListDto> {
    const { params, base, narrow } = buildFilter(query, scope)

    return this.readOnly(async (client) => {
      const { rows } = await client.query<SummaryRow>(
        `SELECT t.*, e.name AS worst_env_name, ws.id AS worst_store_id, ws.name AS worst_store_name
         FROM (
           SELECT
             -- O "agora" das próprias projeções, não o do checkpoint, que anda antes delas
             (SELECT max(now_ts) FROM state.store_snapshot) AS now,
             count(*) FILTER (WHERE m) AS stores,
             sum(environments) FILTER (WHERE m) AS environments,
             sum(env_online) FILTER (WHERE m) AS online,
             sum(env_sensor_fault) FILTER (WHERE m) AS sensor_fault,
             sum(env_offline) FILTER (WHERE m) AS offline,
             sum(env_no_data) FILTER (WHERE m) AS no_data,
             sum(env_out_of_range) FILTER (WHERE m) AS out_of_range,
             sum(env_above) FILTER (WHERE m) AS above,
             sum(env_below) FILTER (WHERE m) AS below,
             sum(env_below_target) FILTER (WHERE m) AS below_target,
             sum(env_open_now) FILTER (WHERE m) AS open_now,
             round(100.0 * sum(samples_within) FILTER (WHERE m) / nullif(sum(samples_in_hours) FILTER (WHERE m), 0), 2) AS comfort_pct,
             round(100.0 * sum(samples_above) FILTER (WHERE m) / nullif(sum(samples_in_hours) FILTER (WHERE m), 0), 2) AS above_pct,
             round(100.0 * sum(samples_below) FILTER (WHERE m) / nullif(sum(samples_in_hours) FILTER (WHERE m), 0), 2) AS below_pct,
             -- LEAST ignora NULL: sem horário esperado, a cobertura fica nula, não 100
             CASE WHEN sum(samples_expected) FILTER (WHERE m) > 0 THEN least(100, round(100.0 * sum(samples_in_hours) FILTER (WHERE m) / sum(samples_expected) FILTER (WHERE m), 2)) END AS coverage_pct,
             (array_agg(worst_env_id ORDER BY worst_env_comfort, worst_env_id)
               FILTER (WHERE m AND worst_env_comfort IS NOT NULL))[1] AS worst_env_id,
             min(worst_env_comfort) FILTER (WHERE m) AS worst_env_comfort,
             count(*) FILTER (WHERE status = 'online') AS facet_online,
             count(*) FILTER (WHERE status = 'degraded') AS facet_degraded,
             count(*) FILTER (WHERE status = 'offline') AS facet_offline,
             count(*) FILTER (WHERE status = 'no_data') AS facet_no_data,
             count(*) FILTER (WHERE env_below_target > 0) AS facet_below_target,
             count(*) FILTER (WHERE env_out_of_range > 0) AS facet_out_of_range
           FROM (
             SELECT ss.*, (${narrow}) AS m
             FROM state.store_snapshot ss JOIN registry.store s ON s.id = ss.store_id
             WHERE ${base}
           ) b
         ) t
         LEFT JOIN registry.environment e ON e.id = t.worst_env_id
         LEFT JOIN registry.store ws ON ws.id = e.store_id`,
        params,
      )
      const summary = rows[0] as SummaryRow
      const total = Number(summary.stores)
      const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)))

      const { rows: stores } = await client.query<StoreRow>(
        `SELECT s.id, s.name, s.kind, s.city, s.state_code, s.timezone, s.client_id, c.name AS client_name,
           ss.status, ss.environments, ss.env_online, ss.env_sensor_fault, ss.env_offline, ss.env_no_data,
           ss.env_out_of_range, ss.env_above, ss.env_below, ss.env_below_target, ss.env_open_now,
           ss.comfort_pct, ss.above_pct, ss.below_pct, ss.coverage_pct, ss.next_open_at,
           ss.worst_env_id, we.name AS worst_env_name, ss.worst_env_comfort
         FROM state.store_snapshot ss
         JOIN registry.store s ON s.id = ss.store_id
         JOIN registry.client c ON c.id = s.client_id
         LEFT JOIN registry.environment we ON we.id = ss.worst_env_id
         WHERE ${base} AND (${narrow})
         ORDER BY ${ORDER_BY[query.sort]}
         LIMIT ${query.pageSize} OFFSET ${(page - 1) * query.pageSize}`,
        params,
      )
      const environments = await environmentsOf(
        client,
        stores.map((row) => row.id),
        query.period,
      )

      const now = summary.now?.getTime() ?? null
      const range = now === null ? null : periodRange(query.period, now)
      return {
        items: stores.map((row) => toStoreItem(row, environments.get(row.id) ?? [])),
        page,
        pageSize: query.pageSize,
        total,
        totals: {
          stores: total,
          environments: count(summary.environments),
          online: count(summary.online),
          sensorFault: count(summary.sensor_fault),
          offline: count(summary.offline),
          noData: count(summary.no_data),
          outOfRange: count(summary.out_of_range),
          above: count(summary.above),
          below: count(summary.below),
          belowTarget: count(summary.below_target),
          openNow: count(summary.open_now),
          comfortPct: summary.comfort_pct,
          abovePct: summary.above_pct,
          belowPct: summary.below_pct,
          coveragePct: summary.coverage_pct,
          worstEnvironment: worstEnvironment(
            summary.worst_env_id,
            summary.worst_env_name,
            summary.worst_store_id,
            summary.worst_store_name,
            summary.worst_env_comfort,
          ),
        },
        facets: {
          status: {
            online: summary.facet_online,
            degraded: summary.facet_degraded,
            offline: summary.facet_offline,
            no_data: summary.facet_no_data,
          },
          belowTarget: summary.facet_below_target,
          outOfRange: summary.facet_out_of_range,
        },
        now: iso(now),
        period: { key: query.period, from: iso(range?.from) ?? '', to: iso(range?.to) ?? '' },
      }
    })
  }

  async clients(scope: UserScope): Promise<ClientListItemDto[]> {
    const { rows } = await this.pool.query<{ id: string; name: string; stores: number }>(
      `SELECT c.id, c.name, count(s.id) AS stores
       FROM registry.client c JOIN registry.store s ON s.client_id = c.id
       WHERE ($1 OR s.id = ANY($2::text[]))
       GROUP BY c.id, c.name ORDER BY c.name, c.id`,
      [scope.all, scope.storeIds],
    )
    return rows
  }

  private async readOnly<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const result = await work(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}

async function environmentsOf(
  client: pg.PoolClient,
  storeIds: string[],
  period: string,
): Promise<Map<string, EnvironmentListItemDto[]>> {
  if (storeIds.length === 0) return new Map()
  const { rows } = await client.query<EnvironmentRow>(
    `SELECT e.id, e.store_id, e.name, e.device_id, e.comfort_min, e.comfort_max,
       es.status, es.situation, es.last_value, es.last_valid_at, es.last_contact_at, es.open_now, es.next_open_at,
       ei.comfort_pct, ei.above_pct, ei.below_pct, ei.coverage_pct
     FROM registry.environment e
     LEFT JOIN state.environment_snapshot es ON es.environment_id = e.id
     LEFT JOIN state.environment_indicator ei ON ei.environment_id = e.id AND ei.period = $2
     WHERE e.store_id = ANY($1::text[])
     ORDER BY e.store_id, e.id`,
    [storeIds, period],
  )
  const byStore = new Map<string, EnvironmentListItemDto[]>()
  for (const row of rows) {
    const list = byStore.get(row.store_id) ?? []
    list.push({
      id: row.id,
      name: row.name,
      deviceId: row.device_id,
      status: row.status ?? 'no_data',
      situation: row.situation ?? 'unknown',
      lastValue: row.last_value,
      lastValidAt: iso(row.last_valid_at?.getTime()),
      lastContactAt: iso(row.last_contact_at?.getTime()),
      comfortRange: { min: row.comfort_min, max: row.comfort_max },
      comfortPct: row.comfort_pct,
      abovePct: row.above_pct,
      belowPct: row.below_pct,
      coveragePct: row.coverage_pct,
      openNow: row.open_now ?? false,
      nextOpenAt: iso(row.next_open_at?.getTime()),
    })
    byStore.set(row.store_id, list)
  }
  return byStore
}

function worstEnvironment(
  id: string | null,
  name: string | null,
  storeId: string | null,
  storeName: string | null,
  comfortPct: number | null,
): WorstEnvironment | null {
  if (id === null || name === null || storeId === null || storeName === null || comfortPct === null)
    return null
  return { id, name, storeId, storeName, comfortPct }
}

function toStoreItem(row: StoreRow, environments: EnvironmentListItemDto[]): StoreListItemDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    city: row.city,
    state: row.state_code,
    timezone: row.timezone,
    client: { id: row.client_id, name: row.client_name },
    status: row.status,
    environmentCounts: {
      total: row.environments,
      online: row.env_online,
      sensorFault: row.env_sensor_fault,
      offline: row.env_offline,
      noData: row.env_no_data,
      outOfRange: row.env_out_of_range,
      above: row.env_above,
      below: row.env_below,
      belowTarget: row.env_below_target,
      openNow: row.env_open_now,
    },
    comfortPct: row.comfort_pct,
    abovePct: row.above_pct,
    belowPct: row.below_pct,
    coveragePct: row.coverage_pct,
    nextOpenAt: iso(row.next_open_at?.getTime()),
    worstEnvironment: worstEnvironment(
      row.worst_env_id,
      row.worst_env_name,
      row.id,
      row.name,
      row.worst_env_comfort,
    ),
    environments,
  }
}
