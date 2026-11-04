import type { PeriodKey, StoreListItem } from '@celsius/contracts'
import { NETWORK_TIME_ZONE } from '../../lib/format'
import { DEVICE_STATE, SITUATION_STATE, STORE_STATE } from '../../lib/states'

/*
 * CSV da lista de lojas no formato que o Excel em pt-BR abre direto: BOM UTF-8, separador ";",
 * vírgula decimal, uma linha por ambiente e data no horário de Brasília.
 */

const SEPARATOR = ';'
const decimal = new Intl.NumberFormat('pt-BR', { useGrouping: false, maximumFractionDigits: 2 })
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: NETWORK_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

type Cell = string | number | null

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

function cell(value: Cell): string {
  if (value === null) return ''
  if (typeof value === 'number') return decimal.format(value)
  // Texto que começa com = + - @ viraria fórmula na planilha
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function storesCsv(stores: readonly StoreListItem[]): string {
  const rows: Cell[][] = [HEADER]
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
  return `﻿${rows.map((row) => row.map(cell).join(SEPARATOR)).join('\r\n')}\r\n`
}

/** "celsius360-lojas-30d-2026-02-11.csv", com a data do "agora" da ingestão. */
export function csvFileName(period: PeriodKey, now: string | null): string {
  const day = now ? new Date(now).toLocaleDateString('sv-SE', { timeZone: NETWORK_TIME_ZONE }) : 'sem-dados'
  return `celsius360-lojas-${period}-${day}.csv`
}

export function downloadFile(name: string, content: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // O navegador já copiou o blob ao iniciar o download
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
