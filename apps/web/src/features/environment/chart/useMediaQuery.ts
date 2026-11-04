import { useSyncExternalStore } from 'react'

/** Estado de uma media query, atualizado quando ela muda (rotação, redimensionamento). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => matchMedia(query).matches,
    () => false,
  )
}
