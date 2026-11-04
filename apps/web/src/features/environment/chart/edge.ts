import type { YScale } from './axis'
import { type LayerVisibility, nowPillText } from './layers'
import type { ChartModel } from './model'

/**
 * Rótulos da borda direita do plot: a pílula do "agora", os limites da faixa ("25 °C", "21 °C") e
 * o nome da Externa. Os três disputam a mesma faixa vertical; quando dois se tocam, o de menor
 * prioridade some (pílula > limites > Externa). Faixa e Externa continuam na legenda.
 */

export type PillPlacement = 'top' | 'bottom' | 'hidden'

export interface EdgeLabels {
  max: boolean
  min: boolean
  outdoor: boolean
  pill: PillPlacement
}

/**
 * Plot mais estreito que isso (celular) fica sem a pílula, só com o ponto: ela cobriria boa parte
 * da janela, e a última leitura está no cabeçalho logo acima do gráfico.
 */
export const PILL_MIN_PLOT_WIDTH = 480

/** Pílula de 12 px com padding de 3 px; rótulos de texto de 12 px. */
const PILL_HEIGHT = 20
const LABEL_HEIGHT = 14
/** Do centro do ponto à borda da pílula: raio de 4 px mais a distância de 8 px. */
const PILL_OFFSET = 12
/** A borda direita da pílula passa 5 px do centro do ponto (o anel). */
const PILL_RIGHT = 5
const GAP = 2

/** Largura aproximada da pílula: 6,5 px por caractere de 12 px mais o padding de 6 px. */
export function pillWidth(text: string): number {
  return Math.ceil(text.length * 6.5) + 12
}

interface Band {
  center: number
  half: number
}

const collides = (a: Band, b: Band) => Math.abs(a.center - b.center) < a.half + b.half + GAP

/** Externa na ponta visível da linha: o ECharts põe o rótulo ali, interpolado na borda do zoom. */
export function outdoorAt(outdoor: ChartModel['outdoor'], t: number): number | null {
  const last = outdoor.at(-1)
  if (!last) return null
  if (t >= last[0]) return last[1]
  const after = outdoor.findIndex(([time]) => time >= t)
  if (after <= 0) return outdoor[0]?.[1] ?? null
  const [t0, v0] = outdoor[after - 1] as [number, number]
  const [t1, v1] = outdoor[after] as [number, number]
  return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0)
}

export function edgeLabels(
  model: Pick<ChartModel, 'latest' | 'range' | 'outdoor' | 'points' | 'bucket'>,
  scale: YScale,
  visible: LayerVisibility,
  plot: { width: number; height: number },
  view: readonly [number, number],
  /** Espaço acima do plot (grid.top), que a pílula pode ocupar. */
  headroom: number,
  timeZone: string,
): EdgeLabels {
  const y = (value: number) => ((scale.max - value) / (scale.max - scale.min)) * plot.height
  const x = (t: number) => ((t - view[0]) / (view[1] - view[0])) * plot.width
  const taken: Band[] = []
  const place = (band: Band) => {
    if (taken.some((other) => collides(band, other))) return false
    taken.push(band)
    return true
  }

  let pill: PillPlacement = 'hidden'
  const { latest } = model
  const shown = visible.temperature && latest?.avg != null && latest.t >= view[0] && latest.t <= view[1]
  if (shown && plot.width >= PILL_MIN_PLOT_WIDTH) {
    const dot = { x: x(latest.t), y: y(latest.avg as number) }
    const text = nowPillText(model, latest, timeZone)
    const right = dot.x + PILL_RIGHT
    const left = right - pillWidth([text.prefix, text.value].filter(Boolean).join(' '))
    const top = dot.y - PILL_OFFSET - PILL_HEIGHT
    const bottom = dot.y + PILL_OFFSET
    // Do lado com menos pontos de dados embaixo da pílula: ela nunca esconde o trecho mais recente
    const crowd = (from: number) => {
      let count = 0
      const hit = (t: number, value: number | null) => {
        if (value == null) return
        const px = x(t)
        const py = y(value)
        if (px >= left && px <= right && py >= from && py <= from + PILL_HEIGHT) count++
      }
      if (visible.temperature) for (const point of model.points) hit(point.t, point.avg)
      if (visible.outdoor) for (const [t, value] of model.outdoor) hit(t, value)
      return count
    }
    const topFits = top >= -headroom
    const bottomFits = bottom + PILL_HEIGHT <= plot.height
    pill = !topFits ? 'bottom' : !bottomFits ? 'top' : crowd(bottom) < crowd(top) ? 'bottom' : 'top'
    place({ center: (pill === 'top' ? top : bottom) + PILL_HEIGHT / 2, half: PILL_HEIGHT / 2 })
  }

  const limit = (value: number) => visible.comfort && place({ center: y(value), half: LABEL_HEIGHT / 2 })
  const max = limit(model.range.max)
  const min = limit(model.range.min)

  const end = visible.outdoor ? outdoorAt(model.outdoor, view[1]) : null
  const outdoor =
    end != null && end >= scale.min && end <= scale.max && place({ center: y(end), half: LABEL_HEIGHT / 2 })

  return { max, min, outdoor, pill }
}
