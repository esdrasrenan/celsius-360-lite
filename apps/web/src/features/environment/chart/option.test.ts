import { describe, expect, test } from 'bun:test'
import type { DataZoomComponentOption } from 'echarts/components'
import type { LayerVisibility } from './layers'
import { buildModel } from './model'
import {
  ANCHOR_INDEX,
  buildOption,
  closedIsDense,
  hasBrush,
  layerVisibility,
  minZoomSpan,
  plotBottom,
  scaleFor,
} from './option'
import { at, HOUR, iso, sampleSeries, TZ, theme } from './testing'

const DAY = 24 * HOUR
const model = buildModel(sampleSeries())
const all: LayerVisibility = {
  temperature: true,
  spread: true,
  outdoor: true,
  comfort: true,
  closed: true,
  previous: false,
}

describe('visibilidade das camadas', () => {
  test('"Loja fechada" desliga sozinha quando o expediente vira listras finas', () => {
    expect(closedIsDense(model, 1000)).toBe(false)
    expect(closedIsDense(model, 40)).toBe(true)
    expect(layerVisibility(model, 40, {}).closed).toBe(false)
    // A escolha na legenda vence o padrão
    expect(layerVisibility(model, 40, { closed: true }).closed).toBe(true)
  })

  test('camada que não existe no período nunca liga', () => {
    const flat = buildModel(sampleSeries({ bucket: '5m', outdoor: [] }))
    const visible = layerVisibility(flat, 1000, { spread: true, outdoor: true })
    expect(visible.spread).toBe(false)
    expect(visible.outdoor).toBe(false)
    expect(visible.previous).toBe(false)
  })
})

describe('escala com as séries visíveis (achado 51)', () => {
  test('a externa não comanda a escala e o item avisa que ela saiu', () => {
    const { scale, outdoorClipped } = scaleFor(model, all, false)
    expect(scale.max).toBeLessThan(31)
    expect(outdoorClipped).toBe(true)
  })

  test('"Ajustar escala à externa" põe a curva inteira na escala', () => {
    const { scale, outdoorClipped } = scaleFor(model, all, true)
    expect(scale.max).toBeGreaterThanOrEqual(31)
    expect(outdoorClipped).toBe(false)
  })

  test('com a Variação desligada, só a média conta', () => {
    const spread = scaleFor(model, all, false).scale
    const plain = scaleFor(model, { ...all, spread: false }, false).scale
    expect(plain.min).toBeGreaterThanOrEqual(spread.min)
  })
})

describe('zoom e brush (seção 5.7)', () => {
  test('brush só em 7 e 30 dias, com a janela mínima do período', () => {
    expect(hasBrush({ from: 0, to: DAY })).toBe(false)
    expect(hasBrush({ from: 0, to: 7 * DAY })).toBe(true)
    expect(minZoomSpan({ from: 0, to: DAY })).toBe(2 * HOUR)
    expect(minZoomSpan({ from: 0, to: 7 * DAY })).toBe(12 * HOUR)
    expect(minZoomSpan({ from: 0, to: 30 * DAY })).toBe(DAY)
    expect(plotBottom({ from: 0, to: DAY })).toBe(40)
    expect(plotBottom({ from: 0, to: 7 * DAY })).toBe(92)
  })
})

describe('option', () => {
  const option = buildOption({
    model,
    theme,
    visible: all,
    fitOutdoor: false,
    timeZone: TZ,
    plotWidth: 1000,
    view: [model.from, model.to],
    summary: 'Resumo',
    edge: { max: true, min: true, outdoor: true, pill: 'top' },
    animate: false,
    formatTooltip: () => '',
    formatStripTooltip: () => '',
  })
  const series = option.series as Array<{ id: string; name?: string }>

  test('cada camada é uma série com id; a âncora do tooltip fica no índice fixo', () => {
    expect(series.map((item) => item.id)).toEqual([
      'shadow',
      'anchor',
      'closed',
      'comfort',
      'discarded',
      'spread-base',
      'spread',
      'outdoor',
      'temperature-closed',
      'temperature',
      'now',
      'strip',
    ])
    expect(series[ANCHOR_INDEX]?.id).toBe('anchor')
  })

  test('a roda sozinha nunca dá zoom: só com Ctrl, e a rolagem da página passa', () => {
    const [inside] = option.dataZoom as DataZoomComponentOption[]
    expect(inside).toMatchObject({
      type: 'inside',
      zoomOnMouseWheel: 'ctrl',
      moveOnMouseWheel: false,
      preventDefaultMouseMove: false,
      xAxisIndex: [0, 1],
    })
  })

  test('legenda do ECharts escondida, controlada pela legenda HTML', () => {
    expect(option.legend).toMatchObject({ show: false, selected: { Temperatura: true, Externa: true } })
  })

  test('tooltip por eixo, confinado ao gráfico e sem caixa própria', () => {
    expect(option.tooltip).toMatchObject({ trigger: 'axis', confine: true, padding: 0 })
    expect(option.tooltip).not.toHaveProperty('appendTo')
  })

  test('Inter no canvas e aria ligado com o resumo', () => {
    expect(option.textStyle).toMatchObject({ fontFamily: 'fontFamily', fontSize: 12 })
    expect(option.aria).toEqual({ enabled: true, label: { description: 'Resumo' } })
  })

  test('24 horas sem brush', () => {
    const day = buildModel(
      sampleSeries({ to: iso(at(24)), points: sampleSeries().points.slice(0, 24), gaps: [] }),
    )
    const oneDay = buildOption({
      model: day,
      theme,
      visible: all,
      fitOutdoor: false,
      timeZone: TZ,
      plotWidth: 1000,
      view: [day.from, day.to],
      summary: '',
      edge: { max: true, min: true, outdoor: true, pill: 'hidden' },
      animate: false,
      formatTooltip: () => '',
      formatStripTooltip: () => '',
    })
    expect((oneDay.dataZoom as DataZoomComponentOption[]).map((zoom) => zoom.type)).toEqual(['inside'])
  })
})
