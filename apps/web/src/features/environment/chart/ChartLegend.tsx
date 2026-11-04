import { clsx } from 'clsx'
import { createElement, type ReactNode } from 'react'
import { Hint } from '../../../components/Hint'
import { formatInteger } from '../../../lib/format'
import { DISCARD_REASON, NO_DATA_GAP } from '../../../lib/states'
import { type SwatchKind, swatchShapes } from './swatches'

/** Amostra SVG de 16×10 com a mesma forma da marca no gráfico; desligada, a 30% e vazada. */
export function Swatch({ kind, off = false }: { kind: SwatchKind; off?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 10"
      width={16}
      height={10}
      aria-hidden="true"
      className={clsx('shrink-0', off && 'opacity-30')}
    >
      {swatchShapes(kind, off).map((shape, index) =>
        createElement(shape.tag, { key: index, ...shape.attrs, style: shape.style }),
      )}
    </svg>
  )
}

export interface LegendToggle {
  key: string
  label: string
  swatch: SwatchKind
  pressed: boolean
  /** Sem efeito no período atual (banda mín–máx em médias de 5 min, por exemplo). */
  unavailable?: boolean
  hint?: string
}

const ITEM =
  'inline-flex h-7 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-sm px-2 font-medium text-legenda'

/** Botão de legenda (seção 3.16): liga e desliga uma camada. */
function LegendButton({
  item,
  onToggle,
  onHover,
}: {
  item: LegendToggle
  onToggle: () => void
  onHover: (active: boolean) => void
}) {
  const off = !item.pressed || item.unavailable
  const button = (
    <button
      type="button"
      aria-pressed={item.pressed}
      aria-disabled={item.unavailable || undefined}
      onClick={item.unavailable ? undefined : onToggle}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      className={clsx(
        ITEM,
        'pressionavel foco-interno',
        item.unavailable ? 'cursor-not-allowed text-texto-3' : 'hover:bg-realce',
        off ? 'text-texto-3' : 'text-texto-2',
      )}
    >
      <Swatch kind={item.swatch} off={off} />
      {item.label}
    </button>
  )
  return item.hint ? <Hint content={item.hint}>{button}</Hint> : button
}

/** Chave fixa (sem alternar): lacunas, sempre mostradas com a contagem, e o período anterior. */
function LegendKey({
  label,
  count,
  mark,
  hint,
}: {
  label: string
  count?: number
  mark: ReactNode
  hint: string
}) {
  return (
    <Hint content={hint}>
      <span className={clsx(ITEM, 'text-texto-2')}>
        {mark}
        {label}
        {count != null && <span className="num text-texto-3">{formatInteger(count)}</span>}
      </span>
    </Hint>
  )
}

const hatch = (className: string) => (
  <span className={clsx('h-2.5 w-4 shrink-0 rounded-xs ring-1 ring-borda-forte ring-inset', className)} />
)

/**
 * Legenda HTML acima do canvas (seção 5.2), um grupo de botões de alternar com nome próprio. No
 * celular vira uma fila com rolagem horizontal, com encaixe por item e esmaecimento na borda direita.
 */
export function ChartLegend({
  items,
  previous,
  noData,
  discarded,
  fitOutdoor,
  onToggle,
  onHover,
  onFitOutdoor,
}: {
  items: LegendToggle[]
  /** Rótulo do período anterior quando "Comparar" está ligado; ele alterna pelo botão, não aqui. */
  previous: string | null
  noData: number
  discarded: number
  /** null: a externa cabe na escala e o botão de ajuste não aparece. */
  fitOutdoor: boolean | null
  onToggle: (key: string) => void
  onHover: (key: string | null) => void
  onFitOutdoor: () => void
}) {
  return (
    <fieldset className="-mx-2 flex min-w-0 snap-x items-center gap-0.5 overflow-x-auto px-2 max-sm:mask-r-from-90% sm:flex-wrap sm:overflow-visible">
      <legend className="so-leitor">Camadas do gráfico</legend>
      {items.map((item) => (
        <span key={item.key} className="contents">
          <LegendButton
            item={item}
            onToggle={() => onToggle(item.key)}
            onHover={(active) => onHover(active ? item.key : null)}
          />
          {item.key === 'outdoor' && fitOutdoor != null && (
            <button
              type="button"
              aria-pressed={fitOutdoor}
              onClick={onFitOutdoor}
              className={clsx(
                ITEM,
                'pressionavel foco-interno text-acento hover:bg-realce',
                fitOutdoor && 'bg-selecionado',
              )}
            >
              Ajustar escala à externa
            </button>
          )}
        </span>
      ))}
      {previous && (
        <LegendKey
          label={previous}
          mark={<Swatch kind="previous" />}
          hint="O mesmo trecho do período anterior, sobreposto a este. Liga e desliga em Comparar."
        />
      )}
      {noData > 0 && (
        <LegendKey
          label="Sem dados"
          count={noData}
          mark={hatch(NO_DATA_GAP.hatchClass)}
          hint={NO_DATA_GAP.hint}
        />
      )}
      {discarded > 0 && (
        <LegendKey
          label="Leitura descartada"
          count={discarded}
          mark={hatch(DISCARD_REASON.stuck.hatchClass)}
          hint="Leituras inválidas descartadas: sensor travado, erro do sensor, picos ou fora da faixa física."
        />
      )}
    </fieldset>
  )
}
