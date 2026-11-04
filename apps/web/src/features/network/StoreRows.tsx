import type { EnvironmentListItem, Situation, StoreListItem } from '@celsius/contracts'
import { Alert02Icon, ArrowRight01Icon, Clock01Icon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import type { MouseEvent, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { Badge, StateBadge } from '../../components/Badge'
import { ComfortBar } from '../../components/ComfortBar'
import { Highlight } from '../../components/Highlight'
import { Hint } from '../../components/Hint'
import { Icon } from '../../components/Icon'
import { StatusDot } from '../../components/StatusDot'
import { TruncatedText } from '../../components/TruncatedText'
import {
  formatAgo,
  formatInteger,
  formatNextOpen,
  formatPercent,
  formatRange,
  formatTemperature,
  MISSING,
  MISSING_HINT,
  plural,
} from '../../lib/format'
import {
  COMFORT_TARGET_PCT,
  COVERAGE_MIN_PCT,
  comfortTone,
  DEVICE_STATE,
  SITUATION_STATE,
  STORE_CLOSED_LABEL,
  STORE_STATE,
  type StateInfo,
  TONE_CLASS,
  type Tone,
} from '../../lib/states'
import { environmentMatches } from './params'

/*
 * Linhas da tabela de lojas (seção 3.11): um <tbody> por loja, com a linha da loja e, abaixo, as dos
 * ambientes. A partir de md as células seguem as colunas do <colgroup>; abaixo de md cada linha
 * vira um bloco com uma célula própria do celular, e nada que comunica situação fica escondido.
 * Só o layout da largura atual é montado, e os ambientes só com a loja aberta: com 100 lojas por
 * página, montar os dois layouts e as linhas recolhidas triplicava os nós e travava cada atualização.
 */

export const CELL_SHOW = {
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
} as const

const STORE_CELL = 'h-linha-loja border-borda-forte border-t px-3 py-2 align-middle'
const ENV_CELL = 'h-linha-ambiente border-borda border-t px-3 py-1.5 align-middle'
const MOBILE_CELL = 'block border-t'

/** Dicas dentro da linha do ambiente ficam acima do link esticado, para o hover alcançá-las. */
const ABOVE_LINK = 'relative z-1'

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1)

/** Ponto entre itens de uma mesma linha, com o mesmo respiro dos dois lados (o gap do pai). */
const Separator = () => (
  <span aria-hidden="true" className="text-legenda text-texto-3">
    ·
  </span>
)

interface Exception {
  label: string
  tone: Tone
  hint: string
}

/** Exceções de conforto da loja: a primeira vira badge; as outras, "+1" com dica. */
function storeExceptions(store: StoreListItem): Exception[] {
  const counts = store.environmentCounts
  return [
    counts.outOfRange > 0 && {
      label: `${formatInteger(counts.outOfRange)} fora da faixa`,
      tone: 'alerta' as const,
      hint: `${plural(counts.outOfRange, 'ambiente aberto', 'ambientes abertos')} com a última leitura fora da faixa.`,
    },
    counts.belowTarget > 0 && {
      label: `${formatInteger(counts.belowTarget)} fora da meta`,
      tone: 'alerta' as const,
      hint: `${plural(counts.belowTarget, 'ambiente', 'ambientes')} com conforto abaixo de ${COMFORT_TARGET_PCT}% no período.`,
    },
  ].filter((item) => !!item)
}

/** Problemas de telemetria da loja, do mais grave ao menos grave. */
function telemetryProblems(store: StoreListItem): Exception[] {
  const counts = store.environmentCounts
  const items: Array<[number, StateInfo, string]> = [
    [counts.offline, DEVICE_STATE.offline, 'offline'],
    [counts.sensorFault, DEVICE_STATE.sensor_fault, 'com falha'],
    [counts.noData, DEVICE_STATE.no_data, 'sem dados'],
  ]
  return items
    .filter(([count]) => count > 0)
    .map(([count, state, short]) => ({
      label: `${formatInteger(count)} ${short}`,
      tone: state.tone,
      hint: `${plural(count, 'ambiente', 'ambientes')}: ${state.label.toLowerCase()}. ${state.hint}`,
    }))
}

function ExceptionBadges({ items, icon = true }: { items: Exception[]; icon?: boolean }) {
  const [first, ...rest] = items
  if (!first) return null
  return (
    <span className={clsx(ABOVE_LINK, 'inline-flex shrink-0 items-center gap-1')}>
      <Hint content={first.hint}>
        <Badge tone={first.tone} size="sm" icon={icon ? Alert02Icon : undefined}>
          {first.label}
        </Badge>
      </Hint>
      {rest.length > 0 && (
        <Hint content={rest.map((item) => item.hint).join(' ')}>
          <span className="num rounded-xs px-0.5 font-medium text-legenda text-texto-3">
            +{rest.length}
            <span className="so-leitor">: {rest.map((item) => item.label).join(', ')}</span>
          </span>
        </Hint>
      )}
    </span>
  )
}

/**
 * "Pior: Provadores 0,2%", no tom da meta (o mesmo do valor na linha do ambiente). O nome do
 * ambiente pode ser cortado; o percentual, nunca.
 */
function WorstEnvironment({
  name,
  pct,
  separator = false,
}: {
  name: string
  pct: number
  separator?: boolean
}) {
  const tone = comfortTone(pct)
  return (
    <span
      className={clsx(
        'inline-flex min-w-0 max-w-full items-baseline whitespace-nowrap',
        TONE_CLASS[tone === 'neutro' ? 'alerta' : tone].text,
      )}
    >
      {separator && (
        <span aria-hidden="true" className="w-3 shrink-0 text-center text-texto-3">
          ·
        </span>
      )}
      <span className="shrink-0">Pior:&nbsp;</span>
      <TruncatedText text={name} />
      <span className="num shrink-0">&nbsp;{formatPercent(pct)}</span>
    </span>
  )
}

/** Percentual de conforto com o tom da meta (seção 3.7), usado no celular ao lado da barra. */
function ComfortValue({ pct }: { pct: number | null }) {
  const tone = comfortTone(pct)
  return (
    <span
      className={clsx(
        'num inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-corpo',
        tone === 'neutro' ? 'text-texto' : TONE_CLASS[tone].text,
      )}
    >
      {tone !== 'neutro' && <Icon icon={Alert02Icon} size={12} />}
      {formatPercent(pct)}
    </span>
  )
}

function Coverage({ pct }: { pct: number | null }) {
  return (
    <span
      className={clsx(
        'num text-apoio',
        pct != null && pct < COVERAGE_MIN_PCT ? 'text-alerta-texto' : 'text-texto-3',
      )}
    >
      {formatPercent(pct)}
    </span>
  )
}

/** "Agora" da loja: fechada (com a próxima abertura), fora da faixa ou na faixa. */
function StoreNow({
  store,
  now,
  layout = 'stack',
}: {
  store: StoreListItem
  now: string | null
  /** stack: duas linhas alinhadas à direita (coluna "Agora"); inline: numa linha, no celular. */
  layout?: 'stack' | 'inline'
}) {
  const situations = store.environments.map((environment) => environment.situation)
  const above = situations.filter((situation) => situation === 'above').length
  const below = situations.filter((situation) => situation === 'below').length
  const open = situations.filter((situation) => situation !== 'closed').length
  const unknown = situations.filter((situation) => situation === 'unknown').length
  const column =
    layout === 'stack' ? 'flex flex-col items-end gap-0.5' : 'flex flex-wrap items-center gap-x-1.5 gap-y-0.5'

  if (open === 0) {
    const next = formatNextOpen(store.nextOpenAt, now, store.timezone)
    return (
      <span className={column}>
        <StateBadge state={SITUATION_STATE.closed} size="sm" label={STORE_CLOSED_LABEL} />
        {next && <span className="num whitespace-nowrap text-legenda text-texto-3">{next}</span>}
      </span>
    )
  }
  const partial = open < store.environments.length && (
    <>
      {layout === 'inline' && <Separator />}
      <span className="num whitespace-nowrap text-legenda text-texto-3">
        {formatInteger(open)} de {formatInteger(store.environments.length)} abertos
      </span>
    </>
  )
  if (above + below === 0) {
    return (
      <span className={column}>
        <span className="whitespace-nowrap text-apoio text-texto-3">
          {unknown > 0 ? 'Sem leitura' : 'Na faixa'}
        </span>
        {partial}
      </span>
    )
  }
  return (
    <span className={clsx(column, 'num whitespace-nowrap font-medium text-apoio')}>
      {above > 0 && (
        <span className="inline-flex items-center gap-1 text-quente-texto">
          <Icon icon={SITUATION_STATE.above.icon ?? Alert02Icon} size={12} className="text-quente" />
          {formatInteger(above)} acima
        </span>
      )}
      {below > 0 && (
        <span className="inline-flex items-center gap-1 text-frio-texto">
          <Icon icon={SITUATION_STATE.below.icon ?? Alert02Icon} size={12} className="text-frio" />
          {formatInteger(below)} abaixo
        </span>
      )}
    </span>
  )
}

function StoreTelemetry({ store, showLabel = false }: { store: StoreListItem; showLabel?: boolean }) {
  const problems = telemetryProblems(store)
  if (problems.length > 0) return <ExceptionBadges items={problems} icon={false} />
  const counts = store.environmentCounts
  return (
    <span className="num text-apoio text-texto-3">
      {formatInteger(counts.online)} de {formatInteger(counts.total)}
      <span className={showLabel ? undefined : 'so-leitor'}> online</span>
    </span>
  )
}

/** Temperatura agora, com seta e cor do tom; fechado em texto-3 com o relógio. */
function Temperature({
  environment,
  now,
  timezone,
}: {
  environment: EnvironmentListItem
  now: string | null
  timezone: string
}) {
  const value = formatTemperature(environment.lastValue)
  if (environment.lastValue == null) {
    return (
      <Hint content={MISSING_HINT}>
        <span className={clsx(ABOVE_LINK, 'num font-medium text-corpo text-texto-3')}>{MISSING}</span>
      </Hint>
    )
  }
  const { situation } = environment
  if (situation === 'closed') {
    const next = formatNextOpen(environment.nextOpenAt, now, timezone)
    const seen = formatAgo(environment.lastValidAt, now)
    return (
      <Hint content={`Fechado agora${next ? `; ${next}` : ''}. Última leitura válida ${seen}.`}>
        <span
          className={clsx(
            ABOVE_LINK,
            'num inline-flex items-center gap-1 whitespace-nowrap text-corpo text-texto-3',
          )}
        >
          <Icon icon={Clock01Icon} size={12} />
          {value}
          <span className="so-leitor">, fechado</span>
        </span>
      </Hint>
    )
  }
  const tone = situation === 'above' ? 'quente' : situation === 'below' ? 'frio' : null
  const state = SITUATION_STATE[situation]
  return (
    <span
      className={clsx(
        'num inline-flex items-center gap-1 whitespace-nowrap font-medium text-corpo',
        tone ? TONE_CLASS[tone].text : 'text-texto',
      )}
    >
      {tone && state.icon && <Icon icon={state.icon} size={12} className={TONE_CLASS[tone].icon} />}
      {value}
      {tone && <span className="so-leitor">, {state.label.toLowerCase()}</span>}
    </span>
  )
}

function DeviceTelemetry({ environment, now }: { environment: EnvironmentListItem; now: string | null }) {
  const state = DEVICE_STATE[environment.status]
  if (state.presentation === 'silent') {
    return (
      <Hint content={`${state.hint} Último contato ${formatAgo(environment.lastContactAt, now)}.`}>
        <span className={clsx(ABOVE_LINK, 'inline-flex size-4 items-center justify-center')}>
          <StatusDot tone={state.tone} label={state.label} />
        </span>
      </Hint>
    )
  }
  return (
    <span
      className={clsx(ABOVE_LINK, 'inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-nowrap')}
    >
      <StateBadge state={state} size="sm" />
      {environment.lastContactAt && (
        <span className="num text-legenda text-texto-3">{formatAgo(environment.lastContactAt, now)}</span>
      )}
    </span>
  )
}

/**
 * Situação no celular, só quando é exceção (acima, abaixo, sem leitura). Na faixa e fechado ficam
 * silenciosos: a temperatura já diz (cor e seta, ou o relógio em texto-3), e o "Fechada" da loja
 * aparece uma vez na linha dela, não repetido em cada ambiente.
 */
function SituationBadge({ situation }: { situation: Situation }) {
  if (situation === 'within' || situation === 'closed') return null
  return (
    <span className={clsx(ABOVE_LINK, 'inline-flex shrink-0')}>
      <StateBadge state={SITUATION_STATE[situation]} size="sm" />
    </span>
  )
}

function ToggleButton({
  store,
  open,
  controls,
  className,
}: {
  store: StoreListItem
  open: boolean
  /** Ids das linhas dos ambientes; ausente com a loja recolhida, quando elas não existem. */
  controls: string | undefined
  className?: string
}) {
  // Sem onClick próprio: o clique sobe para a linha, que alterna (o teclado também gera clique)
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`Ambientes de ${store.name}`}
      className={clsx(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-texto-3 transition-colors duration-100 ease-linear hover:bg-realce hover:text-texto',
        className,
      )}
    >
      <Icon
        icon={ArrowRight01Icon}
        className={clsx(
          'transition-transform duration-200 ease-saida motion-reduce:transition-none',
          open && 'rotate-90',
        )}
      />
    </button>
  )
}

export function StoreRows({
  store,
  open,
  onToggle,
  search,
  flash,
  now,
  period,
  from,
  desktop,
}: {
  store: StoreListItem
  open: boolean
  onToggle: () => void
  search: string
  /** Destaca por 2,4 s os ambientes encontrados pela busca. */
  flash: boolean
  now: string | null
  period: string
  /** Query da lista, levada no state do link para o breadcrumb do detalhe voltar com os filtros. */
  from: string
  /** A partir de md: células das colunas; abaixo, a célula única do celular. */
  desktop: boolean
}) {
  const navigate = useNavigate()
  const rowId = (environment: EnvironmentListItem) => `ambiente-${environment.id}`
  const controls = open ? store.environments.map(rowId).join(' ') : undefined
  const exceptions = storeExceptions(store)
  const storeState = STORE_STATE[store.status]
  const worst = store.worstEnvironment
  const showWorst = worst && store.environments.length > 1 && worst.comfortPct < COMFORT_TARGET_PCT
  const meta = `${store.client.name} · ${store.city}/${store.state} · ${capitalize(store.kind)}`
  const name = (
    <span className="font-semibold text-corpo text-texto">
      <Highlight text={store.name} query={search} />
    </span>
  )
  const statusBadge = storeState.presentation !== 'silent' && (
    <span className={clsx(ABOVE_LINK, 'inline-flex shrink-0')}>
      <StateBadge state={storeState} size="sm" />
    </span>
  )

  return (
    <tbody className="block md:table-row-group">
      <tr onClick={onToggle} className="block cursor-pointer bg-superficie-2 md:table-row">
        {desktop ? (
          <>
            <td className={clsx(CELL_SHOW.md, STORE_CELL, 'ps-1.5 pe-0 text-center')}>
              <ToggleButton store={store} open={open} controls={controls} />
            </td>
            <td className={clsx(CELL_SHOW.md, STORE_CELL)}>
              {/* Na linha do nome, só o nome e um badge: o nome da loja é o que não pode ser cortado */}
              <div className="flex min-w-0 items-center gap-2">
                <TruncatedText text={store.name} className="font-semibold text-corpo text-texto">
                  <Highlight text={store.name} query={search} />
                </TruncatedText>
                <ExceptionBadges items={exceptions} />
                <span className="lg:hidden">{statusBadge}</span>
              </div>
              {/*
               * "Pior" segue o metadado na mesma linha e desce inteiro para a seguinte quando não cabe.
               * Cada item reserva 12 px à esquerda para o separador, e o recuo negativo com o corte do
               * contêiner esconde o separador de quem começa a linha.
               */}
              <div className="overflow-hidden">
                <div className="-ms-3 flex flex-wrap items-baseline text-legenda">
                  <TruncatedText text={meta} className="max-w-full ps-3 text-texto-3">
                    <Highlight text={meta} query={search} />
                  </TruncatedText>
                  {worst && showWorst && (
                    <WorstEnvironment name={worst.name} pct={worst.comfortPct} separator />
                  )}
                </div>
              </div>
            </td>
            <td className={clsx(CELL_SHOW.lg, STORE_CELL)}>
              <StoreTelemetry store={store} />
            </td>
            <td className={clsx(CELL_SHOW.md, STORE_CELL, 'text-end')}>
              <span className="inline-flex justify-end">
                <StoreNow store={store} now={now} />
              </span>
            </td>
            <td className={clsx(CELL_SHOW.xl, STORE_CELL)} />
            <td className={clsx(CELL_SHOW.md, STORE_CELL)}>
              <ComfortBar
                within={store.comfortPct}
                below={store.belowPct}
                above={store.abovePct}
                coverage={store.coveragePct}
              />
            </td>
            <td className={clsx(CELL_SHOW.xl, STORE_CELL, 'text-end')}>
              <Coverage pct={store.coveragePct} />
            </td>
            <td className={clsx(CELL_SHOW.md, STORE_CELL)} />
          </>
        ) : (
          <td className={clsx(MOBILE_CELL, 'border-borda-forte py-3 ps-2 pe-4')}>
            <div className="flex items-start gap-1">
              <ToggleButton store={store} open={open} controls={controls} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    {name}
                    <ExceptionBadges items={exceptions} />
                  </div>
                  <ComfortValue pct={store.comfortPct} />
                </div>
                {worst && showWorst && (
                  <p className="flex text-legenda">
                    <WorstEnvironment name={worst.name} pct={worst.comfortPct} />
                  </p>
                )}
                <p className="text-legenda text-texto-3">
                  <Highlight text={meta} query={search} />
                </p>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <StoreNow store={store} now={now} layout="inline" />
                  <Separator />
                  {statusBadge}
                  <StoreTelemetry store={store} showLabel />
                </div>
                <ComfortBar
                  size="kpi"
                  within={store.comfortPct}
                  below={store.belowPct}
                  above={store.abovePct}
                  coverage={store.coveragePct}
                  className="mt-1"
                />
              </div>
            </div>
          </td>
        )}
      </tr>

      {open &&
        store.environments.map((environment) => {
          const href = `/ambientes/${encodeURIComponent(environment.id)}?periodo=${period}`
          const found = flash && environmentMatches(environment, search)
          const follow = (event: MouseEvent<HTMLTableRowElement>) => {
            // O link esticado cobre a linha; aqui chegam só os cliques nas dicas, que ficam acima dele
            if ((event.target as HTMLElement).closest('a')) return
            navigate(href, { state: { from } })
          }
          const link = (children: ReactNode, className?: string) => (
            <Link
              to={href}
              state={{ from }}
              className={clsx(
                'min-w-0 font-medium text-corpo text-texto-2 after:absolute after:inset-0 focus-visible:outline-none',
                className,
              )}
            >
              {children}
            </Link>
          )
          return (
            <tr
              key={environment.id}
              id={rowId(environment)}
              data-destacado={found || undefined}
              onClick={follow}
              className="group relative block cursor-pointer bg-superficie transition-colors duration-100 ease-linear hover:bg-realce has-focus-visible:outline-2 has-focus-visible:outline-foco has-focus-visible:-outline-offset-2 data-destacado:bg-selecionado md:table-row"
            >
              {desktop ? (
                <>
                  <td className={clsx(CELL_SHOW.md, ENV_CELL)} />
                  <td className={clsx(CELL_SHOW.md, ENV_CELL, 'ps-8')}>
                    <div className="flex min-w-0 items-center gap-3">
                      {link(
                        <TruncatedText text={environment.name} className={ABOVE_LINK}>
                          <Highlight text={environment.name} query={search} />
                        </TruncatedText>,
                        'flex',
                      )}
                      {environment.deviceId && (
                        <span className="id-tecnico hidden shrink-0 xl:inline">
                          <Highlight text={environment.deviceId} query={search} />
                        </span>
                      )}
                      {environment.status !== 'online' && (
                        <span className="lg:hidden">
                          <DeviceTelemetry environment={environment} now={now} />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={clsx(CELL_SHOW.lg, ENV_CELL)}>
                    <DeviceTelemetry environment={environment} now={now} />
                  </td>
                  <td className={clsx(CELL_SHOW.md, ENV_CELL, 'text-end')}>
                    <span className="inline-flex flex-col items-end gap-0.5">
                      <Temperature environment={environment} now={now} timezone={store.timezone} />
                      <span className="num whitespace-nowrap text-legenda text-texto-3 xl:hidden">
                        {formatRange(environment.comfortRange)}
                      </span>
                    </span>
                  </td>
                  <td className={clsx(CELL_SHOW.xl, ENV_CELL, 'text-end')}>
                    <span className="num whitespace-nowrap text-apoio text-texto-3">
                      {formatRange(environment.comfortRange)}
                    </span>
                  </td>
                  <td className={clsx(CELL_SHOW.md, ENV_CELL)}>
                    <div className={clsx(ABOVE_LINK, 'ms-auto w-fit')}>
                      <ComfortBar
                        within={environment.comfortPct}
                        below={environment.belowPct}
                        above={environment.abovePct}
                        coverage={environment.coveragePct}
                      />
                    </div>
                  </td>
                  <td className={clsx(CELL_SHOW.xl, ENV_CELL, 'text-end')}>
                    <Coverage pct={environment.coveragePct} />
                  </td>
                  <td className={clsx(CELL_SHOW.md, ENV_CELL, 'ps-0 pe-3 text-center')}>
                    <Icon
                      icon={ArrowRight01Icon}
                      className="inline text-texto-3 transition-colors duration-100 ease-linear group-hover:text-texto"
                    />
                  </td>
                </>
              ) : (
                <td className={clsx(MOBILE_CELL, 'border-borda py-2.5 ps-11 pe-4')}>
                  <div className="flex items-start justify-between gap-3">
                    {link(<Highlight text={environment.name} query={search} />, 'line-clamp-2 break-words')}
                    <Temperature environment={environment} now={now} timezone={store.timezone} />
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <SituationBadge situation={environment.situation} />
                    {environment.status !== 'online' && (
                      <DeviceTelemetry environment={environment} now={now} />
                    )}
                    <div className="min-w-0 flex-1">
                      <ComfortBar
                        size="kpi"
                        within={environment.comfortPct}
                        below={environment.belowPct}
                        above={environment.abovePct}
                        coverage={environment.coveragePct}
                      />
                    </div>
                    <ComfortValue pct={environment.comfortPct} />
                  </div>
                </td>
              )}
            </tr>
          )
        })}
    </tbody>
  )
}
