/**
 * Amostras da legenda e do tooltip, desenhadas com a mesma forma da marca no gráfico (seção 3.16).
 * Cada uma é uma lista de formas SVG num quadro de 16×10; a legenda as monta em React e o tooltip
 * em DOM, então as duas nunca divergem. As cores são variáveis CSS, nunca valores soltos.
 */

import { OUTDOOR_OPACITY } from './layers'

export type SwatchKind =
  | 'temperature'
  | 'temperature-within'
  | 'temperature-above'
  | 'temperature-below'
  | 'temperature-closed'
  | 'spread'
  | 'outdoor'
  | 'comfort'
  | 'closed'
  | 'previous'

export interface SwatchShape {
  tag: 'line' | 'rect'
  attrs: Record<string, number | string>
  style: { fill?: string; stroke?: string; strokeWidth?: number; strokeDasharray?: string; opacity?: number }
}

const token = (name: string) => `var(--grafico-${name})`

const line = (color: string, width: number, dash?: string, x1 = 0, x2 = 16): SwatchShape => ({
  tag: 'line',
  attrs: { x1, x2, y1: 5, y2: 5 },
  style: { stroke: color, strokeWidth: width, ...(dash ? { strokeDasharray: dash } : {}) },
})

const faded = (shape: SwatchShape, opacity: number): SwatchShape => ({
  ...shape,
  style: { ...shape.style, opacity },
})

const box = (fill: string, stroke?: string): SwatchShape => ({
  tag: 'rect',
  attrs: { x: 0.5, y: 1.5, width: 15, height: 7, rx: 1.5 },
  style: { fill, ...(stroke ? { stroke, strokeWidth: 1 } : {}) },
})

const SHAPES: Record<SwatchKind, SwatchShape[]> = {
  temperature: [
    line(token('abaixo'), 2, undefined, 0, 5.5),
    line(token('temperatura'), 2, undefined, 5.5, 10.5),
    line(token('acima'), 2, undefined, 10.5, 16),
  ],
  'temperature-within': [line(token('temperatura'), 2)],
  'temperature-above': [line(token('acima'), 2)],
  'temperature-below': [line(token('abaixo'), 2)],
  'temperature-closed': [line(token('fora-horario'), 2)],
  spread: [box(token('variacao'))],
  outdoor: [faded(line(token('externa'), 1, '4 3'), OUTDOOR_OPACITY)],
  comfort: [
    box(token('faixa')),
    { ...line(token('faixa-borda'), 1, '3 2'), attrs: { x1: 0, x2: 16, y1: 1.5, y2: 1.5 } },
    { ...line(token('faixa-borda'), 1, '3 2'), attrs: { x1: 0, x2: 16, y1: 8.5, y2: 8.5 } },
  ],
  closed: [box(token('fechado'), token('cursor'))],
  previous: [line(token('comparacao'), 1.5, '2 3')],
}

/**
 * Formas da amostra. Desligada, o retângulo fica vazado (só o contorno) e a linha mantém o traço;
 * a opacidade de 30% fica por conta de quem desenha.
 */
export function swatchShapes(kind: SwatchKind, off = false): SwatchShape[] {
  const shapes = SHAPES[kind]
  if (!off) return shapes
  return shapes.map((shape) =>
    shape.tag === 'rect'
      ? { ...shape, style: { fill: 'none', stroke: token('eixo'), strokeWidth: 1 } }
      : shape,
  )
}
