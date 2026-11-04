import { Alert02Icon, ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { Definition } from '../../components/Definition'
import { Hint } from '../../components/Hint'
import { Icon } from '../../components/Icon'
import { TruncatedText } from '../../components/TruncatedText'
import { MISSING, MISSING_HINT } from '../../lib/format'
import { type Definition as DefinitionText, TONE_CLASS } from '../../lib/states'

export type KpiTone = 'neutro' | 'alerta' | 'falha'

export interface KpiChange {
  /** Valor já formatado, sem sinal ("2,1 p.p.", "0,4 °C", "1 h 20 min"). */
  amount: string
  direction: 'up' | 'down' | 'flat'
  /** good: melhora (ok); bad: piora (falha); neutral: sem juízo (texto-3). */
  verdict: 'good' | 'bad' | 'neutral'
  /** Base da comparação, no nome acessível: "vs 7 dias anteriores". */
  comparison: string
  /** Dica do chip: "Diferença para os 7 dias anteriores (28/01 – 04/02)". */
  hint: string
}

/** Chip de variação da seção 3.6: seta, valor e a base no nome acessível. */
function ChangeChip({ change }: { change: KpiChange }) {
  const spoken =
    change.direction === 'flat'
      ? `sem variação ${change.comparison}`
      : `${change.direction === 'up' ? 'subiu' : 'caiu'} ${change.amount} ${change.comparison}`
  const icon =
    change.direction === 'up' ? ArrowUp01Icon : change.direction === 'down' ? ArrowDown01Icon : null
  return (
    <Hint content={change.hint}>
      <span
        className={clsx(
          'num inline-flex h-5 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-sm px-1.5 font-medium text-legenda',
          change.verdict === 'good'
            ? 'bg-ok-fundo text-ok-texto'
            : change.verdict === 'bad'
              ? 'bg-falha-fundo text-falha-texto'
              : 'bg-superficie-3 text-texto-3',
        )}
      >
        {icon && <Icon icon={icon} size={12} />}
        <span aria-hidden="true">{change.amount}</span>
        <span className="so-leitor">{spoken}</span>
      </span>
    </Hint>
  )
}

/** Número com unidade (seção 1.3): "82,4" em text-kpi e "%" em corpo-lg texto-3. */
export function KpiNumber({ value, unit }: { value: string; unit?: string }) {
  return (
    <span className="num whitespace-nowrap text-kpi text-texto">
      {value}
      {unit && <span className="ms-1 font-medium text-corpo-lg text-texto-3 tracking-normal">{unit}</span>}
    </span>
  )
}

/** Duração com as unidades menores: "4 h 35 min" vira 4 [h] 35 [min]. */
export function KpiDuration({ text }: { text: string }) {
  const parts = [...text.matchAll(/(\d[\d.]*)\s*(min|h|d)/g)]
  return (
    <span className="num whitespace-nowrap text-kpi text-texto">
      {parts.map(([, number, unit], index) => (
        <span key={`${number}${unit}`} className={index > 0 ? 'ms-2' : undefined}>
          {number}
          <span className="ms-1 font-medium text-corpo-lg text-texto-3 tracking-normal">{unit}</span>
        </span>
      ))}
    </span>
  )
}

/**
 * Indicador do detalhe: célula sem sombra dentro do cartão do período (divide-x), com rótulo e
 * definição, valor com o chip de variação ao lado, uma linha de contexto e um visual na base.
 */
export function KpiCell({
  label,
  definition,
  value,
  text,
  context,
  tone = 'neutro',
  change,
  children,
  className,
}: {
  label: string
  definition: DefinitionText
  /** Número formatado (KpiNumber, KpiDuration); null mostra "—". */
  value?: ReactNode
  /** Valor textual ("Nenhuma"), em corpo-lg, nunca no estilo numérico. */
  text?: string
  context?: string
  tone?: KpiTone
  change?: KpiChange | null
  children?: ReactNode
  className?: string
}) {
  const alert = tone !== 'neutro'
  return (
    <article className={clsx('flex min-h-26 w-full min-w-0 flex-col gap-1.5 p-4', className)}>
      <h3 className="font-medium text-apoio text-texto-3">
        {label}
        <span className="nao-imprimir -my-1 ms-1 inline-flex align-middle">
          <Definition term={definition.term} lines={definition.lines} />
        </span>
      </h3>
      {/* O chip vai ao lado do valor (4.3): no rótulo, os nomes longos o empurrariam para outra linha */}
      <p className="flex min-h-8 flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="flex items-center gap-1.5">
          {alert && <Icon icon={Alert02Icon} className={TONE_CLASS[tone].icon} />}
          {text ? (
            <span className="font-medium text-corpo-lg text-texto-2">{text}</span>
          ) : value == null ? (
            <Hint content={MISSING_HINT}>
              <span className="num text-kpi text-texto-3">{MISSING}</span>
            </Hint>
          ) : (
            value
          )}
        </span>
        {change && <ChangeChip change={change} />}
      </p>
      {context && (
        <div className={clsx('text-legenda', alert ? TONE_CLASS[tone].text : 'text-texto-3')}>
          <TruncatedText text={context} wrapOnMobile />
        </div>
      )}
      {children && <div className="mt-auto pt-1.5">{children}</div>}
    </article>
  )
}
