import { useEffect, useState } from 'react'

/**
 * Verdadeiro só depois que `active` fica ligado por `ms` milissegundos. Evita piscar skeleton,
 * spinner e barra de progresso em respostas rápidas (seção 3.13).
 */
export function useDelayed(active: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(ms <= 0)
  useEffect(() => {
    if (!active || ms <= 0) {
      setElapsed(ms <= 0)
      return
    }
    const timer = setTimeout(() => setElapsed(true), ms)
    return () => {
      clearTimeout(timer)
      setElapsed(false)
    }
  }, [active, ms])
  return active && elapsed
}
