import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { clsx } from 'clsx'
import { type ReactNode, useId } from 'react'
import { formatPercent } from '../lib/format'
import type { Tone } from '../lib/labels'

/** Ícone do Huge Icons (o mesmo conjunto da proposta de site), traço 1,6 e cor herdada. */
export function Icon({
  icon,
  size = 18,
  className,
  label,
}: {
  icon: IconSvgElement
  size?: number
  className?: string
  label?: string
}) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={1.6}
      color="currentColor"
      className={className}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  )
}

const TONE_CLASS: Record<Tone, { dot: string; badge: string }> = {
  ok: { dot: 'bg-ok', badge: 'bg-ok/10 text-ok' },
  alerta: { dot: 'bg-alerta', badge: 'bg-alerta/12 text-alerta' },
  falha: { dot: 'bg-falha', badge: 'bg-falha/10 text-falha' },
  neutro: { dot: 'bg-neutro', badge: 'bg-gelo-2 text-tinta-3' },
  quente: { dot: 'bg-calor', badge: 'bg-calor/10 text-calor' },
  frio: { dot: 'bg-frio', badge: 'bg-frio/10 text-frio' },
}

export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 font-medium text-[0.76rem]',
        TONE_CLASS[tone].badge,
      )}
    >
      <span className={clsx('size-1.5 rounded-full', TONE_CLASS[tone].dot)} />
      {children}
    </span>
  )
}

export function Dot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-2">
      {pulse && (
        <span
          className={clsx('absolute inset-0 animate-ping rounded-full opacity-60', TONE_CLASS[tone].dot)}
        />
      )}
      <span className={clsx('relative inline-flex size-2 rounded-full', TONE_CLASS[tone].dot)} />
    </span>
  )
}

/**
 * Grupo de escolha única com rádios nativos (teclado e leitor de tela de graça), em dois visuais:
 * segmentado (período) e pílulas (filtro de status).
 */
export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
  variant = 'segmented',
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  label: string
  variant?: 'segmented' | 'pills'
}) {
  const name = useId()
  return (
    <fieldset
      className={clsx(
        variant === 'segmented' ? 'inline-flex rounded-[13px] bg-gelo-2 p-1' : 'flex flex-wrap gap-2',
      )}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const checked = option.value === value
        return (
          <label
            key={option.value}
            className={clsx(
              'pressionavel inline-flex cursor-pointer items-center font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-celsius has-[:focus-visible]:outline-offset-2',
              variant === 'segmented'
                ? [
                    'h-8 rounded-[10px] px-3.5 text-[0.86rem]',
                    checked
                      ? 'bg-branco text-tinta shadow-[0_1px_2px_rgb(11_12_89/0.12)]'
                      : 'text-tinta-3 hover:text-tinta',
                  ]
                : [
                    'h-8 rounded-full px-3.5 text-[0.84rem] ring-1 ring-inset',
                    checked
                      ? 'bg-tinta text-white ring-tinta'
                      : 'bg-branco text-tinta-3 ring-linha hover:text-tinta',
                  ],
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        )
      })}
    </fieldset>
  )
}

export function Button({
  children,
  variant = 'primario',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primario' | 'secundario' | 'fantasma' }) {
  return (
    <button
      type="button"
      {...props}
      className={clsx(
        'pressionavel inline-flex h-10 items-center justify-center gap-2 rounded-[11px] px-4 font-medium text-[0.9rem] transition-colors disabled:pointer-events-none disabled:opacity-50',
        variant === 'primario' && 'bg-tinta text-white hover:bg-celsius-escuro',
        variant === 'secundario' && 'bg-branco text-tinta ring-1 ring-linha-forte ring-inset hover:bg-gelo',
        variant === 'fantasma' && 'text-tinta-3 hover:bg-gelo-2 hover:text-tinta',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** Barra de conforto: verde até a meta, âmbar abaixo dela; cinza quando não há dado no período. */
export function ComfortBar({
  value,
  target = 90,
  compact = false,
}: {
  value: number | null
  target?: number
  compact?: boolean
}) {
  return (
    <div className={clsx('flex items-center gap-2.5', compact ? 'min-w-28' : 'min-w-36')}>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-gelo-2">
        {value !== null && (
          <div
            className={clsx(
              'h-full rounded-full',
              value >= target ? 'bg-ok' : value >= 70 ? 'bg-alerta' : 'bg-falha',
            )}
            style={{ width: `${Math.max(2, value)}%` }}
          />
        )}
        <span className="absolute inset-y-0 w-px bg-tinta/25" style={{ left: `${target}%` }} />
      </div>
      <span className="w-12 text-right font-medium text-[0.86rem] text-tinta tabular-nums">
        {formatPercent(value)}
      </span>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-[10px] bg-gelo-2', className)} />
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="cartao flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="t-titulo text-lg">{title}</p>
      {children && <div className="max-w-md text-[0.92rem] text-tinta-3">{children}</div>}
    </div>
  )
}

export function Stat({
  label,
  value,
  hint,
  emphasis = false,
  tone,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  emphasis?: boolean
  tone?: Tone
}) {
  return (
    <div className="cartao flex min-w-0 flex-col gap-3 p-5">
      <span className="t-rotulo text-tinta-3">{label}</span>
      <span
        className={clsx(
          't-numero text-[2rem]',
          emphasis && 'texto-degrade',
          tone === 'falha' && 'text-falha',
          tone === 'alerta' && 'text-alerta',
        )}
      >
        {value}
      </span>
      {hint && <span className="text-[0.84rem] text-tinta-3">{hint}</span>}
    </div>
  )
}
