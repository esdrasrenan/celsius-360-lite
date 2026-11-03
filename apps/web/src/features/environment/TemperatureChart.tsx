import type { Series } from '@celsius/contracts'
import { LineChart } from 'echarts/charts'
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'
import { formatAxisTime, formatDateTime, formatTemperature } from '../../lib/format'
import { GAP_REASON } from '../../lib/labels'

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
  DataZoomComponent,
  AxisPointerComponent,
  CanvasRenderer,
])

const COLOR = {
  tinta: '#0b0c59',
  tinta3: '#5f6490',
  celsius: '#363bc4',
  ciano: '#00b9ce',
  calor: '#e5552e',
  linha: 'rgba(11, 12, 89, 0.1)',
  semDados: 'rgba(95, 100, 144, 0.16)',
  descartada: 'rgba(199, 119, 0, 0.16)',
  aberto: 'rgba(11, 12, 89, 0.04)',
}

interface TooltipParam {
  seriesName: string
  dataIndex: number
  value: [number, number | null]
}

const ms = (iso: string) => Date.parse(iso)

/**
 * Temperatura do ambiente com a faixa de conforto, o horário de funcionamento, a temperatura externa
 * e as lacunas. Buckets sem leitura válida chegam nulos da API e quebram a linha de propósito.
 */
export function TemperatureChart({ series, timeZone }: { series: Series; timeZone: string }) {
  const element = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!element.current) return
    const instance = echarts.init(element.current, undefined, { renderer: 'canvas' })
    chart.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(element.current)
    return () => {
      observer.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    const instance = chart.current
    if (!instance) return
    const spanDays = (ms(series.to) - ms(series.from)) / 86_400_000
    const { min, max } = series.comfortRange
    const values = series.points
      .flatMap((point) => [point.min, point.max])
      .filter((value): value is number => value !== null)
    const outdoor = series.outdoor.map((point) => point.value)
    // Escala em múltiplos de 2 °C que sempre mostra a faixa de conforto inteira
    const lowest = Math.floor((Math.min(min, ...values, ...outdoor) - 0.5) / 2) * 2
    const highest = Math.ceil((Math.max(max, ...values, ...outdoor) + 0.5) / 2) * 2

    instance.setOption(
      {
        animation: false,
        grid: { left: 52, right: 20, top: 44, bottom: spanDays > 3 ? 72 : 40 },
        legend: {
          top: 0,
          left: 0,
          icon: 'roundRect',
          itemWidth: 14,
          itemHeight: 4,
          itemGap: 20,
          textStyle: { color: COLOR.tinta3, fontFamily: 'Inter Variable', fontSize: 12 },
          data: ['Temperatura', 'Mín–máx', 'Externa'],
        },
        tooltip: {
          trigger: 'axis',
          backgroundColor: '#fff',
          borderColor: COLOR.linha,
          textStyle: { color: COLOR.tinta, fontFamily: 'Inter Variable', fontSize: 12 },
          formatter: (params: TooltipParam[]) => {
            const main = params.find((param) => param.seriesName === 'Temperatura')
            const external = params.find((param) => param.seriesName === 'Externa')
            const time = (main ?? params[0])?.value[0]
            if (time === undefined) return ''
            const point = main ? series.points[main.dataIndex] : undefined
            const rows = [
              `<span style="color:${COLOR.tinta3}">${formatDateTime(new Date(time).toISOString(), timeZone)}</span>`,
              `Temperatura: <b>${point?.avg == null ? 'sem leitura válida' : formatTemperature(point.avg)}</b>`,
            ]
            if (point?.min != null && point.max != null && point.max !== point.min) {
              rows.push(`Mín–máx: ${formatTemperature(point.min)} a ${formatTemperature(point.max)}`)
            }
            if (external?.value[1] != null) rows.push(`Externa: ${formatTemperature(external.value[1])}`)
            rows.push(
              `<span style="color:${COLOR.tinta3}">Faixa: ${formatTemperature(min)} a ${formatTemperature(max)}</span>`,
            )
            return rows.join('<br/>')
          },
        },
        xAxis: {
          type: 'time',
          min: ms(series.from),
          max: ms(series.to),
          axisLine: { lineStyle: { color: COLOR.linha } },
          axisLabel: {
            color: COLOR.tinta3,
            hideOverlap: true,
            formatter: (value: number) => formatAxisTime(value, timeZone, spanDays > 1.5),
          },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          min: lowest,
          max: highest,
          interval: highest - lowest > 16 ? 4 : 2,
          axisLabel: { color: COLOR.tinta3, formatter: '{value} °C' },
          splitLine: { lineStyle: { color: COLOR.linha } },
        },
        dataZoom:
          spanDays > 3
            ? [
                { type: 'inside', filterMode: 'none' },
                {
                  type: 'slider',
                  height: 22,
                  bottom: 12,
                  filterMode: 'none',
                  borderColor: COLOR.linha,
                  fillerColor: 'rgba(54, 59, 196, 0.08)',
                  handleStyle: { color: COLOR.celsius },
                  textStyle: { color: COLOR.tinta3 },
                  labelFormatter: (value: number) => formatDateTime(new Date(value).toISOString(), timeZone),
                },
              ]
            : [],
        series: [
          // Faixa mín–máx como área empilhada: base invisível + amplitude
          {
            name: 'Mín–máx base',
            type: 'line',
            stack: 'faixa',
            symbol: 'none',
            lineStyle: { opacity: 0 },
            data: series.points.map((point) => [ms(point.t), point.min]),
            silent: true,
          },
          {
            name: 'Mín–máx',
            type: 'line',
            stack: 'faixa',
            symbol: 'none',
            lineStyle: { opacity: 0 },
            itemStyle: { color: 'rgba(54, 59, 196, 0.35)' },
            areaStyle: { color: 'rgba(54, 59, 196, 0.12)' },
            data: series.points.map((point) => [
              ms(point.t),
              point.max === null || point.min === null ? null : Math.round((point.max - point.min) * 10) / 10,
            ]),
          },
          {
            name: 'Temperatura',
            type: 'line',
            symbol: 'none',
            connectNulls: false,
            itemStyle: { color: COLOR.tinta },
            lineStyle: { width: 2, color: COLOR.tinta },
            data: series.points.map((point) => [ms(point.t), point.avg]),
            markArea: {
              silent: true,
              data: [
                [
                  {
                    yAxis: min,
                    itemStyle: {
                      color: 'rgba(0, 185, 206, 0.1)',
                      borderColor: COLOR.ciano,
                      borderWidth: 1,
                      borderType: 'dashed',
                    },
                  },
                  { yAxis: max },
                ],
                ...series.openIntervals.map((interval) => [
                  { xAxis: ms(interval.from), itemStyle: { color: COLOR.aberto } },
                  { xAxis: ms(interval.to) },
                ]),
                ...series.gaps.map((gap) => [
                  {
                    xAxis: ms(gap.from),
                    name:
                      gap.kind === 'no_data'
                        ? 'Sem dados'
                        : (GAP_REASON[gap.reason ?? ''] ?? 'Leitura descartada'),
                    itemStyle: { color: gap.kind === 'no_data' ? COLOR.semDados : COLOR.descartada },
                    label: { show: true, position: 'insideTop', color: COLOR.tinta3, fontSize: 11 },
                  },
                  { xAxis: ms(gap.to) },
                ]),
              ],
            },
          },
          {
            name: 'Externa',
            type: 'line',
            symbol: 'none',
            itemStyle: { color: COLOR.calor },
            lineStyle: { width: 1.5, type: 'dashed', color: COLOR.calor, opacity: 0.8 },
            data: series.outdoor.map((point) => [ms(point.t), point.value]),
          },
        ],
      },
      { notMerge: true },
    )
  }, [series, timeZone])

  return (
    <div
      ref={element}
      className="h-[380px] w-full"
      role="img"
      aria-label="Gráfico da temperatura do ambiente"
    />
  )
}
