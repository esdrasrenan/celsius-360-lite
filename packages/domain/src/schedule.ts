export const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** Horário de funcionamento como no cadastro: ["09:00", "20:00"] por dia ou null quando fechado. */
export type OpeningHours = Record<Weekday, readonly [string, string] | null>

interface Window {
  /** Minutos desde a meia-noite local */
  start: number
  /** Pode passar de 1440 quando o expediente atravessa a meia-noite */
  end: number
}

/** Janela de cada dia da semana, indexada como Date.getUTCDay() (0 = domingo). */
export type CompiledSchedule = ReadonlyArray<Window | null>

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

function toMinutes(hhmm: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!match) throw new Error(`Horário inválido: ${hhmm}`)
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0))
    throw new Error(`Horário inválido: ${hhmm}`)
  return hours * 60 + minutes
}

export function compileSchedule(hours: OpeningHours): CompiledSchedule {
  return WEEKDAYS.map((day) => {
    const window = hours[day]
    if (!window) return null
    const start = toMinutes(window[0])
    let end = toMinutes(window[1])
    if (end === start) return null
    if (end < start) end += 1440 // ex.: 22:00 às 02:00
    return { start, end }
  })
}

// O deslocamento de um fuso só muda em transições de horário de verão, que caem em hora cheia:
// guardar um valor por fuso e hora evita chamar Intl a cada amostra.
const formatters = new Map<string, Intl.DateTimeFormat>()
const offsets = new Map<string, number>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/** Diferença, em ms, entre o horário local do fuso e UTC no instante informado. */
export function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const hour = Math.floor(utcMs / 3_600_000)
  const key = `${timeZone}|${hour}`
  const cached = offsets.get(key)
  if (cached !== undefined) return cached
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(new Date(hour * 3_600_000))
      .map((part) => [part.type, part.value]),
  )
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  const offset = local - hour * 3_600_000
  offsets.set(key, offset)
  return offset
}

/** Converte um horário local (epoch ms "como se fosse UTC") para UTC no fuso informado. */
function localToUtcMs(localMs: number, timeZone: string): number {
  const guess = localMs - timeZoneOffsetMs(localMs, timeZone)
  return localMs - timeZoneOffsetMs(guess, timeZone)
}

export function isOpenAt(schedule: CompiledSchedule, utcMs: number, timeZone: string): boolean {
  const localMs = utcMs + timeZoneOffsetMs(utcMs, timeZone)
  const minute = (localMs - Math.floor(localMs / DAY_MS) * DAY_MS) / MINUTE_MS
  const weekday = new Date(localMs).getUTCDay()
  const today = schedule[weekday]
  if (today && minute >= today.start && minute < today.end) return true
  const yesterday = schedule[(weekday + 6) % 7]
  return !!yesterday && yesterday.end > 1440 && minute < yesterday.end - 1440
}

/** Intervalos [início, fim) em UTC em que o ambiente está em funcionamento dentro de [from, to). */
export function openIntervals(
  schedule: CompiledSchedule,
  fromMs: number,
  toMs: number,
  timeZone: string,
): Array<[number, number]> {
  if (toMs <= fromMs) return []
  const intervals: Array<[number, number]> = []
  const firstLocalDay = Math.floor((fromMs + timeZoneOffsetMs(fromMs, timeZone)) / DAY_MS) - 1
  const lastLocalDay = Math.floor((toMs + timeZoneOffsetMs(toMs, timeZone)) / DAY_MS)
  for (let day = firstLocalDay; day <= lastLocalDay; day++) {
    const midnight = day * DAY_MS
    const window = schedule[new Date(midnight).getUTCDay()]
    if (!window) continue
    const start = Math.max(fromMs, localToUtcMs(midnight + window.start * MINUTE_MS, timeZone))
    const end = Math.min(toMs, localToUtcMs(midnight + window.end * MINUTE_MS, timeZone))
    if (end <= start) continue
    const previous = intervals.at(-1)
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end)
    else intervals.push([start, end])
  }
  return intervals
}

export function openDurationMs(
  schedule: CompiledSchedule,
  fromMs: number,
  toMs: number,
  timeZone: string,
): number {
  return openIntervals(schedule, fromMs, toMs, timeZone).reduce(
    (total, [start, end]) => total + end - start,
    0,
  )
}
