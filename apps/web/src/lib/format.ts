const number1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const integer = new Intl.NumberFormat('pt-BR')

export const NETWORK_TIME_ZONE = 'America/Sao_Paulo'

export function formatTemperature(value: number | null | undefined): string {
  return value == null ? '—' : `${number1.format(value)} °C`
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${value >= 99.95 || value === 0 ? integer.format(Math.round(value)) : number1.format(value)}%`
}

export function formatInteger(value: number): string {
  return integer.format(value)
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  if (hours >= 48) return `${number1.format(minutes / 1440)} dias`
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`
  let value = formatters.get(key)
  if (!value) {
    value = new Intl.DateTimeFormat('pt-BR', { timeZone, ...options })
    formatters.set(key, value)
  }
  return value
}

/** 10/02 23:59, no fuso da loja (ou de Brasília, na visão da rede). */
export function formatDateTime(iso: string | null | undefined, timeZone = NETWORK_TIME_ZONE): string {
  if (!iso) return '—'
  return formatter(timeZone, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  )
}

export function formatFullDateTime(iso: string | null | undefined, timeZone = NETWORK_TIME_ZONE): string {
  if (!iso) return '—'
  return formatter(timeZone, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

export function formatAxisTime(ms: number, timeZone: string, withDate: boolean): string {
  return formatter(
    timeZone,
    withDate ? { day: '2-digit', month: '2-digit' } : { hour: '2-digit', minute: '2-digit' },
  ).format(new Date(ms))
}

/** "há 4 min" em relação ao "agora" da ingestão (não ao relógio do navegador). */
export function formatAgo(iso: string | null | undefined, now: string | null | undefined): string {
  if (!iso || !now) return '—'
  const minutes = Math.max(0, (Date.parse(now) - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'agora'
  return `há ${formatDuration(minutes)}`
}
