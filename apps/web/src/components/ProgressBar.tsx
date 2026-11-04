import { clsx } from 'clsx'
import { useDelayed } from '../lib/hooks'

/**
 * Barra indeterminada de 2 px, em degradê da marca, no topo do cartão durante a recarga (troca de
 * período, página ou filtro). Só aparece depois de `delay` ms. O pai precisa de `relative`, e o
 * cartão arredondado corta as pontas. Com movimento reduzido, fica parada e esmaecida.
 */
export function ProgressBar({
  active,
  delay = 200,
  label = 'Atualizando',
  className,
}: {
  active: boolean
  delay?: number
  label?: string
  className?: string
}) {
  const visible = useDelayed(active, delay)
  if (!visible) return null
  return (
    <div
      role="progressbar"
      aria-label={label}
      className={clsx('pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden', className)}
    >
      <div className="traco-marca h-full w-1/3 motion-safe:animate-progresso motion-reduce:w-full motion-reduce:opacity-60" />
    </div>
  )
}
