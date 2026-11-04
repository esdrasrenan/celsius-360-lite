/**
 * Formatação em pt-BR (seções 2.4 e 2.5). Número, unidade, duração e data passam todos por aqui.
 */

export const MISSING = '—'
export const MISSING_HINT = 'Sem leitura válida no período'
export const NBSP = ' '
const MINUS = '−'

export const NETWORK_TIME_ZONE = 'America/Sao_Paulo'
export const NETWORK_TIME_ZONE_LABEL = 'horário de Brasília'

type Instant = string | number | Date

const decimal1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const upTo1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const integer = new Intl.NumberFormat('pt-BR')
const pluralRules = new Intl.PluralRules('pt-BR')

export function formatInteger(value: number): string {
  return integer.format(value)
}

/** Uma casa decimal fixa: "24,5". */
export function formatDecimal(value: number | null | undefined): string {
  return value == null ? MISSING : decimal1.format(value)
}

export function formatTemperature(value: number | null | undefined): string {
  return value == null ? MISSING : `${decimal1.format(value)}${NBSP}°C`
}

/** Faixa com en dash e a unidade uma vez: "21–25 °C". */
export function formatRange(range: { min: number; max: number } | null | undefined): string {
  if (!range) return MISSING
  return `${upTo1.format(range.min)}–${upTo1.format(range.max)}${NBSP}°C`
}

function signed(value: number, unit: string): string {
  const rounded = Math.round(value * 10) / 10
  const sign = rounded > 0 ? '+' : rounded < 0 ? MINUS : ''
  return `${sign}${decimal1.format(Math.abs(rounded))}${NBSP}${unit}`
}

/** Desvio de temperatura com sinal tipográfico: "+1,4 °C", "−0,6 °C". */
export function formatDeviation(value: number | null | undefined): string {
  return value == null ? MISSING : signed(value, '°C')
}

/** Diferença entre percentuais, em pontos percentuais: "−3,1 p.p.". */
export function formatPointsDelta(value: number | null | undefined): string {
  return value == null ? MISSING : signed(value, 'p.p.')
}

/**
 * Percentual com uma casa, truncado para baixo: 99,97 vira "99,9%", e "100%" ou "0%" só quando o
 * valor é exato. Entre 0 e 0,1 aparece "<0,1%", para um resto pequeno não sumir.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value == null) return MISSING
  if (value === 0 || value === 100) return `${value}%`
  if (value > 0 && value < 0.1) return '<0,1%'
  // O epsilon absorve o erro de ponto flutuante (87,6 × 10 = 875,999…)
  return `${decimal1.format(Math.floor(value * 10 + 1e-9) / 10)}%`
}

/** "1 loja", "2 lojas". Em pt-BR, zero leva plural ("0 lojas"), embora o CLDR o ponha em "one". */
export function pluralWord(count: number, one: string, other: string): string {
  return count !== 0 && pluralRules.select(count) === 'one' ? one : other
}

export function plural(count: number, one: string, other: string): string {
  return `${formatInteger(count)} ${pluralWord(count, one, other)}`
}

/** Razão por extenso: "2 de 25", nunca "2/25". */
export function formatRatio(part: number, total: number): string {
  return `${formatInteger(part)} de ${formatInteger(total)}`
}

/**
 * Duração a partir de minutos. O total é arredondado antes da divisão (nunca "1 h 60 min").
 * Até 48 h: "35 min" ou "16 h 35 min". Acima disso, "hours" (tempo de expediente) fica em horas,
 * "58 h", e "calendar" (lacuna corrida) passa a dias, "2 d 4 h".
 */
export function formatDuration(
  minutes: number | null | undefined,
  mode: 'hours' | 'calendar' = 'hours',
): string {
  if (minutes == null || !Number.isFinite(minutes)) return MISSING
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (total <= 48 * 60) return rest ? `${hours} h ${rest} min` : `${hours} h`
  if (mode === 'hours') return `${Math.round(total / 60)} h`
  const days = Math.floor(total / 1440)
  const dayHours = Math.round((total % 1440) / 60)
  return dayHours ? `${days} d ${dayHours} h` : `${days} d`
}

/* ---------------------------------------------------------------------------------------------
   Datas e horas no fuso da loja (ou de Brasília na visão da rede). Relógio de 24 h, sem o ponto
   que o Intl põe nas abreviações ("qua.", "fev.").
   --------------------------------------------------------------------------------------------- */

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`
  let value = formatters.get(key)
  if (!value) {
    value = new Intl.DateTimeFormat('pt-BR', { timeZone, hourCycle: 'h23', ...options })
    formatters.set(key, value)
  }
  return value
}

function toMs(value: Instant): number {
  return typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : value.getTime()
}

interface LocalParts {
  weekday: string
  day: string
  month: string
  year: string
  hour: string
  minute: string
}

function localParts(value: Instant, timeZone: string): LocalParts {
  const parts = formatter(timeZone, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(toMs(value))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    weekday: get('weekday').replace('.', ''),
    day: get('day'),
    month: get('month'),
    year: get('year'),
    hour: get('hour'),
    minute: get('minute'),
  }
}

const dayMonth = (p: LocalParts) => `${p.day}/${p.month}`
const clock = (p: LocalParts) => `${p.hour}:${p.minute}`

/** Lista: "10/02 23:59". */
export function formatDateTime(value: Instant | null | undefined, timeZone = NETWORK_TIME_ZONE): string {
  if (value == null) return MISSING
  const p = localParts(value, timeZone)
  return `${dayMonth(p)} ${clock(p)}`
}

/** Só a hora: "23:59". */
export function formatTime(value: Instant | null | undefined, timeZone = NETWORK_TIME_ZONE): string {
  return value == null ? MISSING : clock(localParts(value, timeZone))
}

/** Cabeçalho do tooltip, com o intervalo do bucket: "sex, 30/01 · 22:00–23:00". */
export function formatBucketHeader(from: Instant, to: Instant | null, timeZone: string): string {
  const start = localParts(from, timeZone)
  const head = `${start.weekday}, ${dayMonth(start)} · ${clock(start)}`
  return to == null || toMs(to) === toMs(from) ? head : `${head}–${clock(localParts(to, timeZone))}`
}

/** Intervalo do período: "12/01 00:00 – 11/02 00:00"; o ano só aparece se o intervalo cruza o ano. */
export function formatPeriod(from: Instant, to: Instant, timeZone: string): string {
  const a = localParts(from, timeZone)
  const b = localParts(to, timeZone)
  const date = (p: LocalParts) => (a.year === b.year ? dayMonth(p) : `${dayMonth(p)}/${p.year}`)
  return `${date(a)} ${clock(a)} – ${date(b)} ${clock(b)}`
}

export function isLocalMidnight(value: Instant, timeZone: string): boolean {
  const p = localParts(value, timeZone)
  return p.hour === '00' && p.minute === '00'
}

/**
 * Rótulo do eixo X no fuso da loja. 24 horas: "15h", e na meia-noite "qua 11/02" (em peso 600,
 * por conta de quem desenha). 7 dias: "qua 05/02". 30 dias: "05/02".
 */
export function formatAxisTick(value: Instant, timeZone: string, period: '1d' | '7d' | '30d'): string {
  const p = localParts(value, timeZone)
  if (period === '30d') return dayMonth(p)
  if (period === '1d' && !(p.hour === '00' && p.minute === '00')) return `${Number(p.hour)}h`
  return `${p.weekday} ${dayMonth(p)}`
}

/** Forma longa, só na dica do chip ao vivo: "10 de fev de 2026, 23:59". */
export function formatLongDateTime(value: Instant | null | undefined, timeZone = NETWORK_TIME_ZONE): string {
  if (value == null) return MISSING
  const p = localParts(value, timeZone)
  const month = formatter(timeZone, { month: 'short' }).format(toMs(value)).replace('.', '')
  return `${Number(p.day)} de ${month} de ${p.year}, ${clock(p)}`
}

/**
 * Relativo ao "agora" da ingestão, não ao relógio do navegador: "há 6 min" até 59 min, "há 3 h"
 * até 24 h e, depois disso, a data absoluta.
 */
export function formatAgo(
  value: Instant | null | undefined,
  now: Instant | null | undefined,
  timeZone = NETWORK_TIME_ZONE,
): string {
  if (value == null || now == null) return MISSING
  const minutes = Math.max(0, Math.round((toMs(now) - toMs(value)) / 60_000))
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  if (minutes < 24 * 60) return `há ${Math.floor(minutes / 60)} h`
  return formatDateTime(value, timeZone)
}

/** Próxima abertura: "abre 10:00" em até 24 h, "abre seg 10:00" depois disso. */
export function formatNextOpen(
  nextOpenAt: Instant | null | undefined,
  now: Instant | null | undefined,
  timeZone: string,
): string | null {
  if (nextOpenAt == null) return null
  const p = localParts(nextOpenAt, timeZone)
  const soon = now != null && toMs(nextOpenAt) - toMs(now) <= 24 * 3_600_000
  return soon ? `abre ${clock(p)}` : `abre ${p.weekday} ${clock(p)}`
}

const CITY: Record<string, string> = {
  'America/Sao_Paulo': 'São Paulo',
  'America/Belem': 'Belém',
  'America/Maceio': 'Maceió',
  'America/Cuiaba': 'Cuiabá',
  'America/Araguaina': 'Araguaína',
  'America/Santarem': 'Santarém',
  'America/Bahia': 'Salvador',
  'America/Noronha': 'Fernando de Noronha',
}

/** "horário de Recife (UTC−3)", a partir do fuso da loja. */
export function formatTimeZoneLabel(timeZone: string, at: Instant = Date.now()): string {
  const city = CITY[timeZone] ?? timeZone.split('/').at(-1)?.replaceAll('_', ' ') ?? timeZone
  const offset =
    formatter(timeZone, { timeZoneName: 'shortOffset' })
      .formatToParts(toMs(at))
      .find((part) => part.type === 'timeZoneName')?.value ?? ''
  const utc = offset
    .replace('GMT', 'UTC')
    .replace('-', MINUS)
    .replace(/^UTC\+0$/, 'UTC')
  return `horário de ${city} (${utc})`
}

const WEEK: Array<[key: string, label: string]> = [
  ['seg', 'Seg'],
  ['ter', 'Ter'],
  ['qua', 'Qua'],
  ['qui', 'Qui'],
  ['sex', 'Sex'],
  ['sab', 'Sáb'],
  ['dom', 'Dom'],
]

/** Horário de funcionamento agrupado: "Seg–Sáb 10:00–22:00 · Dom 14:00–20:00". */
export function formatOpeningHours(
  hours: Record<string, readonly [string, string] | null | undefined>,
): string {
  const groups: Array<{ from: string; to: string; value: string }> = []
  for (const [key, label] of WEEK) {
    const day = hours[key]
    const value = day ? `${day[0]}–${day[1]}` : 'fechada'
    const last = groups.at(-1)
    if (last && last.value === value) last.to = label
    else groups.push({ from: label, to: label, value })
  }
  if (groups.every((group) => group.value === 'fechada')) return 'Sem horário cadastrado'
  return groups
    .map((group) => `${group.from === group.to ? group.from : `${group.from}–${group.to}`} ${group.value}`)
    .join(' · ')
}
