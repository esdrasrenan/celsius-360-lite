import type { IconSvgElement } from '@hugeicons/react'
import { clsx } from 'clsx'
import type { ComponentProps, ReactNode } from 'react'
import { type StateInfo, TONE_CLASS, type Tone } from '../lib/states'
import { Hint } from './Hint'
import { Icon } from './Icon'

export type BadgeSize = 'md' | 'sm'

/**
 * Badge da seção 3.5: pílula com fundo, texto e anel do tom; o ícone (12 px) vai na cor sólida.
 * `outline` é o contornado neutro de "Fechado". `sm` é o compacto (20 px de altura).
 */
export function Badge({
  tone = 'neutro',
  variant = 'soft',
  size = 'md',
  icon,
  className,
  children,
  ...props
}: ComponentProps<'span'> & {
  tone?: Tone
  variant?: 'soft' | 'outline'
  size?: BadgeSize
  icon?: IconSvgElement
  children: ReactNode
}) {
  // As props restantes (ref, handlers) chegam quando o badge é gatilho de uma dica
  return (
    <span
      {...props}
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-medium text-legenda ring-1 ring-inset',
        size === 'md' ? 'h-6 px-2' : 'h-5 px-1.5',
        variant === 'soft' ? TONE_CLASS[tone].soft : 'bg-transparent text-neutro-texto ring-borda-forte',
        className,
      )}
    >
      {icon && (
        <Icon icon={icon} size={12} className={variant === 'soft' ? TONE_CLASS[tone].icon : undefined} />
      )}
      {children}
    </span>
  )
}

/**
 * Badge de um estado do vocabulário (lib/states.ts), respeitando a apresentação: o normal
 * ("silent") não renderiza nada, "text" vira texto em texto-3, "outline" e "badge" viram pílula.
 * A dica do estado aparece em hover, a não ser com `hint={false}`.
 */
export function StateBadge({
  state,
  size = 'md',
  label,
  hint = true,
  className,
}: {
  state: StateInfo
  size?: BadgeSize
  /** Rótulo no lugar do padrão ("Fechada · abre 10:00"). */
  label?: string
  hint?: boolean
  className?: string
}) {
  if (state.presentation === 'silent') return null
  const text = label ?? state.label
  const element =
    state.presentation === 'text' ? (
      <span className={clsx('whitespace-nowrap text-apoio text-texto-3', className)}>{text}</span>
    ) : (
      <Badge
        tone={state.tone}
        variant={state.presentation === 'outline' ? 'outline' : 'soft'}
        size={size}
        icon={state.icon}
        className={className}
      >
        {text}
      </Badge>
    )
  return hint ? <Hint content={state.hint}>{element}</Hint> : element
}
