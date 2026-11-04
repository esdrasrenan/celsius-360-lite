import type { ClientListItem, StoreFacets, StoreSort } from '@celsius/contracts'
import { Building03Icon, FilterHorizontalIcon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '../../components/Button'
import { Combobox } from '../../components/Combobox'
import { FilterChip } from '../../components/FilterChip'
import { Hint } from '../../components/Hint'
import { SearchField } from '../../components/SearchField'
import { PillGroup } from '../../components/SegmentedControl'
import { Select } from '../../components/Select'
import { Sheet } from '../../components/Sheet'
import { formatInteger, plural } from '../../lib/format'
import { COMFORT_TARGET_PCT, SORT_LABEL, STORE_STATE } from '../../lib/states'
import { CLEARED_FILTERS, type NetworkView, SEARCH_MAX, type StatusFilter } from './params'

const SORT_OPTIONS = (Object.keys(SORT_LABEL) as StoreSort[]).map((value) => ({
  value,
  label: SORT_LABEL[value],
}))

const ALL_CLIENTS = 'todos'

/** Até 7 clientes cabem num Select; acima disso, o Combobox com busca (seção 3.3). */
const COMBOBOX_FROM = 8

function useMediaQuery(media: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(media)
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    },
    () => window.matchMedia(media).matches,
  )
}

/**
 * Texto de exemplo na medida da largura da busca: abaixo de lg ela divide a linha com os selects
 * (ou com "Filtros", no celular), e o texto inteiro viraria "Buscar l…".
 */
function useSearchPlaceholder(singleStore: boolean): string {
  const large = useMediaQuery('(min-width: 64rem)')
  const small = useMediaQuery('(min-width: 40rem)')
  if (singleStore) return small ? 'Buscar ambiente ou dispositivo' : 'Buscar ambiente'
  if (large) return 'Buscar loja, ambiente, cidade, cliente ou dispositivo'
  return small ? 'Buscar loja ou ambiente' : 'Buscar'
}

function statusOptions(facets: StoreFacets | undefined) {
  const count = (...keys: Array<keyof StoreFacets['status']>) =>
    facets ? keys.reduce((sum, key) => sum + facets.status[key], 0) : undefined
  return [
    { value: 'todas', label: 'Todas', count: count('online', 'degraded', 'offline', 'no_data') },
    { value: 'atencao', label: 'Com problema', count: count('degraded', 'offline', 'no_data') },
    { value: 'online', label: STORE_STATE.online.label, count: count('online') },
    { value: 'degraded', label: STORE_STATE.degraded.label, count: count('degraded') },
    { value: 'offline', label: STORE_STATE.offline.label, count: count('offline') },
    { value: 'no_data', label: STORE_STATE.no_data.label, count: count('no_data') },
  ] satisfies Array<{ value: StatusFilter; label: string; count?: number }>
}

/**
 * Pílula liga/desliga (aria-pressed), com a mesma forma das pílulas de telemetria. A dica diz o
 * que a contagem conta (lojas, enquanto o KPI conta ambientes).
 */
function TogglePill({
  label,
  hint,
  count,
  pressed,
  onToggle,
}: {
  label: string
  hint: string
  count?: number
  pressed: boolean
  onToggle: () => void
}) {
  return (
    <Hint content={count === 0 ? 'Nenhuma loja nesta situação' : hint}>
      <button
        type="button"
        aria-pressed={pressed}
        onClick={onToggle}
        className={clsx(
          'pressionavel inline-flex h-controle-sm items-center gap-1.5 whitespace-nowrap rounded-full px-3 font-medium text-apoio ring-1 ring-inset',
          pressed
            ? 'bg-inverso text-texto-inverso ring-inverso'
            : 'bg-superficie text-texto-2 ring-borda hover:bg-superficie-2 hover:text-texto',
          count === 0 && !pressed && 'opacity-55',
        )}
      >
        {label}
        {count != null && (
          <span className={clsx('num', pressed ? 'text-texto-inverso-2' : 'text-texto-3')}>
            {formatInteger(count)}
          </span>
        )}
      </button>
    </Hint>
  )
}

const BELOW_TARGET_HINT = `Lojas com algum ambiente abaixo da meta de ${COMFORT_TARGET_PCT}% no período`
const OUT_OF_RANGE_HINT = 'Lojas com algum ambiente aberto fora da faixa agora'

function ClientFilter({
  clients,
  value,
  onChange,
  className,
}: {
  clients: readonly ClientListItem[]
  value: string | null
  onChange: (clientId: string | null) => void
  className?: string
}) {
  if (clients.length >= COMBOBOX_FROM) {
    return (
      <Combobox
        items={clients}
        value={value}
        onValueChange={onChange}
        getKey={(client) => client.id}
        getLabel={(client) => client.name}
        getAux={(client) => plural(client.stores, 'loja', 'lojas')}
        label="Cliente"
        allLabel="Todos os clientes"
        searchPlaceholder="Buscar cliente…"
        emptyText={(query) => `Nenhum cliente para "${query}"`}
        icon={Building03Icon}
        className={className}
      />
    )
  }
  return (
    <Select
      label="Cliente"
      value={value ?? ALL_CLIENTS}
      onValueChange={(next) => onChange(next === ALL_CLIENTS ? null : next)}
      options={[
        { value: ALL_CLIENTS, label: 'Todos os clientes' },
        ...clients.map((client) => ({
          value: client.id,
          label: client.name,
          aux: plural(client.stores, 'loja', 'lojas'),
        })),
      ]}
      className={className}
    />
  )
}

function SortSelect({
  value,
  onChange,
  className,
}: {
  value: StoreSort
  onChange: (sort: StoreSort) => void
  className?: string
}) {
  return (
    <Select
      label="Ordenar por"
      prefix="Ordenar por"
      value={value}
      onValueChange={onChange}
      options={SORT_OPTIONS}
      className={className}
    />
  )
}

type Draft = Pick<NetworkView, 'clientId' | 'sort' | 'status' | 'belowTarget' | 'outOfRange' | 'storeId'>

/**
 * Barra de filtros (seção 3.10). Linha 1: busca, cliente e "Ordenar por". Linha 2: chips dos
 * filtros ativos, pílulas de telemetria com contagem, "Fora da meta" e "Limpar filtros". No
 * celular, cliente, ordem e pílulas vão para a gaveta "Filtros (n)".
 */
export function FilterBar({
  view,
  update,
  clients,
  facets,
  storeName,
  busy,
  loading,
  singleStore,
  notice,
  searchRef,
}: {
  view: NetworkView
  update: (patch: Partial<NetworkView>, mode?: 'push' | 'replace') => void
  clients: readonly ClientListItem[] | undefined
  facets: StoreFacets | undefined
  /** Nome da loja do filtro exato (?loja=), quando ela está na página. */
  storeName: string | undefined
  busy: boolean
  /** Primeira carga: as pílulas esperam a contagem invisíveis, para não deslocar quando ela chega. */
  loading: boolean
  singleStore: boolean
  /** Aviso de filtro da URL descartado ("Cliente não encontrado…"). */
  notice: string | null
  searchRef: RefObject<HTMLInputElement | null>
}) {
  const chipsRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<number | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(view)
  const placeholder = useSearchPlaceholder(singleStore)

  const showClients = !singleStore && clients !== undefined && clients.length > 1
  const clientName = clients?.find((client) => client.id === view.clientId)?.name
  const sheetCount = [
    view.clientId !== null,
    view.storeId !== null,
    view.status !== 'todas',
    view.belowTarget,
    view.outOfRange,
  ].filter(Boolean).length
  const search = view.search.trim()
  const anyFilter = sheetCount > 0 || search !== ''

  const chips = [
    search && { key: 'busca', label: 'Busca', value: search, patch: { search: '' } },
    view.clientId && {
      key: 'cliente',
      label: 'Cliente',
      value: clientName ?? view.clientId,
      patch: { clientId: null },
    },
    view.storeId && {
      key: 'loja',
      label: 'Loja',
      value: storeName ?? view.storeId,
      patch: { storeId: null },
    },
    view.outOfRange && {
      key: 'faixa',
      label: 'Agora',
      value: 'fora da faixa',
      patch: { outOfRange: false },
    },
  ].filter((chip) => !!chip)

  // Ao remover um chip, o foco vai para o vizinho (o que ocupou o lugar dele) ou para a busca
  useEffect(() => {
    if (pendingFocus.current === null) return
    const buttons = chipsRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []
    const target = buttons[Math.min(pendingFocus.current, buttons.length - 1)]
    pendingFocus.current = null
    if (target) target.focus()
    else searchRef.current?.focus()
  })

  const openSheet = (open: boolean) => {
    if (open) setDraft(view)
    setSheetOpen(open)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          value={view.search}
          onValueChange={(search) => update({ search }, 'replace')}
          label="Buscar lojas"
          placeholder={placeholder}
          maxLength={SEARCH_MAX}
          busy={busy}
          inputRef={searchRef}
          // Sozinha na linha (escopo de uma loja), a busca não precisa atravessar a página
          className={clsx('min-w-0 flex-1 md:min-w-60', singleStore && 'sm:max-w-112')}
        />
        {!singleStore && (
          <div className="hidden md:contents">
            {showClients && (
              <ClientFilter
                clients={clients}
                value={view.clientId}
                onChange={(clientId) => update({ clientId })}
                className="w-56"
              />
            )}
            <SortSelect value={view.sort} onChange={(sort) => update({ sort })} className="w-60" />
          </div>
        )}
        {!singleStore && (
          <Sheet
            title="Filtros"
            open={sheetOpen}
            onOpenChange={openSheet}
            trigger={
              <Button icon={FilterHorizontalIcon} className="md:hidden">
                Filtros{sheetCount > 0 && <span className="num"> ({formatInteger(sheetCount)})</span>}
              </Button>
            }
            footer={
              <>
                <Button variant="ghost" onClick={() => setDraft({ ...draft, ...CLEARED_FILTERS })}>
                  Limpar
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    update(draft)
                    setSheetOpen(false)
                  }}
                >
                  Aplicar
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-5">
              {showClients && (
                <div className="flex flex-col gap-2">
                  <span className="font-medium text-apoio text-texto-3">Cliente</span>
                  <ClientFilter
                    clients={clients}
                    value={draft.clientId}
                    onChange={(clientId) => setDraft({ ...draft, clientId })}
                    className="w-full"
                  />
                </div>
              )}
              <SortSelect
                value={draft.sort}
                onChange={(sort) => setDraft({ ...draft, sort })}
                className="w-full"
              />
              <div className="flex flex-col gap-2">
                <span className="font-medium text-apoio text-texto-3">Telemetria da loja</span>
                <PillGroup
                  label="Telemetria da loja"
                  value={draft.status}
                  options={statusOptions(facets)}
                  onValueChange={(status) => setDraft({ ...draft, status })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <span className="font-medium text-apoio text-texto-3">Conforto no período</span>
                <div className="flex flex-wrap gap-2">
                  <TogglePill
                    label="Fora da meta"
                    hint={BELOW_TARGET_HINT}
                    count={facets?.belowTarget}
                    pressed={draft.belowTarget}
                    onToggle={() => setDraft({ ...draft, belowTarget: !draft.belowTarget })}
                  />
                  <TogglePill
                    label="Fora da faixa agora"
                    hint={OUT_OF_RANGE_HINT}
                    count={facets?.outOfRange}
                    pressed={draft.outOfRange}
                    onToggle={() => setDraft({ ...draft, outOfRange: !draft.outOfRange })}
                  />
                </div>
              </div>
            </div>
          </Sheet>
        )}
      </div>

      {(chips.length > 0 || !singleStore || notice) && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.length > 0 && (
            <div ref={chipsRef} className="me-2 flex min-w-0 max-w-full flex-wrap items-center gap-2">
              {chips.map((chip, index) => (
                <FilterChip
                  key={chip.key}
                  label={chip.label}
                  value={chip.value}
                  onRemove={() => {
                    pendingFocus.current = index
                    update(chip.patch)
                  }}
                />
              ))}
            </div>
          )}
          {!singleStore && (
            <div className={clsx('hidden flex-wrap items-center gap-2 md:flex', loading && 'invisible')}>
              <PillGroup
                label="Telemetria da loja"
                value={view.status}
                options={statusOptions(facets)}
                onValueChange={(status) => update({ status })}
              />
              <span aria-hidden="true" className="mx-1 h-5 w-px bg-borda-forte" />
              <TogglePill
                label="Fora da meta"
                hint={BELOW_TARGET_HINT}
                count={facets?.belowTarget}
                pressed={view.belowTarget}
                onToggle={() => update({ belowTarget: !view.belowTarget })}
              />
            </div>
          )}
          {notice && (
            <p role="status" className="text-alerta-texto text-apoio">
              {notice}
            </p>
          )}
          {anyFilter && (
            <Button
              variant="ghost"
              size="sm"
              className="ms-auto"
              onClick={() => {
                update(CLEARED_FILTERS)
                searchRef.current?.focus()
              }}
            >
              Limpar filtros
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
