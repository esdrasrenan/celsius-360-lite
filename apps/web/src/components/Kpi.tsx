import { Alert02Icon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { MISSING } from '../lib/format'
import type { Definition as DefinitionText } from '../lib/states'
import { Definition } from './Definition'
import { Icon } from './Icon'
import { Skeleton } from './Skeleton'
import { TruncatedText } from './TruncatedText'

export interface KpiFilter {
  pressed: boolean
  onToggle: () => void
  /** Nome acessível do botão: "Filtrar por fora da meta: 2 de 25". */
  label: string
}

export interface KpiProps {
  label: string
  /** Definição do popover "Como é calculado" (DEFINITIONS de lib/states.ts). */
  definition?: DefinitionText
  /** Número já formatado ("93,2"); null mostra "—". */
  value?: string | null
  /** Unidade ao lado do número ("%", "de 25"). */
  unit?: string
  /** Valor textual ("Nenhuma", "Todas as lojas fechadas"), no lugar do número. */
  text?: string
  /** Contexto: quebra no celular (a dica não abre com toque) e trunca com dica a partir de md. */
  context?: string
  /** Contagem de problema maior que zero: ícone de alerta antes do valor e contexto em alerta. */
  alert?: boolean
  /** Assinatura da marca: só o KPI herói ("Conforto da rede"). */
  brand?: boolean
  /** Variante filtro: o cartão inteiro vira um botão com aria-pressed. */
  filter?: KpiFilter
  loading?: boolean
  /** Erro: valor "—" e contexto "Indisponível", nunca skeleton eterno. */
  error?: boolean
  /** Visual opcional na base (barra de distribuição). */
  children?: ReactNode
  className?: string
}

/**
 * Cartão de indicador único (seção 3.6), no lugar de Stat e Indicator: rótulo com definição,
 * valor com unidade, uma linha de contexto e um visual opcional na base.
 */
export function Kpi({
  label,
  definition,
  value = null,
  unit,
  text,
  context,
  alert = false,
  brand = false,
  filter,
  loading = false,
  error = false,
  children,
  className,
}: KpiProps) {
  if (loading) {
    return (
      <article
        aria-busy="true"
        className={clsx('cartao flex min-h-kpi flex-col gap-2 p-4 md:p-5', className)}
      >
        <span className="so-leitor">{label}: carregando</span>
        <Skeleton className="h-3 w-24" delay={0} />
        <Skeleton className="mt-1 h-6 w-18" delay={0} />
        <Skeleton className="mt-auto h-2.5 w-35 max-w-full" delay={0} />
      </article>
    )
  }

  const shownContext = error ? 'Indisponível' : context
  const showAlert = alert && !error
  return (
    <article
      className={clsx(
        'cartao relative flex min-h-kpi min-w-0 flex-col gap-2 p-4 md:p-5',
        brand && 'barra-topo-marca',
        className,
      )}
    >
      {filter && (
        // Botão esticado atrás do conteúdo (que ignora o ponteiro): o cartão inteiro filtra sem
        // aninhar o botão da definição, e o hover e o estado ativo pintam o fundo do cartão
        <button
          type="button"
          aria-pressed={filter.pressed}
          aria-label={filter.label}
          onClick={filter.onToggle}
          className="absolute inset-0 rounded-xl transition-shadow duration-100 ease-linear hover:shadow-cartao-hover aria-pressed:bg-selecionado aria-pressed:ring-2 aria-pressed:ring-acento aria-pressed:ring-inset"
        />
      )}
      <h3 className="pointer-events-none relative min-w-0 font-medium text-apoio text-texto-3">
        {label}
        {definition && (
          <span className="pointer-events-auto -my-1 ms-1 inline-flex align-middle">
            <Definition term={definition.term} lines={definition.lines} />
          </span>
        )}
      </h3>
      <p className="pointer-events-none relative flex items-center gap-1.5">
        {showAlert && <Icon icon={Alert02Icon} className="text-alerta" />}
        {text && !error ? (
          <span className="font-medium text-corpo-lg text-texto-2">{text}</span>
        ) : (
          // Sem espaço (2 × 2 em 320 px), a unidade desce inteira e alinhada à esquerda, nunca partida
          <span className="num flex flex-wrap items-baseline gap-x-1 text-kpi text-texto">
            {error || value == null ? MISSING : value}
            {unit && !error && value != null && (
              <span className="font-medium text-corpo-lg text-texto-3 tracking-normal">{unit}</span>
            )}
          </span>
        )}
      </p>
      {shownContext && (
        <div
          className={clsx(
            'relative text-legenda',
            // No KPI-filtro o clique no contexto também filtra; o nome do botão já traz a informação
            filter ? 'pointer-events-none' : 'pointer-events-auto',
            showAlert ? 'text-alerta-texto' : 'text-texto-3',
          )}
        >
          <TruncatedText text={shownContext} wrapOnMobile />
        </div>
      )}
      {children && !error && <div className="pointer-events-none relative mt-auto">{children}</div>}
      {filter?.pressed && (
        <p className="pointer-events-none relative font-medium text-acento text-legenda">Filtrando</p>
      )}
    </article>
  )
}
