/**
 * Contrato das respostas da API, compartilhado pela API (os DTOs implementam estas interfaces)
 * e pelo frontend. Mudou um lado sem o outro, o build quebra.
 */

export type Role = 'admin_diel' | 'gestor_cliente' | 'gerente_loja'
export type PeriodKey = '1d' | '7d' | '30d'
export type DeviceStatus = 'online' | 'sensor_fault' | 'offline' | 'no_data'
export type StoreStatus = 'online' | 'degraded' | 'offline' | 'no_data'
export type Situation = 'within' | 'above' | 'below' | 'closed' | 'unknown'
export type StoreSort = 'status' | 'comfort' | 'comfort_desc' | 'out_of_range' | 'worst_env' | 'name'
export type SeriesBucket = 'raw' | '5m' | '15m' | '1h'
export type GapKind = 'no_data' | 'discarded'
export type DiscardReason = 'sensor_error' | 'out_of_range' | 'spike' | 'stuck'

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

/** Ambiente com o pior conforto no período (loja ou rede). */
export interface WorstEnvironment {
  id: string
  name: string
  storeId: string
  storeName: string
  comfortPct: number
}

export interface EnvironmentListItem {
  id: string
  name: string
  deviceId: string | null
  status: DeviceStatus
  situation: Situation
  lastValue: number | null
  lastValidAt: string | null
  lastContactAt: string | null
  comfortRange: ComfortRange
  /** Percentuais do horário de funcionamento com leitura válida: dentro, acima e abaixo da faixa. */
  comfortPct: number | null
  abovePct: number | null
  belowPct: number | null
  coveragePct: number | null
  /** A loja está no horário de funcionamento no "agora" da ingestão. */
  openNow: boolean
  /** Próxima abertura, quando fechado agora (null se aberto ou sem horário). */
  nextOpenAt: string | null
}

export interface StoreEnvironmentCounts {
  total: number
  online: number
  sensorFault: number
  offline: number
  noData: number
  /** Ambientes abertos agora com a última leitura válida fora da faixa (above + below). */
  outOfRange: number
  above: number
  below: number
  belowTarget: number
  /** Ambientes no horário de funcionamento agora. */
  openNow: number
}

export interface StoreListItem {
  id: string
  name: string
  kind: string
  city: string
  state: string
  timezone: string
  client: ClientRef
  status: StoreStatus
  environmentCounts: StoreEnvironmentCounts
  comfortPct: number | null
  abovePct: number | null
  belowPct: number | null
  coveragePct: number | null
  /** Próxima abertura da loja, quando todos os ambientes estão fechados agora. */
  nextOpenAt: string | null
  worstEnvironment: WorstEnvironment | null
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
  above: number
  below: number
  belowTarget: number
  openNow: number
  /** Ponderado pelo tempo: soma das leituras válidas no horário de todos os ambientes. */
  comfortPct: number | null
  abovePct: number | null
  belowPct: number | null
  coveragePct: number | null
  worstEnvironment: WorstEnvironment | null
}

/**
 * Contagem de lojas por filtro, calculada com a busca e o cliente aplicados, mas ignorando os
 * filtros de status, de meta e de faixa: é o número que cada pílula de filtro mostra.
 */
export interface StoreFacets {
  status: Record<StoreStatus, number>
  /** Lojas com algum ambiente abaixo da meta de conforto no período. */
  belowTarget: number
  /** Lojas com algum ambiente aberto fora da faixa agora. */
  outOfRange: number
}

export interface StoreList {
  items: StoreListItem[]
  page: number
  pageSize: number
  total: number
  totals: NetworkTotals
  facets: StoreFacets
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
  device: DeviceStatus
  situation: Situation
  lastValue: number | null
  lastValidAt: string | null
  lastContactAt: string | null
  openNow: boolean
  nextOpenAt: string | null
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
  /** Minutos de funcionamento esperados no período (denominador da cobertura). */
  minutesExpected: number
  /** Estatísticas de todas as leituras válidas do período (24 h por dia). */
  valueAvg: number | null
  valueMin: number | null
  valueMax: number | null
  /** Estatísticas só das leituras válidas com a loja aberta (coerentes com o conforto). */
  valueAvgInHours: number | null
  valueMinInHours: number | null
  valueMaxInHours: number | null
  samplesDiscarded: number
  discarded: Discarded
  gapCount: number
  gapMinutes: number
  /** Parte das lacunas que caiu no horário de funcionamento. */
  gapCountInHours: number
  gapMinutesInHours: number
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
  kind: GapKind
  reason: DiscardReason | null
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

/**
 * Perfil semanal (heatmap hora × dia da semana) no fuso da loja, a partir dos agregados de 1 h.
 * weekday segue a ISO 8601: 1 = segunda ... 7 = domingo.
 */
export interface ProfileCell {
  weekday: number
  hour: number
  /** A loja abre nesse horário segundo o cadastro. */
  open: boolean
  /** Quantos dias do período contribuíram para a célula. */
  days: number
  minutesInHours: number
  withinPct: number | null
  abovePct: number | null
  belowPct: number | null
  valueAvg: number | null
}

export interface WeeklyProfile {
  period: Period
  timezone: string
  comfortRange: ComfortRange
  cells: ProfileCell[]
}

/** Conforto por dia, no fuso da loja. day = AAAA-MM-DD local. */
export interface DailyComfort {
  day: string
  minutesExpected: number
  minutesInHours: number
  minutesWithin: number
  minutesAbove: number
  minutesBelow: number
  comfortPct: number | null
  coveragePct: number | null
  valueAvgInHours: number | null
}

export interface DailySeries {
  period: Period
  timezone: string
  days: DailyComfort[]
}

/** Relatório de qualidade dos dados (GET /quality, só administrador). */
export interface QualityReport {
  generatedAt: string
  source: string
  packets: {
    total: number
    invalid: number
    exactDuplicates: number
    savedData: number
    late: { packets: number; withSavedData: number; maxMinutes: number; thresholdMinutes: number }
    /** Relógio adiantado além da tolerância e sem confirmação de outro dispositivo: fora da série e do "agora". */
    futureTimestamp: {
      packets: number
      toleranceMinutes: number
      devices: Array<{
        deviceId: string
        environmentId: string | null
        packets: number
        from: string
        to: string
      }>
    }
  }
  devices: {
    registered: number
    reporting: number
    unknown: Array<{ deviceId: string; packets: number; from: string; to: string }>
    reboots: number
  }
  samples: {
    total: number
    valid: number
    sensorError: number
    outOfRange: number
    spike: number
    stuck: number
    rawErrorCodes: { minus127: number; plus85: number }
  }
  stuckEpisodes: Array<{
    deviceId: string
    environmentId: string | null
    from: string
    to: string
    minutes: number
    value: number
    samples: number
  }>
  gaps: Array<{ deviceId: string; environmentId: string | null; from: string; to: string; minutes: number }>
}

/** Primeiro evento do SSE: estado atual da ingestão. */
export interface SnapshotEvent {
  type: 'snapshot'
  now: string | null
  lastSeq: number
  /** A ingestão atualizou as projeções nos últimos 10 s. */
  ingesting: boolean
}

/** A ingestão atualizou as projeções. Sem dados de loja: a interface refaz as próprias consultas. */
export interface StateUpdatedEvent {
  type: 'state_updated'
  now: string
  lastSeq: number
}

/** Corpo de erro (RFC 9457, application/problem+json). */
export interface ProblemDetails {
  type: string
  title: string
  status: number
  detail: string
  instance?: string
  requestId?: string
  errors?: Array<{ field: string; message: string }>
}
