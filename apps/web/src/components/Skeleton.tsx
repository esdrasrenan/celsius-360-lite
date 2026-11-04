import { clsx } from 'clsx'
import { useDelayed } from '../lib/hooks'

/**
 * Bloco de carregamento com a geometria do conteúdo (a altura e a largura vêm de `className`).
 * Fica invisível nos primeiros `delay` ms, sem mudar o layout, para não piscar em resposta rápida.
 */
export function Skeleton({ className, delay = 150 }: { className?: string; delay?: number }) {
  const visible = useDelayed(true, delay)
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'block rounded-xs bg-superficie-3 motion-safe:animate-pulse',
        !visible && 'invisible',
        className,
      )}
    />
  )
}
