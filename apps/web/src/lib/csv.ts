/*
 * CSV no formato que o Excel em pt-BR abre direto: BOM UTF-8, separador ";", vírgula decimal sem
 * separador de milhar e texto que viraria fórmula neutralizado. Único escritor das exportações.
 */

export type CsvValue = string | number | null | undefined

const SEPARATOR = ';'
const decimal = new Intl.NumberFormat('pt-BR', { useGrouping: false, maximumFractionDigits: 2 })

export function csvCell(value: CsvValue): string {
  if (value == null) return ''
  // Número nunca é fórmula: "-12,5" sai sem apóstrofo
  if (typeof value === 'number') return decimal.format(value)
  // Texto que começa com = + - @, tabulação ou retorno a planilha avaliaria, mesmo entre aspas
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** Uma linha por array, a primeira com os cabeçalhos. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<CsvValue>>): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(SEPARATOR)).join('\r\n')}\r\n`
}

export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  // O navegador já copiou o blob ao iniciar o download
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
