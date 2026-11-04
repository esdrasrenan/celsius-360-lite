import type { NetworkTotals } from '@celsius/contracts'
import { clsx } from 'clsx'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { ComfortBar } from '../../components/ComfortBar'
import { Kpi } from '../../components/Kpi'
import { Skeleton } from '../../components/Skeleton'
import { formatInteger, formatPercent, plural, pluralWord } from '../../lib/format'
import { COMFORT_TARGET_PCT, DEFINITIONS } from '../../lib/states'
import type { NetworkView } from './params'

/** Número e unidade separados: "93,2" + "%" (e "<0,1" + "%"). */
const percentParts = (value: number | null) => {
  const text = formatPercent(value)
  return value == null ? { value: null } : { value: text.slice(0, -1), unit: '%' }
}

/** Repete o último valor no máximo a cada `ms`: a região viva não anuncia cada atualização. */
function useThrottled(value: string, ms: number): string {
  const [shown, setShown] = useState(value)
  const last = useRef(0)
  useEffect(() => {
    const timer = setTimeout(
      () => {
        last.current = Date.now()
        setShown(value)
      },
      Math.max(0, last.current + ms - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [value, ms])
  return shown
}

/** Esqueleto com a geometria do cartão pronto: linhas de 18, 32 e 16 px e a barra do herói. */
function KpiSkeleton({ hero = false }: { hero?: boolean }) {
  return (
    <div aria-hidden="true" className="cartao flex min-h-kpi flex-col gap-2 p-4 md:p-5">
      {/*
       * A linha do rótulo reproduz a do Kpi (texto com o botão da definição alinhado ao meio, que a
       * deixa com fração de pixel a mais): sem isso, o conteúdo desce meio pixel ao chegar.
       */}
      <span className="relative flex items-center font-medium text-apoio">
        <span className="invisible">
          x<span className="-my-1 ms-1 inline-flex size-6 align-middle" />
        </span>
        <Skeleton className="absolute h-3 w-24 max-w-full" />
      </span>
      <span className="flex h-8 items-center">
        <Skeleton className="h-6 w-18" />
      </span>
      {hero ? (
        <span className="flex flex-col gap-2">
          <Skeleton className="h-1 w-full" />
          <span className="flex h-4 items-center">
            <Skeleton className="h-2.5 w-35 max-w-full" />
          </span>
        </span>
      ) : (
        <span className="flex h-4 items-center">
          <Skeleton className="h-2.5 w-35 max-w-full" />
        </span>
      )}
    </div>
  )
}

function LegendItem({ swatch, children }: { swatch: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span aria-hidden="true" className={swatch} />
      {children}
    </span>
  )
}

/**
 * Legenda do KPI herói, numa linha só: a direção do problema (frio ou quente) em texto, não só em
 * cor, e o traço da meta com a mesma forma que ele tem na barra. Quando falta largura, quebra
 * alinhada à esquerda, como uma lista.
 */
function ComfortLegend({ totals }: { totals: NetworkTotals }) {
  return (
    <p className="num flex flex-wrap items-center gap-x-2 gap-y-0.5 text-legenda text-texto-3">
      <LegendItem swatch="size-2 rounded-xs bg-frio">{formatPercent(totals.belowPct)} abaixo</LegendItem>
      <LegendItem swatch="size-2 rounded-xs bg-quente">{formatPercent(totals.abovePct)} acima</LegendItem>
      <LegendItem swatch="h-2.5 w-0.5 rounded-full bg-texto">meta {COMFORT_TARGET_PCT}%</LegendItem>
    </p>
  )
}

/**
 * Os 4 indicadores da visão da rede (seção 4.2). Com filtro, o título diz "da seleção" e quantas
 * lojas do acesso ela cobre. Três cartões são filtros (aria-pressed); no escopo de uma loja só,
 * não filtram.
 */
export function NetworkKpis({
  totals,
  loading,
  error,
  reloading,
  view,
  scopeStores,
  filtered,
  singleStore,
  onFilter,
}: {
  totals: NetworkTotals | undefined
  /** Primeira carga, sem dado nenhum. */
  loading: boolean
  error: boolean
  /** Recarga com os dados anteriores ainda na tela. */
  reloading: boolean
  view: NetworkView
  /** Lojas no acesso do usuário, sem filtro ("1 de 5 lojas"). */
  scopeStores: number | null
  filtered: boolean
  singleStore: boolean
  onFilter: (patch: Partial<NetworkView>) => void
}) {
  const ready = totals && !error
  const summary = ready
    ? [
        `Conforto ${formatPercent(totals.comfortPct)}`,
        `${formatInteger(totals.belowTarget)} de ${formatInteger(totals.environments)} ambientes fora da meta`,
        `${formatInteger(totals.outOfRange)} fora da faixa agora`,
        `${formatInteger(totals.online)} de ${formatInteger(totals.environments)} online`,
      ].join('; ')
    : ''
  const announcement = useThrottled(summary, 10_000)

  // Com filtro é sempre "da seleção", mesmo no escopo de uma loja (a busca pode zerá-la)
  const title = filtered
    ? 'Indicadores da seleção'
    : singleStore
      ? 'Indicadores da loja'
      : 'Indicadores da rede'
  const scope =
    filtered && totals && scopeStores != null
      ? `${formatInteger(totals.stores)} de ${plural(scopeStores, 'loja', 'lojas')}`
      : null

  return (
    <section aria-labelledby="indicadores-titulo" className="flex flex-col gap-3">
      <h2 id="indicadores-titulo" className="font-semibold text-corpo text-texto">
        {title}
        {scope && <span className="font-normal text-texto-3"> · {scope}</span>}
      </h2>
      <p className="so-leitor" aria-live="polite">
        {announcement}
      </p>
      {loading ? (
        <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
          <KpiSkeleton hero />
          <KpiSkeleton />
          <KpiSkeleton />
          <KpiSkeleton />
        </div>
      ) : (
        <div
          aria-busy={reloading || undefined}
          className={clsx('grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4', reloading && 'opacity-60')}
        >
          <NetworkKpiCards
            totals={ready ? totals : undefined}
            view={view}
            filtered={filtered}
            singleStore={singleStore}
            onFilter={onFilter}
          />
        </div>
      )}
    </section>
  )
}

const EMPTY_SELECTION = 'Nenhuma loja na seleção'

function NetworkKpiCards({
  totals,
  view,
  filtered,
  singleStore,
  onFilter,
}: {
  /** undefined = erro: os cartões mostram "—" e "Indisponível". */
  totals: NetworkTotals | undefined
  view: NetworkView
  filtered: boolean
  singleStore: boolean
  onFilter: (patch: Partial<NetworkView>) => void
}) {
  const error = !totals
  // Seleção vazia (busca sem resultado): "—", nunca "0 de 0" nem "Todos os ambientes abertos"
  const none = totals?.environments === 0
  const count = (value: number | undefined) => (value === undefined || none ? null : formatInteger(value))
  const environments = totals?.environments ?? 0
  const worst = totals?.worstEnvironment
  const closed = totals ? totals.environments - totals.openNow : 0
  const problems = totals ? totals.environments - totals.online : 0
  const filters = !singleStore && totals
  // Nunca "da rede" sobre um recorte (seção 6, item 14)
  const comfortLabel = filtered
    ? 'Conforto da seleção'
    : singleStore
      ? 'Conforto da loja'
      : 'Conforto da rede'

  return (
    <>
      <Kpi
        brand
        label={comfortLabel}
        definition={{ ...DEFINITIONS.networkComfort, term: comfortLabel }}
        {...percentParts(totals?.comfortPct ?? null)}
        context={none ? EMPTY_SELECTION : undefined}
        error={error}
      >
        {totals && totals.comfortPct != null && (
          <div className="flex flex-col gap-2">
            <ComfortBar
              size="kpi"
              within={totals.comfortPct}
              below={totals.belowPct}
              above={totals.abovePct}
              coverage={totals.coveragePct}
            />
            <ComfortLegend totals={totals} />
          </div>
        )}
      </Kpi>

      <Kpi
        label={DEFINITIONS.belowTarget.term}
        definition={DEFINITIONS.belowTarget}
        value={count(totals?.belowTarget)}
        unit={`de ${formatInteger(environments)}`}
        alert={(totals?.belowTarget ?? 0) > 0}
        context={
          !totals
            ? undefined
            : none
              ? EMPTY_SELECTION
              : worst && worst.comfortPct < COMFORT_TARGET_PCT
                ? // O percentual vem antes da loja: num cartão estreito, é o que sobra do corte
                  `Pior: ${worst.name} ${formatPercent(worst.comfortPct)}${singleStore ? '' : ` · ${worst.storeName}`}`
                : `${plural(totals.environments, 'ambiente', 'ambientes')} na meta`
        }
        filter={
          filters
            ? {
                pressed: view.belowTarget,
                onToggle: () => onFilter({ belowTarget: !view.belowTarget }),
                label: `Filtrar lojas fora da meta: ${formatInteger(totals.belowTarget)} de ${plural(environments, 'ambiente', 'ambientes')}`,
              }
            : undefined
        }
        error={error}
      />

      {totals && totals.openNow === 0 && totals.environments > 0 ? (
        <Kpi
          label={DEFINITIONS.outOfRangeNow.term}
          definition={DEFINITIONS.outOfRangeNow}
          text={singleStore ? 'Loja fechada' : 'Todas as lojas fechadas'}
          context={`${plural(totals.environments, 'ambiente fechado', 'ambientes fechados')} agora`}
        />
      ) : (
        <Kpi
          label={DEFINITIONS.outOfRangeNow.term}
          definition={DEFINITIONS.outOfRangeNow}
          value={count(totals?.outOfRange)}
          unit={
            totals
              ? `de ${formatInteger(totals.openNow)} ${pluralWord(totals.openNow, 'aberto', 'abertos')}`
              : undefined
          }
          alert={(totals?.outOfRange ?? 0) > 0}
          context={
            totals &&
            (none
              ? EMPTY_SELECTION
              : closed > 0
                ? `${formatInteger(closed)} em lojas fechadas`
                : 'Todos os ambientes abertos')
          }
          filter={
            filters
              ? {
                  pressed: view.outOfRange,
                  onToggle: () => onFilter({ outOfRange: !view.outOfRange }),
                  label: `Filtrar lojas fora da faixa agora: ${formatInteger(totals.outOfRange)} de ${formatInteger(totals.openNow)} abertos`,
                }
              : undefined
          }
          error={error}
        />
      )}

      <Kpi
        label={DEFINITIONS.telemetry.term}
        definition={DEFINITIONS.telemetry}
        value={count(totals?.online)}
        unit={`de ${formatInteger(environments)} online`}
        alert={problems > 0}
        context={
          totals &&
          (none
            ? EMPTY_SELECTION
            : `${formatInteger(totals.offline)} offline · ${formatInteger(totals.sensorFault)} falha no sensor · ${formatInteger(totals.noData)} sem dados`)
        }
        filter={
          filters
            ? {
                pressed: view.status === 'atencao',
                onToggle: () => onFilter({ status: view.status === 'atencao' ? 'todas' : 'atencao' }),
                label: `Filtrar lojas com problema de telemetria: ${plural(problems, 'ambiente', 'ambientes')} fora do ar ou sem leitura`,
              }
            : undefined
        }
        error={error}
      />
    </>
  )
}
