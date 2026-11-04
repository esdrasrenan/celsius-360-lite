import type { DataZoomComponentOption } from 'echarts/components'
import { axisTicks, DAY_MS, formatPointer, formatScaleValue, formatTick, HOUR_MS, yScale } from './axis'
import type { ChartOption } from './echarts'
import type { EdgeLabels } from './edge'
import {
  ANCHOR_ID,
  anchorSeries,
  brushShadowSeries,
  type ChartTheme,
  closedLayer,
  comfortLayer,
  gapLayers,
  type LayerVisibility,
  nowLayer,
  outdoorLayer,
  previousLayer,
  SERIES_NAME,
  situationStripLayer,
  spreadLayers,
  temperatureLayers,
  temperatureVisualMap,
} from './layers'
import type { ChartModel } from './model'

/** Margens do plot (seção 5.4). À esquerda cabem os números do eixo e o rótulo "Situação". */
export const GRID = { left: 56, right: 64, top: 16 } as const
/** Abaixo do plot: 6 px de respiro, a tira de 10 px e os rótulos do eixo X. */
const STRIP_GAP = 6
const STRIP_HEIGHT = 10
const BOTTOM = 40
const BRUSH = { height: 40, bottom: 8 } as const
const BOTTOM_WITH_BRUSH = BOTTOM + BRUSH.height + BRUSH.bottom + 4

/** A sombra do brush e a âncora do tooltip são sempre as duas primeiras séries. */
export const ANCHOR_INDEX = 1

/** Alça do brush: o polegar da régua da Diel (seção 5.7). */
const HANDLE_ICON = 'path://M3,0h0a3,3 0 0 1 3,3v14a3,3 0 0 1-3,3h0a3,3 0 0 1-3-3v-14a3,3 0 0 1 3-3z'

/** Brush só em 7 e 30 dias; em 24 horas o zoom é por Ctrl + roda e pinça. */
export function hasBrush(model: Pick<ChartModel, 'from' | 'to'>): boolean {
  return model.to - model.from > 1.5 * DAY_MS
}

/** Espaço abaixo do plot: eixo X, tira de situação e, em 7 e 30 dias, o brush. */
export function plotBottom(model: Pick<ChartModel, 'from' | 'to'>): number {
  return hasBrush(model) ? BOTTOM_WITH_BRUSH : BOTTOM
}

/** Menor janela de zoom: 2 h em 24 horas, 12 h em 7 dias e 1 dia em 30 dias. */
export function minZoomSpan(model: Pick<ChartModel, 'from' | 'to'>): number {
  const days = (model.to - model.from) / DAY_MS
  return days <= 1.5 ? 2 * HOUR_MS : days <= 10 ? 12 * HOUR_MS : DAY_MS
}

/**
 * "Loja fechada" nasce desligada quando o expediente vira zebra: menos de 24 px por intervalo
 * aberto. A tira de situação continua dizendo quando a loja estava fechada.
 */
export function closedIsDense(model: Pick<ChartModel, 'open' | 'closed'>, plotWidth: number): boolean {
  return model.open.length > 0 && plotWidth / model.open.length < 24
}

/** Camadas que existem no período (sem loja fechada num CPD 24 h, sem externa sem cidade...). */
export function layerAvailability(model: ChartModel): LayerVisibility {
  return {
    temperature: true,
    spread: model.spread === 'available',
    outdoor: model.outdoor.length > 0,
    comfort: true,
    closed: model.closed.length > 0,
    previous: model.previous != null,
  }
}

/**
 * Visibilidade de cada camada: o que o usuário escolheu na legenda vence o padrão, mas nunca liga
 * uma camada que não existe no período. "Período anterior" segue o botão Comparar.
 */
export function layerVisibility(
  model: ChartModel,
  plotWidth: number,
  chosen: Partial<LayerVisibility>,
): LayerVisibility {
  const available = layerAvailability(model)
  const defaults: LayerVisibility = {
    ...available,
    closed: available.closed && !closedIsDense(model, plotWidth),
  }
  return {
    temperature: chosen.temperature ?? defaults.temperature,
    spread: available.spread && (chosen.spread ?? defaults.spread),
    outdoor: available.outdoor && (chosen.outdoor ?? defaults.outdoor),
    comfort: chosen.comfort ?? defaults.comfort,
    closed: available.closed && (chosen.closed ?? defaults.closed),
    previous: available.previous,
  }
}

export interface ScaleState {
  scale: ReturnType<typeof yScale>
  /** Alguma leitura externa visível fica fora da escala. */
  outdoorClipped: boolean
}

/** Escala Y com as séries visíveis; a externa só entra quando o usuário pede (seção 5.4). */
export function scaleFor(model: ChartModel, visible: LayerVisibility, fitOutdoor: boolean): ScaleState {
  const extras: (number | null)[] = []
  if (visible.previous && model.previous) extras.push(...model.previous.points.map(([, value]) => value))
  if (visible.outdoor && fitOutdoor) extras.push(...model.outdoor.map(([, value]) => value))
  const scale = yScale(model.points, model.range, visible.spread && model.spread === 'available', extras)
  const outdoorClipped =
    visible.outdoor && model.outdoor.some(([, value]) => value < scale.min || value > scale.max)
  return { scale, outdoorClipped }
}

export interface OptionInput {
  model: ChartModel
  theme: ChartTheme
  visible: LayerVisibility
  fitOutdoor: boolean
  timeZone: string
  plotWidth: number
  /** Janela visível, para as marcas do eixo X. */
  view: readonly [number, number]
  summary: string
  /** Rótulos da borda direita que cabem sem se tocar. */
  edge: EdgeLabels
  /** Animação de dados (troca de período) ou nenhuma (carga e tempo real). */
  animate: boolean
  formatTooltip: (index: number) => HTMLElement | string
  formatStripTooltip: (index: number) => HTMLElement | string
}

/** Eixos X dos dois grids para a janela visível. Vai inteiro no setOption do zoom. */
export function xAxes(
  model: ChartModel,
  theme: ChartTheme,
  timeZone: string,
  plotWidth: number,
  view: readonly [number, number],
) {
  const { tokens } = theme
  const ticks = axisTicks(view[0], view[1], timeZone, plotWidth)
  const common = { type: 'time', min: model.from, max: model.to } as const
  return [
    {
      ...common,
      gridIndex: 0,
      axisLine: { show: false },
      // As marcas deste eixo só servem às linhas verticais da meia-noite
      axisTick: { show: false, customValues: ticks.midnights },
      splitLine: { show: true, lineStyle: { color: tokens.grade, type: 'solid' as const } },
      axisLabel: {
        customValues: ticks.labels,
        margin: STRIP_GAP + STRIP_HEIGHT + 8,
        color: tokens.eixo,
        fontSize: 12,
        hideOverlap: true,
        formatter: (value: number) => formatTick(value, timeZone, ticks.format),
        rich: { strong: { fontWeight: 600, color: tokens.eixo, fontSize: 12 } },
      },
      axisPointer: {
        label: {
          show: true,
          margin: STRIP_GAP + STRIP_HEIGHT + 4,
          formatter: (params: { value: unknown }) => formatPointer(Number(params.value), timeZone),
          backgroundColor: tokens.pilula,
          color: tokens.superficie,
          borderRadius: 999,
          padding: [3, 8],
          fontSize: 12,
          fontWeight: 500,
        },
      },
    },
    {
      ...common,
      gridIndex: 1,
      show: true,
      axisLine: { show: false },
      axisTick: {
        show: true,
        customValues: ticks.ticks,
        length: 4,
        lineStyle: { color: tokens.eixo, opacity: 0.5 },
      },
      axisLabel: { show: false },
      splitLine: { show: false },
      axisPointer: { show: false, triggerTooltip: false },
    },
  ]
}

/**
 * As séries com rótulo na borda direita. O zoom muda o que cabe ali (a pílula sai da janela, a
 * Externa termina em outra altura), então elas são reaplicadas sozinhas, pelo id.
 */
export function edgeSeries(
  model: ChartModel,
  theme: ChartTheme,
  timeZone: string,
  plotWidth: number,
  edge: EdgeLabels,
) {
  return [
    comfortLayer(model, theme, !closedIsDense(model, plotWidth), edge),
    outdoorLayer(model, theme, edge.outdoor),
    nowLayer(model, theme, timeZone, edge.pill),
  ].filter((item) => item != null)
}

export function buildOption(input: OptionInput): ChartOption {
  const { model, theme, visible, timeZone } = input
  const { tokens } = theme
  const brush = hasBrush(model)
  const { scale } = scaleFor(model, visible, input.fitOutdoor)
  const bottom = plotBottom(model)

  const series = [
    brushShadowSeries(model),
    anchorSeries(model),
    closedLayer(model, theme),
    comfortLayer(model, theme, !closedIsDense(model, input.plotWidth), input.edge),
    ...gapLayers(model, theme),
    ...spreadLayers(model, theme),
    previousLayer(model, theme),
    outdoorLayer(model, theme, input.edge.outdoor),
    ...temperatureLayers(model, theme),
    nowLayer(model, theme, timeZone, input.edge.pill),
    situationStripLayer(model, theme, input.formatStripTooltip),
  ].filter((item) => item != null)
  const temperatureIndex = series.findIndex((item) => item.id === 'temperature')

  const dataZoom: DataZoomComponentOption[] = [
    {
      type: 'inside',
      xAxisIndex: [0, 1],
      filterMode: 'none',
      zoomOnMouseWheel: 'ctrl',
      moveOnMouseWheel: false,
      moveOnMouseMove: true,
      preventDefaultMouseMove: false,
      minValueSpan: minZoomSpan(model),
    },
  ]
  if (brush) {
    dataZoom.push({
      type: 'slider',
      xAxisIndex: [0, 1],
      filterMode: 'none',
      height: BRUSH.height,
      bottom: BRUSH.bottom,
      left: GRID.left,
      right: GRID.right,
      borderColor: 'transparent',
      backgroundColor: tokens.trilho,
      fillerColor: tokens.zoom,
      borderRadius: 8,
      dataBackground: {
        lineStyle: { color: tokens.eixo, opacity: 0.5, width: 1 },
        areaStyle: { color: tokens.grade, opacity: 1 },
      },
      selectedDataBackground: {
        lineStyle: { color: tokens.acento, opacity: 0.8, width: 1 },
        areaStyle: { color: tokens.zoom, opacity: 1 },
      },
      handleIcon: HANDLE_ICON,
      handleSize: '60%',
      handleStyle: { color: tokens.superficie, borderColor: tokens.alca, borderWidth: 1 },
      moveHandleSize: 0,
      showDetail: false,
      brushSelect: true,
      emphasis: { handleStyle: { borderColor: tokens.acento } },
      minValueSpan: minZoomSpan(model),
    })
  }

  return {
    animation: input.animate,
    animationDuration: 0,
    animationDurationUpdate: 250,
    animationEasingUpdate: 'cubicOut',
    textStyle: { fontFamily: tokens.fontFamily, fontSize: 12, color: tokens.eixo },
    aria: { enabled: true, label: { description: input.summary } },
    legend: {
      show: false,
      data: Object.values(SERIES_NAME),
      selected: Object.fromEntries(
        Object.entries(SERIES_NAME).map(([layer, name]) => [name, visible[layer as keyof LayerVisibility]]),
      ),
    },
    grid: [
      { ...GRID, bottom },
      {
        left: GRID.left,
        right: GRID.right,
        bottom: bottom - STRIP_GAP - STRIP_HEIGHT,
        height: STRIP_HEIGHT,
      },
    ],
    xAxis: xAxes(model, theme, timeZone, input.plotWidth, input.view),
    yAxis: [
      {
        type: 'value',
        gridIndex: 0,
        min: scale.min,
        max: scale.max,
        interval: scale.interval,
        name: '°C',
        nameLocation: 'end',
        nameGap: 8,
        nameTextStyle: { color: tokens.eixo, fontSize: 12, align: 'right', padding: [0, 8, 0, 0] },
        axisLine: { show: false },
        axisTick: { show: false },
        // O menor valor sobe para dentro do plot: logo abaixo fica o rótulo "Situação"
        axisLabel: {
          color: tokens.eixo,
          fontSize: 12,
          margin: 8,
          formatter: formatScaleValue,
          verticalAlignMinLabel: 'bottom',
        },
        splitLine: { lineStyle: { color: tokens.grade, type: [4, 4] } },
        axisPointer: { show: false },
      },
      {
        type: 'value',
        gridIndex: 1,
        min: 0,
        max: 1,
        show: true,
        name: 'Situação',
        nameLocation: 'middle',
        nameRotate: 0,
        nameGap: 6,
        nameTextStyle: { color: tokens.eixo, fontSize: 12, align: 'right', verticalAlign: 'middle' },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
        axisPointer: { show: false },
      },
    ],
    visualMap: temperatureVisualMap(model, theme, temperatureIndex),
    tooltip: {
      trigger: 'axis',
      // Fica dentro do contêiner do gráfico, preso a ele (seção 5.3 pede appendTo: body): no
      // ECharts 6.1 o appendTo põe o tooltip de um toque fora da tela, somando a rolagem duas vezes
      confine: true,
      transitionDuration: 0.1,
      backgroundColor: 'transparent',
      borderWidth: 0,
      padding: 0,
      extraCssText: 'box-shadow:none;',
      axisPointer: {
        type: 'line',
        snap: true,
        lineStyle: { color: tokens.cursor, type: [4, 4], width: 1 },
      },
      formatter: (params) => {
        const list = Array.isArray(params) ? params : [params]
        const anchor = list.find((item) => item.seriesId === ANCHOR_ID)
        return anchor ? input.formatTooltip(anchor.dataIndex) : ''
      },
    },
    dataZoom,
    series,
  }
}
