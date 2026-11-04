import {
  COMFORT_TARGET_PCT,
  type ComfortCounts,
  type ComfortIndicator,
  type ComfortRange,
  comfortIndicator,
  compileSchedule,
  type DeviceStatus,
  deviceStatus,
  EXPECTED_SAMPLING_MS,
  isOpenAt,
  nextOpenAt,
  type OpeningHours,
  openDurationMs,
  PERIOD_KEYS,
  type PeriodKey,
  periodRange,
  type Situation,
  STORE_STATUS_RANK,
  situationNow,
  storeStatus,
  sumCounts,
} from '@celsius/domain'
import type pg from 'pg'
import type { Config } from '../config'
import { SYNTHETIC_CLIENT_ID } from '../registry'

/**
 * Rede sintética para ver e medir a visão da rede com centenas de lojas. Grava lojas, ambientes e
 * dispositivos com prefixo próprio (LOJA-SINT-, AMB-SINT-, IOT-SINT-) sob o cliente "Rede Sintética",
 * já com estado e indicadores dos três períodos. Os números são sorteados com semente fixa, mas
 * coerentes entre si: o status sai das regras do domínio a partir do último contato e da última
 * leitura válida, e o conforto e a cobertura, das contagens. Não há telemetria sintética: a série
 * real fica intacta, e a ingestão e o relatório de qualidade ignoram esse cliente.
 */

const CITIES = [
  { city: 'São Paulo', uf: 'SP', timeZone: 'America/Sao_Paulo', latitude: -23.55, longitude: -46.63 },
  { city: 'Campinas', uf: 'SP', timeZone: 'America/Sao_Paulo', latitude: -22.91, longitude: -47.06 },
  { city: 'Rio de Janeiro', uf: 'RJ', timeZone: 'America/Sao_Paulo', latitude: -22.91, longitude: -43.17 },
  { city: 'Belo Horizonte', uf: 'MG', timeZone: 'America/Sao_Paulo', latitude: -19.92, longitude: -43.94 },
  { city: 'Curitiba', uf: 'PR', timeZone: 'America/Sao_Paulo', latitude: -25.43, longitude: -49.27 },
  { city: 'Porto Alegre', uf: 'RS', timeZone: 'America/Sao_Paulo', latitude: -30.03, longitude: -51.23 },
  { city: 'Salvador', uf: 'BA', timeZone: 'America/Bahia', latitude: -12.97, longitude: -38.5 },
  { city: 'Recife', uf: 'PE', timeZone: 'America/Recife', latitude: -8.05, longitude: -34.9 },
  { city: 'Fortaleza', uf: 'CE', timeZone: 'America/Fortaleza', latitude: -3.73, longitude: -38.52 },
  { city: 'Manaus', uf: 'AM', timeZone: 'America/Manaus', latitude: -3.12, longitude: -60.02 },
] as const

const week = (from: string, to: string, sunday = true): OpeningHours => ({
  seg: [from, to],
  ter: [from, to],
  qua: [from, to],
  qui: [from, to],
  sex: [from, to],
  sab: [from, to],
  dom: sunday ? [from, to] : null,
})

const KINDS = [
  { kind: 'loja de shopping', hours: week('10:00', '22:00') },
  { kind: 'loja de rua', hours: week('09:00', '19:00', false) },
]

const ENVIRONMENTS: Array<{ name: string; range: ComfortRange; allDay?: boolean }> = [
  { name: 'Salão de vendas', range: { min: 21, max: 25 } },
  { name: 'Provadores', range: { min: 21, max: 25 } },
  { name: 'Caixas', range: { min: 21, max: 25 } },
  { name: 'Vitrine', range: { min: 20, max: 26 } },
  { name: 'Estoque', range: { min: 18, max: 27 } },
  { name: 'Sala técnica', range: { min: 18, max: 24 }, allDay: true },
]
const ALL_DAY = week('00:00', '24:00')
const MINUTE = 60_000

// Sorteio reprodutível (mulberry32): a mesma quantidade de lojas gera sempre a mesma rede
function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round1 = (value: number) => Math.round(value * 10) / 10

interface Indicator {
  period: PeriodKey
  from: number
  to: number
  counts: ComfortCounts
  result: ComfortIndicator
  discarded: number
  avg: number | null
  min: number | null
  max: number | null
}

interface Environment {
  id: string
  storeId: string
  deviceId: string
  name: string
  range: ComfortRange
  hours: OpeningHours
  contactAt: number | null
  validAt: number | null
  value: number | null
  status: DeviceStatus
  situation: Situation
  openNow: boolean
  nextOpenAt: number | null
  indicators: Indicator[]
}

interface Store {
  id: string
  name: string
  kind: string
  city: (typeof CITIES)[number]
  hours: OpeningHours
  environments: Environment[]
}

function buildNetwork(total: number, now: number): Store[] {
  const random = seeded(360)
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)] as T

  return Array.from({ length: total }, (_, index) => {
    const number = String(index + 1).padStart(4, '0')
    const city = pick(CITIES)
    const { kind, hours } = pick(KINDS)
    // Algumas lojas sem internet (todos os ambientes offline) e algumas com climatização ruim
    const storeOffline = random() < 0.02
    const struggling = random() < 0.15
    const environments = ENVIRONMENTS.map((template, position): Environment => {
      const id = `${number}-${position + 1}`
      const environmentHours = template.allDay ? ALL_DAY : hours
      const schedule = compileSchedule(environmentHours)
      const { range } = template
      const comfortShare = 1 - (struggling ? 0.55 : 0.12) * random() ** 2

      const draw = random()
      const target = storeOffline
        ? 'offline'
        : draw < 0.01
          ? 'no_data'
          : draw < 0.04
            ? 'offline'
            : draw < 0.06
              ? 'sensor_fault'
              : 'online'
      const contactAt =
        target === 'no_data'
          ? null
          : target === 'offline'
            ? now - (20 + random() * 2 * 1440) * MINUTE
            : now - random() * 5 * MINUTE
      const validAt =
        contactAt === null
          ? null
          : target === 'sensor_fault'
            ? now - (30 + random() * 300) * MINUTE
            : contactAt
      const outside = random() > comfortShare
      const value =
        validAt === null
          ? null
          : round1(
              !outside
                ? range.min + 0.5 + random() * (range.max - range.min - 1)
                : random() < 0.7
                  ? range.max + 0.3 + random() * 3
                  : range.min - 0.3 - random() * 2,
            )
      const status = deviceStatus(
        contactAt === null ? null : { lastContactAt: contactAt, lastValidAt: validAt },
        now,
      )
      const openNow = isOpenAt(schedule, now, city.timeZone)
      const situation = situationNow({ status, lastValue: value, range, openNow })

      const indicators = PERIOD_KEYS.map((period): Indicator => {
        const { from, to } = periodRange(period, now)
        const expected = Math.floor(
          openDurationMs(schedule, from, Math.min(to, now), city.timeZone) / EXPECTED_SAMPLING_MS,
        )
        const coverage =
          status === 'no_data' ? 0 : status === 'offline' ? 0.4 + random() * 0.5 : 0.92 + random() * 0.08
        const inHours = Math.floor(expected * coverage)
        const share = Math.min(1, Math.max(0, comfortShare + (random() - 0.5) * 0.06))
        const within = Math.round(inHours * share)
        const above = Math.round((inHours - within) * 0.7)
        const mid = (range.min + range.max) / 2
        const avg = inHours > 0 ? round1(mid + ((above - (inHours - within - above)) / inHours) * 3) : null
        const counts = { inHours, within, above, below: inHours - within - above, expected }
        return {
          period,
          from,
          to,
          counts,
          result: comfortIndicator(counts),
          discarded: Math.round(expected * (status === 'sensor_fault' ? 0.05 : 0.002 * random())),
          avg,
          min: avg === null ? null : round1(Math.min(avg, range.min) - 0.5 - random()),
          max: avg === null ? null : round1(Math.max(avg, range.max) + (above > 0 ? random() * 3 : -1)),
        }
      })

      return {
        id: `AMB-SINT-${id}`,
        storeId: `LOJA-SINT-${number}`,
        deviceId: `IOT-SINT-${id}`,
        name: template.name,
        range,
        hours: environmentHours,
        contactAt,
        validAt,
        value,
        status,
        situation,
        openNow,
        nextOpenAt: openNow ? null : nextOpenAt(schedule, now, city.timeZone),
        indicators,
      }
    })
    return { id: `LOJA-SINT-${number}`, name: `Loja sintética ${number}`, kind, city, hours, environments }
  })
}

/** INSERT em lote por unnest: um array por coluna, cada um com o tipo do Postgres. */
async function insertRows<T>(
  client: pg.PoolClient,
  table: string,
  rows: readonly T[],
  columns: Record<string, readonly [type: string, value: (row: T) => unknown]>,
) {
  const specs = Object.values(columns)
  await client.query(
    `INSERT INTO ${table} (${Object.keys(columns).join(', ')})
     SELECT * FROM unnest(${specs.map(([type], index) => `$${index + 1}::${type}[]`).join(', ')})`,
    specs.map(([, value]) => rows.map(value)),
  )
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())

async function deleteSynthetic(client: pg.PoolClient): Promise<number> {
  const stores = 'SELECT id FROM registry.store WHERE client_id = $1'
  const environments = `SELECT id FROM registry.environment WHERE store_id IN (${stores})`
  await client.query(`DELETE FROM state.environment_indicator WHERE environment_id IN (${environments})`, [
    SYNTHETIC_CLIENT_ID,
  ])
  await client.query(`DELETE FROM state.environment_snapshot WHERE environment_id IN (${environments})`, [
    SYNTHETIC_CLIENT_ID,
  ])
  await client.query(`DELETE FROM state.store_snapshot WHERE store_id IN (${stores})`, [SYNTHETIC_CLIENT_ID])
  const { rows } = await client.query<{ device_id: string | null }>(
    `DELETE FROM registry.environment WHERE store_id IN (${stores}) RETURNING device_id`,
    [SYNTHETIC_CLIENT_ID],
  )
  const devices = rows.flatMap((row) => (row.device_id ? [row.device_id] : []))
  await client.query('DELETE FROM state.device WHERE device_id = ANY($1)', [devices])
  await client.query('DELETE FROM registry.device WHERE id = ANY($1)', [devices])
  const removed = await client.query('DELETE FROM registry.store WHERE client_id = $1', [SYNTHETIC_CLIENT_ID])
  await client.query('DELETE FROM registry.client WHERE id = $1', [SYNTHETIC_CLIENT_ID])
  return removed.rowCount ?? 0
}

/** Remove a rede sintética e tudo o que depende dela. */
export async function clearSyntheticNetwork(pool: pg.Pool): Promise<number> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const removed = await deleteSynthetic(client)
    await client.query('COMMIT')
    return removed
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** Grava (ou regrava) a rede sintética no "agora" da ingestão, numa única transação. */
export async function createSyntheticNetwork(pool: pg.Pool, total: number) {
  const { rows } = await pool.query<{ now: Date | null }>('SELECT max(now_ts) AS now FROM state.ingestion')
  const now = rows[0]?.now?.getTime()
  if (now === undefined) {
    throw new Error(
      'A ingestão ainda não definiu o "agora". Rode o replay (ou espere a ingestão) e tente de novo.',
    )
  }
  const stores = buildNetwork(total, now)
  const environments = stores.flatMap((store) => store.environments)
  const indicators = environments.flatMap((environment) =>
    environment.indicators.map((indicator) => ({ environment, indicator })),
  )
  // Resumo da loja como a projeção da ingestão o calcula (Projector.writeStoreSnapshots)
  const snapshots = stores.flatMap((store) => {
    const list = store.environments
    const count = (predicate: (environment: Environment) => boolean) => list.filter(predicate).length
    const status = storeStatus(list.map((environment) => environment.status))
    const openNow = count((environment) => environment.openNow)
    const nextOpenings = list.flatMap((environment) =>
      environment.nextOpenAt === null ? [] : [environment.nextOpenAt],
    )
    return PERIOD_KEYS.map((period) => {
      const ofPeriod = list.map((environment) => ({
        environment,
        indicator: environment.indicators.find((indicator) => indicator.period === period) as Indicator,
      }))
      const counts = sumCounts(ofPeriod.map(({ indicator }) => indicator.counts))
      const comfort = (item: (typeof ofPeriod)[number]) =>
        item.indicator.result.comfortPct ?? Number.POSITIVE_INFINITY
      const [worst] = ofPeriod
        .filter((item) => item.indicator.result.comfortPct !== null)
        .sort((a, b) => comfort(a) - comfort(b) || a.environment.id.localeCompare(b.environment.id))
      return {
        store,
        period,
        status,
        counts,
        result: comfortIndicator(counts),
        online: count((environment) => environment.status === 'online'),
        sensorFault: count((environment) => environment.status === 'sensor_fault'),
        offline: count((environment) => environment.status === 'offline'),
        noData: count((environment) => environment.status === 'no_data'),
        above: count((environment) => environment.situation === 'above'),
        below: count((environment) => environment.situation === 'below'),
        openNow,
        belowTarget: ofPeriod.filter(({ indicator }) => {
          const pct = indicator.result.comfortPct
          return pct !== null && pct < COMFORT_TARGET_PCT
        }).length,
        // A loja só "abre às ..." quando todos os ambientes estão fechados
        nextOpenAt: openNow > 0 || nextOpenings.length === 0 ? null : Math.min(...nextOpenings),
        worst: worst ? { id: worst.environment.id, comfortPct: worst.indicator.result.comfortPct } : null,
      }
    })
  })
  const reporting = environments.filter((environment) => environment.contactAt !== null)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await deleteSynthetic(client)
    await client.query(
      "INSERT INTO registry.client (id, name, segment) VALUES ($1, 'Rede Sintética', 'varejo')",
      [SYNTHETIC_CLIENT_ID],
    )
    await insertRows(client, 'registry.store', stores, {
      id: ['text', (store) => store.id],
      client_id: ['text', () => SYNTHETIC_CLIENT_ID],
      name: ['text', (store) => store.name],
      kind: ['text', (store) => store.kind],
      city: ['text', (store) => store.city.city],
      state_code: ['text', (store) => store.city.uf],
      latitude: ['float8', (store) => store.city.latitude],
      longitude: ['float8', (store) => store.city.longitude],
      timezone: ['text', (store) => store.city.timeZone],
      opening_hours: ['jsonb', (store) => JSON.stringify(store.hours)],
    })
    await insertRows(client, 'registry.device', environments, {
      id: ['text', (environment) => environment.deviceId],
    })
    await insertRows(client, 'registry.environment', environments, {
      id: ['text', (environment) => environment.id],
      store_id: ['text', (environment) => environment.storeId],
      name: ['text', (environment) => environment.name],
      comfort_min: ['real', (environment) => environment.range.min],
      comfort_max: ['real', (environment) => environment.range.max],
      opening_hours: ['jsonb', (environment) => JSON.stringify(environment.hours)],
      device_id: ['text', (environment) => environment.deviceId],
    })
    await insertRows(client, 'state.device', reporting, {
      device_id: ['text', (environment) => environment.deviceId],
      last_contact_at: ['timestamptz', (environment) => iso(environment.contactAt)],
      last_sample_at: ['timestamptz', (environment) => iso(environment.contactAt)],
      last_valid_at: ['timestamptz', (environment) => iso(environment.validAt)],
      last_valid_value: ['real', (environment) => environment.value],
    })
    await insertRows(client, 'state.environment_snapshot', environments, {
      environment_id: ['text', (environment) => environment.id],
      status: ['text', (environment) => environment.status],
      situation: ['text', (environment) => environment.situation],
      last_value: ['real', (environment) => environment.value],
      last_valid_at: ['timestamptz', (environment) => iso(environment.validAt)],
      last_contact_at: ['timestamptz', (environment) => iso(environment.contactAt)],
      open_now: ['boolean', (environment) => environment.openNow],
      next_open_at: ['timestamptz', (environment) => iso(environment.nextOpenAt)],
      now_ts: ['timestamptz', () => iso(now)],
    })
    await insertRows(client, 'state.environment_indicator', indicators, {
      environment_id: ['text', (row) => row.environment.id],
      period: ['text', (row) => row.indicator.period],
      from_ts: ['timestamptz', (row) => iso(row.indicator.from)],
      to_ts: ['timestamptz', (row) => iso(row.indicator.to)],
      samples_in_hours: ['int', (row) => row.indicator.counts.inHours],
      samples_within: ['int', (row) => row.indicator.counts.within],
      samples_above: ['int', (row) => row.indicator.counts.above],
      samples_below: ['int', (row) => row.indicator.counts.below],
      samples_expected: ['int', (row) => row.indicator.counts.expected],
      samples_discarded: ['int', (row) => row.indicator.discarded],
      value_avg: ['real', (row) => row.indicator.avg],
      value_min: ['real', (row) => row.indicator.min],
      value_max: ['real', (row) => row.indicator.max],
      comfort_pct: ['real', (row) => row.indicator.result.comfortPct],
      above_pct: ['real', (row) => row.indicator.result.abovePct],
      below_pct: ['real', (row) => row.indicator.result.belowPct],
      coverage_pct: ['real', (row) => row.indicator.result.coveragePct],
    })
    await insertRows(client, 'state.store_snapshot', snapshots, {
      store_id: ['text', (row) => row.store.id],
      period: ['text', (row) => row.period],
      status: ['text', (row) => row.status],
      status_rank: ['smallint', (row) => STORE_STATUS_RANK[row.status]],
      environments: ['int', (row) => row.store.environments.length],
      env_online: ['int', (row) => row.online],
      env_sensor_fault: ['int', (row) => row.sensorFault],
      env_offline: ['int', (row) => row.offline],
      env_no_data: ['int', (row) => row.noData],
      env_out_of_range: ['int', (row) => row.above + row.below],
      env_above: ['int', (row) => row.above],
      env_below: ['int', (row) => row.below],
      env_open_now: ['int', (row) => row.openNow],
      env_below_target: ['int', (row) => row.belowTarget],
      samples_in_hours: ['int', (row) => row.counts.inHours],
      samples_within: ['int', (row) => row.counts.within],
      samples_above: ['int', (row) => row.counts.above],
      samples_below: ['int', (row) => row.counts.below],
      samples_expected: ['int', (row) => row.counts.expected],
      comfort_pct: ['real', (row) => row.result.comfortPct],
      above_pct: ['real', (row) => row.result.abovePct],
      below_pct: ['real', (row) => row.result.belowPct],
      coverage_pct: ['real', (row) => row.result.coveragePct],
      next_open_at: ['timestamptz', (row) => iso(row.nextOpenAt)],
      worst_env_id: ['text', (row) => row.worst?.id ?? null],
      worst_env_comfort: ['real', (row) => row.worst?.comfortPct ?? null],
      now_ts: ['timestamptz', () => iso(now)],
    })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  return { stores: stores.length, environments: environments.length, now }
}

/** Percentil pelo método do posto mais próximo (sem interpolação). */
export function percentile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? Number.NaN
}

const SCENARIOS = [
  ['Mais graves primeiro, 7 dias', 'period=7d&sort=status'],
  ['Pior conforto, 30 dias', 'period=30d&sort=comfort'],
  ['Com problema, 1 dia', 'period=1d&sort=out_of_range&status=degraded,offline'],
  ['Busca "campinas", 7 dias', 'period=7d&search=campinas'],
  ['Página 20 por nome, 30 dias', 'period=30d&sort=name&page=20'],
] as const
const REQUESTS = 30

/** Entra na API como administrador e mede a listagem da visão da rede em cada consulta. */
export async function measureNetworkView(pool: pg.Pool, config: Config): Promise<string> {
  if (!config.DEMO_PASSWORD) {
    throw new Error('Para medir, defina DEMO_PASSWORD no .env: o comando entra na API como administrador.')
  }
  const { rows } = await pool.query<{ email: string }>(
    "SELECT email FROM registry.app_user WHERE role = 'admin_diel' ORDER BY id LIMIT 1",
  )
  const email = rows[0]?.email
  if (!email) throw new Error('Nenhum administrador no cadastro para entrar na API.')

  const api = config.API_URL.replace(/\/$/, '')
  const login = await fetch(`${api}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: config.DEMO_PASSWORD }),
  }).catch((error: Error) => {
    throw new Error(`API fora do ar em ${api} (${error.message}). Confira API_URL.`)
  })
  if (!login.ok)
    throw new Error(`A API recusou o login de ${email} (HTTP ${login.status}). Confira DEMO_PASSWORD.`)
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')

  let total = 0
  const lines: string[] = []
  for (const [label, query] of SCENARIOS) {
    const timings: number[] = []
    // A primeira requisição aquece conexões e planos e fica fora da conta
    for (let round = 0; round <= REQUESTS; round++) {
      const started = performance.now()
      const response = await fetch(`${api}/api/v1/stores?${query}`, { headers: { cookie } })
      if (!response.ok) throw new Error(`A listagem respondeu HTTP ${response.status} em ${query}`)
      const body = (await response.json()) as { total: number }
      if (round > 0) timings.push(performance.now() - started)
      if (query === SCENARIOS[0][1]) total = body.total
    }
    const ms = (value: number) => `${value.toFixed(1)} ms`.padStart(9)
    lines.push(`  ${label.padEnd(30)} ${ms(percentile(timings, 0.5))} ${ms(percentile(timings, 0.95))}`)
  }
  return [
    '',
    `Visão da rede com ${total} lojas: ${REQUESTS} requisições por consulta, entrando como ${email}`,
    `  ${'Consulta'.padEnd(30)} ${'p50'.padStart(9)} ${'p95'.padStart(9)}`,
    ...lines,
    '',
  ].join('\n')
}
