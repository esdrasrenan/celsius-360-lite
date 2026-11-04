import { clsx } from 'clsx'
import { Fragment, type ReactElement, useId } from 'react'
import { formatInteger } from '../lib/format'
import { Hint } from './Hint'

export interface SegmentOption<V extends string> {
  value: V
  label: string
  /** Nome acessível mais completo que o rótulo ("Últimas 24 horas"). */
  accessibleLabel?: string
  /** Dica com o intervalo exato ("04/02 00:00 – 11/02 00:00 · horário de Brasília"). */
  hint?: string
}

const withHint = (key: string, hint: string | undefined, element: ReactElement) =>
  hint ? (
    <Hint key={key} content={hint}>
      {element}
    </Hint>
  ) : (
    <Fragment key={key}>{element}</Fragment>
  )

/**
 * Controle segmentado (seção 3.8) com rádios nativos: as setas trocam e focam, sem pílula
 * deslizante. `onIntent` dispara no hover e no foco de um segmento, para pré-carregar o período.
 * Ocupa a largura toda no celular.
 */
export function SegmentedControl<V extends string>({
  legend,
  value,
  options,
  onValueChange,
  onIntent,
  className,
}: {
  /** Rótulo do grupo, oculto ("Período"). */
  legend: string
  value: V
  options: readonly SegmentOption<V>[]
  onValueChange: (value: V) => void
  onIntent?: (value: V) => void
  className?: string
}) {
  const name = useId()
  return (
    <fieldset
      className={clsx(
        'flex h-controle w-full min-w-0 rounded-md bg-superficie-3 p-0.5 ring-1 ring-borda ring-inset sm:inline-flex sm:w-auto pointer-coarse:h-controle-toque',
        className,
      )}
    >
      <legend className="so-leitor">{legend}</legend>
      {options.map((option) => {
        const checked = option.value === value
        return withHint(
          option.value,
          option.hint,
          <label
            onPointerEnter={() => onIntent?.(option.value)}
            className={clsx(
              'relative flex h-full flex-1 cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-sm px-3 font-medium text-corpo transition-colors duration-100 ease-linear has-focus-visible:outline-2 has-focus-visible:outline-foco has-focus-visible:outline-offset-2 sm:flex-none',
              checked ? 'bg-superficie text-texto shadow-segmento' : 'text-texto-3 hover:text-texto-2',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              aria-label={option.accessibleLabel}
              onChange={() => onValueChange(option.value)}
              onFocus={() => onIntent?.(option.value)}
              className="so-leitor"
            />
            {option.label}
          </label>,
        )
      })}
    </fieldset>
  )
}

export interface PillOption<V extends string> {
  value: V
  label: string
  /** Contagem à direita; ausente quando a API não a fornece (nunca mostre um número errado). */
  count?: number
}

/**
 * Pílulas de filtro de escolha única (seção 3.10), também com rádios nativos. Contagem zero
 * esmaece a pílula, que continua selecionável.
 */
export function PillGroup<V extends string>({
  label,
  value,
  options,
  onValueChange,
  zeroHint = 'Nenhuma loja nesta situação',
  className,
}: {
  /** Nome acessível do grupo ("Telemetria da loja"). */
  label: string
  value: V
  options: readonly PillOption<V>[]
  onValueChange: (value: V) => void
  zeroHint?: string
  className?: string
}) {
  const name = useId()
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx('flex flex-wrap items-center gap-2', className)}
    >
      {options.map((option) => {
        const checked = option.value === value
        const empty = option.count === 0
        return withHint(
          option.value,
          empty ? zeroHint : undefined,
          <label
            className={clsx(
              'pressionavel relative inline-flex h-controle-sm cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-full px-3 font-medium text-apoio ring-1 ring-inset has-focus-visible:outline-2 has-focus-visible:outline-foco has-focus-visible:outline-offset-2',
              checked
                ? 'bg-inverso text-texto-inverso ring-inverso'
                : 'bg-superficie text-texto-2 ring-borda hover:bg-superficie-2 hover:text-texto',
              empty && !checked && 'opacity-55',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onValueChange(option.value)}
              className="so-leitor"
            />
            {option.label}
            {option.count != null && (
              <span className={clsx('num', checked ? 'text-texto-inverso-2' : 'text-texto-3')}>
                {formatInteger(option.count)}
              </span>
            )}
          </label>,
        )
      })}
    </div>
  )
}
