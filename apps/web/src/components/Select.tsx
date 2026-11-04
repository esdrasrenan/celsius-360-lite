import { Select as BaseSelect } from '@base-ui/react/select'
import { Tick02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import { Fragment, type ReactNode, useId } from 'react'
import { TONE_CLASS, type Tone } from '../lib/states'
import { Icon } from './Icon'

export interface SelectOption<V extends string> {
  value: V
  label: string
  /** Texto auxiliar à direita, em texto-3 ("12 lojas"). */
  aux?: ReactNode
  /** Ponto de estado de 8 px antes do rótulo. */
  tone?: Tone
  disabled?: boolean
}

export interface SelectGroup<V extends string> {
  label: string
  options: readonly SelectOption<V>[]
}

export type SelectEntry<V extends string> = SelectOption<V> | SelectGroup<V>

const isGroup = <V extends string>(entry: SelectEntry<V>): entry is SelectGroup<V> => 'options' in entry

/** Gatilho compartilhado com o Combobox: mesma altura, anel e chevron a 12 px da borda. */
export const TRIGGER_CLASS =
  'group inline-flex min-w-0 items-center gap-2 rounded-md bg-superficie pe-3 text-texto shadow-controle ring-1 ring-borda-controle ring-inset transition-colors duration-100 ease-linear hover:bg-superficie-2 hover:ring-borda-controle-hover data-popup-open:ring-acento data-disabled:cursor-not-allowed data-disabled:opacity-50'

export const POPUP_CLASS =
  'animacao-popover largura-popover overflow-y-auto rounded-lg bg-superficie p-1 shadow-flutuante outline-none'

export const ITEM_CLASS =
  'grade-item-menu foco-interno h-8 cursor-default gap-2 rounded-md px-2 text-corpo text-texto-2 outline-none select-none pointer-coarse:h-controle-toque data-disabled:opacity-45 data-highlighted:bg-realce data-highlighted:text-texto data-selected:font-medium data-selected:text-texto'

/**
 * Select da seção 3.2 (Base UI Select), no lugar do select nativo do navegador. O nome acessível é o prefixo
 * (ou o `label`, oculto) seguido do valor: "Ordenar por: Gravidade". Opções podem vir agrupadas.
 */
export function Select<V extends string>({
  value,
  onValueChange,
  options,
  label,
  prefix,
  placeholder = 'Selecione',
  size = 'md',
  error,
  disabled = false,
  className,
}: {
  value: V | null
  onValueChange: (value: V) => void
  options: readonly SelectEntry<V>[]
  /** Nome acessível ("Por página"), oculto. Com `prefix`, o prefixo visível ocupa o lugar dele. */
  label: string
  /** Prefixo visível em texto-3 ("Ordenar por"); substitui o `label` no nome acessível. */
  prefix?: string
  placeholder?: string
  size?: 'sm' | 'md'
  /** Mensagem de erro: anel em falha e texto abaixo. */
  error?: string
  disabled?: boolean
  /** Largura do gatilho (w-56, w-60, w-28...). */
  className?: string
}) {
  const id = useId()
  const flat = options.flatMap((entry) => (isGroup(entry) ? entry.options : [entry]))
  const items = flat.map((option) => ({ value: option.value, label: option.label }))

  return (
    <div className={clsx('inline-flex flex-col gap-1', className)}>
      <BaseSelect.Root
        items={items}
        value={value}
        onValueChange={(next) => next !== null && onValueChange(next as V)}
        disabled={disabled}
      >
        <BaseSelect.Trigger
          aria-labelledby={`${id}-rotulo ${id}-valor`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-erro` : undefined}
          className={clsx(
            TRIGGER_CLASS,
            'w-full ps-3',
            size === 'md'
              ? 'h-controle text-corpo pointer-coarse:h-controle-toque'
              : 'h-controle-sm text-apoio',
            error && 'ring-falha',
          )}
        >
          <span id={`${id}-rotulo`} className={prefix ? 'shrink-0 text-texto-3' : 'so-leitor'}>
            {prefix ?? label}
          </span>
          <BaseSelect.Value
            id={`${id}-valor`}
            placeholder={placeholder}
            className="min-w-0 flex-1 truncate text-start font-medium data-placeholder:font-normal data-placeholder:text-texto-3"
          />
          <BaseSelect.Icon className="flex shrink-0 text-texto-3">
            <Icon icon={UnfoldMoreIcon} />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal>
          <BaseSelect.Positioner
            sideOffset={4}
            collisionPadding={12}
            alignItemWithTrigger={false}
            align="start"
            className="z-50 outline-none"
          >
            <BaseSelect.Popup className={POPUP_CLASS}>
              <BaseSelect.List>
                {options.map((entry, index) => {
                  const separator =
                    index > 0 && (isGroup(entry) || isGroup(options[index - 1] as SelectEntry<V>))
                  return (
                    <Fragment key={isGroup(entry) ? `g:${entry.label}` : entry.value}>
                      {separator && <BaseSelect.Separator className="-mx-1 my-1 h-px bg-borda" />}
                      {isGroup(entry) ? (
                        <BaseSelect.Group>
                          <BaseSelect.GroupLabel className="px-2 pt-2 pb-1 font-medium text-legenda text-texto-3">
                            {entry.label}
                          </BaseSelect.GroupLabel>
                          {entry.options.map((option) => (
                            <SelectItem key={option.value} option={option} />
                          ))}
                        </BaseSelect.Group>
                      ) : (
                        <SelectItem option={entry} />
                      )}
                    </Fragment>
                  )
                })}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
      {error && (
        <p id={`${id}-erro`} className="text-falha-texto text-legenda">
          {error}
        </p>
      )}
    </div>
  )
}

function SelectItem<V extends string>({ option }: { option: SelectOption<V> }) {
  return (
    <BaseSelect.Item
      value={option.value}
      label={option.label}
      disabled={option.disabled}
      className={ITEM_CLASS}
    >
      <span className="flex size-4 items-center justify-center">
        <BaseSelect.ItemIndicator className="flex text-acento">
          <Icon icon={Tick02Icon} />
        </BaseSelect.ItemIndicator>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        {option.tone && (
          <span
            aria-hidden="true"
            className={clsx('size-2 shrink-0 rounded-full', TONE_CLASS[option.tone].solid)}
          />
        )}
        <BaseSelect.ItemText className="truncate">{option.label}</BaseSelect.ItemText>
      </span>
      {option.aux != null && <span className="num text-legenda text-texto-3">{option.aux}</span>}
    </BaseSelect.Item>
  )
}
