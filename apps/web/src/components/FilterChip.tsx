import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { Icon } from './Icon'

/**
 * Chip de filtro ativo (seção 3.10): "Cliente: Moda Carioca" com o botão de remover. Ao remover,
 * a tela leva o foco ao chip vizinho ou à busca.
 */
export function FilterChip({
  label,
  value,
  onRemove,
}: {
  /** Nome do filtro ("Cliente", "Busca"). */
  label: string
  value: string
  onRemove: () => void
}) {
  const name = `${label}: ${value}`
  return (
    <span className="inline-flex h-7 min-w-0 max-w-full items-center gap-1 rounded-sm bg-superficie ps-2 pe-0.5 text-apoio text-texto-2 ring-1 ring-borda-forte ring-inset">
      <span className="truncate">
        <span className="text-texto-3">{label}:</span> {value}
      </span>
      <button
        type="button"
        aria-label={`Remover filtro ${name}`}
        onClick={onRemove}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-texto-3 transition-colors duration-100 ease-linear hover:bg-realce hover:text-texto"
      >
        <Icon icon={Cancel01Icon} size={14} />
      </button>
    </span>
  )
}
