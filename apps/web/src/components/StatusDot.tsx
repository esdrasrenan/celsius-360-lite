import { clsx } from 'clsx'
import type { ComponentProps } from 'react'
import { TONE_CLASS, type Tone } from '../lib/states'

/**
 * Ponto de estado de 8 px. Sozinho, recebe `label` e vira imagem com nome ("Online"); ao lado de
 * um texto que já nomeia o estado, fica oculto do leitor de tela. O pulso existe só no chip ao vivo.
 */
export function StatusDot({
  tone,
  label,
  pulse = false,
  className,
  ...props
}: ComponentProps<'span'> & { tone: Tone; label?: string; pulse?: boolean }) {
  return (
    <span
      {...props}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      className={clsx('relative inline-flex size-2 shrink-0', className)}
    >
      {pulse && (
        <span
          className={clsx(
            'absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping',
            TONE_CLASS[tone].solid,
          )}
        />
      )}
      <span className={clsx('relative size-2 rounded-full', TONE_CLASS[tone].solid)} />
    </span>
  )
}
