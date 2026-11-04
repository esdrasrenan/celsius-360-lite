import { describe, expect, test } from 'bun:test'
import { edgeLabels, outdoorAt, PILL_MIN_PLOT_WIDTH, pillWidth } from './edge'
import type { LayerVisibility } from './layers'
import { buildModel } from './model'
import { at, iso, sampleSeries, TZ } from './testing'

const visible: LayerVisibility = {
  temperature: true,
  spread: true,
  outdoor: true,
  comfort: true,
  closed: true,
  previous: false,
}
/** 20 a 30 °C em 300 px: 30 px por grau. */
const scale = { min: 20, max: 30, interval: 2 }
const plot = { width: 1000, height: 300 }

/** Série cujo último bucket (o "agora") vale `last`, com a externa terminando em `outdoor`. */
function modelEndingAt(last: number, outdoor = 28) {
  const series = sampleSeries()
  series.points = series.points.map((point, index) => (index === 47 ? { ...point, avg: last } : point))
  series.outdoor = series.outdoor.map((point) => ({ ...point, value: outdoor }))
  return buildModel(series)
}

const full = (model: ReturnType<typeof buildModel>) => [model.from, model.to] as const

describe('rótulos da borda direita', () => {
  test('a pílula do agora tira o "25 °C" que ficaria colado nela', () => {
    // 24,1 °C fica 0,9 °C (27 px) abaixo do 25: a pílula acima do ponto encosta no rótulo
    const model = modelEndingAt(24.1)
    const edge = edgeLabels(model, scale, visible, plot, full(model), 16, TZ)
    expect(edge).toMatchObject({ max: false, min: true })
    expect(edge.pill).not.toBe('hidden')
  })

  test('longe dos limites, os três rótulos convivem', () => {
    const model = modelEndingAt(27.5, 22.5)
    expect(edgeLabels(model, scale, visible, plot, full(model), 16, TZ)).toMatchObject({
      max: true,
      min: true,
      outdoor: true,
    })
  })

  test('a Externa cede o lugar ao limite da faixa', () => {
    const model = modelEndingAt(27.5, 25.2)
    expect(edgeLabels(model, scale, visible, plot, full(model), 16, TZ)).toMatchObject({
      max: true,
      outdoor: false,
    })
  })

  test('externa fora da escala não ganha nome flutuando fora do plot', () => {
    const model = modelEndingAt(27.5, 36)
    expect(edgeLabels(model, scale, visible, plot, full(model), 16, TZ).outdoor).toBe(false)
  })

  test('no celular só o ponto; fora da janela do zoom, nada disputa a borda', () => {
    const model = modelEndingAt(24.1)
    const narrow = { width: PILL_MIN_PLOT_WIDTH - 1, height: 240 }
    expect(edgeLabels(model, scale, visible, narrow, full(model), 16, TZ)).toMatchObject({
      pill: 'hidden',
      max: true,
    })
    const earlier = [model.from, at(20)] as const
    expect(edgeLabels(model, scale, visible, plot, earlier, 16, TZ)).toMatchObject({
      pill: 'hidden',
      max: true,
    })
  })

  test('a pílula vai para o lado com menos dados por baixo e vira quando não cabe no topo', () => {
    // A externa e as médias de 24 °C passam logo acima do ponto: a pílula desce
    const crowded = modelEndingAt(23, 23.9)
    expect(edgeLabels(crowded, scale, visible, plot, full(crowded), 16, TZ).pill).toBe('bottom')
    const top = modelEndingAt(29.9, 22)
    expect(edgeLabels(top, scale, visible, plot, full(top), 16, TZ).pill).toBe('bottom')
    // Nada por perto: fica acima, o padrão
    const clear = modelEndingAt(27.5, 22)
    expect(edgeLabels(clear, scale, visible, plot, full(clear), 16, TZ).pill).toBe('top')
  })

  test('com a Temperatura desligada não há pílula', () => {
    const model = modelEndingAt(24.1)
    const edge = edgeLabels(model, scale, { ...visible, temperature: false }, plot, full(model), 16, TZ)
    expect(edge).toMatchObject({ pill: 'hidden', max: true })
  })
})

test('externa na borda do zoom, interpolada como o ECharts faz', () => {
  const outdoor: Array<[number, number]> = [
    [at(0), 20],
    [at(2), 30],
  ]
  expect(outdoorAt(outdoor, at(1))).toBe(25)
  expect(outdoorAt(outdoor, at(5))).toBe(30)
  expect(outdoorAt([], at(1))).toBeNull()
  expect(
    outdoorAt(buildModel(sampleSeries({ outdoor: [{ t: iso(at(3)), value: 27 }] })).outdoor, at(1)),
  ).toBe(27)
})

test('largura estimada da pílula', () => {
  expect(pillWidth('Média 23h 24,1 °C')).toBe(123)
})
