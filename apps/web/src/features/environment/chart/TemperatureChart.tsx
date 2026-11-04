import type { Series } from '@celsius/contracts'
import { ZoomOutAreaIcon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import {
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button } from '../../../components/Button'
import { chartHatches, chartTokens, prefersReducedMotion } from '../../../lib/chart-theme'
import { formatPeriod, formatRange, formatTimeZoneLabel } from '../../../lib/format'
import { DAY_MS, formatWindow } from './axis'
import { ChartLegend, type LegendToggle } from './ChartLegend'
import { type ChartInstance, echarts } from './echarts'
import { edgeLabels } from './edge'
import { keyCommand, keyContext } from './keyboard'
import { type ChartTheme, LAYERS, type LayerVisibility, SERIES_NAME } from './layers'
import { buildModel } from './model'
import {
  ANCHOR_INDEX,
  buildOption,
  closedIsDense,
  edgeSeries,
  GRID,
  hasBrush,
  layerVisibility,
  minZoomSpan,
  plotBottom,
  scaleFor,
  xAxes,
} from './option'
import { describeChart } from './summary'
import {
  announcement,
  BUCKET_TITLE,
  previousLabel,
  renderStripTooltip,
  renderTooltip,
  stripText,
  tooltipContent,
} from './tooltip'
import { useMediaQuery } from './useMediaQuery'

export interface TemperatureChartHandle {
  /** Amplia no intervalo (ISO 8601) e rola até o gráfico: o "Ver no gráfico" da lista de lacunas. */
  zoomTo(fromIso: string, toIso: string): void
  resetZoom(): void
}

type View = readonly [number, number]

interface ZoomEvent {
  start?: number
  end?: number
  startValue?: number
  endValue?: number
  batch?: ZoomEvent[]
}

const MOBILE_QUERY = '(max-width: 639.98px)'
/** No celular, 30 dias abrem nos últimos 7 (seção 4.3). */
const MOBILE_WINDOW = 7 * DAY_MS
const ANNOUNCE_EVERY_MS = 500
const ZOOM_HINT_MS = 4000
/** O zrender escuta o wheel e, onde ele não existe, o legado mousewheel. */
const WHEEL_EVENTS = ['wheel', 'mousewheel']

// A dica de zoom aparece uma vez por carga da página, não a cada gráfico
let zoomHintShown = false

const layerOf = (name: string) => LAYERS.find((layer) => SERIES_NAME[layer] === name)

/** Bucket e duração: muda na troca de período, não quando o tempo real anda a janela. */
const windowKey = (bucket: string, from: number, to: number) => `${bucket}|${to - from}`
const seriesWindow = (value: Series) => windowKey(value.bucket, Date.parse(value.from), Date.parse(value.to))

interface Snapshot {
  series: Series
  previous: Series | null
}

/**
 * Temperatura do ambiente no período (seção 5): camadas legendáveis, tooltip com a situação, tira
 * de situação, zoom com Ctrl + roda e brush, teclado e resumo para leitor de tela. Com o ponteiro
 * em cima, as atualizações ao vivo esperam: o selo "Novos dados" aplica quando o usuário quiser.
 */
export function TemperatureChart({
  series,
  previous,
  timeZone,
  title,
  ref,
}: {
  series: Series
  previous: Series | null
  timeZone: string
  title: string
  ref?: Ref<TemperatureChartHandle>
}) {
  const titleId = useId()
  const summaryId = useId()
  const container = useRef<HTMLDivElement>(null)
  const figure = useRef<HTMLElement>(null)
  const chartRef = useRef<ChartInstance | null>(null)
  const themeRef = useRef<ChartTheme | null>(null)
  /** Período aplicado ao gráfico e janela visível, lidos pelos eventos do ECharts. */
  const spanRef = useRef<View>([0, 0])
  const viewRef = useRef<View | null>(null)
  const periodKey = useRef<string | null>(null)
  const cursor = useRef<number | null>(null)
  const announcer = useRef({ last: 0, timer: 0 })
  const hintTimer = useRef(0)

  const [ready, setReady] = useState(false)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<View | null>(null)
  const [chosen, setChosen] = useState<Partial<LayerVisibility>>({})
  const [fitOutdoor, setFitOutdoor] = useState(false)
  const [frozen, setFrozen] = useState<Snapshot | null>(null)
  const [spoken, setSpoken] = useState('')
  const [zoomHint, setZoomHint] = useState(false)
  const narrow = useMediaQuery(MOBILE_QUERY)

  // Com o ponteiro em cima, só o tempo real espera; troca de período ou de comparação aplica na hora
  const holding =
    frozen != null &&
    seriesWindow(frozen.series) === seriesWindow(series) &&
    (frozen.previous == null) === (previous == null)
  const shown = holding ? frozen : { series, previous }
  const stale = holding && (frozen.series !== series || frozen.previous !== previous)
  const model = useMemo(() => buildModel(shown.series, shown.previous), [shown.series, shown.previous])
  const brush = hasBrush(model)
  const plotWidth = Math.max(0, size.width - GRID.left - GRID.right)
  const plotHeight = Math.max(0, size.height - GRID.top - plotBottom(model))
  const visible = useMemo(() => layerVisibility(model, plotWidth, chosen), [model, plotWidth, chosen])
  const { scale, outdoorClipped } = useMemo(
    () => scaleFor(model, visible, fitOutdoor),
    [model, visible, fitOutdoor],
  )
  const summary = useMemo(() => describeChart(model, timeZone), [model, timeZone])
  const total = model.to - model.from
  const zoomed = view != null && view[1] - view[0] < total * 0.995
  const plot = { width: plotWidth, height: plotHeight }
  // Recalculado a cada janela do zoom; o efeito da borda só reaplica quando a resposta muda
  const edge =
    view && plotHeight > 0 ? edgeLabels(model, scale, visible, plot, view, GRID.top, timeZone) : null
  const {
    max: edgeMax = true,
    min: edgeMin = true,
    outdoor: edgeOutdoor = true,
    pill = 'hidden',
  } = edge ?? {}

  // Inicia depois das fontes: o canvas mede o texto na primeira pintura (achado 12)
  useEffect(() => {
    const element = container.current
    if (!element) return
    let disposed = false
    let frame = 0
    let instance: ChartInstance | null = null
    let observer: ResizeObserver | null = null
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    // O zoom "inside" do ECharts 6 consome toda roda sobre o grid (preventDefault e
    // stopPropagation), mesmo com zoomOnMouseWheel: 'ctrl'. Sem Ctrl, a roda para aqui, antes do
    // zrender, e a página rola (seção 5.7, achado 49); com Ctrl (ou a pinça do trackpad), amplia
    const passWheel = (event: Event) => {
      if (!(event as WheelEvent).ctrlKey) event.stopPropagation()
    }
    for (const name of WHEEL_EVENTS) element.addEventListener(name, passWheel, { capture: true })

    void document.fonts.ready.then(() => {
      if (disposed) return
      const chart = echarts.init(element, null, { renderer: 'canvas' })
      instance = chart
      chartRef.current = chart
      chart.on('datazoom', (event) => {
        const next = readZoom(chart, event as ZoomEvent, spanRef.current)
        viewRef.current = next
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => setView(next))
      })
      chart.on('legendselectchanged', (event) => {
        const { name, selected } = event as { name: string; selected: Record<string, boolean> }
        const layer = layerOf(name)
        if (layer) setChosen((current) => ({ ...current, [layer]: selected[name] ?? true }))
      })
      chart.getZr().on('dblclick', () => chart.dispatchAction({ type: 'dataZoom', start: 0, end: 100 }))
      observer = new ResizeObserver(() => {
        chart.resize()
        measure()
      })
      observer.observe(element)
      measure()
      setReady(true)
    })

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      for (const name of WHEEL_EVENTS) element.removeEventListener(name, passWheel, { capture: true })
      observer?.disconnect()
      instance?.dispose()
      chartRef.current = null
      periodKey.current = null
      setReady(false)
    }
  }, [])

  // Dados, camadas e tamanho. Troca de período redefine o zoom; tempo real o preserva (seção 5.9)
  useEffect(() => {
    const chart = chartRef.current
    if (!ready || !chart || plotWidth <= 0 || plotHeight <= 0) return
    themeRef.current ??= { tokens: chartTokens(), hatches: chartHatches() }
    const theme = themeRef.current
    const key = windowKey(model.bucket, model.from, model.to)
    const reset = periodKey.current !== key
    const animate = reset && periodKey.current !== null && !prefersReducedMotion()
    periodKey.current = key

    let next: View
    if (reset) {
      next =
        narrow && model.to - model.from > 10 * DAY_MS
          ? [model.to - MOBILE_WINDOW, model.to]
          : [model.from, model.to]
    } else {
      // O ECharts é a fonte da janela: lê start e end (percentuais) antes de reaplicar
      const current = (chart.getOption().dataZoom as ZoomEvent[] | undefined)?.[0]
      const start = current?.start ?? 0
      const end = current?.end ?? 100
      next = [
        model.from + ((model.to - model.from) * start) / 100,
        model.from + ((model.to - model.from) * end) / 100,
      ]
    }
    const range = {
      start: ((next[0] - model.from) / (model.to - model.from)) * 100,
      end: ((next[1] - model.from) / (model.to - model.from)) * 100,
    }
    spanRef.current = [model.from, model.to]
    viewRef.current = next

    const option = buildOption({
      model,
      theme,
      visible,
      fitOutdoor,
      timeZone,
      plotWidth,
      view: next,
      summary,
      edge: edgeLabels(
        model,
        scale,
        visible,
        { width: plotWidth, height: plotHeight },
        next,
        GRID.top,
        timeZone,
      ),
      animate,
      formatTooltip: (index) => {
        cursor.current = index
        const content = tooltipContent(model, index, visible, timeZone)
        return content ? renderTooltip(content) : ''
      },
      formatStripTooltip: (index) => {
        const segment = model.strip[index]
        return segment ? renderStripTooltip(stripText(segment, timeZone)) : ''
      },
    })
    for (const zoom of option.dataZoom as ZoomEvent[]) Object.assign(zoom, range)
    chart.setOption(option, { replaceMerge: reset ? ['series', 'dataZoom'] : ['series'] })
    setView(next)
  }, [ready, plotWidth, plotHeight, model, visible, scale, fitOutdoor, narrow, timeZone, summary])

  // Só as marcas do eixo X acompanham o zoom: refazer as séries a cada quadro do arraste pesaria
  useEffect(() => {
    const chart = chartRef.current
    const theme = themeRef.current
    if (!ready || !chart || !theme || !view || plotWidth <= 0) return
    chart.setOption({ xAxis: xAxes(model, theme, timeZone, plotWidth, view) })
  }, [ready, view, model, timeZone, plotWidth])

  // O que cabe na borda direita muda com o zoom (a pílula sai da janela, a Externa termina em
  // outra altura): só essas três séries são reaplicadas, e só quando a resposta muda
  useEffect(() => {
    const chart = chartRef.current
    const theme = themeRef.current
    if (!ready || !chart || !theme || plotWidth <= 0) return
    const labels = { max: edgeMax, min: edgeMin, outdoor: edgeOutdoor, pill }
    chart.setOption({ series: edgeSeries(model, theme, timeZone, plotWidth, labels) })
  }, [ready, model, timeZone, plotWidth, edgeMax, edgeMin, edgeOutdoor, pill])

  useEffect(
    () => () => {
      clearTimeout(announcer.current.timer)
      clearTimeout(hintTimer.current)
    },
    [],
  )

  const resetZoom = () => chartRef.current?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })

  const zoomWindow = (from: number, to: number) => {
    const chart = chartRef.current
    if (!chart) return
    const [first, last] = spanRef.current
    const span = Math.min(last - first, Math.max(to - from, minZoomSpan({ from: first, to: last })))
    const start = Math.min(Math.max(first, (from + to) / 2 - span / 2), last - span)
    chart.dispatchAction({ type: 'dataZoom', startValue: start, endValue: start + span })
  }

  useImperativeHandle(ref, () => ({
    zoomTo(fromIso, toIso) {
      zoomWindow(Date.parse(fromIso), Date.parse(toIso))
      figure.current?.scrollIntoView({
        block: 'center',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      })
    },
    resetZoom,
  }))

  const speak = (text: string) => {
    const state = announcer.current
    clearTimeout(state.timer)
    const wait = Math.max(0, state.last + ANNOUNCE_EVERY_MS - Date.now())
    state.timer = window.setTimeout(() => {
      state.last = Date.now()
      setSpoken(text)
    }, wait)
  }

  const showPoint = (index: number) => {
    const chart = chartRef.current
    const point = model.points[index]
    if (!chart || !point) return
    const [start, end] = viewRef.current ?? [model.from, model.to]
    if (point.t < start || point.t + model.bucketMs > end) {
      const span = end - start
      zoomWindow(point.t - span / 2, point.t + span / 2)
    }
    cursor.current = index
    chart.dispatchAction({ type: 'showTip', seriesIndex: ANCHOR_INDEX, dataIndex: index })
    speak(announcement(model, index, timeZone))
  }

  // Teclado (seção 5.10): os comandos saem de keyCommand, testado à parte
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const chart = chartRef.current
    if (!chart || model.points.length === 0 || event.ctrlKey || event.metaKey || event.altKey) return
    const [start, end] = viewRef.current ?? [model.from, model.to]
    const context = keyContext(model, [start, end], cursor.current)
    const command = keyCommand(event.key, context)
    if (!command) return
    event.preventDefault()
    switch (command.kind) {
      case 'point':
        showPoint(command.index)
        break
      case 'zoom': {
        const center = model.points[context.current]?.t ?? (start + end) / 2
        const span = (end - start) * command.factor
        zoomWindow(center - span / 2, center + span / 2)
        break
      }
      case 'reset':
        resetZoom()
        break
      case 'hide':
        // O showTip do teclado também liga o cursor e a pílula de data, que o hideTip não apaga
        chart.dispatchAction({ type: 'hideTip' })
        chart.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' })
        cursor.current = null
        setZoomHint(false)
        break
    }
  }

  const onPlotEnter = (event: PointerEvent<HTMLElement>) => {
    if (zoomHintShown || event.pointerType !== 'mouse') return
    zoomHintShown = true
    setZoomHint(true)
    hintTimer.current = window.setTimeout(() => setZoomHint(false), ZOOM_HINT_MS)
  }

  const hover = (key: string | null) => {
    const chart = chartRef.current
    if (!chart) return
    chart.dispatchAction({ type: 'downplay' })
    const layer = LAYERS.find((item) => item === key)
    if (layer && visible[layer]) chart.dispatchAction({ type: 'highlight', seriesName: SERIES_NAME[layer] })
  }

  const closedHint = closedIsDense(model, plotWidth)
    ? 'Desligada por padrão quando o expediente vira listras finas: a tira de situação mostra quando a loja estava fechada.'
    : 'Fora do horário de funcionamento: não entra no cálculo de conforto.'
  const legend: LegendToggle[] = [
    {
      key: 'temperature',
      label: 'Temperatura',
      swatch: 'temperature',
      pressed: visible.temperature,
      hint: 'Azul abaixo da faixa, laranja acima, cinza com a loja fechada.',
    },
    {
      key: 'spread',
      label: 'Variação no intervalo',
      swatch: 'spread',
      pressed: visible.spread,
      unavailable: model.spread !== 'available',
      hint:
        model.spread === 'bucket'
          ? 'Indisponível em médias de 5 min ou menos.'
          : model.spread === 'flat'
            ? 'Indisponível: a variação média dentro de cada intervalo fica abaixo de 0,3 °C.'
            : 'Menor e maior leitura dentro de cada média.',
    },
    ...(model.outdoor.length
      ? [
          {
            key: 'outdoor',
            label: 'Externa (Open-Meteo)',
            swatch: 'outdoor' as const,
            pressed: visible.outdoor,
            hint:
              outdoorClipped && !fitOutdoor
                ? 'Parcialmente fora da escala. Use "Ajustar escala à externa" para ver a curva inteira.'
                : 'Temperatura externa horária da cidade da loja.',
          },
        ]
      : []),
    {
      key: 'comfort',
      label: `Faixa de conforto ${formatRange(model.range)}`,
      swatch: 'comfort',
      pressed: visible.comfort,
    },
    ...(model.closed.length
      ? [
          {
            key: 'closed',
            label: 'Loja fechada',
            swatch: 'closed' as const,
            pressed: visible.closed,
            hint: closedHint,
          },
        ]
      : []),
  ]

  const toggle = (key: string) => {
    const layer = LAYERS.find((item) => item === key)
    if (layer) chartRef.current?.dispatchAction({ type: 'legendToggleSelect', name: SERIES_NAME[layer] })
  }

  const noData = model.gaps.filter((gap) => gap.kind === 'no_data').length
  const windowText = view && formatWindow(view[1] - view[0], total)

  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      onPointerEnter={() => setFrozen({ series, previous })}
      onPointerLeave={() => setFrozen(null)}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={titleId} className="text-texto text-titulo-3">
            {title}
          </h2>
          <p className="text-apoio text-texto-3">
            {BUCKET_TITLE[model.bucket]} · {formatTimeZoneLabel(timeZone, model.to)}
          </p>
        </div>
        <div className="flex min-h-8 flex-wrap items-center justify-end gap-2">
          {stale && (
            <button
              type="button"
              onClick={() => setFrozen({ series, previous })}
              className="pressionavel h-6 rounded-full bg-acento-fundo px-2 font-medium text-acento text-legenda hover:bg-selecionado"
            >
              Novos dados · Atualizar
            </button>
          )}
          {zoomed && view && narrow && (
            <button
              type="button"
              onClick={resetZoom}
              className="pressionavel inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full bg-superficie-3 px-2.5 font-medium text-legenda text-texto-2 hover:bg-pressionado"
            >
              <span className="num">Mostrando {windowText}</span>
              <span aria-hidden="true">·</span>
              <span className="text-acento">Ver tudo</span>
            </button>
          )}
          {zoomed && view && !narrow && (
            <>
              <span className="num text-apoio text-texto-3">
                Exibindo {formatPeriod(view[0], view[1], timeZone)} ({windowText})
              </span>
              <Button variant="ghost" size="sm" icon={ZoomOutAreaIcon} onClick={resetZoom}>
                Redefinir zoom
              </Button>
            </>
          )}
        </div>
      </div>

      <ChartLegend
        items={legend}
        previous={model.previous ? `Período anterior (${previousLabel(model.previous.shift)})` : null}
        noData={noData}
        discarded={model.gaps.length - noData}
        fitOutdoor={visible.outdoor && (outdoorClipped || fitOutdoor) ? fitOutdoor : null}
        onToggle={toggle}
        onHover={hover}
        onFitOutdoor={() => setFitOutdoor((current) => !current)}
      />

      <figure
        ref={figure}
        // Widget composto (seção 5.10): no papel application o leitor de tela entra em modo de foco
        // e entrega ao gráfico as setas, PageUp/PageDown, Home/End, + − 0 e Esc; cada leitura sai
        // pela região aria-live e o resumo vai em aria-describedby
        role="application"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: application recebe o foco e as teclas acima; o Biome só conta como interativos os papéis de widget
        tabIndex={0}
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        aria-roledescription="gráfico"
        onKeyDown={onKeyDown}
        onPointerEnter={onPlotEnter}
        className="relative rounded-md"
      >
        <div
          ref={container}
          className={clsx('w-full touch-pan-y', brush ? 'h-87 sm:h-107' : 'h-74 sm:h-94')}
        />
        <p id={summaryId} className="so-leitor">
          {summary}
        </p>
        {zoomHint && (
          <p
            aria-hidden="true"
            className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-inverso px-2 py-1.5 text-legenda text-texto-inverso shadow-dica"
          >
            {brush ? 'Ctrl + rolagem ou arraste no brush para ampliar' : 'Ctrl + rolagem para ampliar'}
          </p>
        )}
      </figure>
      <p aria-live="polite" className="so-leitor">
        {spoken}
      </p>
    </div>
  )
}

/** Janela visível a partir do evento de zoom (percentuais do inside e do brush, ou valores). */
function readZoom(chart: ChartInstance, event: ZoomEvent, span: View): View {
  const item = event.batch?.[0] ?? event
  const [from, to] = span
  if (item.startValue != null && item.endValue != null)
    return [Number(item.startValue), Number(item.endValue)]
  let { start, end } = item
  if (start == null || end == null) {
    const current = (chart.getOption().dataZoom as ZoomEvent[] | undefined)?.[0]
    start = current?.start ?? 0
    end = current?.end ?? 100
  }
  return [from + ((to - from) * start) / 100, from + ((to - from) * end) / 100]
}
