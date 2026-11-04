import { describe, expect, test } from 'bun:test'
import { buildModel, closedSpans, deviation, pointIndexAt, situationStrip } from './model'
import { at, HOUR, iso, sampleSeries } from './testing'

describe('modelo do gráfico', () => {
  test('loja fechada é o complemento do expediente, mesmo fora de ordem', () => {
    expect(
      closedSpans(0, 100, [
        [60, 80],
        [10, 30],
      ]),
    ).toEqual([
      [0, 10],
      [30, 60],
      [80, 100],
    ])
    expect(closedSpans(0, 100, [[0, 100]])).toEqual([])
  })

  test('bucket aberto pelo meio do intervalo e lacuna presa aos buckets que ela toca', () => {
    const model = buildModel(sampleSeries())
    expect(model.points[9]?.open).toBe(false)
    expect(model.points[10]?.open).toBe(true)
    expect(model.points[21]?.open).toBe(true)
    expect(model.points[22]?.open).toBe(false)
    expect(model.points[37]?.gap?.reason).toBe('stuck')
    expect(model.points[38]?.gap?.info.label).toBe('Sensor travado')
    expect(model.points[39]?.gap).toBeNull()
  })

  test('"agora" só com leitura recente; offline não ganha a pílula', () => {
    expect(buildModel(sampleSeries()).latest?.t).toBe(at(47))
    const offline = sampleSeries()
    offline.points = offline.points.map((point, index) => (index > 40 ? { ...point, avg: null } : point))
    expect(buildModel(offline).latest).toBeNull()
    expect(buildModel(sampleSeries({ now: null })).latest).toBeNull()
  })

  test('banda mín–máx: indisponível em 5 min e com amplitude média abaixo de 0,3 °C', () => {
    expect(buildModel(sampleSeries()).spread).toBe('available')
    expect(buildModel(sampleSeries({ bucket: '5m' })).spread).toBe('bucket')
    const flat = sampleSeries()
    flat.points = flat.points.map((point) => ({ ...point, min: point.avg, max: point.avg }))
    expect(buildModel(flat).spread).toBe('flat')
  })

  test('período anterior deslocado para cima do atual', () => {
    const current = sampleSeries()
    const before = sampleSeries({ from: iso(at(-48)), to: iso(at(0)) })
    before.points = before.points.map((point, index) => ({ ...point, t: iso(at(index - 48)), avg: 20 }))
    const model = buildModel(current, before)
    expect(model.previous?.shift).toBe(48 * HOUR)
    expect(model.previous?.byTime.get(at(5))).toBe(20)
  })

  test('tira de situação: trechos iguais fundidos e lacuna acima do expediente', () => {
    const model = buildModel(sampleSeries())
    const strip = situationStrip(model)
    expect(strip[0]).toMatchObject({ from: at(0), to: at(10), state: 'closed' })
    expect(strip.find((segment) => segment.state === 'above')).toMatchObject({ from: at(15), to: at(16) })
    expect(strip.find((segment) => segment.state === 'discarded')).toMatchObject({ from: at(37), to: at(39) })
    expect(strip.find((segment) => segment.state === 'below')).toMatchObject({ from: at(42), to: at(43) })
    // Nada se sobrepõe e nada fica de fora
    for (let i = 1; i < strip.length; i++) expect(strip[i]?.from).toBe(strip[i - 1]?.to as number)
    expect(strip.at(-1)?.to).toBe(at(48))
  })

  test('índice do bucket que contém o instante', () => {
    const model = buildModel(sampleSeries())
    expect(pointIndexAt(model, at(3) + 10)).toBe(3)
    expect(pointIndexAt(model, at(-5))).toBe(0)
    expect(pointIndexAt(model, at(99))).toBe(47)
  })

  test('desvio até a faixa', () => {
    const range = { min: 21, max: 25 }
    expect(deviation(26.4, range)).toBeCloseTo(1.4)
    expect(deviation(20.2, range)).toBeCloseTo(-0.8)
    expect(deviation(23, range)).toBe(0)
  })
})
