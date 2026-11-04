import { type ChartModel, pointIndexAt } from './model'

/**
 * Teclado do gráfico (seção 5.10): ← e → andam um bucket, PageUp e PageDown 1/6 da janela, Home e
 * End vão às pontas visíveis, + e − ampliam e reduzem em volta do cursor, 0 redefine e Esc esconde
 * o tooltip.
 */

export type KeyCommand =
  | { kind: 'point'; index: number }
  | { kind: 'zoom'; factor: number }
  | { kind: 'reset' }
  | { kind: 'hide' }

export interface KeyContext {
  count: number
  /** Bucket do cursor; sem cursor, o último visível. */
  current: number
  /** Primeiro e último bucket inteiros na janela. */
  first: number
  last: number
  /** 1/6 da janela, em buckets. */
  page: number
}

export function keyContext(
  model: Pick<ChartModel, 'points' | 'bucketMs'>,
  view: readonly [number, number],
  cursor: number | null,
): KeyContext {
  const [start, end] = view
  const count = model.points.length
  const near = pointIndexAt(model, start)
  const first = Math.min(count - 1, (model.points[near]?.t ?? start) < start ? near + 1 : near)
  const last = pointIndexAt(model, end - model.bucketMs)
  const page = Math.max(1, Math.round((end - start) / 6 / model.bucketMs))
  return { count, current: cursor ?? last, first, last, page }
}

export function keyCommand(key: string, context: KeyContext): KeyCommand | null {
  const { count, current, first, last, page } = context
  const point = (index: number): KeyCommand => ({
    kind: 'point',
    index: Math.min(count - 1, Math.max(0, index)),
  })
  switch (key) {
    case 'ArrowLeft':
      return point(current - 1)
    case 'ArrowRight':
      return point(current + 1)
    case 'PageUp':
      return point(current - page)
    case 'PageDown':
      return point(current + page)
    case 'Home':
      return point(first)
    case 'End':
      return point(last)
    case '+':
    case '=':
      return { kind: 'zoom', factor: 0.5 }
    case '-':
      return { kind: 'zoom', factor: 2 }
    case '0':
      return { kind: 'reset' }
    case 'Escape':
      return { kind: 'hide' }
    default:
      return null
  }
}
