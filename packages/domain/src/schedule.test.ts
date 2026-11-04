import { describe, expect, test } from 'bun:test'
import {
  compileSchedule,
  isOpenAt,
  localDays,
  nextOpenAt,
  type OpeningHours,
  openDurationMs,
  openIntervals,
  opensDuringHour,
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

describe('nextOpenAt', () => {
  const schedule = compileSchedule(store)

  test('fechado à noite: abre no dia seguinte, no horário local', () => {
    // terça, 13/01/2026, 23:59 local
    expect(nextOpenAt(schedule, at('2026-01-14T02:59:00Z'), SP)).toBe(at('2026-01-14T12:00:00Z'))
  })

  test('aberto agora não tem próxima abertura', () => {
    expect(nextOpenAt(schedule, at('2026-01-12T15:00:00Z'), SP)).toBeNull()
  })

  test('domingo fechado: depois do sábado, a próxima abertura é segunda', () => {
    // sábado, 17/01/2026, 18:30 local (fecha às 18:00)
    expect(nextOpenAt(schedule, at('2026-01-17T21:30:00Z'), SP)).toBe(at('2026-01-19T12:00:00Z'))
  })

  test('expediente que passa da meia-noite: fechado na madrugada, reabre na noite seguinte', () => {
    const night = compileSchedule({ ...store, sex: ['22:00', '02:00'], sab: ['22:00', '02:00'] })
    // sábado, 17/01/2026, 01:00 local: ainda no turno de sexta
    expect(nextOpenAt(night, at('2026-01-17T04:00:00Z'), SP)).toBeNull()
    // sábado, 03:00 local: o turno de sexta acabou às 02:00; o de sábado começa às 22:00
    expect(nextOpenAt(night, at('2026-01-17T06:00:00Z'), SP)).toBe(at('2026-01-18T01:00:00Z'))
  })

  test('24:00 todos os dias: sempre aberto', () => {
    expect(nextOpenAt(compileSchedule(allDay), at('2026-01-13T02:59:59Z'), SP)).toBeNull()
  })

  test('sem nenhum dia de funcionamento não há próxima abertura', () => {
    const closed = compileSchedule({
      ...store,
      seg: null,
      ter: null,
      qua: null,
      qui: null,
      sex: null,
      sab: null,
    })
    expect(nextOpenAt(closed, at('2026-01-12T15:00:00Z'), SP)).toBeNull()
  })
})

describe('opensDuringHour', () => {
  test('marca as horas que o expediente toca, inclusive a sobra da véspera', () => {
    const schedule = compileSchedule({ ...store, sex: ['22:00', '02:00'], sab: ['09:30', '18:00'] })
    const monday = 1
    const saturday = 6
    expect(opensDuringHour(schedule, monday, 8)).toBe(false)
    expect(opensDuringHour(schedule, monday, 9)).toBe(true)
    expect(opensDuringHour(schedule, monday, 19)).toBe(true)
    expect(opensDuringHour(schedule, monday, 20)).toBe(false)
    // turno de sexta vai até 02:00 de sábado; meia hora de 09:30 já conta a hora
    expect(opensDuringHour(schedule, saturday, 1)).toBe(true)
    expect(opensDuringHour(schedule, saturday, 2)).toBe(false)
    expect(opensDuringHour(schedule, saturday, 9)).toBe(true)
    expect(opensDuringHour(schedule, 0, 12)).toBe(false)
  })
})

describe('localDays', () => {
  test('quebra o intervalo nos dias do fuso da loja e recorta as pontas', () => {
    expect(localDays(at('2026-01-12T15:00:00Z'), at('2026-01-14T06:00:00Z'), SP)).toEqual([
      { day: '2026-01-12', from: at('2026-01-12T15:00:00Z'), to: at('2026-01-13T03:00:00Z') },
      { day: '2026-01-13', from: at('2026-01-13T03:00:00Z'), to: at('2026-01-14T03:00:00Z') },
      { day: '2026-01-14', from: at('2026-01-14T03:00:00Z'), to: at('2026-01-14T06:00:00Z') },
    ])
  })

  test('o mesmo instante cai em dias diferentes conforme o fuso', () => {
    expect(localDays(at('2026-01-12T01:00:00Z'), at('2026-01-12T02:00:00Z'), SP)[0]?.day).toBe('2026-01-11')
    expect(localDays(at('2026-01-12T01:00:00Z'), at('2026-01-12T02:00:00Z'), 'UTC')[0]?.day).toBe(
      '2026-01-12',
    )
  })
})
