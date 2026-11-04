import { CustomChart, type CustomSeriesOption, LineChart, type LineSeriesOption } from 'echarts/charts'
import {
  AriaComponent,
  type AriaComponentOption,
  AxisPointerComponent,
  type DataZoomComponentOption,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  type GridComponentOption,
  LegendComponent,
  type LegendComponentOption,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  type TooltipComponentOption,
  type VisualMapComponentOption,
  VisualMapPiecewiseComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

// Registro mínimo (seção 5.11): só o que o gráfico de temperatura usa
echarts.use([
  LineChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  MarkAreaComponent,
  MarkLineComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  VisualMapPiecewiseComponent,
  AriaComponent,
  LegendComponent,
  CanvasRenderer,
])

export type ChartOption = echarts.ComposeOption<
  | LineSeriesOption
  | CustomSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | DataZoomComponentOption
  | VisualMapComponentOption
  | LegendComponentOption
  | AriaComponentOption
>

export type ChartInstance = echarts.ECharts

export { echarts }
