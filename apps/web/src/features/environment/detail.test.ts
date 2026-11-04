import { describe, expect, test } from 'bun:test'
import type { DailyComfort, ProfileCell, Series } from '@celsius/contracts'
import {
  compareAvailability,
  coveredDuration,
  csvFileName,
  dailyAxisLabels,
  dailyState,
  gapsCsv,
  keepSamePeriod,
  localDay,
  networkHref,
  overlapMinutes,
  parsePeriod,
  periodRangeEndingAt,
  pointState,
  previousRange,
  profileStep,
  seriesCsv,
  seriesRows,
  storeHref,
  trendPerHour,
  unbrokenDuration,
} from './detail'

const TZ = 'America/Recife'

const series = (patch: Partial<Series> = {}): Series => ({
  bucket: '1h',
  from: '2026-01-30T03:00:00.000Z',
  to: '2026-01-31T03:00:00.000Z',
  now: '2026-01-31T02:59:00.000Z',
  comfortRange: { min: 21, max: 25 },
  points: [],
  outdoor: [],
  gaps: [],
  // Sexta, 10:00–22:00 em Recife (UTC−3)
  openIntervals: [{ from: '2026-01-30T13:00:00.000Z', to: '2026-01-31T01:00:00.000Z' }],
  ...patch,
})

describe('período e navegação', () => {
  test('período da URL: inválido ou herdado do protótipo cai em 24 horas', () => {
    expect(parsePeriod('30d')).toBe('30d')
    expect(parsePeriod(null)).toBe('1d')
    expect(parsePeriod('toString')).toBe('1d')
    expect(parsePeriod('90d')).toBe('1d')
  })

  test('período anterior tem o mesmo comprimento e termina onde o atual começa', () => {
    expect(previousRange({ from: '2026-02-04T03:00:00.000Z', to: '2026-02-11T03:00:00.000Z' })).toEqual({
      from: '2026-01-28T03:00:00.000Z',
      to: '2026-02-04T03:00:00.000Z',
    })
  })

  test('intervalo exato de cada segmento, para a dica', () => {
    expect(periodRangeEndingAt('7d', '2026-02-11T03:00:00.000Z').from).toBe('2026-02-04T03:00:00.000Z')
  })

  test('breadcrumb restaura a query da lista e troca só o período', () => {
    expect(networkHref('?ordem=comfort&periodo=1d&busca=tijuca', '30d')).toBe(
      '/?ordem=comfort&periodo=30d&busca=tijuca',
    )
    // Sem estado (link aberto direto) ou com estado estranho
    expect(networkHref(undefined, '7d')).toBe('/?periodo=7d')
    expect(networkHref({ x: 1 }, '7d')).toBe('/?periodo=7d')
  })

  test('link da loja é o filtro exato por id', () => {
    expect(storeHref('LOJA-PE-001', '30d')).toBe('/?loja=LOJA-PE-001&periodo=30d')
  })
})

describe('lacunas e situação do bucket', () => {
  test('parte da lacuna no horário de funcionamento (achado 63)', () => {
    // Sensor travado de 30/01 17:25 a 31/01 04:15 (Recife): só até 22:00 cai no expediente
    expect(
      overlapMinutes('2026-01-30T20:25:00.000Z', '2026-01-31T07:15:00.000Z', series().openIntervals),
    ).toBe(275)
    expect(
      overlapMinutes('2026-01-30T04:45:00.000Z', '2026-01-30T10:30:00.000Z', series().openIntervals),
    ).toBe(0)
  })

  test('duração sem quebra no meio (achado 17)', () => {
    expect(unbrokenDuration(995)).toBe('16 h 35 min')
    expect(unbrokenDuration(3125, 'calendar')).toBe('2 d 4 h')
  })

  test('tempo coberto arredonda para baixo, como o percentual: nunca "64 h de 64 h" com 99,6%', () => {
    const plain = (minutes: number) => coveredDuration(minutes).replaceAll(' ', ' ')
    expect(plain(3827.5)).toBe('63 h')
    expect(plain(3840)).toBe('64 h')
    expect(plain(19_830)).toBe('330 h')
    expect(plain(1439.6)).toBe('23 h 59 min')
  })

  test('lacuna, loja fechada e posição na faixa', () => {
    const s = series({
      gaps: [
        {
          from: '2026-01-30T20:25:00.000Z',
          to: '2026-01-31T07:15:00.000Z',
          kind: 'discarded',
          reason: 'stuck',
        },
      ],
    })
    const at = (t: string, avg: number | null) => pointState({ t, avg, min: avg, max: avg }, s)
    expect(at('2026-01-30T21:00:00.000Z', null)).toMatchObject({ situation: 'gap', label: 'Sensor travado' })
    expect(at('2026-01-30T05:00:00.000Z', null)).toMatchObject({ situation: 'missing' })
    expect(at('2026-01-30T05:00:00.000Z', 27)).toMatchObject({ situation: 'closed', label: 'Loja fechada' })
    expect(at('2026-01-30T14:00:00.000Z', 25.4)).toMatchObject({ situation: 'above' })
    expect(at('2026-01-30T14:00:00.000Z', 20.9)).toMatchObject({ situation: 'below' })
    expect(at('2026-01-30T14:00:00.000Z', 25)).toMatchObject({ situation: 'within' })
  })

  test('a externa horária vale para os buckets da mesma hora', () => {
    const s = series({
      bucket: '15m',
      points: [
        { t: '2026-01-30T14:00:00.000Z', avg: 24, min: 23.8, max: 24.1 },
        { t: '2026-01-30T14:45:00.000Z', avg: 24.2, min: 24, max: 24.4 },
        { t: '2026-01-30T15:00:00.000Z', avg: 24.3, min: 24.1, max: 24.5 },
      ],
      outdoor: [
        { t: '2026-01-30T14:00:00.000Z', value: 29.6 },
        { t: '2026-01-30T16:00:00.000Z', value: 30.1 },
      ],
    })
    expect(seriesRows(s).map((row) => row.outdoor)).toEqual([29.6, 29.6, null])
  })
})

describe('CSV para o Excel em pt-BR', () => {
  const s = series({
    points: [
      { t: '2026-01-30T13:00:00.000Z', avg: 24.45, min: 24, max: 25 },
      { t: '2026-01-30T14:00:00.000Z', avg: null, min: null, max: null },
    ],
    outdoor: [{ t: '2026-01-30T13:00:00.000Z', value: 29.6 }],
  })

  test('BOM, ponto e vírgula, vírgula decimal e data no fuso da loja', () => {
    const csv = seriesCsv(s, TZ, 'horário de Recife (UTC−3)')
    expect(csv.startsWith('﻿Data e hora · horário de Recife (UTC−3);Média (°C);')).toBe(true)
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[1]).toBe('30/01/2026 10:00;24,45;24;25;29,6;Na faixa')
    // Ausência fica vazia, nunca 0
    expect(lines[2]).toBe('30/01/2026 11:00;;;;;Sem leitura válida')
  })

  test('lacunas com minutos no horário', () => {
    const csv = gapsCsv(
      series({
        gaps: [
          {
            from: '2026-01-30T20:25:00.000Z',
            to: '2026-01-31T07:15:00.000Z',
            kind: 'discarded',
            reason: 'stuck',
          },
        ],
      }),
      TZ,
      'horário de Recife (UTC−3)',
    )
    expect(csv.trimEnd().split('\r\n')[1]).toBe('30/01/2026 17:25;31/01/2026 04:15;650;275;Sensor travado')
  })

  test('nome do arquivo com a data local do "agora"', () => {
    expect(csvFileName('AMB-014', '30d', '2026-02-11T02:59:56.000Z', TZ)).toBe('AMB-014_30d_2026-02-10.csv')
    expect(csvFileName('AMB-014', '7d', '2026-02-11T02:59:56.000Z', TZ, 'lacunas')).toBe(
      'AMB-014_7d_lacunas_2026-02-10.csv',
    )
  })
})

describe('tendência da última leitura', () => {
  const points = [22.0, 22.2, 22.4, 22.6].map((avg, index) => ({
    t: new Date(Date.parse('2026-01-30T23:00:00.000Z') + index * 3_600_000).toISOString(),
    avg,
    min: avg,
    max: avg,
  }))

  test('inclinação em °C por hora sobre os 4 últimos buckets válidos', () => {
    const s = series({ points, now: '2026-01-31T02:50:00.000Z' })
    expect(trendPerHour(s, '2026-01-31T02:45:00.000Z')).toBeCloseTo(0.2, 5)
  })

  test('sem tendência com leitura antiga ou fora do período', () => {
    const s = series({ points, now: '2026-01-31T02:50:00.000Z' })
    expect(trendPerHour(s, '2026-01-31T02:20:00.000Z')).toBeNull()
    expect(trendPerHour({ ...s, now: '2026-02-05T00:00:00.000Z' }, '2026-02-05T00:00:00.000Z')).toBeNull()
  })
})

describe('comparação com o período anterior', () => {
  const indicators = (coveragePct: number | null) => ({ indicators: { coveragePct } }) as never
  const current = series({ points: [{ t: '2026-01-12T03:00:00.000Z', avg: 25.1, min: 25, max: 25.3 }] })

  test('no tempo real a chave do anterior anda, e a resposta velha fica só se for do mesmo período', () => {
    const keep = keepSamePeriod('AMB-014', {
      from: '2026-01-27T03:15:00.000Z',
      to: '2026-02-03T03:15:00.000Z',
    })
    const key = (id: string, from: string, to: string) => ({
      queryKey: ['environment', id, 'summary', { from, to }],
    })
    // A ingestão andou 15 min: outra chave, os mesmos 7 dias
    expect(keep('anterior', key('AMB-014', '2026-01-27T03:00:00.000Z', '2026-02-03T03:00:00.000Z'))).toBe(
      'anterior',
    )
    // Troca para 24 horas ou para outro ambiente: nada do que estava na tela vale
    expect(keep('anterior', key('AMB-014', '2026-02-02T03:00:00.000Z', '2026-02-03T03:00:00.000Z'))).toBe(
      undefined,
    )
    expect(keep('anterior', key('AMB-003', '2026-01-27T03:00:00.000Z', '2026-02-03T03:00:00.000Z'))).toBe(
      undefined,
    )
    expect(keep('anterior', undefined)).toBe(undefined)
    // Sem o resumo atual ainda não há período anterior
    const none = keepSamePeriod('AMB-014', { from: '', to: '' })
    expect(none('anterior', key('AMB-014', '', ''))).toBe(undefined)
  })

  test('com 80% de cobertura ou mais, compara', () => {
    expect(compareAvailability(indicators(80), current, TZ)).toEqual({ ok: true })
  })

  test('sem leitura antes, a dica diz onde os dados começam (30 dias)', () => {
    expect(compareAvailability(indicators(null), current, TZ)).toEqual({
      ok: false,
      reason: 'Sem base de comparação: os dados começam em 12/01',
    })
  })

  test('cobertura baixa no período anterior', () => {
    expect(compareAvailability(indicators(42.37), current, TZ)).toEqual({
      ok: false,
      reason: 'Sem base de comparação: o período anterior tem só 42,3% de cobertura',
    })
  })
})

describe('perfil semanal: ausência nunca vira 0', () => {
  const cell = (patch: Partial<ProfileCell>): ProfileCell => ({
    weekday: 1,
    hour: 10,
    open: true,
    days: 5,
    minutesInHours: 300,
    withinPct: 100,
    abovePct: 0,
    belowPct: 0,
    valueAvg: 23,
    ...patch,
  })

  test('hora fechada e hora sem leitura têm tipo próprio', () => {
    expect(profileStep(cell({ open: false }))).toEqual({ kind: 'closed' })
    expect(profileStep(cell({ withinPct: null, abovePct: null, belowPct: null, minutesInHours: 0 }))).toEqual(
      {
        kind: 'empty',
      },
    )
  })

  test('degraus pelo lado dominante', () => {
    expect(profileStep(cell({ withinPct: 96, abovePct: 4 }))).toMatchObject({ level: 0 })
    expect(profileStep(cell({ withinPct: 35.67, abovePct: 64.33 }))).toMatchObject({
      side: 'quente',
      level: 4,
    })
    expect(profileStep(cell({ withinPct: 80, abovePct: 20 }))).toMatchObject({ side: 'quente', level: 2 })
    expect(profileStep(cell({ withinPct: 60, abovePct: 10, belowPct: 30 }))).toMatchObject({
      side: 'frio',
      level: 3,
    })
  })
})

describe('conforto por dia', () => {
  const day = (patch: Partial<DailyComfort>): DailyComfort => ({
    day: '2026-02-04',
    minutesExpected: 660,
    minutesInHours: 660,
    minutesWithin: 0,
    minutesAbove: 0,
    minutesBelow: 660,
    comfortPct: 0,
    coveragePct: 100,
    valueAvgInHours: 19.5,
    ...patch,
  })

  test('partes do horário com leitura; dia fechado e sem leitura não viram 0%', () => {
    expect(dailyState(day({}))).toEqual({ kind: 'value', within: 0, below: 100, above: 0 })
    expect(dailyState(day({ minutesExpected: 0, minutesInHours: 0, minutesBelow: 0 }))).toEqual({
      kind: 'closed',
    })
    expect(dailyState(day({ minutesInHours: 0, minutesBelow: 0, coveragePct: 0 }))).toEqual({ kind: 'empty' })
  })

  test('dia local com dia da semana', () => {
    expect(localDay('2026-02-04')).toEqual({ weekday: 'qua', day: '04', date: '04/02', monday: false })
    expect(localDay('2026-02-09')).toMatchObject({ weekday: 'seg', monday: true })
  })

  test('eixo de 30 dias: segundas pelo início, o último dia pelo fim e nada encostado', () => {
    // 12/01 (segunda) a 10/02 (terça): a segunda 09/02 fica colada no último dia e sai
    const days = Array.from({ length: 30 }, (_, index) =>
      new Date(Date.UTC(2026, 0, 12 + index)).toISOString().slice(0, 10),
    )
    const labels = dailyAxisLabels(days)
    const shown = labels.flatMap((label, index) => (label ? [[days[index], label.align, label.mobile]] : []))
    expect(shown).toEqual([
      ['2026-01-12', 'start', true],
      ['2026-01-19', 'start', true],
      ['2026-01-26', 'start', true],
      // No celular, a 8 colunas do fim, encostaria no último rótulo
      ['2026-02-02', 'start', false],
      ['2026-02-10', 'end', true],
    ])
  })
})
