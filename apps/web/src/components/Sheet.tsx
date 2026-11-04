import { Dialog } from '@base-ui/react/dialog'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import type { ReactElement, ReactNode } from 'react'
import { IconButton } from './Button'

/**
 * Gaveta inferior do celular (Base UI Dialog): filtros e outros painéis curtos. Sobe em 200 ms com
 * ease-movimento; Esc, o fundo e o botão "Fechar" fecham. Pode ser controlada (`open`) ou abrir
 * pelo `trigger`. `footer` fica fixo embaixo ("Aplicar", "Limpar").
 */
export function Sheet({
  title,
  description,
  trigger,
  open,
  onOpenChange,
  footer,
  children,
}: {
  title: string
  description?: string
  trigger?: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger render={trigger} />}
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-inverso/30 transition-opacity duration-200 ease-linear data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="gaveta-inferior z-50 outline-none">
          <div className="flex shrink-0 items-start justify-between gap-3 border-borda border-b py-2 ps-4 pe-2">
            <div className="flex min-w-0 flex-col gap-0.5 py-1.5">
              <Dialog.Title className="text-texto text-titulo-3">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="text-apoio text-texto-3">{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close render={<IconButton icon={Cancel01Icon} label="Fechar" hint={false} />} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
          {footer && (
            <div className="flex shrink-0 justify-end gap-2 border-borda border-t px-4 py-3">{footer}</div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
