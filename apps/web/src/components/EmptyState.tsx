import type { IconSvgElement } from '@hugeicons/react'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

/**
 * Estado vazio (seção 3.13): ícone num círculo, título, texto e ações. Dentro do cartão da tabela,
 * vai num <td colSpan>; ocupando a página, use `heading="h1"`.
 */
export function EmptyState({
  title,
  description,
  icon,
  actions,
  heading = 'h2',
  tone = 'neutro',
  className,
}: {
  title: string
  description?: ReactNode
  icon?: IconSvgElement
  /** Botões, lado a lado. */
  actions?: ReactNode
  heading?: 'h1' | 'h2'
  /** falha: o círculo do ícone em falha-fundo (usado pelo ErrorState). */
  tone?: 'neutro' | 'falha'
  className?: string
}) {
  const Heading = heading
  return (
    <div
      className={clsx('flex min-h-60 flex-col items-center justify-center gap-3 p-10 text-center', className)}
    >
      {icon && (
        <span
          className={clsx(
            'flex size-10 items-center justify-center rounded-full',
            tone === 'falha' ? 'bg-falha-fundo text-falha-texto' : 'bg-superficie-3 text-texto-3',
          )}
        >
          <Icon icon={icon} size={20} />
        </span>
      )}
      <div className="flex flex-col items-center gap-1">
        <Heading className="text-texto text-titulo-3">{title}</Heading>
        {description && <div className="max-w-texto text-pretty text-corpo text-texto-3">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
}
