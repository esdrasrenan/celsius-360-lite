import { useEffect, useState, useSyncExternalStore } from 'react'

/** Casa com uma media query e acompanha a mudança (rotação, janela redimensionada). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
  )
}

/**
 * Verdadeiro depois que o sentinela (8 px no topo da página) sai da tela: o cabeçalho ganha
 * superfície e blur só com a página rolada. IntersectionObserver, sem ouvir o scroll.
 */
export function useScrolledPast(sentinel: Element | null): boolean {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    if (!sentinel) return
    const observer = new IntersectionObserver(([entry]) => setScrolled(entry ? !entry.isIntersecting : false))
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [sentinel])
  return scrolled
}
