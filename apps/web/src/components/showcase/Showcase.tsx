import type { PeriodKey, StoreSort } from '@celsius/contracts'
import {
  Building03Icon,
  Download04Icon,
  FilterHorizontalIcon,
  Logout03Icon,
  PrinterIcon,
  Search01Icon,
  Table01Icon,
} from '@hugeicons/core-free-icons'
import { type ReactNode, useState } from 'react'
import { ApiError } from '../../api/client'
import { formatPercent, formatRatio, formatTemperature, NETWORK_TIME_ZONE_LABEL } from '../../lib/format'
import {
  DEFINITIONS,
  DEVICE_STATE,
  DISCARD_REASON,
  NO_DATA_GAP,
  PERIOD_FULL_LABEL,
  PERIOD_LABEL,
  SITUATION_STATE,
  SORT_LABEL,
  STORE_STATE,
  type Tone,
} from '../../lib/states'
import { Badge, StateBadge } from '../Badge'
import { Button, IconButton } from '../Button'
import { Combobox } from '../Combobox'
import { ComfortBar, ComfortBarLegend } from '../ComfortBar'
import { CopyButton } from '../CopyButton'
import { Definition } from '../Definition'
import { EmptyState } from '../EmptyState'
import { ErrorState } from '../ErrorState'
import { FilterChip } from '../FilterChip'
import { Highlight } from '../Highlight'
import { Hint, HintProvider } from '../Hint'
import { Kpi } from '../Kpi'
import { Menu } from '../Menu'
import { Pagination } from '../Pagination'
import { ProgressBar } from '../ProgressBar'
import { SearchField } from '../SearchField'
import { PillGroup, SegmentedControl } from '../SegmentedControl'
import { Select } from '../Select'
import { Sheet } from '../Sheet'
import { Skeleton } from '../Skeleton'
import { StatusDot } from '../StatusDot'
import { TruncatedText } from '../TruncatedText'

/*
 * Vitrine dos componentes, só em desenvolvimento (rota /_componentes). Mostra cada componente nos
 * estados que as telas usam, para revisão visual e captura de tela.
 */

const CLIENTS = [
  { id: 'CLI-001', name: 'Moda Carioca', stores: 12 },
  { id: 'CLI-002', name: 'Farmácias São João', stores: 48 },
  { id: 'CLI-003', name: 'Banco Paraná', stores: 31 },
  { id: 'CLI-004', name: 'Supermercados Ômega', stores: 7 },
  { id: 'CLI-005', name: 'Livrarias Graúna', stores: 3 },
  { id: 'CLI-006', name: 'Óticas Visão Clara', stores: 22 },
  { id: 'CLI-007', name: 'Academia Movimento', stores: 9 },
  { id: 'CLI-008', name: 'Padarias Pão Nosso', stores: 15 },
  { id: 'CLI-009', name: 'Calçados Passo Firme', stores: 18 },
]

const TONES: Tone[] = ['ok', 'alerta', 'falha', 'neutro', 'quente', 'frio']

function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section data-vitrine={id} className="flex flex-col gap-3">
      <h2 className="text-texto text-titulo-2">{title}</h2>
      {children}
    </section>
  )
}

function Panel({ children, layout = 'row' }: { children: ReactNode; layout?: 'row' | 'top' | 'column' }) {
  const flow = { row: 'flex-wrap items-center', top: 'flex-wrap items-start', column: 'flex-col' }[layout]
  return <div className={`cartao flex gap-3 p-4 md:p-5 ${flow}`}>{children}</div>
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="w-full font-medium text-apoio text-texto-3">{children}</p>
}

export function Component() {
  const [period, setPeriod] = useState<PeriodKey>('7d')
  const [sort, setSort] = useState<StoreSort>('status')
  const [client, setClient] = useState<string | null>('CLI-001')
  const [clientSelect, setClientSelect] = useState<string>('all')
  const [pageSize, setPageSize] = useState('20')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('todas')
  const [page, setPage] = useState(1)
  const [filterOn, setFilterOn] = useState(true)
  const [busy, setBusy] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  const simulateBusy = () => {
    setBusy(true)
    setTimeout(() => setBusy(false), 1600)
  }

  return (
    <HintProvider>
      <main className="mx-auto flex max-w-conteudo flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-texto text-titulo-1">Componentes</h1>
          <p className="text-corpo text-texto-3">
            Vitrine do sistema visual do Celsius 360 · só em desenvolvimento · {NETWORK_TIME_ZONE_LABEL}
          </p>
        </header>

        <Section title="Tipografia">
          <Panel layout="column">
            <p className="text-texto text-titulo-1">Título 1 · Visão da rede</p>
            <p className="text-texto text-titulo-2">Título 2 · Indicadores da rede</p>
            <p className="text-texto text-titulo-3">Título 3 · Lacunas e descartes</p>
            <p className="text-corpo-lg text-texto-2">
              Corpo grande · 5 lojas · 25 ambientes · horário de Brasília
            </p>
            <p className="text-corpo text-texto-2">Corpo · Salão de vendas - Vitrine, na faixa há 3 h</p>
            <p className="text-apoio text-texto-3">Apoio · Moda Carioca · Recife/PE · Loja de shopping</p>
            <p className="text-legenda text-texto-3">Legenda · meta 90% · 20 de 25 ambientes na meta</p>
            <p className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <span className="num text-kpi text-texto">
                93,2<span className="ms-1 font-medium text-corpo-lg text-texto-3">%</span>
              </span>
              <span className="num text-destaque text-quente-texto">{formatTemperature(24.5)}</span>
              <span className="id-tecnico">IOT014 · AMB-014 · LOJA-PE-001</span>
            </p>
          </Panel>
        </Section>

        <Section title="Botões" id="botoes">
          <Panel>
            <Caption>Primário, secundário e fantasma · md e sm · ocupado mantém a largura</Caption>
            <Button variant="primary">Entrar</Button>
            <Button>Limpar filtros</Button>
            <Button variant="ghost">Expandir todas</Button>
            <Button variant="primary" icon={Download04Icon}>
              Baixar CSV
            </Button>
            <Button variant="primary" busy={busy} busyLabel="Entrando…" onClick={simulateBusy}>
              Entrar
            </Button>
            <Button busy>Tentar de novo</Button>
            <Button disabled>Desabilitado</Button>
            <Button size="sm" icon={Table01Icon}>
              Tabela
            </Button>
            <Button size="sm" variant="ghost">
              Redefinir zoom
            </Button>
            <span data-vitrine="dica">
              <IconButton icon={PrinterIcon} label="Imprimir ou salvar PDF" variant="secondary" />
            </span>
            <IconButton icon={Search01Icon} label="Buscar" />
          </Panel>
        </Section>

        <Section title="Seleção" id="selecao">
          <Panel layout="top">
            <Caption>Select com prefixo, com texto auxiliar e grupos · Combobox com busca sem acento</Caption>
            <span data-vitrine="ordenar">
              <Select
                label="Ordenar por"
                prefix="Ordenar por"
                value={sort}
                onValueChange={setSort}
                options={(Object.keys(SORT_LABEL) as StoreSort[]).map((value) => ({
                  value,
                  label: SORT_LABEL[value],
                }))}
                className="w-60"
              />
            </span>
            <Select
              label="Cliente"
              value={clientSelect}
              onValueChange={setClientSelect}
              options={[
                { value: 'all', label: 'Todos os clientes', aux: '5 lojas' },
                {
                  label: 'Clientes',
                  options: CLIENTS.slice(0, 4).map((item) => ({
                    value: item.id,
                    label: item.name,
                    aux: `${item.stores} lojas`,
                  })),
                },
              ]}
              className="w-56"
            />
            <Combobox
              items={CLIENTS}
              value={client}
              onValueChange={setClient}
              getKey={(item) => item.id}
              getLabel={(item) => item.name}
              getAux={(item) => `${item.stores} lojas`}
              label="Cliente"
              allLabel="Todos os clientes"
              searchPlaceholder="Buscar cliente…"
              emptyText={(query) => `Nenhum cliente para "${query}"`}
              icon={Building03Icon}
              className="w-56"
            />
            <Select
              label="Status"
              value="online"
              onValueChange={() => undefined}
              options={(['online', 'degraded', 'offline', 'no_data'] as const).map((value) => ({
                value,
                label: STORE_STATE[value].label,
                tone: STORE_STATE[value].tone,
              }))}
              className="w-44"
            />
            <Select
              label="Período de comparação"
              value={null}
              placeholder="Escolha o período"
              onValueChange={() => undefined}
              options={[{ value: '7d', label: '7 dias anteriores' }]}
              error="Escolha um período para comparar."
              className="w-56"
            />
            <Select
              label="Desabilitado"
              value="a"
              onValueChange={() => undefined}
              options={[{ value: 'a', label: 'Sem opções' }]}
              disabled
              className="w-40"
            />
          </Panel>
        </Section>

        <Section title="Busca e filtros" id="busca">
          <Panel layout="column">
            <div className="flex flex-wrap items-center gap-3">
              <SearchField
                label="Buscar lojas"
                value={search}
                onValueChange={setSearch}
                placeholder="Buscar loja, ambiente, cidade, cliente ou dispositivo"
                className="min-w-60 flex-1"
              />
              <SearchField
                label="Buscar lojas (ocupado)"
                value="tijuca"
                onValueChange={() => undefined}
                busy
                className="w-60"
                shortcut={false}
              />
              <SegmentedControl
                legend="Período"
                value={period}
                onValueChange={setPeriod}
                options={(['1d', '7d', '30d'] as const).map((value) => ({
                  value,
                  label: PERIOD_LABEL[value],
                  accessibleLabel: PERIOD_FULL_LABEL[value],
                  hint: `04/02 00:00 – 11/02 00:00 · ${NETWORK_TIME_ZONE_LABEL}`,
                }))}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip label="Cliente" value="Moda Carioca" onRemove={() => undefined} />
              <FilterChip label="Busca" value={search || 'tijuca'} onRemove={() => setSearch('')} />
              <PillGroup
                label="Telemetria da loja"
                value={status}
                onValueChange={setStatus}
                options={[
                  { value: 'todas', label: 'Todas', count: 5 },
                  { value: 'problema', label: 'Com problema', count: 2 },
                  { value: 'online', label: 'Online', count: 3 },
                  { value: 'parcial', label: 'Parcial', count: 1 },
                  { value: 'offline', label: 'Offline', count: 1 },
                  { value: 'sem-dados', label: 'Sem dados', count: 0 },
                ]}
              />
              <p role="status" className="ms-auto text-apoio text-texto-3">
                5 lojas · 25 ambientes
              </p>
            </div>
            <div className="sm:hidden">
              <Sheet
                title="Filtros"
                description="Cliente, ordem e telemetria"
                open={sheetOpen}
                onOpenChange={setSheetOpen}
                trigger={<Button icon={FilterHorizontalIcon}>Filtros (2)</Button>}
                footer={
                  <>
                    <Button variant="ghost" onClick={() => setSheetOpen(false)}>
                      Limpar
                    </Button>
                    <Button variant="primary" onClick={() => setSheetOpen(false)}>
                      Aplicar
                    </Button>
                  </>
                }
              >
                <div className="flex flex-col gap-4">
                  <Select
                    label="Ordenar por"
                    prefix="Ordenar por"
                    value={sort}
                    onValueChange={setSort}
                    options={(Object.keys(SORT_LABEL) as StoreSort[]).map((value) => ({
                      value,
                      label: SORT_LABEL[value],
                    }))}
                    className="w-full"
                  />
                  <PillGroup
                    label="Telemetria da loja"
                    value={status}
                    onValueChange={setStatus}
                    options={[
                      { value: 'todas', label: 'Todas' },
                      { value: 'problema', label: 'Com problema' },
                      { value: 'offline', label: 'Offline' },
                    ]}
                  />
                </div>
              </Sheet>
            </div>
          </Panel>
        </Section>

        <Section title="Estados: badge e ponto">
          <Panel>
            <Caption>Dispositivo (o online é silencioso: só o ponto)</Caption>
            <StatusDot tone="ok" label="Online" />
            {(['sensor_fault', 'offline', 'no_data'] as const).map((key) => (
              <StateBadge key={key} state={DEVICE_STATE[key]} />
            ))}
            <Caption>Loja · situação · lacunas</Caption>
            {(['degraded', 'offline', 'no_data'] as const).map((key) => (
              <StateBadge key={key} state={STORE_STATE[key]} />
            ))}
            {(['within', 'above', 'below', 'unknown'] as const).map((key) => (
              <StateBadge key={key} state={SITUATION_STATE[key]} />
            ))}
            <StateBadge state={SITUATION_STATE.closed} label="Fechada · abre 10:00" />
            <StateBadge state={SITUATION_STATE.above} size="sm" label="Acima" />
            <Badge tone="alerta">2 fora da meta</Badge>
            <span className="inline-flex items-center gap-1.5 text-apoio text-texto-2">
              <span
                aria-hidden="true"
                className="hachura-sem-dados size-4 rounded-xs ring-1 ring-borda ring-inset"
              />
              {NO_DATA_GAP.label}
            </span>
            <span className="inline-flex items-center gap-1.5 text-apoio text-texto-2">
              <span aria-hidden="true" className="hachura-descartada size-4 rounded-xs" />
              {DISCARD_REASON.stuck.label}
            </span>
            <Caption>Pontos de cada tom · pulso só no chip ao vivo</Caption>
            {TONES.map((tone) => (
              <span key={tone} className="inline-flex items-center gap-1.5 text-apoio text-texto-2">
                <StatusDot tone={tone} />
                {tone}
              </span>
            ))}
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-superficie px-2.5 font-medium text-legenda text-texto-2 ring-1 ring-borda ring-inset">
              <StatusDot tone="ok" pulse />
              <span className="num">Ao vivo · 10/02 23:59</span>
            </span>
          </Panel>
        </Section>

        <Section title="Dica, definição e texto truncado">
          <Panel>
            <Hint content="O relógio do sistema é o último pacote processado. O conjunto de dados é histórico.">
              <Button size="sm">Dica simples</Button>
            </Hint>
            <Hint title="Meta de conforto" content="90% do horário de funcionamento dentro da faixa.">
              <Button size="sm">Dica com título</Button>
            </Hint>
            <span className="inline-flex items-center gap-1 font-medium text-apoio text-texto-3">
              Conforto da rede
              <Definition term={DEFINITIONS.networkComfort.term} lines={DEFINITIONS.networkComfort.lines} />
            </span>
            <span className="inline-flex items-center gap-1 font-medium text-apoio text-texto-3">
              Conforto no período
              <Definition term={DEFINITIONS.comfortInPeriod.term} lines={DEFINITIONS.comfortInPeriod.lines}>
                <ComfortBarLegend />
              </Definition>
            </span>
            <span className="w-44 font-medium text-corpo text-texto-2">
              <TruncatedText text="Salão de vendas - Vitrine principal do térreo" />
            </span>
            <span className="w-44 text-corpo text-texto-2">
              <TruncatedText text="Provadores" />
            </span>
          </Panel>
        </Section>

        <Section title="Indicadores">
          <div className="grid grid-cols-2 gap-2 md:gap-4 lg:grid-cols-4">
            <Kpi
              brand
              label="Conforto da rede"
              definition={DEFINITIONS.networkComfort}
              value="93,2"
              unit="%"
              context="meta 90% · ponderado pelo tempo"
            >
              <ComfortBar size="kpi" within={93.2} below={5} above={1.8} coverage={99.1} />
            </Kpi>
            <Kpi
              label="Fora da meta de 90%"
              definition={DEFINITIONS.belowTarget}
              value="2"
              unit="de 25"
              alert
              context="Pior: Provadores 0,3%"
              filter={{
                pressed: filterOn,
                onToggle: () => setFilterOn(!filterOn),
                label: 'Filtrar por fora da meta: 2 de 25',
              }}
            />
            <Kpi
              label="Fora da faixa agora"
              definition={DEFINITIONS.outOfRangeNow}
              text="Todas as lojas fechadas"
              context="25 ambientes em lojas fechadas"
            />
            <Kpi
              label="Telemetria"
              definition={DEFINITIONS.telemetry}
              value="25"
              unit="de 25 online"
              context="0 offline · 0 falha no sensor · 0 sem dados"
              filter={{
                pressed: false,
                onToggle: () => undefined,
                label: 'Filtrar por telemetria com problema',
              }}
            />
            <Kpi label="Conforto no horário" definition={DEFINITIONS.comfortInHours} loading />
            <Kpi label="Temperatura no horário" definition={DEFINITIONS.temperatureInHours} error />
            <Kpi
              label="Indisponibilidade no horário"
              definition={DEFINITIONS.unavailabilityInHours}
              text="Nenhuma"
              context="+12 h com a loja fechada"
            />
            <Kpi
              label="Cobertura de dados"
              definition={DEFINITIONS.coverage}
              value="98,4"
              unit="%"
              context="do horário com leitura válida"
            />
          </div>
        </Section>

        <Section title="Barra de conforto">
          <Panel layout="column">
            <Caption>Na faixa · abaixo · acima, com a meta · cobertura baixa · crítico · sem dado</Caption>
            {[
              { name: 'Provadores', within: 0.3, below: 97.2, above: 2.5, coverage: 100 },
              { name: 'Salão de vendas - Vitrine', within: 87.6, below: 9.1, above: 3.3, coverage: 99.1 },
              { name: 'Estoque', within: 93.9, coverage: 62 },
              { name: 'CPD', within: 100, below: 0, above: 0, coverage: 100 },
              { name: 'Caixa', within: 72.4, below: 0.04, above: 27.56, coverage: 95 },
              { name: 'Sala de reunião', within: null, coverage: null },
            ].map((row) => (
              <div
                key={row.name}
                className="flex items-center justify-between gap-4 border-borda border-b pb-3 last:border-b-0 last:pb-0"
              >
                <span className="min-w-0 flex-1 text-corpo text-texto-2">
                  <TruncatedText text={row.name} />
                </span>
                <ComfortBar
                  within={row.within}
                  below={row.below}
                  above={row.above}
                  coverage={row.coverage}
                  belowMinutes={660}
                  aboveMinutes={240}
                />
              </div>
            ))}
            <ComfortBarLegend />
          </Panel>
        </Section>

        <Section title="Paginação">
          <div className="cartao overflow-clip">
            <Pagination
              page={page}
              pageSize={Number(pageSize)}
              total={312}
              onPageChange={setPage}
              onPageSizeChange={(size) => setPageSize(String(size))}
            />
            <Pagination page={8} pageSize={20} total={312} onPageChange={() => undefined} />
            <Pagination page={1} pageSize={20} total={1} onPageChange={() => undefined} />
            <Pagination
              page={1}
              pageSize={20}
              total={45}
              onPageChange={() => undefined}
              onPageSizeChange={() => undefined}
            />
          </div>
        </Section>

        <Section title="Vazio e erro">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="cartao">
              <EmptyState
                icon={Search01Icon}
                title='Nenhuma loja para "tijuka"'
                description="0 de 5 lojas. A busca considera loja, ambiente, cidade, UF, cliente e dispositivo."
                actions={
                  <>
                    <Button>Limpar busca</Button>
                    <Button variant="ghost">Limpar filtros</Button>
                  </>
                }
              />
            </div>
            <div className="cartao">
              <ErrorState
                error={new ApiError(0, 'Sem conexão')}
                onRetry={() => new Promise((done) => setTimeout(done, 1200))}
              />
            </div>
            <div className="cartao">
              <ErrorState
                error={new ApiError(503, 'Service Unavailable', null, '7f3c2a91-4be0-4d55-9a1e-2f0c6b8d1e44')}
                onRetry={() => undefined}
              />
            </div>
            <div className="cartao">
              <ErrorState
                error={
                  new ApiError(400, 'Bad Request', {
                    type: 'about:blank',
                    title: 'Bad Request',
                    status: 400,
                    detail: 'A busca aceita até 80 caracteres.',
                    requestId: 'b81e0c55',
                  })
                }
                onClearFilters={() => undefined}
              />
            </div>
          </div>
        </Section>

        <Section title="Carregando e recarga">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="cartao flex flex-col gap-3 p-5">
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-2.5 w-1/4" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-2 w-30" />
            </div>
            <div aria-busy="true" className="cartao relative flex flex-col gap-2 overflow-clip p-5">
              <ProgressBar active delay={0} />
              <p className="text-texto text-titulo-3">Recarga</p>
              <p className="text-corpo text-texto-3 opacity-60">
                O conteúdo fica a 60% e a barra corre no topo do cartão.
              </p>
            </div>
          </div>
        </Section>

        <Section title="Menus, cópia e destaque" id="menus">
          <Panel>
            <span data-vitrine="menu-exportar">
              <Menu
                trigger={<Button icon={Download04Icon}>Exportar</Button>}
                items={[
                  {
                    label: 'Baixar CSV da série',
                    icon: Download04Icon,
                    aux: 'CSV',
                    onSelect: () => undefined,
                  },
                  {
                    label: 'Baixar CSV das lacunas',
                    icon: Download04Icon,
                    aux: 'CSV',
                    onSelect: () => undefined,
                  },
                  'separator',
                  { label: 'Imprimir ou salvar PDF', icon: PrinterIcon, onSelect: () => undefined },
                ]}
              />
            </span>
            <Menu
              trigger={
                <button
                  type="button"
                  className="pressionavel inline-flex h-controle items-center gap-2 rounded-md px-1.5 text-texto-2 hover:bg-realce"
                >
                  <span className="flex size-7 items-center justify-center rounded-full bg-inverso font-semibold text-legenda text-texto-inverso">
                    AR
                  </span>
                  <span className="font-medium text-apoio">Ana Ribeiro</span>
                </button>
              }
              header={
                <div className="flex flex-col">
                  <span className="font-medium text-corpo text-texto">Ana Ribeiro</span>
                  <span className="text-apoio text-texto-3">ana.ribeiro@diel.example</span>
                  <span className="text-legenda text-texto-3">Administrador Diel</span>
                </div>
              }
              items={[{ label: 'Sair', icon: Logout03Icon, onSelect: () => undefined }]}
            />
            <span className="inline-flex items-center gap-1 rounded-md bg-superficie-3 py-1 ps-3 pe-1">
              <code className="id-tecnico">docker compose logs setup | Select-String "Senha"</code>
              <CopyButton
                text={'docker compose logs setup | Select-String "Senha"'}
                label="Copiar comando"
                showLabel
              />
            </span>
            <span className="text-corpo text-texto-2">
              <Highlight text="Salão de vendas - Vitrine · São Paulo/SP" query="salao sao paulo" />
            </span>
            <span className="num text-apoio text-texto-3">
              {formatRatio(2, 25)} · {formatPercent(99.97)} · {formatPercent(0.04)}
            </span>
          </Panel>
        </Section>
      </main>
    </HintProvider>
  )
}
