import { Menu as BaseMenu } from '@base-ui/react/menu'
import type { IconSvgElement } from '@hugeicons/react'
import type { ReactElement, ReactNode } from 'react'
import { Icon } from './Icon'

export interface MenuItem {
  label: string
  icon?: IconSvgElement
  onSelect: () => void
  disabled?: boolean
  /** Texto auxiliar à direita, em texto-3 ("CSV"). */
  aux?: string
}

export type MenuEntry = MenuItem | 'separator'

const ITEM =
  'grade-item-menu foco-interno h-8 cursor-default gap-2 rounded-md px-2 text-corpo text-texto-2 outline-none select-none pointer-coarse:h-controle-toque data-disabled:opacity-45 data-highlighted:bg-realce data-highlighted:text-texto'

/**
 * Menu de ações (Base UI Menu): exportação e menu do usuário. O gatilho é o elemento passado em
 * `trigger` (um Button ou IconButton); `header` vai no topo, separado das ações.
 */
export function Menu({
  trigger,
  items,
  header,
  align = 'end',
}: {
  trigger: ReactElement
  items: readonly MenuEntry[]
  header?: ReactNode
  align?: 'start' | 'center' | 'end'
}) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner sideOffset={4} collisionPadding={12} align={align} className="z-50 outline-none">
          <BaseMenu.Popup className="animacao-popover min-w-48 max-w-popover rounded-lg bg-superficie p-1 shadow-flutuante outline-none">
            {header && (
              <>
                <div className="px-2 pt-1.5 pb-2">{header}</div>
                <BaseMenu.Separator className="-mx-1 mb-1 h-px bg-borda" />
              </>
            )}
            {items.map((item, index) =>
              item === 'separator' ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: separadores não têm identidade própria
                <BaseMenu.Separator key={`sep-${index}`} className="-mx-1 my-1 h-px bg-borda" />
              ) : (
                <BaseMenu.Item
                  key={item.label}
                  disabled={item.disabled}
                  onClick={item.onSelect}
                  className={ITEM}
                >
                  <span className="flex size-4 items-center justify-center text-texto-3">
                    {item.icon && <Icon icon={item.icon} />}
                  </span>
                  <span className="truncate">{item.label}</span>
                  {item.aux && <span className="text-legenda text-texto-3">{item.aux}</span>}
                </BaseMenu.Item>
              ),
            )}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}
