import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { clsx } from 'clsx'

export type IconSize = 12 | 14 | 16 | 20 | 24

/**
 * Ícone do Hugeicons com a cor herdada. Traço 2 entre 12 e 14 px e 1,75 a partir de 16 px, para o
 * peso visual ficar igual nos dois tamanhos. Com `label`, vira imagem com nome; sem, é decorativo.
 */
export function Icon({
  icon,
  size = 16,
  label,
  className,
}: {
  icon: IconSvgElement
  size?: IconSize
  label?: string
  className?: string
}) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={size <= 14 ? 2 : 1.75}
      color="currentColor"
      className={clsx('shrink-0', className)}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  )
}
