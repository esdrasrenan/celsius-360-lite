import type { CustomSeriesOption, LineSeriesOption } from 'echarts/charts'
import type { VisualMapComponentOption } from 'echarts/components'
import type { ChartTokens, HatchPattern } from '../../../lib/chart-theme'
import { formatTemperature, formatTime } from '../../../lib/format'
import { formatLimit } from './axis'
import type { EdgeLabels } from './edge'
import { type ChartGap, type ChartModel, type ChartPoint, classify, type StripState } from './model'

/**
 * Camadas do gráfico (seção 5.1), cada uma uma série nomeada: desligar uma na legenda nunca leva
 * as outras junto. As que só desenham áreas e linhas de referência têm `data: []` e carregam
 * markArea ou markLine.
 */

export const LAYERS = ['temperature', 'spread', 'outdoor', 'comfort', 'closed', 'previous'] as const
export type Layer = (typeof LAYERS)[number]
export type LayerVisibility = Record<Layer, boolean>

/** Nome da série no ECharts: é a chave do legendToggleSelect. */
export const SERIES_NAME: Record<Layer, string> = {
  temperature: 'Temperatura',
  spread: 'Variação no intervalo',
  outdoor: 'Externa',
  comfort: 'Faixa de conforto',
  closed: 'Loja fechada',
  previous: 'Período anterior',
}

export const NO_DATA_NAME = 'Sem dados'
export const DISCARDED_NAME = 'Leitura descartada'

export type Fill = string | HatchPattern

export interface ChartTheme {
  tokens: ChartTokens
  hatches: { semDados: Fill; descartada: Fill }
}

/** Ordem de desenho, de trás para frente. */
const Z = {
  closed: 1,
  comfort: 2,
  gaps: 3,
  spread: 4,
  previous: 5,
  outdoor: 6,
  temperatureClosed: 7,
  temperature: 8,
  now: 9,
} as const

const emphasis = { focus: 'series', blurScope: 'coordinateSystem' } as const
const blurLine = { lineStyle: { opacity: 0.2 } }

const hidden = {
  type: 'line',
  symbol: 'none',
  lineStyle: { opacity: 0 },
  silent: true,
  emphasis: { disabled: true },
  animation: false,
  z: 0,
} as const

/** Média de todos os buckets, invisível: é a curva que o brush desenha ao fundo (a primeira série). */
export function brushShadowSeries(model: ChartModel): LineSeriesOption {
  return {
    ...hidden,
    id: 'shadow',
    tooltip: { show: false },
    data: model.points.map((point) => [point.t, point.avg]),
  }
}

export const ANCHOR_ID = 'anchor'

/**
 * Âncora invisível, um ponto por bucket numa altura fixa (o meio da faixa). Dá ao tooltip e ao
 * teclado um índice estável, inclusive em lacunas e com a Temperatura desligada.
 */
export function anchorSeries(model: ChartModel): LineSeriesOption {
  const middle = (model.range.min + model.range.max) / 2
  return { ...hidden, id: ANCHOR_ID, data: model.points.map((point) => [point.t, middle]) }
}

/** 1. Loja fechada: o complemento do expediente, só em x. */
export function closedLayer(model: ChartModel, theme: ChartTheme): LineSeriesOption {
  return {
    id: 'closed',
    name: SERIES_NAME.closed,
    type: 'line',
    data: [],
    z: Z.closed,
    markArea: {
      silent: true,
      itemStyle: { color: theme.tokens.fechado },
      data: model.closed.map(([from, to]) => [{ xAxis: from }, { xAxis: to }]),
    },
  }
}

/**
 * 2. Faixa de conforto: preenchimento só dentro do expediente (é onde o conforto conta) ou em
 * largura total quando a regra de densidade desliga "Loja fechada"; limites tracejados de ponta a
 * ponta com o valor à direita.
 */
export function comfortLayer(
  model: ChartModel,
  theme: ChartTheme,
  perOpenInterval: boolean,
  labels: Pick<EdgeLabels, 'max' | 'min'> = { max: true, min: true },
): LineSeriesOption {
  const { min, max } = model.range
  const spans = perOpenInterval ? model.open : [[model.from, model.to] as const]
  const { tokens } = theme
  return {
    id: 'comfort',
    name: SERIES_NAME.comfort,
    type: 'line',
    data: [],
    z: Z.comfort,
    markArea: {
      silent: true,
      itemStyle: { color: tokens.faixa },
      data: spans.map(([from, to]) => [
        { xAxis: from, yAxis: min },
        { xAxis: to, yAxis: max },
      ]),
    },
    markLine: {
      silent: true,
      symbol: ['none', 'none'],
      lineStyle: { color: tokens.faixaBorda, type: [4, 4], width: 1 },
      label: { position: 'end', color: tokens.faixaTexto, fontSize: 12, distance: 6 },
      emphasis: { disabled: true },
      data: [
        { yAxis: max, label: { show: labels.max, formatter: formatLimit(max) } },
        { yAxis: min, label: { show: labels.min, formatter: formatLimit(min) } },
      ],
    },
  }
}

interface CoordSys {
  x: number
  y: number
  width: number
  height: number
}

const DIAMOND = 4

/**
 * 3. Lacunas: hachura no trecho (markArea) e, sem texto nenhum no plot, um losango de 8 px no
 * topo do grid, no centro de cada lacuna (seção 5.5). A descartada ganha ainda uma faixa de 2 px
 * no topo, para continuar visível quando a lacuna tem menos de um pixel.
 */
function gapLayer(
  id: string,
  name: string,
  gaps: ChartGap[],
  fill: Fill,
  marker: string,
  theme: ChartTheme,
  band: boolean,
): CustomSeriesOption {
  return {
    id,
    name,
    type: 'custom',
    z: Z.gaps,
    silent: true,
    tooltip: { show: false },
    data: gaps.map((gap) => [gap.from, gap.to]),
    encode: { x: [0, 1] },
    renderItem: (params, api) => {
      const area = params.coordSys as unknown as CoordSys
      const start = (api.coord([api.value(0), 0]) as number[])[0] ?? 0
      const end = (api.coord([api.value(1), 0]) as number[])[0] ?? 0
      const center = (start + end) / 2
      if (center < area.x || center > area.x + area.width) return null
      const top = area.y
      const left = Math.max(area.x, start)
      const width = Math.max(2, Math.min(area.x + area.width, end) - left)
      return {
        type: 'group',
        children: [
          ...(band
            ? [
                {
                  type: 'rect' as const,
                  shape: { x: left, y: top, width, height: 2 },
                  style: { fill: marker },
                },
              ]
            : []),
          {
            type: 'polygon' as const,
            shape: {
              points: [
                [center, top - DIAMOND],
                [center + DIAMOND, top],
                [center, top + DIAMOND],
                [center - DIAMOND, top],
              ],
            },
            style: { fill: marker, stroke: theme.tokens.superficie, lineWidth: 1 },
          },
        ],
      }
    },
    markArea: {
      silent: true,
      itemStyle: { color: fill as string },
      data: gaps.map((gap) => [{ xAxis: gap.from }, { xAxis: gap.to }]),
    },
  }
}

export function gapLayers(model: ChartModel, theme: ChartTheme): CustomSeriesOption[] {
  const noData = model.gaps.filter((gap) => gap.kind === 'no_data')
  const discarded = model.gaps.filter((gap) => gap.kind !== 'no_data')
  const { tokens, hatches } = theme
  return [
    ...(noData.length
      ? [gapLayer('no-data', NO_DATA_NAME, noData, hatches.semDados, tokens.semDados, theme, false)]
      : []),
    ...(discarded.length
      ? [gapLayer('discarded', DISCARDED_NAME, discarded, hatches.descartada, tokens.descartada, theme, true)]
      : []),
  ]
}

/** 4. Variação no intervalo: banda mín–máx empilhada (base transparente + amplitude). */
export function spreadLayers(model: ChartModel, theme: ChartTheme): LineSeriesOption[] {
  const common = {
    name: SERIES_NAME.spread,
    type: 'line',
    stack: 'spread',
    symbol: 'none',
    connectNulls: false,
    lineStyle: { opacity: 0 },
    z: Z.spread,
    emphasis,
    tooltip: { show: false },
  } as const
  return [
    { ...common, id: 'spread-base', data: model.points.map((point) => [point.t, point.min]) },
    {
      ...common,
      id: 'spread',
      areaStyle: { color: theme.tokens.variacao, opacity: 1 },
      blur: { areaStyle: { opacity: 0.3 } },
      data: model.points.map((point) => [
        point.t,
        point.min == null || point.max == null ? null : Math.round((point.max - point.min) * 100) / 100,
      ]),
    },
  ]
}

/** 5. Período anterior (Comparar): instantes deslocados em +P, tracejado curto. */
export function previousLayer(model: ChartModel, theme: ChartTheme): LineSeriesOption | null {
  if (!model.previous) return null
  return {
    id: 'previous',
    name: SERIES_NAME.previous,
    type: 'line',
    data: model.previous.points,
    symbol: 'none',
    connectNulls: false,
    z: Z.previous,
    lineStyle: { color: theme.tokens.comparacao, width: 1.25, type: [2, 3] },
    itemStyle: { color: theme.tokens.comparacao },
    emphasis,
    blur: blurLine,
  }
}

/**
 * Externa a 80%: com 1 px, fica secundária ao lado dos 2 px da Temperatura e ainda dá 3,17:1
 * contra o branco (objeto gráfico, mínimo de 3:1).
 */
export const OUTDOOR_OPACITY = 0.8

/** 6. Externa (Open-Meteo): cortada no grid, com o nome na ponta direita. */
export function outdoorLayer(
  model: ChartModel,
  theme: ChartTheme,
  showLabel = true,
): LineSeriesOption | null {
  if (model.outdoor.length === 0) return null
  const { tokens } = theme
  return {
    id: 'outdoor',
    name: SERIES_NAME.outdoor,
    type: 'line',
    data: model.outdoor,
    symbol: 'none',
    clip: true,
    z: Z.outdoor,
    lineStyle: { color: tokens.externa, width: 1, type: [4, 3], opacity: OUTDOOR_OPACITY },
    itemStyle: { color: tokens.externa },
    endLabel: { show: showLabel, formatter: 'Externa', color: tokens.eixo, fontSize: 12, distance: 6 },
    emphasis,
    blur: blurLine,
  }
}

/**
 * 7 e 8. Temperatura em duas séries com o mesmo nome (a legenda liga e desliga as duas): fora do
 * expediente, cinza e mais fina; dentro, colorida pela faixa via visualMap. A de fora repete os
 * pontos de fronteira para as duas linhas se encontrarem.
 */
export function temperatureLayers(model: ChartModel, theme: ChartTheme): LineSeriesOption[] {
  const { points } = model
  const { tokens } = theme
  const closed = points.map((point, index) => {
    const touches = !point.open || points[index - 1]?.open === false || points[index + 1]?.open === false
    return [point.t, touches ? point.avg : null]
  })
  return [
    {
      id: 'temperature-closed',
      name: SERIES_NAME.temperature,
      type: 'line',
      data: closed,
      symbol: 'circle',
      symbolSize: 8,
      showSymbol: false,
      connectNulls: false,
      z: Z.temperatureClosed,
      lineStyle: { color: tokens.foraHorario, width: 1.25 },
      itemStyle: { color: tokens.foraHorario },
      emphasis: { ...emphasis, itemStyle: { borderColor: tokens.superficie, borderWidth: 2 } },
      blur: blurLine,
    },
    {
      id: 'temperature',
      name: SERIES_NAME.temperature,
      type: 'line',
      data: points.map((point) => [point.t, point.open ? point.avg : null]),
      symbol: 'circle',
      symbolSize: 8,
      showSymbol: false,
      smooth: false,
      connectNulls: false,
      z: Z.temperature,
      lineStyle: { width: 2 },
      emphasis: { ...emphasis, itemStyle: { borderColor: tokens.superficie, borderWidth: 2 } },
      blur: blurLine,
    },
  ]
}

/** Cor da linha por faixa, só na série "Temperatura" do expediente. */
export function temperatureVisualMap(
  model: ChartModel,
  theme: ChartTheme,
  seriesIndex: number,
): VisualMapComponentOption {
  const { min, max } = model.range
  const { tokens } = theme
  return {
    type: 'piecewise',
    show: false,
    dimension: 1,
    seriesIndex,
    pieces: [
      { lt: min, color: tokens.abaixo },
      { gte: min, lte: max, color: tokens.temperatura },
      { gt: max, color: tokens.acima },
    ],
  }
}

/**
 * Texto da pílula do "agora". O ponto é a média do último bucket, não a última leitura que o
 * cabeçalho mostra; a pílula diz isso ("Média 23h 24,1 °C") para os dois números não se
 * contradizerem. Em leituras de 30 s o ponto já é a leitura.
 */
export function nowPillText(model: Pick<ChartModel, 'bucket'>, point: ChartPoint, timeZone: string) {
  const value = formatTemperature(point.avg)
  if (model.bucket === 'raw') return { prefix: null, value }
  const time = formatTime(point.t, timeZone)
  return { prefix: `Média ${model.bucket === '1h' ? `${Number(time.slice(0, 2))}h` : time}`, value }
}

/**
 * 9. Agora: ponto de 8 px com anel branco e a média do último bucket numa pílula, acima ou abaixo
 * do ponto conforme edgeLabels (no celular, só o ponto).
 */
export function nowLayer(
  model: ChartModel,
  theme: ChartTheme,
  timeZone: string,
  placement: EdgeLabels['pill'] = 'top',
): LineSeriesOption | null {
  const point = model.latest
  if (!point || point.avg == null) return null
  const { tokens } = theme
  const state = classify(point.avg, model.range)
  const color = !point.open
    ? tokens.foraHorario
    : state === 'above'
      ? tokens.acima
      : state === 'below'
        ? tokens.abaixo
        : tokens.temperatura
  const text = nowPillText(model, point, timeZone)
  const rich = { color: tokens.superficie, fontSize: 12, lineHeight: 14 }
  return {
    id: 'now',
    name: SERIES_NAME.temperature,
    type: 'line',
    data: [[point.t, point.avg]],
    symbol: 'circle',
    symbolSize: 8,
    showSymbol: true,
    z: Z.now,
    silent: true,
    tooltip: { show: false },
    emphasis: { disabled: true },
    itemStyle: { color, borderColor: tokens.superficie, borderWidth: 2 },
    label: {
      show: placement !== 'hidden',
      position: placement === 'bottom' ? 'bottom' : 'top',
      distance: 8,
      // A borda direita da pílula para na do ponto: a margem fica com os limites da faixa
      align: 'right',
      offset: [5, 0],
      formatter: text.prefix ? `{prefix|${text.prefix}} {value|${text.value}}` : `{value|${text.value}}`,
      rich: {
        prefix: { ...rich, fontWeight: 500, opacity: 0.75 },
        value: { ...rich, fontWeight: 600 },
      },
      backgroundColor: tokens.pilula,
      // Contorno na cor da superfície: as linhas que passam por trás não encostam no texto
      borderColor: tokens.superficie,
      borderWidth: 2,
      borderRadius: 6,
      padding: [3, 6],
    },
  }
}

/** Cores da tira por estado. */
function stripFill(state: StripState, theme: ChartTheme): Fill {
  const { tokens, hatches } = theme
  switch (state) {
    case 'within':
      return tokens.naFaixa
    case 'above':
      return tokens.acima
    case 'below':
      return tokens.abaixo
    case 'closed':
      return tokens.fechado
    case 'no_data':
      return hatches.semDados
    case 'discarded':
      return hatches.descartada
  }
}

export const STRIP_ID = 'strip'

/**
 * Tira de situação (seção 5.6): retângulos no segundo grid, com 1 px de respiro entre estados
 * diferentes. "Fechada" ganha contorno para não sumir no branco.
 */
export function situationStripLayer(
  model: ChartModel,
  theme: ChartTheme,
  formatTooltip: (index: number) => HTMLElement | string,
): CustomSeriesOption {
  const fills = model.strip.map((segment) => stripFill(segment.state, theme))
  return {
    id: STRIP_ID,
    type: 'custom',
    xAxisIndex: 1,
    yAxisIndex: 1,
    animation: false,
    data: model.strip.map((segment) => [segment.from, segment.to]),
    encode: { x: [0, 1] },
    tooltip: {
      trigger: 'item',
      formatter: (params) => formatTooltip((params as { dataIndex: number }).dataIndex),
    },
    renderItem: (params, api) => {
      const area = params.coordSys as unknown as CoordSys
      const start = Math.max(area.x, (api.coord([api.value(0), 0]) as number[])[0] ?? 0)
      const end = Math.min(area.x + area.width, (api.coord([api.value(1), 0]) as number[])[0] ?? 0)
      const last = params.dataIndex === model.strip.length - 1
      const width = end - start - (last ? 0 : 1)
      if (width <= 0) return null
      const closed = model.strip[params.dataIndex]?.state === 'closed'
      return {
        type: 'rect',
        shape: closed
          ? { x: start + 0.5, y: area.y + 0.5, width: width - 1, height: area.height - 1, r: 1 }
          : { x: start, y: area.y, width, height: area.height, r: 1 },
        style: {
          fill: fills[params.dataIndex] as string,
          ...(closed ? { stroke: theme.tokens.cursor, lineWidth: 1 } : {}),
        },
      }
    },
  }
}
