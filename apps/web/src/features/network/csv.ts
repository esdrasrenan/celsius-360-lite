import type { PeriodKey, StoreListItem } from '@celsius/contracts'
import { type CsvValue, toCsv } from '../../lib/csv'
import { NETWORK_TIME_ZONE } from '../../lib/format'
import { DEVICE_STATE, SITUATION_STATE, STORE_STATE } from '../../lib/states'

/*
 * CSV da lista de lojas no formato que o Excel em pt-BR abre direto (lib/csv.ts): uma linha por
 * ambiente e data no horário de Brasília.
 */

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: NETWORK_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const HEADER = [
  'Código da loja',
  'Loja',
  'Cliente',
  'Cidade',
  'UF',
  'Tipo',
  'Telemetria da loja',
  'Código do ambiente',
  'Ambiente',
  'Dispositivo',
  'Telemetria do ambiente',
  'Situação agora',
  'Última leitura (°C)',
  'Última leitura válida (horário de Brasília)',
  'Faixa mínima (°C)',
  'Faixa máxima (°C)',
  'Conforto no período (%)',
  'Abaixo da faixa (%)',
  'Acima da faixa (%)',
  'Cobertura (%)',
]

export function storesCsv(stores: readonly StoreListItem[]): string {
  const rows: CsvValue[][] = [HEADER]
  for (const store of stores) {
    for (const environment of store.environments) {
      rows.push([
        store.id,
        store.name,
        store.client.name,
        store.city,
        store.state,
        store.kind,
        STORE_STATE[store.status].label,
        environment.id,
        environment.name,
        environment.deviceId,
        DEVICE_STATE[environment.status].label,
        SITUATION_STATE[environment.situation].label,
        environment.lastValue,
        environment.lastValidAt
          ? dateTime.format(Date.parse(environment.lastValidAt)).replace(', ', ' ')
          : null,
        environment.comfortRange.min,
        environment.comfortRange.max,
        environment.comfortPct,
        environment.belowPct,
        environment.abovePct,
        environment.coveragePct,
      ])
    }
  }
  return toCsv(rows)
}

/** "celsius360-lojas-30d-2026-02-11.csv", com a data do "agora" da ingestão. */
export function csvFileName(period: PeriodKey, now: string | null): string {
  const day = now ? new Date(now).toLocaleDateString('sv-SE', { timeZone: NETWORK_TIME_ZONE }) : 'sem-dados'
  return `celsius360-lojas-${period}-${day}.csv`
}
