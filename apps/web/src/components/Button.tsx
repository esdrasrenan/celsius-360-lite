import { Loading03Icon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { clsx } from 'clsx'
import type { ComponentProps, MouseEvent } from 'react'
import { Hint } from './Hint'
import { Icon } from './Icon'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'
export type ButtonSize = 'sm' | 'md'

const BASE =
  'pressionavel inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium select-none disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-inverso text-texto-inverso hover:bg-marca-indigo',
  secondary:
    'bg-superficie text-texto shadow-controle ring-1 ring-borda-controle ring-inset hover:bg-superficie-2 hover:ring-borda-controle-hover',
  ghost: 'text-texto-3 hover:bg-realce hover:text-texto',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-controle-sm px-3 text-apoio',
  md: 'h-controle px-3.5 text-corpo pointer-coarse:h-controle-toque',
}

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: 'size-8',
  md: 'size-9 pointer-coarse:size-controle-toque',
}

/** Classes do botão, para um <Link> ou <a> com a mesma aparência. */
export function buttonClass(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  className?: string,
) {
  return clsx(BASE, VARIANT[variant], SIZE[size], className)
}

export type ButtonProps = ComponentProps<'button'> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Ícone antes do rótulo (16 px). */
  icon?: IconSvgElement
  /** Ocupado: o spinner substitui o ícone e o rótulo vira `busyLabel`, sem mudar a largura. */
  busy?: boolean
  busyLabel?: string
}

const Spinner = () => <Icon icon={Loading03Icon} className="motion-safe:animate-spin" />

/** Botão da seção 3.1: primário, secundário (padrão) ou fantasma, em sm ou md. */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  busy = false,
  busyLabel,
  type = 'button',
  className,
  children,
  onClick,
  ...props
}: ButtonProps) {
  // Ocupado não desabilita (o foco ficaria perdido); só ignora o clique
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy) event.preventDefault()
    else onClick?.(event)
  }
  const leading = busy ? <Spinner /> : icon && <Icon icon={icon} />
  return (
    <button
      type={type}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      className={buttonClass(variant, size, className)}
      onClick={handleClick}
      {...props}
    >
      {busyLabel ? (
        // Os dois rótulos ocupam a mesma célula: a largura é a do maior e não pula ao trocar
        <span className="grid">
          <span
            className={clsx(
              'col-start-1 row-start-1 inline-flex items-center justify-center gap-2',
              busy && 'invisible',
            )}
          >
            {icon && <Icon icon={icon} />}
            {children}
          </span>
          <span
            className={clsx(
              'col-start-1 row-start-1 inline-flex items-center justify-center gap-2',
              !busy && 'invisible',
            )}
          >
            <Spinner />
            {busyLabel}
          </span>
        </span>
      ) : (
        <>
          {leading}
          {children}
        </>
      )}
    </button>
  )
}

export type IconButtonProps = Omit<ComponentProps<'button'>, 'children'> & {
  icon: IconSvgElement
  /** Nome acessível, repetido na dica. */
  label: string
  variant?: ButtonVariant
  size?: ButtonSize
  /** Mostra o rótulo numa dica (padrão). Desligue quando o gatilho já tem outra dica ou popover. */
  hint?: boolean
}

/** Botão só com ícone: aria-label obrigatório e dica com o mesmo texto. */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  hint = true,
  type = 'button',
  className,
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      className={clsx(BASE, VARIANT[variant], ICON_SIZE[size], className)}
      {...props}
    >
      <Icon icon={icon} />
    </button>
  )
  return hint ? <Hint content={label}>{button}</Hint> : button
}
