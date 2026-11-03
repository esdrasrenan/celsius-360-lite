/**
 * Contrato das respostas da API, compartilhado pela API (os DTOs implementam estas interfaces)
 * e pelo frontend. Mudou um lado sem o outro, o build quebra.
 */

export type Role = 'admin_diel' | 'gestor_cliente' | 'gerente_loja'
export type PeriodKey = '1d' | '7d' | '30d'
export type DeviceStatus = 'online' | 'sensor_fault' | 'offline' | 'no_data'
export type StoreStatus = 'online' | 'degraded' | 'offline' | 'no_data'
export type Situation = 'within' | 'above' | 'below' | 'closed' | 'unknown'
export type StoreSort = 'status' | 'comfort' | 'comfort_desc' | 'out_of_range' | 'name'
export type SeriesBucket = 'raw' | '5m' | '15m' | '1h'

export interface SessionUser {
  id: string
  name: string
  email: string
  role: Role
  clientId: string | null
  allStores: boolean
  storeIds: string[]
}

export interface DemoUser {
  email: string
  name: string
  role: Role
  scope: string
}

export interface ComfortRange {
  min: number
  max: number
}

export interface ClientRef {
  id: string
  name: string
}

export interface ClientListItem extends ClientRef {
  stores: number
}

export interface EnvironmentListItem {
  id: string
  name: string
  status: string
  situation: string
  lastValue: number | null
  lastValidAt: string | null
  comfortRange: ComfortRange
  comfortPct: number | null
  coveragePct: number | null
}

export interface StoreEnvironmentCounts {
  total: number
  online: number
  sensorFault: number
  offline: number
  noData: number
  outOfRange: number
  belowTarget: number
}

export interface StoreListItem {
  id: string
  name: string
  kind: string
  city: string
  state: string
  client: ClientRef
  status: string
  environmentCounts: StoreEnvironmentCounts
  comfortPct: number | null
  coveragePct: number | null
  environments: EnvironmentListItem[]
}

export interface Period {
  key: PeriodKey | null
  from: string
  to: string
}

export interface NetworkTotals {
  stores: number
  environments: number
  online: number
  sensorFault: number
  offline: number
  noData: number
  outOfRange: number
  belowTarget: number
  comfortPct: number | null
}

export interface StoreList {
  items: StoreListItem[]
  page: number
  pageSize: number
  total: number
  totals: NetworkTotals
  now: string | null
  period: Period
}

export interface StoreRef {
  id: string
  name: string
  city: string
  state: string
  timezone: string
  client: ClientRef
}

export interface EnvironmentInfo {
  id: string
  name: string
  comfortRange: ComfortRange
  openingHours: Record<string, [string, string] | null>
  deviceId: string | null
}

export interface EnvironmentStatus {
  device: string
  situation: string
  lastValue: number | null
  lastValidAt: string | null
  lastContactAt: string | null
}

export interface Discarded {
  sensorError: number
  outOfRange: number
  spike: number
  stuck: number
}

export interface Indicators {
  comfortPct: number | null
  abovePct: number | null
  belowPct: number | null
  coveragePct: number | null
  minutesInHours: number
  minutesWithin: number
  minutesAbove: number
  minutesBelow: number
  valueAvg: number | null
  valueMin: number | null
  valueMax: number | null
  samplesDiscarded: number
  discarded: Discarded
  gapCount: number
  gapMinutes: number
}

export interface EnvironmentSummary {
  environment: EnvironmentInfo
  store: StoreRef
  status: EnvironmentStatus
  period: Period
  indicators: Indicators
  now: string | null
}

export interface SeriesPoint {
  t: string
  avg: number | null
  min: number | null
  max: number | null
}

export interface OutdoorPoint {
  t: string
  value: number
}

export interface Gap {
  from: string
  to: string
  kind: string
  reason: string | null
}

export interface Interval {
  from: string
  to: string
}

export interface Series {
  bucket: SeriesBucket
  from: string
  to: string
  now: string | null
  comfortRange: ComfortRange
  points: SeriesPoint[]
  outdoor: OutdoorPoint[]
  gaps: Gap[]
  openIntervals: Interval[]
}

export interface StateUpdatedEvent {
  type: 'state_updated'
  now: string
  lastSeq: number
  storeIds: string[]
}
