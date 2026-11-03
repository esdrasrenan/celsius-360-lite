import { describe, expect, test } from 'bun:test'
import {
  compileSchedule,
  isOpenAt,
  type OpeningHours,
  openDurationMs,
  openIntervals,
  timeZoneOffsetMs,
} from './schedule'

const SP = 'America/Sao_Paulo'
const at = (iso: string) => Date.parse(iso)
const hour = 3_600_000

const store: OpeningHours = {
  seg: ['09:00', '20:00'],
  ter: ['09:00', '20:00'],
  qua: ['09:00', '20:00'],
  qui: ['09:00', '20:00'],
  sex: ['09:00', '20:00'],
  sab: ['09:00', '18:00'],
  dom: null,
}

const allDay: OpeningHours = {
  seg: ['00:00', '24:00'],
  ter: ['00:00', '24:00'],
  qua: ['00:00', '24:00'],
  qui: ['00:00', '24:00'],
  sex: ['00:00', '24:00'],
  sab: ['00:00', '24:00'],
  dom: ['00:00', '24:00'],
}

describe('timeZoneOffsetMs', () => {
  test('Brasil sem horário de verão: São Paulo e Recife em UTC-3', () => {
    expect(timeZoneOffsetMs(at('2026-01-12T12:00:00Z'), SP)).toBe(-3 * hour)
    expect(timeZoneOffsetMs(at('2026-01-12T12:00:00Z'), 'America/Recife')).toBe(-3 * hour)
  })

  test('respeita horário de verão onde existe', () => {
    expect(timeZoneOffsetMs(at('2026-07-01T12:00:00Z'), 'Europe/Lisbon')).toBe(1 * hour)
    expect(timeZoneOffsetMs(at('2026-01-12T12:00:00Z'), 'Europe/Lisbon')).toBe(0)
  })
})

describe('isOpenAt', () => {
  const schedule = compileSchedule(store)

  test('usa o horário local da loja, não o UTC', () => {
    // segunda, 12/01/2026: 09:00 local = 12:00 UTC
    expect(isOpenAt(schedule, at('2026-01-12T11:59:00Z'), SP)).toBe(false)
    expect(isOpenAt(schedule, at('2026-01-12T12:00:00Z'), SP)).toBe(true)
    // 20:00 local fecha (fim exclusivo)
    expect(isOpenAt(schedule, at('2026-01-12T22:59:59Z'), SP)).toBe(true)
    expect(isOpenAt(schedule, at('2026-01-12T23:00:00Z'), SP)).toBe(false)
  })

  test('dia sem horário fica fechado o dia todo', () => {
    // domingo, 18/01/2026, 15:00 local
    expect(isOpenAt(schedule, at('2026-01-18T18:00:00Z'), SP)).toBe(false)
  })

  test('24:00 cobre o dia inteiro', () => {
    const cpd = compileSchedule(allDay)
    expect(isOpenAt(cpd, at('2026-01-13T02:59:59Z'), SP)).toBe(true)
    expect(isOpenAt(cpd, at('2026-01-13T03:00:00Z'), SP)).toBe(true)
  })

  test('expediente que atravessa a meia-noite continua no dia seguinte', () => {
    const night = compileSchedule({ ...store, sex: ['22:00', '02:00'], sab: null })
    // sábado, 17/01/2026, 01:00 local: ainda é o turno de sexta
    expect(isOpenAt(night, at('2026-01-17T04:00:00Z'), SP)).toBe(true)
    expect(isOpenAt(night, at('2026-01-17T05:30:00Z'), SP)).toBe(false)
  })

  test('rejeita horário malformado no cadastro', () => {
    expect(() => compileSchedule({ ...store, seg: ['9h', '20:00'] })).toThrow()
    expect(() => compileSchedule({ ...store, seg: ['09:00', '24:30'] })).toThrow()
  })
})

describe('openIntervals e openDurationMs', () => {
  test('uma semana de loja de rua soma 64 horas', () => {
    const schedule = compileSchedule(store)
    // de segunda 12/01 00:00 local a segunda 19/01 00:00 local
    expect(openDurationMs(schedule, at('2026-01-12T03:00:00Z'), at('2026-01-19T03:00:00Z'), SP)).toBe(
      64 * hour,
    )
  })

  test('recorta os intervalos nas bordas pedidas', () => {
    const schedule = compileSchedule(store)
    const intervals = openIntervals(schedule, at('2026-01-12T15:00:00Z'), at('2026-01-12T16:00:00Z'), SP)
    expect(intervals).toEqual([[at('2026-01-12T15:00:00Z'), at('2026-01-12T16:00:00Z')]])
  })

  test('dias inteiros consecutivos viram um intervalo só', () => {
    const schedule = compileSchedule(allDay)
    const intervals = openIntervals(schedule, at('2026-01-12T03:00:00Z'), at('2026-01-15T03:00:00Z'), SP)
    expect(intervals).toEqual([[at('2026-01-12T03:00:00Z'), at('2026-01-15T03:00:00Z')]])
  })
})
