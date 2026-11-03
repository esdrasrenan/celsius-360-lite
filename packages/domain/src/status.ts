import { type ComfortRange, comfortLevel } from './comfort'

/**
 * Pacotes chegam a cada 6 minutos (12 amostras de 30 s). Sem contato por 15 minutos,
 * ou seja, dois pacotes perdidos e uma margem, o dispositivo passa a offline.
 */
export const ONLINE_WINDOW_MS = 15 * 60_000

/**
 * - online: comunicou nos últimos 15 min e tem leitura válida nesse intervalo
 * - sensor_fault: comunica, mas as leituras recentes são inválidas (erro do sensor ou sensor travado)
 * - offline: sem comunicação há mais de 15 min
 * - no_data: nunca comunicou
 */
export type DeviceStatus = 'online' | 'sensor_fault' | 'offline' | 'no_data'

export interface DeviceState {
  lastContactAt: number | null
  lastValidAt: number | null
}

export function deviceStatus(state: DeviceState | null, now: number): DeviceStatus {
  if (!state || state.lastContactAt === null) return 'no_data'
  if (now - state.lastContactAt > ONLINE_WINDOW_MS) return 'offline'
  if (state.lastValidAt === null || now - state.lastValidAt > ONLINE_WINDOW_MS) return 'sensor_fault'
  return 'online'
}

/**
 * Situação do ambiente agora em relação à faixa de conforto.
 * Fora do horário de funcionamento a faixa não se aplica ("closed").
 */
export type Situation = 'within' | 'above' | 'below' | 'closed' | 'unknown'

export function situationNow(input: {
  status: DeviceStatus
  lastValue: number | null
  range: ComfortRange
  openNow: boolean
}): Situation {
  if (input.status !== 'online' || input.lastValue === null) return 'unknown'
  if (!input.openNow) return 'closed'
  const level = comfortLevel(input.lastValue, input.range)
  return level === 0 ? 'within' : level > 0 ? 'above' : 'below'
}

/**
 * - online: todos os ambientes online
 * - degraded: parte dos ambientes offline, sem dados ou com falha de sensor
 * - offline: nenhum ambiente comunicando
 * - no_data: nenhum ambiente jamais comunicou
 */
export type StoreStatus = 'online' | 'degraded' | 'offline' | 'no_data'

/** Gravidade para ordenação: o que pede ação primeiro. */
export const STORE_STATUS_RANK: Record<StoreStatus, number> = {
  offline: 3,
  degraded: 2,
  no_data: 1,
  online: 0,
}

export function storeStatus(environments: readonly DeviceStatus[]): StoreStatus {
  if (environments.length === 0 || environments.every((status) => status === 'no_data')) return 'no_data'
  if (environments.every((status) => status === 'offline' || status === 'no_data')) return 'offline'
  if (environments.some((status) => status !== 'online')) return 'degraded'
  return 'online'
}
