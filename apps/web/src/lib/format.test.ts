import { describe, expect, test } from 'bun:test'
import { buildPath } from '../api/client'
import {
  formatAgo,
  formatAxisTick,
  formatBucketHeader,
  formatDateTime,
  formatDeviation,
  formatDuration,
  formatLongDateTime,
  formatNextOpen,
  formatOpeningHours,
  formatPercent,
  formatPeriod,
  formatPointsDelta,
  formatRange,
  formatRatio,
  formatTemperature,
  formatTimeZoneLabel,
  plural,
} from './format'

const SP = 'America/Sao_Paulo'
const NBSP = ' '

describe('números e unidades (seção 2.4)', () => {
  test('temperatura com uma casa e NBSP antes de °C; ausência vira travessão, nunca 0', () => {
    expect(formatTemperature(24.5)).toBe(`24,5${NBSP}°C`)
    expect(formatTemperature(22.75)).toBe(`22,8${NBSP}°C`)
    expect(formatTemperature(0)).toBe(`0,0${NBSP}°C`)
    expect(formatTemperature(null)).toBe('—')
  })

  test('faixa com en dash e a unidade uma vez', () => {
    expect(formatRange({ min: 21, max: 25 })).toBe(`21–25${NBSP}°C`)
    expect(formatRange({ min: 18.5, max: 22 })).toBe(`18,5–22${NBSP}°C`)
  })

  test('desvio e diferença de percentuais com sinal tipográfico (U+2212)', () => {
    expect(formatDeviation(1.4)).toBe(`+1,4${NBSP}°C`)
    expect(formatDeviation(-0.6)).toBe(`−0,6${NBSP}°C`)
    expect(formatDeviation(0.04)).toBe(`0,0${NBSP}°C`)
    expect(formatPointsDelta(-3.1)).toBe(`−3,1${NBSP}p.p.`)
    expect(formatPointsDelta(2.1)).toBe(`+2,1${NBSP}p.p.`)
  })

  test('percentual truncado para baixo: 100% e 0% só quando exatos', () => {
    expect(formatPercent(99.95)).toBe('99,9%')
    expect(formatPercent(99.99)).toBe('99,9%')
    expect(formatPercent(100)).toBe('100%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.04)).toBe('<0,1%')
    expect(formatPercent(0.1)).toBe('0,1%')
    expect(formatPercent(87.64)).toBe('87,6%')
    expect(formatPercent(87.6)).toBe('87,6%')
    expect(formatPercent(50)).toBe('50,0%')
    expect(formatPercent(null)).toBe('—')
  })

  test('plural com Intl.PluralRules e milhar com ponto', () => {
    expect(plural(1, 'loja', 'lojas')).toBe('1 loja')
    expect(plural(2, 'loja', 'lojas')).toBe('2 lojas')
    expect(plural(0, 'loja', 'lojas')).toBe('0 lojas')
    expect(plural(1, 'ambiente', 'ambientes')).toBe('1 ambiente')
    expect(plural(1307, 'leitura', 'leituras')).toBe('1.307 leituras')
    expect(formatRatio(2, 25)).toBe('2 de 25')
  })

  test('duração arredonda o total antes de dividir (nunca "1 h 60 min")', () => {
    expect(formatDuration(119.5)).toBe('2 h')
    expect(formatDuration(59.5)).toBe('1 h')
    expect(formatDuration(35)).toBe('35 min')
    expect(formatDuration(995)).toBe('16 h 35 min')
    expect(formatDuration(2879.5)).toBe('48 h')
    expect(formatDuration(null)).toBe('—')
  })

  test('acima de 48 h: expediente em horas, nunca em dias; lacuna corrida em dias', () => {
    expect(formatDuration(58 * 60)).toBe('58 h')
    expect(formatDuration(3 * 1440)).toBe('72 h')
    expect(formatDuration(52 * 60, 'calendar')).toBe('2 d 4 h')
    expect(formatDuration(3 * 1440, 'calendar')).toBe('3 d')
    expect(formatDuration(995, 'calendar')).toBe('16 h 35 min')
  })
})

describe('datas no fuso (seção 2.5)', () => {
  test('lista: dia/mês e hora, sem vírgula', () => {
    expect(formatDateTime('2026-02-11T02:59:56Z', SP)).toBe('10/02 23:59')
    expect(formatDateTime(null)).toBe('—')
  })

  test('cabeçalho do tooltip com o intervalo do bucket e o dia da semana sem ponto', () => {
    expect(formatBucketHeader('2026-01-31T01:00:00Z', '2026-01-31T02:00:00Z', 'America/Recife')).toBe(
      'sex, 30/01 · 22:00–23:00',
    )
    expect(formatBucketHeader('2026-01-31T01:00:00Z', null, 'America/Recife')).toBe('sex, 30/01 · 22:00')
  })

  test('intervalo do período; o ano só quando cruza o ano', () => {
    expect(formatPeriod('2026-01-12T03:00:00Z', '2026-02-11T03:00:00Z', SP)).toBe('12/01 00:00 – 11/02 00:00')
    expect(formatPeriod('2025-12-28T03:00:00Z', '2026-01-04T03:00:00Z', SP)).toBe(
      '28/12/2025 00:00 – 04/01/2026 00:00',
    )
  })

  test('eixos de 24 h, 7 dias e 30 dias no fuso da loja', () => {
    expect(formatAxisTick('2026-02-10T18:00:00Z', SP, '1d')).toBe('15h')
    expect(formatAxisTick('2026-02-11T03:00:00Z', SP, '1d')).toBe('qua 11/02')
    expect(formatAxisTick('2026-02-05T03:00:00Z', SP, '7d')).toBe('qui 05/02')
    expect(formatAxisTick('2026-02-05T03:00:00Z', SP, '30d')).toBe('05/02')
    // O mesmo instante cai em dias diferentes conforme o fuso da loja
    expect(formatAxisTick('2026-02-04T16:00:00Z', 'Asia/Tokyo', '7d')).toBe('qui 05/02')
    expect(formatAxisTick('2026-02-04T16:00:00Z', SP, '7d')).toBe('qua 04/02')
  })

  test('forma longa sem o ponto da abreviação', () => {
    expect(formatLongDateTime('2026-02-11T02:59:00Z', SP)).toBe('10 de fev de 2026, 23:59')
  })

  test('relativo ao "agora" da ingestão', () => {
    const now = '2026-02-11T02:59:56Z'
    expect(formatAgo('2026-02-11T02:54:21Z', now)).toBe('há 6 min')
    expect(formatAgo('2026-02-11T02:59:40Z', now)).toBe('agora')
    expect(formatAgo('2026-02-10T23:30:00Z', now)).toBe('há 3 h')
    expect(formatAgo('2026-02-09T02:59:00Z', now, SP)).toBe('08/02 23:59')
  })

  test('próxima abertura: "abre 10:00" em até 24 h e com o dia depois disso', () => {
    expect(formatNextOpen('2026-02-11T13:00:00Z', '2026-02-11T02:59:00Z', SP)).toBe('abre 10:00')
    // Sábado 23:59 → segunda 10:00
    expect(formatNextOpen('2026-02-09T13:00:00Z', '2026-02-08T02:59:00Z', SP)).toBe('abre seg 10:00')
    expect(formatNextOpen(null, '2026-02-08T02:59:00Z', SP)).toBeNull()
  })

  test('nome do fuso com a cidade e o deslocamento', () => {
    expect(formatTimeZoneLabel('America/Recife', '2026-02-10T12:00:00Z')).toBe('horário de Recife (UTC−3)')
    expect(formatTimeZoneLabel(SP, '2026-02-10T12:00:00Z')).toBe('horário de São Paulo (UTC−3)')
    expect(formatTimeZoneLabel('Asia/Kolkata', '2026-02-10T12:00:00Z')).toBe('horário de Kolkata (UTC+5:30)')
  })

  test('horário de funcionamento agrupado por dias iguais', () => {
    const week = { seg: ['10:00', '22:00'], ter: ['10:00', '22:00'], qua: ['10:00', '22:00'] } as const
    expect(
      formatOpeningHours({
        ...week,
        qui: ['10:00', '22:00'],
        sex: ['10:00', '22:00'],
        sab: ['10:00', '22:00'],
        dom: ['14:00', '20:00'],
      }),
    ).toBe('Seg–Sáb 10:00–22:00 · Dom 14:00–20:00')
    expect(formatOpeningHours({ ...week, qui: null, sex: null, sab: null, dom: null })).toBe(
      'Seg–Qua 10:00–22:00 · Qui–Dom fechada',
    )
  })
})

describe('buildPath', () => {
  test('ignora vazios e junta listas por vírgula', () => {
    expect(buildPath('/stores', { period: '7d', search: '', status: ['online', 'degraded'], page: 2 })).toBe(
      '/api/v1/stores?period=7d&status=online%2Cdegraded&page=2',
    )
  })
})
