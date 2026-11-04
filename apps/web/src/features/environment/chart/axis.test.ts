import { afterEach, describe, expect, test } from 'bun:test'
import { formatAxisTick } from '../../../lib/format'
import { axisTicks, DAY_MS, formatTick, formatWindow, HOUR_MS, localTicks, yScale } from './axis'

const SP = 'America/Sao_Paulo'
/** 04/02 00:00 em São Paulo; 7 dias até 11/02 00:00 (o período de 7 dias do conjunto real). */
const WEEK_FROM = Date.parse('2026-02-04T03:00:00Z')
const WEEK_TO = WEEK_FROM + 7 * DAY_MS
const originalTz = process.env.TZ

describe('eixo X no fuso da loja (seção 5.4, achado 46)', () => {
  afterEach(() => {
    process.env.TZ = originalTz
  })

  test('meias-noites da loja, iguais com qualquer fuso do navegador', () => {
    const results = ['America/Sao_Paulo', 'UTC', 'Asia/Tokyo'].map((zone) => {
      process.env.TZ = zone
      return localTicks(WEEK_FROM, WEEK_TO, SP, 24)
    })
    expect(results[1]).toEqual(results[0] as number[])
    expect(results[2]).toEqual(results[0] as number[])
    // 03:00Z é meia-noite em UTC−3; o fim do período fica de fora
    expect(results[0]?.map((t) => new Date(t).toISOString().slice(11, 16))).toEqual(Array(7).fill('03:00'))
    const labels = results[0]?.map((t) => formatAxisTick(t, SP, '7d'))
    expect(labels?.[0]).toBe('qua 04/02')
    expect(labels?.at(-1)).toBe('ter 10/02')
  })

  test('fuso de meia hora: as marcas caem na hora cheia local', () => {
    const ticks = localTicks(
      Date.parse('2026-02-04T00:00:00Z'),
      Date.parse('2026-02-05T00:00:00Z'),
      'Asia/Kolkata',
      6,
    )
    expect(ticks.map((t) => new Date(t).toISOString().slice(11, 16))).toEqual([
      '00:30',
      '06:30',
      '12:30',
      '18:30',
    ])
  })

  test('24 horas: horas a cada 3 h e a meia-noite em negrito', () => {
    const from = Date.parse('2026-02-10T03:00:00Z')
    const ticks = axisTicks(from, from + DAY_MS, SP, 1050)
    expect(ticks.format).toBe('hour')
    expect(ticks.labels).toHaveLength(8)
    expect(formatTick(ticks.labels[0] as number, SP, 'hour')).toBe('{strong|ter 10/02}')
    expect(formatTick(ticks.labels[5] as number, SP, 'hour')).toBe('15h')
    // Plot estreito: a cada 6 h
    expect(axisTicks(from, from + DAY_MS, SP, 206).labels).toHaveLength(4)
  })

  test('7 dias: um rótulo por dia com o dia da semana e marca menor ao meio-dia', () => {
    const ticks = axisTicks(WEEK_FROM, WEEK_TO, SP, 1050)
    expect(ticks.format).toBe('weekday')
    expect(ticks.labels).toHaveLength(7)
    expect(ticks.ticks).toHaveLength(14)
    expect(ticks.midnights).toEqual(ticks.labels)
  })

  test('30 dias: de n em n dias contando do fim, então a última data sempre aparece', () => {
    const to = WEEK_TO
    const from = to - 30 * DAY_MS
    const ticks = axisTicks(from, to, SP, 1054)
    expect(ticks.format).toBe('date')
    // floor(1054 / 72) = 14 rótulos cabem, então a cada ceil(30 / 14) = 3 dias
    expect(ticks.labels).toHaveLength(10)
    expect(formatTick(ticks.labels.at(-1) as number, SP, 'date')).toBe('10/02')
    expect((ticks.labels[1] as number) - (ticks.labels[0] as number)).toBe(3 * DAY_MS)
    expect(ticks.midnights).toHaveLength(30)
  })
})

describe('escala Y (seção 5.4, achado 51)', () => {
  const range = { min: 21, max: 25 }
  const points = [
    { avg: 22, min: 21.5, max: 23.5 },
    { avg: 26, min: 25, max: 27.2 },
    { avg: null, min: null, max: null },
  ]

  test('só as séries visíveis e a faixa, com 1 °C de folga', () => {
    // 20 a 27 pede 7 passos de 1 °C; com passo de 2, a escala fecha em 28
    expect(yScale(points, range, false)).toEqual({ min: 20, max: 28, interval: 2 })
    expect(yScale(points, range, true)).toEqual({ min: 20, max: 30, interval: 2 })
  })

  test('a externa só entra quando pedida, como extra', () => {
    expect(yScale(points, range, false, [38, null])).toEqual({ min: 20, max: 40, interval: 5 })
  })

  test('sem dados, a faixa sozinha define a escala', () => {
    expect(yScale([], range, true)).toEqual({ min: 20, max: 26, interval: 1 })
  })
})

test('janela visível em texto', () => {
  expect(formatWindow(7 * DAY_MS, 30 * DAY_MS)).toBe('7 de 30 dias')
  expect(formatWindow(7.5 * DAY_MS, 30 * DAY_MS)).toBe('7,5 de 30 dias')
  expect(formatWindow(6 * HOUR_MS, DAY_MS)).toBe('6 de 24 horas')
})
