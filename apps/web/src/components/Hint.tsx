import { Tooltip } from '@base-ui/react/tooltip'
import { clsx } from 'clsx'
import type { ReactElement, ReactNode } from 'react'

/**
 * Agrupa as dicas da página: depois que uma abre, as vizinhas abrem na hora (seção 3.4). Vai uma
 * vez na raiz da aplicação.
 */
export function HintProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delay={300} closeDelay={0} timeout={300}>
      {children}
    </Tooltip.Provider>
  )
}

export type HintSide = 'top' | 'bottom' | 'left' | 'right'

/**
 * Dica complementar (Base UI Tooltip): abre em hover e em foco depois de 300 ms e fecha com Esc.
 * Nunca é o único caminho até uma informação essencial; para definições, use Definition, que
 * funciona com toque. O filho precisa aceitar ref e props (um elemento HTML ou um componente que
 * os repasse).
 */
export function Hint({
  content,
  title,
  side = 'top',
  disabled = false,
  children,
}: {
  content: ReactNode
  /** Título opcional, em 600 branco acima do texto. */
  title?: string
  side?: HintSide
  disabled?: boolean
  children: ReactElement
}) {
  return (
    <Tooltip.Root disabled={disabled}>
      <Tooltip.Trigger delay={300} closeDelay={0} render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={6} collisionPadding={8} className="z-50">
          <Tooltip.Popup
            className={clsx(
              'animacao-dica max-w-dica rounded-md bg-inverso text-legenda text-texto-inverso shadow-dica',
              title ? 'px-2.5 py-2' : 'px-2 py-1.5',
            )}
          >
            <Tooltip.Arrow className="seta-dica">
              <svg viewBox="0 0 8 4" className="size-full fill-current" aria-hidden="true">
                <path d="M0 0h8L4 4z" />
              </svg>
            </Tooltip.Arrow>
            {title ? (
              <>
                <p className="font-semibold">{title}</p>
                <div className="mt-0.5 text-texto-inverso-2">{content}</div>
              </>
            ) : (
              content
            )}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
