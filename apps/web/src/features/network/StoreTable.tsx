import type { StoreListItem, StoreSort } from '@celsius/contracts'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import { type ReactNode, useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { ComfortBarLegend } from '../../components/ComfortBar'
import { Definition } from '../../components/Definition'
import { Icon } from '../../components/Icon'
import { ProgressBar } from '../../components/ProgressBar'
import { Skeleton } from '../../components/Skeleton'
import { DEFINITIONS } from '../../lib/states'
import { CELL_SHOW, StoreRows } from './StoreRows'

type SortColumn = 'name' | 'now' | 'comfort'

/** Ciclo de cada cabeçalho; depois do último, volta à gravidade (o padrão). */
const SORT_CYCLE: Record<SortColumn, StoreSort[]> = {
  name: ['name'],
  now: ['out_of_range'],
  comfort: ['comfort', 'comfort_desc'],
}

/** Direção de cada ordenação, do ponto de vista do valor da coluna. */
const SORT_DIRECTION: Partial<Record<StoreSort, 'ascending' | 'descending'>> = {
  name: 'ascending',
  out_of_range: 'descending',
  comfort: 'ascending',
  comfort_desc: 'descending',
}

const DIRECTION_LABEL = { ascending: 'crescente', descending: 'decrescente' }

const COL_SHOW = { md: '', lg: 'hidden lg:table-column', xl: 'hidden xl:table-column' } as const

const HEAD_CELL =
  'h-cabecalho-tabela border-borda border-b bg-superficie-2 px-3 align-middle font-medium text-legenda text-texto-3'

function SortHeader({
  column,
  label,
  sort,
  onSort,
  align = 'start',
  className,
  children,
}: {
  column: SortColumn
  label: string
  sort: StoreSort
  onSort: (sort: StoreSort) => void
  align?: 'start' | 'end'
  className?: string
  children?: ReactNode
}) {
  const cycle = SORT_CYCLE[column]
  const index = cycle.indexOf(sort)
  const direction = index >= 0 ? SORT_DIRECTION[sort] : undefined
  const next = cycle[index + 1] ?? 'status'
  return (
    <th scope="col" aria-sort={direction ?? 'none'} className={clsx(HEAD_CELL, className)}>
      <span className={clsx('flex items-center gap-0.5', align === 'end' && 'justify-end')}>
        <button
          type="button"
          onClick={() => onSort(next)}
          aria-label={`Ordenar por ${label.toLowerCase()}${direction ? `, atualmente ${DIRECTION_LABEL[direction]}` : ''}`}
          className={clsx(
            '-mx-1 inline-flex h-6 items-center gap-1 rounded-xs px-1 transition-colors duration-100 ease-linear hover:text-texto',
            direction && 'text-texto-2',
          )}
        >
          {label}
          <Icon
            icon={ArrowDown01Icon}
            size={12}
            className={clsx(
              'transition-transform duration-200 ease-saida motion-reduce:transition-none',
              direction ? 'opacity-100' : 'opacity-35',
              direction === 'ascending' && 'rotate-180',
            )}
          />
        </button>
        {children}
      </span>
    </th>
  )
}

function SkeletonRows() {
  return (
    <tbody className="block md:table-row-group" aria-hidden="true">
      {['a', 'b', 'c', 'd', 'e'].map((key) => (
        <tr key={key} className="block bg-superficie-2 md:table-row">
          <td className={clsx(CELL_SHOW.md, 'h-linha-loja border-borda-forte border-t')} />
          <td className={clsx(CELL_SHOW.md, 'h-linha-loja border-borda-forte border-t px-3')}>
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="mt-2 h-2.5 w-1/4" />
          </td>
          <td className={clsx(CELL_SHOW.lg, 'border-borda-forte border-t px-3')}>
            <Skeleton className="h-3 w-12" />
          </td>
          <td className={clsx(CELL_SHOW.md, 'border-borda-forte border-t px-3')}>
            <Skeleton className="ms-auto h-3 w-16" />
          </td>
          <td className={clsx(CELL_SHOW.xl, 'border-borda-forte border-t')} />
          <td className={clsx(CELL_SHOW.md, 'border-borda-forte border-t px-3')}>
            <span className="flex items-center justify-end gap-2">
              <Skeleton className="h-2 w-30" />
              <Skeleton className="h-3 w-10" />
              <span className="w-3" />
            </span>
          </td>
          <td className={clsx(CELL_SHOW.xl, 'border-borda-forte border-t px-3')}>
            <Skeleton className="ms-auto h-3 w-10" />
          </td>
          <td className={clsx(CELL_SHOW.md, 'border-borda-forte border-t')} />
          <td className="block border-borda-forte border-t px-4 py-4 md:hidden">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="mt-2 h-2.5 w-3/5" />
            <Skeleton className="mt-3 h-1 w-full" />
          </td>
        </tr>
      ))}
    </tbody>
  )
}

/** Uma linha só com o conteúdo (vazio ou erro), mantendo o cabeçalho da tabela visível. */
function MessageRow({ children }: { children: ReactNode }) {
  return (
    <tbody className="block md:table-row-group">
      <tr className="block md:table-row">
        <td colSpan={8} className="block md:table-cell">
          {children}
        </td>
      </tr>
    </tbody>
  )
}

/** Verdadeiro por 2,4 s depois que a busca muda e o resultado chega (ambiente encontrado em destaque). */
function useFlash(search: string, settled: boolean): boolean {
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!search || !settled) return
    setFlash(true)
    const timer = setTimeout(() => setFlash(false), 2400)
    return () => clearTimeout(timer)
  }, [search, settled])
  return flash
}

/**
 * Tabela de lojas e ambientes (seção 3.11) dentro do cartão: topo com a contagem viva e
 * "Expandir todas", cabeçalho fixo com ordenação sincronizada ao "Ordenar por", um <tbody> por
 * loja e o rodapé de paginação. Na recarga, o conteúdo fica a 60% com a barra indeterminada.
 */
export function StoreTable({
  items,
  open,
  onToggle,
  onToggleAll,
  sort,
  onSort,
  search,
  now,
  period,
  from,
  count,
  loading,
  reloading,
  message,
  footer,
}: {
  items: readonly StoreListItem[]
  open: ReadonlySet<string>
  onToggle: (storeId: string) => void
  onToggleAll: (open: boolean) => void
  sort: StoreSort
  onSort: (sort: StoreSort) => void
  search: string
  now: string | null
  period: string
  from: string
  /** Texto da contagem viva ("5 lojas · 25 ambientes"). */
  count: ReactNode
  loading: boolean
  reloading: boolean
  /** Estado vazio ou de erro, no lugar das linhas. */
  message: ReactNode
  footer?: ReactNode
}) {
  const flash = useFlash(search, !loading && !reloading)
  const allOpen = items.length > 0 && items.every((store) => open.has(store.id))

  return (
    <section aria-labelledby="lojas-titulo" className="cartao relative overflow-clip">
      <ProgressBar active={reloading} label="Atualizando a lista de lojas" />
      <div className="flex h-12 items-center justify-between gap-3 border-borda border-b ps-4 pe-2">
        <h2 id="lojas-titulo" className="so-leitor">
          Lojas
        </h2>
        <p role="status" className="num min-w-0 truncate text-apoio text-texto-3">
          {count}
        </p>
        {items.length > 1 && !message && (
          <Button variant="ghost" size="sm" onClick={() => onToggleAll(!allOpen)}>
            {allOpen ? 'Recolher todas' : 'Expandir todas'}
          </Button>
        )}
      </div>
      <table
        aria-labelledby="lojas-titulo"
        aria-busy={reloading || loading || undefined}
        className={clsx(
          'block w-full border-separate border-spacing-0 md:table md:table-fixed',
          reloading && 'opacity-60',
        )}
      >
        <colgroup className="hidden md:table-column-group">
          <col className="w-10" />
          <col />
          <col className={clsx(COL_SHOW.lg, 'w-36')} />
          <col className="w-36" />
          <col className={clsx(COL_SHOW.xl, 'w-24')} />
          <col className="w-60" />
          <col className={clsx(COL_SHOW.xl, 'w-24')} />
          <col className="w-8" />
        </colgroup>
        <thead className="sticky top-cabecalho z-10 hidden md:table-header-group">
          <tr>
            <td className={HEAD_CELL} />
            <SortHeader column="name" label="Loja / ambiente" sort={sort} onSort={onSort} />
            <th scope="col" className={clsx(HEAD_CELL, CELL_SHOW.lg, 'text-start')}>
              Telemetria
            </th>
            <SortHeader column="now" label="Agora" sort={sort} onSort={onSort} align="end" />
            <th scope="col" className={clsx(HEAD_CELL, CELL_SHOW.xl, 'text-end')}>
              Faixa
            </th>
            <SortHeader column="comfort" label="Conforto no período" sort={sort} onSort={onSort} align="end">
              <Definition term={DEFINITIONS.comfortInPeriod.term} lines={DEFINITIONS.comfortInPeriod.lines}>
                <div className="mt-1 border-borda border-t pt-2.5">
                  <ComfortBarLegend />
                </div>
              </Definition>
            </SortHeader>
            <th scope="col" className={clsx(HEAD_CELL, CELL_SHOW.xl, 'text-end')}>
              Cobertura
            </th>
            <td className={HEAD_CELL} />
          </tr>
        </thead>
        {loading ? (
          <SkeletonRows />
        ) : message ? (
          <MessageRow>{message}</MessageRow>
        ) : (
          items.map((store) => (
            <StoreRows
              key={store.id}
              store={store}
              open={open.has(store.id)}
              onToggle={() => onToggle(store.id)}
              search={search}
              flash={flash}
              now={now}
              period={period}
              from={from}
            />
          ))
        )}
      </table>
      {footer}
    </section>
  )
}
