import { Combobox as BaseCombobox } from '@base-ui/react/combobox'
import { Cancel01Icon, Search01Icon, Tick02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { clsx } from 'clsx'
import { Fragment, type ReactNode, useId, useState } from 'react'
import { matchesSearch } from '../lib/text'
import { Highlight } from './Highlight'
import { Hint } from './Hint'
import { Icon } from './Icon'
import { ITEM_CLASS, POPUP_CLASS, TRIGGER_CLASS } from './Select'

interface Entry {
  value: string | null
  label: string
  aux?: ReactNode
}

/**
 * Combobox da seção 3.3: gatilho igual ao do Select e busca sem acento num campo dentro do popup.
 * Genérico: recebe a lista e as funções que tiram a chave, o rótulo e o texto auxiliar. Com
 * `allLabel`, a primeira opção ("Todos os clientes") limpa a seleção (valor null).
 */
export function Combobox<T>({
  items,
  value,
  onValueChange,
  getKey,
  getLabel,
  getAux,
  label,
  allLabel,
  placeholder,
  searchPlaceholder = 'Buscar…',
  emptyText = (query) => `Nada para "${query}"`,
  icon,
  className,
}: {
  items: readonly T[]
  value: string | null
  onValueChange: (value: string | null) => void
  getKey: (item: T) => string
  getLabel: (item: T) => string
  getAux?: (item: T) => ReactNode
  /** Nome acessível do gatilho ("Cliente"). */
  label: string
  allLabel?: string
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: (query: string) => string
  icon?: IconSvgElement
  /** Largura do gatilho (w-56...). */
  className?: string
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const entries: Entry[] = [
    ...(allLabel ? [{ value: null, label: allLabel }] : []),
    ...items.map((item) => ({ value: getKey(item), label: getLabel(item), aux: getAux?.(item) })),
  ]
  const selected = entries.find((entry) => entry.value === value && value !== null) ?? null
  const hasValue = selected !== null

  return (
    <div className={clsx('relative inline-flex', className)}>
      <BaseCombobox.Root
        items={entries}
        value={selected}
        onValueChange={(entry) => onValueChange(entry?.value ?? null)}
        isItemEqualToValue={(a, b) => a.value === b.value}
        itemToStringLabel={(entry) => entry.label}
        inputValue={query}
        onInputValueChange={setQuery}
        // "Todos" só aparece sem busca; o resto casa sem acento e sem caixa
        filter={(entry, text) => (entry.value === null ? text === '' : matchesSearch(entry.label, text))}
        onOpenChange={(open) => !open && setQuery('')}
      >
        <BaseCombobox.Trigger
          aria-labelledby={`${id}-rotulo ${id}-valor`}
          className={clsx(
            TRIGGER_CLASS,
            'relative h-controle w-full text-corpo pointer-coarse:h-controle-toque',
            icon ? 'ps-9' : 'ps-3',
            hasValue && 'pe-10',
          )}
        >
          {icon && <Icon icon={icon} className="absolute start-3 text-texto-3" />}
          <span id={`${id}-rotulo`} className="so-leitor">
            {label}
          </span>
          <span id={`${id}-valor`} className="min-w-0 flex-1 truncate text-start font-medium">
            {selected?.label ?? <span className="font-normal text-texto-3">{placeholder ?? allLabel}</span>}
          </span>
          {!hasValue && <Icon icon={UnfoldMoreIcon} className="text-texto-3" />}
        </BaseCombobox.Trigger>
        <BaseCombobox.Portal>
          <BaseCombobox.Positioner
            sideOffset={4}
            collisionPadding={12}
            align="start"
            className="z-50 outline-none"
          >
            <BaseCombobox.Popup aria-label={label} className={clsx(POPUP_CLASS, 'flex flex-col')}>
              <div className="relative mb-1 shrink-0">
                <Icon
                  icon={Search01Icon}
                  size={14}
                  className="pointer-events-none absolute start-2.5 top-2.5 text-texto-3"
                />
                <BaseCombobox.Input
                  placeholder={searchPlaceholder}
                  className="foco-interno h-8 w-full rounded-md bg-superficie-2 ps-8 pe-2 text-corpo text-texto ring-1 ring-borda ring-inset placeholder:text-texto-3"
                />
              </div>
              {/* O Empty já é role="status": a contagem vazia é anunciada */}
              <BaseCombobox.Empty>
                <p className="p-2 text-center text-apoio text-texto-3">{emptyText(query)}</p>
              </BaseCombobox.Empty>
              <BaseCombobox.List className="min-h-0 overflow-y-auto">
                {(entry: Entry) => (
                  <Fragment key={entry.value ?? ''}>
                    <BaseCombobox.Item value={entry} className={ITEM_CLASS}>
                      <span className="flex size-4 items-center justify-center">
                        <BaseCombobox.ItemIndicator className="flex text-acento">
                          <Icon icon={Tick02Icon} />
                        </BaseCombobox.ItemIndicator>
                      </span>
                      <span className="truncate">
                        <Highlight text={entry.label} query={query} />
                      </span>
                      {entry.aux != null && (
                        <span className="num text-legenda text-texto-3">{entry.aux}</span>
                      )}
                    </BaseCombobox.Item>
                    {entry.value === null && <BaseCombobox.Separator className="-mx-1 my-1 h-px bg-borda" />}
                  </Fragment>
                )}
              </BaseCombobox.List>
            </BaseCombobox.Popup>
          </BaseCombobox.Positioner>
        </BaseCombobox.Portal>
      </BaseCombobox.Root>
      {hasValue && (
        <Hint content="Limpar seleção">
          <button
            type="button"
            aria-label="Limpar seleção"
            onClick={() => onValueChange(null)}
            className="absolute end-1 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-texto-3 transition-colors duration-100 ease-linear hover:bg-realce hover:text-texto"
          >
            <Icon icon={Cancel01Icon} size={14} />
          </button>
        </Hint>
      )}
    </div>
  )
}
