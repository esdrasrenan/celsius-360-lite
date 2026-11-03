import { periodRange } from '@celsius/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import type { UserScope } from '../auth/session'
import { iso, NowService } from '../common/time'
import { PG_POOL } from '../database/database.module'
import type {
  ClientListItemDto,
  EnvironmentListItemDto,
  ListStoresQueryDto,
  StoreListDto,
  StoreListItemDto,
  StoreSort,
} from './stores.dto'

// Lista fechada: o valor de "sort" nunca chega ao SQL como texto livre
const ORDER_BY: Record<StoreSort, string> = {
  status: 'status_rank DESC, env_out_of_range DESC, comfort_pct ASC NULLS LAST, name',
  comfort: 'comfort_pct ASC NULLS LAST, name',
  comfort_desc: 'comfort_pct DESC NULLS LAST, name',
  out_of_range: 'env_out_of_range DESC, env_below_target DESC, name',
  name: 'name',
}

interface StoreRow {
  id: string
  name: string
  kind: string
  city: string
  state_code: string
  client_id: string
  client_name: string
  status: string
  environments: number
  env_online: number
  env_sensor_fault: number
  env_offline: number
  env_no_data: number
  env_out_of_range: number
  env_below_target: number
  comfort_pct: number | null
  coverage_pct: number | null
}

interface EnvironmentRow {
  id: string
  store_id: string
  name: string
  comfort_min: number
  comfort_max: number
  status: string | null
  situation: string | null
  last_value: number | null
  last_valid_at: Date | null
  comfort_pct: number | null
  coverage_pct: number | null
}

@Injectable()
export class StoresService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly nowService: NowService,
  ) {}

  /**
   * Visão da rede: lê só as projeções mantidas pela ingestão (state.store_snapshot), então filtro,
   * ordenação, paginação e totais acontecem no banco, com uma consulta por página.
   */
  async list(query: ListStoresQueryDto, scope: UserScope): Promise<StoreListDto> {
    const now = await this.nowService.current()
    const params: unknown[] = [query.period, scope.all, scope.storeIds]
    const where = ['($2 OR s.id = ANY($3::text[]))']
    if (query.clientId) {
      params.push(query.clientId)
      where.push(`s.client_id = $${params.length}`)
    }
    if (query.status?.length) {
      params.push(query.status)
      where.push(`coalesce(ss.status, 'no_data') = ANY($${params.length}::text[])`)
    }
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`)
      where.push(
        `unaccent(s.name || ' ' || s.city || ' ' || s.state_code || ' ' || c.name) ILIKE unaccent($${params.length})`,
      )
    }

    const filtered = `
      SELECT s.id, s.name, s.kind, s.city, s.state_code, s.client_id, c.name AS client_name,
        coalesce(ss.status, 'no_data') AS status, coalesce(ss.status_rank, 1) AS status_rank,
        coalesce(ss.environments, 0) AS environments, coalesce(ss.env_online, 0) AS env_online,
        coalesce(ss.env_sensor_fault, 0) AS env_sensor_fault, coalesce(ss.env_offline, 0) AS env_offline,
        coalesce(ss.env_no_data, 0) AS env_no_data, coalesce(ss.env_out_of_range, 0) AS env_out_of_range,
        coalesce(ss.env_below_target, 0) AS env_below_target, coalesce(ss.samples_in_hours, 0) AS samples_in_hours,
        coalesce(ss.samples_within, 0) AS samples_within, ss.comfort_pct, ss.coverage_pct
      FROM registry.store s
      JOIN registry.client c ON c.id = s.client_id
      LEFT JOIN state.store_snapshot ss ON ss.store_id = s.id AND ss.period = $1
      WHERE ${where.join(' AND ')}`

    const offset = (query.page - 1) * query.pageSize
    const [page, totals] = await Promise.all([
      this.pool.query<StoreRow>(
        `SELECT * FROM (${filtered}) f ORDER BY ${ORDER_BY[query.sort]} LIMIT ${query.pageSize} OFFSET ${offset}`,
        params,
      ),
      this.pool.query<Record<string, number | null>>(
        `SELECT count(*) AS stores, coalesce(sum(environments), 0) AS environments,
           coalesce(sum(env_online), 0) AS online, coalesce(sum(env_sensor_fault), 0) AS sensor_fault,
           coalesce(sum(env_offline), 0) AS offline, coalesce(sum(env_no_data), 0) AS no_data,
           coalesce(sum(env_out_of_range), 0) AS out_of_range, coalesce(sum(env_below_target), 0) AS below_target,
           round((sum(samples_within)::numeric / nullif(sum(samples_in_hours), 0)) * 100, 2) AS comfort_pct
         FROM (${filtered}) f`,
        params,
      ),
    ])

    const environments = await this.environmentsOf(
      page.rows.map((row) => row.id),
      query.period,
    )
    const range = now === null ? null : periodRange(query.period, now)
    const t = totals.rows[0] ?? {}
    return {
      items: page.rows.map((row) => toStoreItem(row, environments.get(row.id) ?? [])),
      page: query.page,
      pageSize: query.pageSize,
      total: Number(t.stores ?? 0),
      totals: {
        stores: Number(t.stores ?? 0),
        environments: Number(t.environments ?? 0),
        online: Number(t.online ?? 0),
        sensorFault: Number(t.sensor_fault ?? 0),
        offline: Number(t.offline ?? 0),
        noData: Number(t.no_data ?? 0),
        outOfRange: Number(t.out_of_range ?? 0),
        belowTarget: Number(t.below_target ?? 0),
        comfortPct: t.comfort_pct ?? null,
      },
      now: iso(now),
      period: { key: query.period, from: iso(range?.from) ?? '', to: iso(range?.to) ?? '' },
    }
  }

  async clients(scope: UserScope): Promise<ClientListItemDto[]> {
    const { rows } = await this.pool.query<{ id: string; name: string; stores: number }>(
      `SELECT c.id, c.name, count(s.id) AS stores
       FROM registry.client c JOIN registry.store s ON s.client_id = c.id
       WHERE ($1 OR s.id = ANY($2::text[]))
       GROUP BY c.id, c.name ORDER BY c.name`,
      [scope.all, scope.storeIds],
    )
    return rows
  }

  private async environmentsOf(
    storeIds: string[],
    period: string,
  ): Promise<Map<string, EnvironmentListItemDto[]>> {
    if (storeIds.length === 0) return new Map()
    const { rows } = await this.pool.query<EnvironmentRow>(
      `SELECT e.id, e.store_id, e.name, e.comfort_min, e.comfort_max, es.status, es.situation, es.last_value,
         es.last_valid_at, ei.comfort_pct, ei.coverage_pct
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
        status: row.status ?? 'no_data',
        situation: row.situation ?? 'unknown',
        lastValue: row.last_value,
        lastValidAt: iso(row.last_valid_at?.getTime()),
        comfortRange: { min: row.comfort_min, max: row.comfort_max },
        comfortPct: row.comfort_pct,
        coveragePct: row.coverage_pct,
      })
      byStore.set(row.store_id, list)
    }
    return byStore
  }
}

function toStoreItem(row: StoreRow, environments: EnvironmentListItemDto[]): StoreListItemDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    city: row.city,
    state: row.state_code,
    client: { id: row.client_id, name: row.client_name },
    status: row.status,
    environmentCounts: {
      total: row.environments || environments.length,
      online: row.env_online,
      sensorFault: row.env_sensor_fault,
      offline: row.env_offline,
      noData: row.env_no_data,
      outOfRange: row.env_out_of_range,
      belowTarget: row.env_below_target,
    },
    comfortPct: row.comfort_pct,
    coveragePct: row.coverage_pct,
    environments,
  }
}
