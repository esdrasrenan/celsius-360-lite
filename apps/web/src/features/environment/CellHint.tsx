import { Tooltip } from '@base-ui/react/tooltip'
import type { ReactElement } from 'react'

export interface CellHintPayload {
  title: string
  lines: string[]
}

export type CellHintHandle = Tooltip.Handle<CellHintPayload>

export const createCellHint = () => Tooltip.createHandle<CellHintPayload>()

/**
 * Uma dica só para as células de uma visualização densa (heatmap, colunas por dia): as 168
 * células compartilham o mesmo popup, que desliza de uma para a outra. Mesmo visual da Hint.
 */
export function CellHintRoot({ handle }: { handle: CellHintHandle }) {
  return (
    <Tooltip.Root handle={handle}>
      {({ payload }) => (
        <Tooltip.Portal>
          <Tooltip.Positioner side="top" sideOffset={6} collisionPadding={8} className="z-50">
            <Tooltip.Popup className="animacao-dica max-w-dica rounded-md bg-inverso px-2.5 py-2 text-legenda text-texto-inverso shadow-dica">
              <Tooltip.Arrow className="seta-dica">
                <svg viewBox="0 0 8 4" className="size-full fill-current" aria-hidden="true">
                  <path d="M0 0h8L4 4z" />
                </svg>
              </Tooltip.Arrow>
              {payload && (
                <>
                  <p className="font-semibold">{payload.title}</p>
                  {payload.lines.map((line) => (
                    <p key={line} className="num mt-0.5 text-texto-inverso-2">
                      {line}
                    </p>
                  ))}
                </>
              )}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      )}
    </Tooltip.Root>
  )
}

/** Gatilho de uma célula: o elemento passado em `render` recebe ref, eventos e aria. */
export function CellHintTrigger({
  handle,
  payload,
  render,
}: {
  handle: CellHintHandle
  payload: CellHintPayload
  render: ReactElement
}) {
  return <Tooltip.Trigger handle={handle} payload={payload} delay={120} closeDelay={0} render={render} />
}
