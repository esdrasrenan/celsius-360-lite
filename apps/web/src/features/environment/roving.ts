import { type KeyboardEvent, useRef, useState } from 'react'

/**
 * Foco itinerante numa grade de células (heatmap, colunas por dia): um único ponto de parada no
 * Tab, e as setas, Home e End andam entre as células. Assim a dica de cada célula também chega
 * pelo teclado, e não só pelo ponteiro.
 */
export function useRovingGrid(rows: number, columns: number) {
  const [active, setActive] = useState(0)
  const cells = useRef(new Map<number, HTMLElement>())

  const move = (index: number) => {
    const next = Math.min(rows * columns - 1, Math.max(0, index))
    setActive(next)
    cells.current.get(next)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const row = Math.floor(active / columns)
    const column = active % columns
    const target: Record<string, number> = {
      ArrowRight: column < columns - 1 ? active + 1 : active,
      ArrowLeft: column > 0 ? active - 1 : active,
      ArrowDown: row < rows - 1 ? active + columns : active,
      ArrowUp: row > 0 ? active - columns : active,
      Home: event.ctrlKey ? 0 : row * columns,
      End: event.ctrlKey ? rows * columns - 1 : row * columns + columns - 1,
    }
    const index = target[event.key]
    if (index === undefined) return
    event.preventDefault()
    move(index)
  }

  /** Props de cada célula: tabIndex itinerante, registro do elemento e foco pelo ponteiro. */
  const cell = (index: number) => ({
    tabIndex: index === active ? 0 : -1,
    ref: (element: HTMLElement | null) => {
      if (element) cells.current.set(index, element)
      else cells.current.delete(index)
    },
    onFocus: () => setActive(index),
  })

  return { onKeyDown, cell }
}
