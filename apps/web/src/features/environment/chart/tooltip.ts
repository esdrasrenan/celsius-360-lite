import type { SeriesBucket } from '@celsius/contracts'
import { ArrowDown02Icon, ArrowUp02Icon, Clock01Icon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { clsx } from 'clsx'
import {
  formatAxisTick,
  formatBucketHeader,
  formatDateTime,
  formatDecimal,
  formatDeviation,
  formatDuration,
  formatTemperature,
  formatTimeZoneLabel,
  NBSP,
} from '../../../lib/format'
import { DISCARD_REASON, NO_DATA_GAP, SITUATION_STATE, TONE_CLASS } from '../../../lib/states'
import { formatPointer, HOUR_MS } from './axis'
import type { LayerVisibility } from './layers'
import { type ChartGap, type ChartModel, classify, deviation, type StripSegment } from './model'
import { type SwatchKind, swatchShapes } from './swatches'

/**
 * Tooltip do gráfico (seção 5.3). O conteúdo é montado como dado (testável) e depois vira DOM com
 * textContent: nomes e motivos vêm da API e nunca passam por innerHTML.
 */

export interface TooltipRow {
  swatch: SwatchKind
  label: string
  value: string
}

export type TooltipStatus =
  | { kind: 'situation'; state: 'within' | 'above' | 'below'; deviation: string | null }
  | { kind: 'unknown' }

export interface TooltipNote {
  kind: 'closed' | 'no_data' | 'discarded'
  text: string
}

export interface TooltipContent {
  header: string
  subheader: string
  rows: TooltipRow[]
  status: TooltipStatus | null
  notes: TooltipNote[]
}

const BUCKET_LABEL: Record<SeriesBucket, string> = {
  raw: 'Leitura de 30 s',
  '5m': 'Média de 5 min',
  '15m': 'Média de 15 min',
  '1h': 'Média de 1 h',
}

/** "Médias de 1 h" para o subtítulo do cartão. */
export const BUCKET_TITLE: Record<SeriesBucket, string> = {
  raw: 'Leituras de 30 s',
  '5m': 'Médias de 5 min',
  '15m': 'Médias de 15 min',
  '1h': 'Médias de 1 h',
}

/** "horário de Recife", sem o deslocamento (que já está no subtítulo do cartão). */
export function shortTimeZoneLabel(timeZone: string, at: number): string {
  return formatTimeZoneLabel(timeZone, at).replace(/ \(.*\)$/, '')
}

/** "7 dias antes", "24 horas antes": o tamanho do deslocamento da comparação. */
export function previousLabel(shift: number): string {
  const hours = Math.round(shift / HOUR_MS)
  if (hours % 24 !== 0) return `${hours} h antes`
  const days = hours / 24
  return days === 1 ? '24 horas antes' : `${days} dias antes`
}

/** "+1,4" e "−0,6", sem unidade, para a diferença ao lado de um valor que já tem °C. */
function signedDifference(value: number): string {
  return formatDeviation(value).replace(`${NBSP}°C`, '')
}

export function gapNote(gap: ChartGap, timeZone: string): TooltipNote {
  const minutes = (gap.to - gap.from) / 60_000
  return {
    kind: gap.kind === 'no_data' ? 'no_data' : 'discarded',
    text: `${gap.info.label} · ${formatDateTime(gap.from, timeZone)} – ${formatDateTime(gap.to, timeZone)} (${formatDuration(minutes, 'calendar')})`,
  }
}

export const CLOSED_NOTE = 'Loja fechada · fora do cálculo de conforto'

/** Conteúdo do tooltip do bucket `index`, só com as séries visíveis. */
export function tooltipContent(
  model: ChartModel,
  index: number,
  visible: LayerVisibility,
  timeZone: string,
): TooltipContent | null {
  const point = model.points[index]
  if (!point) return null
  const end = model.bucket === 'raw' ? null : point.t + model.bucketMs
  const rows: TooltipRow[] = []

  if (visible.temperature) {
    const swatch: SwatchKind =
      point.avg == null || !point.open
        ? 'temperature-closed'
        : `temperature-${classify(point.avg, model.range)}`
    rows.push({
      swatch,
      label: 'Temperatura',
      value: point.avg == null ? 'Sem leitura válida' : formatTemperature(point.avg),
    })
  }
  if (visible.spread && model.spread === 'available' && point.min != null && point.max != null) {
    rows.push({
      swatch: 'spread',
      label: 'Variação no intervalo',
      value: `${formatDecimal(point.min)}–${formatDecimal(point.max)}${NBSP}°C`,
    })
  }
  const outdoor = model.outdoorByHour.get(Math.floor(point.t / HOUR_MS) * HOUR_MS)
  if (visible.outdoor && outdoor != null) {
    rows.push({ swatch: 'outdoor', label: 'Externa', value: formatTemperature(outdoor) })
  }
  if (visible.previous && model.previous) {
    const before = model.previous.byTime.get(point.t)
    if (before !== undefined) {
      const label = `${previousLabel(model.previous.shift)} (${formatAxisTick(point.t - model.previous.shift, timeZone, '7d')})`
      const difference =
        before != null && point.avg != null ? ` (${signedDifference(before - point.avg)})` : ''
      rows.push({ swatch: 'previous', label, value: `${formatTemperature(before)}${difference}` })
    }
  }

  const notes: TooltipNote[] = []
  let status: TooltipStatus | null = null
  if (!point.open) notes.push({ kind: 'closed', text: CLOSED_NOTE })
  else if (point.avg != null) {
    const state = classify(point.avg, model.range)
    const delta = deviation(point.avg, model.range)
    status = { kind: 'situation', state, deviation: state === 'within' ? null : formatDeviation(delta) }
  } else if (!point.gap) status = { kind: 'unknown' }
  if (point.gap) notes.push(gapNote(point.gap, timeZone))

  return {
    header: formatBucketHeader(point.t, end, timeZone),
    subheader: `${BUCKET_LABEL[model.bucket]} · ${shortTimeZoneLabel(timeZone, point.t)}`,
    rows,
    status,
    notes,
  }
}

/** Texto do tooltip da tira: "Acima da faixa · 08/02 13:00–15:30 (2 h 30 min)". */
export function stripText(segment: StripSegment, timeZone: string): string {
  const label =
    segment.state === 'closed'
      ? 'Loja fechada'
      : segment.state === 'no_data'
        ? NO_DATA_GAP.label
        : segment.state === 'discarded'
          ? (segment.gap?.info.label ?? 'Leitura descartada')
          : SITUATION_STATE[segment.state].label
  const start = formatDateTime(segment.from, timeZone)
  const end = formatDateTime(segment.to, timeZone)
  const sameDay = start.slice(0, 5) === end.slice(0, 5)
  const minutes = (segment.to - segment.from) / 60_000
  return `${label} · ${start}–${sameDay ? end.slice(6) : end} (${formatDuration(minutes, 'calendar')})`
}

/** Anúncio do teclado (aria-live): "sex 30/01 22:00, 24,4 °C, acima da faixa". */
export function announcement(model: ChartModel, index: number, timeZone: string): string {
  const point = model.points[index]
  if (!point) return ''
  const when = formatPointer(point.t, timeZone)
  if (point.avg == null) {
    return `${when}, sem leitura válida${point.gap ? `, ${point.gap.info.label.toLowerCase()}` : ''}`
  }
  const state = point.open
    ? SITUATION_STATE[classify(point.avg, model.range)].label.toLowerCase()
    : 'loja fechada'
  return `${when}, ${formatTemperature(point.avg)}, ${state}`
}

/* ---------------------------------------------------------------------------------------------
   DOM. Classes do Tailwind ficam aqui por inteiro, para o scanner achar os nomes.
   --------------------------------------------------------------------------------------------- */

const SVG = 'http://www.w3.org/2000/svg'

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag)
  node.className = className
  if (text != null) node.textContent = text
  return node
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

/** Ícone do Hugeicons em DOM, a partir da lista de formas do pacote (sem innerHTML). */
export function iconElement(icon: IconSvgElement, size = 12, className = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', clsx('shrink-0', className))
  for (const [tag, attrs] of icon) {
    const child = document.createElementNS(SVG, tag)
    for (const [name, value] of Object.entries(attrs)) {
      if (name !== 'key') child.setAttribute(kebab(name), String(value))
    }
    child.setAttribute('stroke-width', size <= 14 ? '2' : '1.75')
    svg.append(child)
  }
  return svg
}

function swatchElement(kind: SwatchKind): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '3 0 10 10')
  svg.setAttribute('width', '10')
  svg.setAttribute('height', '10')
  svg.setAttribute('aria-hidden', 'true')
  for (const shape of swatchShapes(kind)) {
    const child = document.createElementNS(SVG, shape.tag)
    for (const [name, value] of Object.entries(shape.attrs)) child.setAttribute(name, String(value))
    if (shape.style.fill) child.style.fill = shape.style.fill
    if (shape.style.stroke) child.style.stroke = shape.style.stroke
    if (shape.style.strokeWidth) child.style.strokeWidth = String(shape.style.strokeWidth)
    if (shape.style.strokeDasharray) child.style.strokeDasharray = shape.style.strokeDasharray
    if (shape.style.opacity != null) child.style.opacity = String(shape.style.opacity)
    svg.append(child)
  }
  return svg
}

const STATUS_ICON = { above: ArrowUp02Icon, below: ArrowDown02Icon } as const
const NOTE_SWATCH = {
  no_data: NO_DATA_GAP.hatchClass,
  discarded: DISCARD_REASON.stuck.hatchClass,
} as const

export function renderTooltip(content: TooltipContent): HTMLElement {
  // O contêiner do ECharts impõe white-space: nowrap; o motivo da lacuna precisa quebrar linha
  const root = element(
    'div',
    'flex min-w-56 max-w-72 flex-col whitespace-normal rounded-lg bg-superficie p-3 text-legenda text-texto-2 shadow-flutuante',
  )
  root.dataset.chartTooltip = ''
  root.append(
    element('p', 'num font-semibold text-texto', content.header),
    element('p', 'text-texto-3', content.subheader),
  )
  if (content.rows.length > 0) {
    const grid = element('div', 'grade-tooltip mt-2 border-borda border-t pt-2')
    for (const row of content.rows) {
      grid.append(
        swatchElement(row.swatch),
        element('span', 'min-w-0 truncate text-texto-3', row.label),
        element('span', 'num whitespace-nowrap text-right font-medium text-texto', row.value),
      )
    }
    root.append(grid)
  }

  const footer = element('div', 'mt-2 flex flex-col gap-1.5 border-borda border-t pt-2')
  const { status } = content
  if (status?.kind === 'situation') {
    const line = element('div', 'flex items-center gap-2')
    if (status.state === 'within') line.append(element('span', 'font-medium text-texto-2', 'Na faixa'))
    else {
      const info = SITUATION_STATE[status.state]
      const badge = element(
        'span',
        clsx(
          'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-1.5 font-medium ring-1 ring-inset',
          TONE_CLASS[info.tone].soft,
        ),
      )
      badge.append(iconElement(STATUS_ICON[status.state], 12, TONE_CLASS[info.tone].icon), info.label)
      line.append(badge, element('span', 'num font-medium text-texto', status.deviation ?? ''))
    }
    footer.append(line)
  } else if (status?.kind === 'unknown') {
    footer.append(element('span', 'text-texto-3', SITUATION_STATE.unknown.label))
  }
  for (const note of content.notes) {
    const line = element('div', 'flex items-start gap-2 text-texto-3')
    const mark =
      note.kind === 'closed'
        ? iconElement(Clock01Icon, 12, 'mt-0.5')
        : element(
            'span',
            clsx(
              'mt-0.5 size-3 shrink-0 rounded-xs ring-1 ring-borda-forte ring-inset',
              NOTE_SWATCH[note.kind],
            ),
          )
    line.append(mark, element('span', 'min-w-0 text-pretty', note.text))
    footer.append(line)
  }
  if (footer.childElementCount > 0) root.append(footer)
  return root
}

/** Tooltip da tira de situação: uma linha só. */
export function renderStripTooltip(text: string): HTMLElement {
  const root = element(
    'div',
    'num rounded-md bg-inverso px-2 py-1.5 text-legenda text-texto-inverso shadow-dica',
    text,
  )
  root.dataset.chartTooltip = ''
  return root
}
