import { describe, expect, test } from 'bun:test'
import {
  closedLayer,
  comfortLayer,
  gapLayers,
  nowLayer,
  nowPillText,
  OUTDOOR_OPACITY,
  outdoorLayer,
  previousLayer,
  SERIES_NAME,
  situationStripLayer,
  spreadLayers,
  temperatureLayers,
  temperatureVisualMap,
} from './layers'
import { buildModel } from './model'
import { at, iso, sampleSeries, TZ, theme } from './testing'

const model = buildModel(sampleSeries())
const xs = (data: unknown) =>
  (data as Array<[{ xAxis: number }, { xAxis: number }]>).map(([a, b]) => [a.xAxis, b.xAxis])

describe('camadas como séries próprias (seção 5.1, achados 29 e 45)', () => {
  test('loja fechada: markArea só em x, no complemento do expediente', () => {
    const layer = closedLayer(model, theme)
    expect(layer.name).toBe(SERIES_NAME.closed)
    expect(layer.data).toEqual([])
    expect(xs(layer.markArea?.data)).toEqual([
      [at(0), at(10)],
      [at(22), at(34)],
      [at(46), at(48)],
    ])
    expect(layer.markArea?.itemStyle?.color).toBe('fechado')
  })

  test('faixa de conforto dentro do expediente, ou de ponta a ponta pela regra de densidade', () => {
    const inside = comfortLayer(model, theme, true)
    const areas = inside.markArea?.data as Array<
      [{ xAxis: number; yAxis: number }, { xAxis: number; yAxis: number }]
    >
    expect(areas.map(([a, b]) => [a.xAxis, a.yAxis, b.xAxis, b.yAxis])).toEqual([
      [at(10), 21, at(22), 25],
      [at(34), 21, at(46), 25],
    ])
    const full = comfortLayer(model, theme, false)
    expect(xs(full.markArea?.data)).toEqual([[at(0), at(48)]])
  })

  test('limites da faixa com rótulo à direita, que some quando colide', () => {
    const lines = comfortLayer(model, theme, true, { max: false, min: true }).markLine?.data as Array<{
      yAxis: number
      label: { show: boolean; formatter: string }
    }>
    expect(lines.map((line) => [line.yAxis, line.label.show, line.label.formatter])).toEqual([
      [25, false, '25 °C'],
      [21, true, '21 °C'],
    ])
  })

  test('lacunas: uma série por tipo, sem nenhum texto no plot', () => {
    const layers = gapLayers(model, theme)
    expect(layers.map((layer) => layer.id)).toEqual(['discarded'])
    expect(layers[0]?.markArea?.itemStyle?.color).toBe('hachura-descartada')
    expect(layers[0]?.markArea).not.toHaveProperty('label')
    const noData = buildModel(
      sampleSeries({ gaps: [{ from: iso(at(2)), to: iso(at(3)), kind: 'no_data', reason: null }] }),
    )
    expect(gapLayers(noData, theme).map((layer) => layer.id)).toEqual(['no-data'])
    expect(gapLayers(buildModel(sampleSeries({ gaps: [] })), theme)).toEqual([])
  })

  test('variação: base mínima transparente e amplitude empilhada, com nulos nas lacunas', () => {
    const [base, band] = spreadLayers(model, theme)
    if (!base || !band) throw new Error('faltou uma das séries da banda')
    expect(base.stack).toBe(band.stack as string)
    const baseData = base.data as unknown[][]
    const bandData = band.data as unknown[][]
    expect(baseData[0]).toEqual([at(0), 22.5])
    expect(bandData[0]).toEqual([at(0), 1])
    expect(bandData[37]).toEqual([at(37), null])
    expect(band.connectNulls).toBe(false)
  })

  test('externa secundária: 1 px tracejado a 80%, com o nome na ponta', () => {
    const layer = outdoorLayer(model, theme)
    expect(layer?.lineStyle).toEqual({ color: 'externa', width: 1, type: [4, 3], opacity: OUTDOOR_OPACITY })
    expect(layer?.clip).toBe(true)
    expect(layer?.endLabel).toMatchObject({ show: true, formatter: 'Externa' })
    expect(outdoorLayer(model, theme, false)?.endLabel?.show).toBe(false)
    expect(outdoorLayer(buildModel(sampleSeries({ outdoor: [] })), theme)).toBeNull()
  })

  test('período anterior só com Comparar', () => {
    expect(previousLayer(model, theme)).toBeNull()
  })

  test('temperatura em duas séries de mesmo nome, unidas no ponto de fronteira', () => {
    const [closed, open] = temperatureLayers(model, theme)
    expect(closed?.name).toBe(open?.name as string)
    const closedData = closed?.data as Array<[number, number | null]>
    const openData = open?.data as Array<[number, number | null]>
    // 10h abre: a série de fora repete o primeiro ponto aberto e a de dentro começa nele
    expect(closedData[10]?.[1]).toBe(24)
    expect(openData[9]?.[1]).toBeNull()
    expect(openData[10]?.[1]).toBe(24)
    expect(closedData[12]?.[1]).toBeNull()
    expect(open?.smooth).toBe(false)
    expect(open?.connectNulls).toBe(false)
    expect(open?.lineStyle?.width).toBe(2)
    expect(closed?.lineStyle).toEqual({ color: 'foraHorario', width: 1.25 })
  })

  test('visualMap por faixa, só na série do expediente', () => {
    const map = temperatureVisualMap(model, theme, 12)
    expect(map).toMatchObject({ type: 'piecewise', dimension: 1, seriesIndex: 12 })
    expect((map as { pieces: unknown[] }).pieces).toEqual([
      { lt: 21, color: 'abaixo' },
      { gte: 21, lte: 25, color: 'temperatura' },
      { gt: 25, color: 'acima' },
    ])
  })

  test('agora: a pílula diz que é a média do último bucket', () => {
    const latest = model.latest
    if (!latest) throw new Error('sem "agora"')
    expect(nowPillText(model, latest, TZ)).toEqual({ prefix: 'Média 23h', value: '23,0 °C' })
    expect(nowPillText({ bucket: '15m' }, { ...latest, t: at(47) + 45 * 60_000 }, TZ).prefix).toBe(
      'Média 23:45',
    )
    expect(nowPillText({ bucket: 'raw' }, latest, TZ).prefix).toBeNull()

    const layer = nowLayer(model, theme, TZ, 'bottom')
    expect(layer?.itemStyle).toEqual({ color: 'foraHorario', borderColor: 'superficie', borderWidth: 2 })
    expect(layer?.label).toMatchObject({
      show: true,
      position: 'bottom',
      formatter: '{prefix|Média 23h} {value|23,0 °C}',
      backgroundColor: 'pilula',
    })
    expect(nowLayer(model, theme, TZ, 'hidden')?.label?.show).toBe(false)
    expect(nowLayer(buildModel(sampleSeries({ now: null })), theme, TZ)).toBeNull()
  })

  test('tira de situação no segundo grid, um retângulo por trecho', () => {
    const strip = situationStripLayer(model, theme, () => '')
    expect(strip).toMatchObject({ xAxisIndex: 1, yAxisIndex: 1, type: 'custom' })
    expect((strip.data as unknown[]).length).toBe(model.strip.length)
  })
})
