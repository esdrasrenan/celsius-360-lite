import { Popover } from '@base-ui/react/popover'
import { InformationCircleIcon } from '@hugeicons/core-free-icons'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

/**
 * "Como é calculado" (Base UI Popover com openOnHover): abre em hover depois de 300 ms, em foco e
 * em toque, ao contrário da dica. A primeira linha é a fórmula; as seguintes, as exceções.
 * Aceita as definições prontas de DEFINITIONS (lib/states.ts) ou um conteúdo livre (legenda).
 */
export function Definition({
  term,
  lines,
  children,
}: {
  /** Indicador explicado; vira o nome acessível "Como é calculado: <term>". */
  term: string
  lines?: readonly string[]
  children?: ReactNode
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={300}
        aria-label={`Como é calculado: ${term}`}
        className="relative inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-texto-3 transition-colors duration-100 ease-linear hover:bg-realce hover:text-texto data-popup-open:text-texto pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5"
      >
        <Icon icon={InformationCircleIcon} size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} collisionPadding={12} className="z-50">
          <Popover.Popup className="animacao-popover flex max-w-definicao flex-col gap-1.5 rounded-lg bg-superficie p-3 text-apoio text-texto-2 shadow-flutuante outline-none">
            <Popover.Title className="so-leitor">{term}</Popover.Title>
            {lines?.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
