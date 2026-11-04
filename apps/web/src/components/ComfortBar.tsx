import { Alert02Icon, SignalNo01Icon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import { formatDuration, formatPercent, MISSING_HINT } from '../lib/format'
import { COMFORT_TARGET_PCT, comfortTone, TONE_CLASS } from '../lib/states'
import { Hint } from './Hint'
import { Icon } from './Icon'

const SEGMENTS = [
  { key: 'within', label: 'Na faixa', className: 'bg-na-faixa' },
  { key: 'below', label: 'Abaixo', className: 'bg-frio' },
  { key: 'above', label: 'Acima', className: 'bg-quente' },
] as const

export interface ComfortBarProps {
  /** % do horário na faixa (comfortPct). null = sem dado no período. */
  within: number | null
  /** % abaixo e acima da faixa. Sem eles, a barra mostra só o segmento "na faixa". */
  below?: number | null
  above?: number | null
  /** % do horário com leitura válida; abaixo de 90%, aparece o aviso de cobertura. */
  coverage?: number | null
  /** Minutos abaixo e acima, para a dica ("Abaixo 9,1% (11 h)"). */
  belowMinutes?: number
  aboveMinutes?: number
  /** table: trilho de 8 × 120 px com o valor à direita; kpi: 4 px em largura total, sem valor. */
  size?: 'table' | 'kpi'
  className?: string
}

/**
 * Barra de conforto (seção 3.7): distribuição na faixa · abaixo · acima, da esquerda para a direita,
 * com a marca da meta. "Na faixa" começa em 0, então o fim dele se compara direto com a meta.
 */
export function ComfortBar({
  within,
  below,
  above,
  coverage,
  belowMinutes,
  aboveMinutes,
  size = 'table',
  className,
}: ComfortBarProps) {
  const values = { within, below, above }
  const hasData = within != null
  const tone = comfortTone(within)
  const lowCoverage = coverage != null && coverage < COMFORT_TARGET_PCT
  const minutes = { within: undefined, below: belowMinutes, above: aboveMinutes }

  const described = SEGMENTS.filter((segment) => values[segment.key] != null)
  const label = hasData
    ? [
        `${formatPercent(within)} do horário na faixa`,
        ...described
          .slice(1)
          .map((segment) => `${formatPercent(values[segment.key])} ${segment.label.toLowerCase()}`),
        `meta ${COMFORT_TARGET_PCT}%`,
      ].join('; ')
    : MISSING_HINT
  const hint = hasData
    ? [
        ...described.map((segment) => {
          const time = minutes[segment.key]
          return `${segment.label} ${formatPercent(values[segment.key])}${time != null ? ` (${formatDuration(time)})` : ''}`
        }),
        ...(coverage != null ? [`Cobertura ${formatPercent(coverage)}`] : []),
        `Meta ${COMFORT_TARGET_PCT}%`,
      ].join(' · ')
    : MISSING_HINT

  const bar = (
    <div
      role="img"
      aria-label={label}
      className={clsx('relative shrink-0', size === 'table' ? 'h-2 w-30' : 'h-1 w-full', className)}
    >
      <div
        className={clsx(
          'flex size-full overflow-hidden rounded-xs',
          hasData ? 'bg-superficie-3' : 'hachura-sem-dados ring-1 ring-borda ring-inset',
        )}
      >
        {hasData &&
          SEGMENTS.map((segment, index) => {
            const value = values[segment.key]
            if (value == null || value <= 0) return null
            return (
              <span
                key={segment.key}
                // Todo segmento com valor tem ao menos 2 px, para 0,3% continuar visível
                className={clsx(
                  'h-full min-w-0.5 shrink-0',
                  segment.className,
                  index > 0 && 'border-superficie border-s',
                )}
                style={{ width: `${Math.min(100, value)}%` }}
              />
            )
          })}
      </div>
      {hasData && (
        <span
          aria-hidden="true"
          className={clsx(
            'absolute top-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-texto',
            size === 'table' ? 'h-3' : 'h-2',
          )}
          style={{ left: `${COMFORT_TARGET_PCT}%` }}
        />
      )}
    </div>
  )

  if (size === 'kpi') return <Hint content={hint}>{bar}</Hint>

  return (
    <div className="flex items-center justify-end gap-2">
      <Hint content={hint}>{bar}</Hint>
      <span
        className={clsx(
          'num inline-flex w-16 shrink-0 items-center justify-end gap-1 whitespace-nowrap font-medium text-corpo',
          tone === 'neutro' ? 'text-texto' : TONE_CLASS[tone].text,
        )}
      >
        {tone !== 'neutro' && <Icon icon={Alert02Icon} size={12} />}
        {formatPercent(within)}
      </span>
      <span className="flex w-3 shrink-0">
        {lowCoverage && (
          <Hint
            content={`Conforto calculado sobre ${formatPercent(coverage)} do horário. Lacunas não contam.`}
          >
            <span className="flex text-texto-3">
              <Icon icon={SignalNo01Icon} size={12} label={`Cobertura de ${formatPercent(coverage)}`} />
            </span>
          </Hint>
        )}
      </span>
    </div>
  )
}

/** Legenda da barra: aparece uma vez por tela (na definição da coluna e no KPI herói). */
export function ComfortBarLegend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-legenda text-texto-2">
      {SEGMENTS.map((segment) => (
        <li key={segment.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={clsx('h-2 w-3 rounded-xs', segment.className)} />
          {segment.label}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-texto" />
        Meta de {COMFORT_TARGET_PCT}%
      </li>
    </ul>
  )
}
