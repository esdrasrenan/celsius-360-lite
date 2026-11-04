import type { QualityReport } from '@celsius/contracts'
import { ArrowRight01Icon, Download04Icon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { CopyButton } from '../../components/CopyButton'
import { Icon } from '../../components/Icon'
import { Kpi } from '../../components/Kpi'
import { Skeleton } from '../../components/Skeleton'
import { TruncatedText } from '../../components/TruncatedText'
import {
  formatDuration,
  formatInteger,
  formatPercent,
  formatPeriod,
  formatTemperature,
  NETWORK_TIME_ZONE,
  plural,
} from '../../lib/format'
import { useLiveState } from '../../lib/live'
import { DISCARD_REASON } from '../../lib/states'
import { type Column, DataTable } from './DataTable'
import {
  type Anomaly,
  anomalies,
  type CsvColumn,
  discardsByReason,
  downloadCsv,
  environmentHref,
  periodCovering,
  toCsv,
} from './report'
import { type EnvironmentName, useEnvironmentNames } from './useEnvironmentNames'

type Report = QualityReport
type StuckEpisode = Report['stuckEpisodes'][number]
type Gap = Report['gaps'][number]
type UnknownDevice = Report['devices']['unknown'][number]

const RECOMPUTE_COMMAND = 'docker compose run --rm ingest bun run apps/ingest/src/main.ts quality'

const period = (from: string, to: string) => formatPeriod(from, to, NETWORK_TIME_ZONE)

function ReportCard({
  id,
  title,
  description,
  action,
  children,
  className,
}: {
  id: string
  title: string
  description?: ReactNode
  /** Ação do cartão (Baixar CSV), sempre na mesma linha do título. */
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section aria-labelledby={id} className={clsx('cartao flex min-w-0 flex-col', className)}>
      <header className="flex items-start justify-between gap-4 p-4 md:px-5 md:pt-5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={id} className="text-texto text-titulo-3">
            {title}
          </h2>
          {description && <p className="text-apoio text-texto-3">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

function CsvButton<T>({
  filename,
  columns,
  rows,
}: {
  filename: string
  columns: CsvColumn<T>[]
  rows: readonly T[]
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={Download04Icon}
      disabled={rows.length === 0}
      onClick={() => downloadCsv(filename, toCsv(columns, rows))}
      aria-label="Baixar CSV"
      className="-me-2"
    >
      {/* No celular fica só o ícone, para o título não perder a linha */}
      <span className="hidden sm:inline">Baixar CSV</span>
    </Button>
  )
}

/** Contagem com a unidade menor ao lado: "1.099 pacotes". */
function Count({ value, unit }: { value: number; unit: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="num font-medium text-texto">{formatInteger(value)}</span>{' '}
      <span className="text-apoio text-texto-3">{unit}</span>
    </span>
  )
}

/* --------------------------------------------------------------------------------------------- */

function DiscardBreakdown({ report, className }: { report: Report; className?: string }) {
  const { total, reasons } = discardsByReason(report)
  const codes = report.samples.rawErrorCodes
  return (
    <ReportCard
      className={className}
      id="qualidade-descartes"
      title="Amostras descartadas por motivo"
      description={
        <>
          <span className="num font-medium text-texto-2">{plural(total, 'amostra', 'amostras')}</span> (
          <span className="num">{formatPercent((total / report.samples.total) * 100)}</span> do total) ficam
          na série com o código de qualidade; nenhuma leitura é apagada.
        </>
      }
    >
      <ul className="flex flex-col gap-4 px-4 pt-1 pb-5 md:px-5">
        {reasons.map(({ reason, samples, pct }) => {
          const info = DISCARD_REASON[reason]
          return (
            <li key={reason} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className={clsx('font-medium text-corpo', samples ? 'text-texto' : 'text-texto-3')}>
                  {info.label}
                </span>
                <span className="num whitespace-nowrap text-apoio text-texto-3">
                  <span className={clsx('font-medium text-corpo', samples ? 'text-texto' : 'text-texto-3')}>
                    {formatInteger(samples)}
                  </span>
                  {samples > 0 && ` · ${formatPercent(pct)}`}
                </span>
              </div>
              <div className="h-2 rounded-xs bg-superficie-3" aria-hidden="true">
                {samples > 0 && (
                  <div
                    className={clsx('h-full rounded-xs ring-1 ring-alerta-borda ring-inset', info.hatchClass)}
                    style={{ width: `${Math.max(pct, 1)}%` }}
                  />
                )}
              </div>
              <p className="text-legenda text-texto-3">
                {reason === 'sensor_error'
                  ? `Códigos −127 (${formatInteger(codes.minus127)}) e 85 (${formatInteger(codes.plus85)}) do DS18B20.`
                  : samples
                    ? info.hint
                    : `Não ocorreu. ${info.hint}`}
              </p>
            </li>
          )
        })}
      </ul>
    </ReportCard>
  )
}

/* --------------------------------------------------------------------------------------------- */

function Devices({ report, className }: { report: Report; className?: string }) {
  const { devices } = report
  const future = report.packets.futureTimestamp
  const columns: CsvColumn<UnknownDevice>[] = [
    { header: 'Dispositivo', value: (row) => row.deviceId },
    { header: 'Pacotes', value: (row) => row.packets },
    { header: 'Primeiro pacote (UTC)', value: (row) => row.from },
    { header: 'Último pacote (UTC)', value: (row) => row.to },
  ]
  const stats: Array<[string, number]> = [
    ['Cadastrados', devices.registered],
    ['Comunicaram', devices.reporting],
    ['Reinícios', devices.reboots],
  ]
  return (
    <ReportCard className={className} id="qualidade-dispositivos" title="Dispositivos">
      <div className="flex flex-col gap-5 px-4 pb-5 md:px-5">
        {/* Três colunas a partir de sm; no celular, uma linha por número */}
        <dl className="grid divide-y divide-borda border-borda border-y sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:py-3">
          {stats.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-3 py-2 sm:flex-col sm:justify-start sm:gap-0.5 sm:px-3 sm:py-0 sm:first:ps-0"
            >
              <dt className="text-apoio text-texto-3">{label}</dt>
              <dd className="num font-semibold text-corpo-lg text-texto sm:text-titulo-2">
                {formatInteger(value)}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-medium text-apoio text-texto-3">Fora do cadastro</h3>
            <CsvButton
              filename="qualidade-dispositivos-fora-do-cadastro.csv"
              columns={columns}
              rows={devices.unknown}
            />
          </div>
          {devices.unknown.length === 0 ? (
            <p className="text-corpo text-texto-3">
              Nenhum: todos os pacotes vieram de dispositivos cadastrados.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {devices.unknown.map((device) => (
                <li key={device.deviceId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-corpo">
                  <code className="id-tecnico text-texto">{device.deviceId}</code>
                  <Count value={device.packets} unit={device.packets === 1 ? 'pacote' : 'pacotes'} />
                  <span className="num text-apoio text-texto-3">{period(device.from, device.to)}</span>
                  <Badge size="sm" tone="neutro">
                    Em quarentena
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="font-medium text-apoio text-texto-3">Relógio adiantado</h3>
          {future.devices.length === 0 ? (
            <p className="text-corpo text-texto-3">
              Nenhum pacote mais de {future.toleranceMinutes} min à frente do "agora".
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {future.devices.map((device) => (
                <li key={device.deviceId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-corpo">
                  <code className="id-tecnico text-texto">{device.deviceId}</code>
                  <Count value={device.packets} unit={device.packets === 1 ? 'pacote' : 'pacotes'} />
                  <span className="num text-apoio text-texto-3">{period(device.from, device.to)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ReportCard>
  )
}

/* --------------------------------------------------------------------------------------------- */

const ANOMALY_COLUMNS: Column<Anomaly>[] = [
  {
    header: 'Anomalia',
    className: 'w-52',
    cell: (row) => (
      <span className={clsx('font-medium', row.count ? 'text-texto' : 'text-texto-3')}>{row.label}</span>
    ),
  },
  {
    header: 'Ocorrências',
    align: 'end',
    className: 'w-40',
    cell: (row) => <Count value={row.count} unit={row.unit} />,
  },
  {
    header: 'Evidência',
    cell: (row) => <span className={row.count ? 'text-texto-2' : undefined}>{row.evidence}</span>,
  },
  { header: 'Tratamento', cell: (row) => <span className="text-texto-3">{row.treatment}</span> },
]

const ANOMALY_CSV: CsvColumn<Anomaly>[] = [
  { header: 'Anomalia', value: (row) => row.label },
  { header: 'Ocorrências', value: (row) => row.count },
  { header: 'Unidade', value: (row) => row.unit },
  { header: 'Evidência', value: (row) => row.evidence },
  { header: 'Tratamento', value: (row) => row.treatment },
]

function Anomalies({ report }: { report: Report }) {
  const rows = anomalies(report)
  const found = rows.filter((row) => row.count > 0).length
  return (
    <ReportCard
      id="qualidade-anomalias"
      title="Anomalias encontradas"
      description={`${plural(found, 'tipo ocorreu', 'tipos ocorreram')} no arquivo; as regras sem ocorrência ficam no fim, esmaecidas.`}
      action={<CsvButton filename="qualidade-anomalias.csv" columns={ANOMALY_CSV} rows={rows} />}
    >
      <DataTable
        label="Anomalias encontradas"
        columns={ANOMALY_COLUMNS}
        rows={rows}
        rowKey={(row) => row.id}
        muted={(row) => row.count === 0}
        mobileRow={(row) => (
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className={clsx('font-medium text-corpo', row.count ? 'text-texto' : 'text-texto-3')}>
                {row.label}
              </span>
              <Count value={row.count} unit={row.unit} />
            </div>
            <p className={clsx('text-apoio', row.count ? 'text-texto-2' : 'text-texto-3')}>{row.evidence}</p>
            <p className="text-apoio text-texto-3">{row.treatment}</p>
          </div>
        )}
      />
    </ReportCard>
  )
}

/* --------------------------------------------------------------------------------------------- */

interface EpisodeRow {
  key: string
  deviceId: string
  environmentId: string | null
  from: string
  to: string
  minutes: number
  value?: number
  samples?: number
}

function EnvironmentCell({
  row,
  name,
}: {
  row: EpisodeRow
  name: EnvironmentName | 'pending' | 'missing' | undefined
}) {
  return (
    <div className="flex min-w-0 flex-col">
      {typeof name === 'object' ? (
        <TruncatedText text={name.name} wrapOnMobile className="font-medium text-texto" />
      ) : name === 'pending' ? (
        <Skeleton className="my-1 h-3 w-40 max-w-full" />
      ) : (
        <span className="font-medium text-texto">{row.environmentId ?? 'Sem ambiente'}</span>
      )}
      <span className="flex min-w-0 items-center gap-1.5 text-apoio text-texto-3">
        {typeof name === 'object' && <TruncatedText text={name.store} wrapOnMobile className="min-w-0" />}
        {typeof name === 'object' && <span aria-hidden="true">·</span>}
        <code className="id-tecnico shrink-0">{row.deviceId}</code>
      </span>
    </div>
  )
}

function ChartLink({ row, now }: { row: EpisodeRow; now: string | null }) {
  if (!row.environmentId) return <span className="text-texto-3">—</span>
  return (
    <Link
      to={environmentHref(row.environmentId, row.from, now)}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-xs font-medium text-acento hover:underline"
    >
      Ver no gráfico
      <span className="so-leitor">
        : {row.deviceId}, {period(row.from, row.to)}
      </span>
      <Icon icon={ArrowRight01Icon} size={14} />
    </Link>
  )
}

/** Período, duração e, no sensor travado, valor e amostras: a linha de fatos do celular. */
function mobileFacts(row: EpisodeRow, withValues: boolean): string[] {
  return [
    period(row.from, row.to),
    formatDuration(row.minutes, 'calendar'),
    ...(withValues ? [formatTemperature(row.value), plural(row.samples ?? 0, 'amostra', 'amostras')] : []),
  ]
}

const EPISODE_CSV: CsvColumn<EpisodeRow>[] = [
  { header: 'Dispositivo', value: (row) => row.deviceId },
  { header: 'Ambiente', value: (row) => row.environmentId },
  { header: 'Início (UTC)', value: (row) => row.from },
  { header: 'Fim (UTC)', value: (row) => row.to },
  { header: 'Minutos', value: (row) => row.minutes },
]

function EpisodeTable({
  id,
  title,
  description,
  filename,
  rows,
  withValues,
  empty,
}: {
  id: string
  title: string
  description: string
  filename: string
  rows: EpisodeRow[]
  withValues: boolean
  empty: string
}) {
  const { now } = useLiveState()
  const names = useEnvironmentNames(
    rows.flatMap((row) =>
      row.environmentId ? [{ environmentId: row.environmentId, period: periodCovering(row.from, now) }] : [],
    ),
  )
  const name = (row: EpisodeRow) => (row.environmentId ? names.get(row.environmentId) : 'missing')

  const columns: Column<EpisodeRow>[] = [
    { header: 'Ambiente', cell: (row) => <EnvironmentCell row={row} name={name(row)} /> },
    {
      header: 'Período',
      className: 'w-56',
      cell: (row) => <span className="num whitespace-nowrap text-texto-2">{period(row.from, row.to)}</span>,
    },
    {
      header: 'Duração',
      align: 'end',
      className: 'w-28',
      cell: (row) => <span className="num whitespace-nowrap">{formatDuration(row.minutes, 'calendar')}</span>,
    },
    ...(withValues
      ? [
          {
            header: 'Valor',
            align: 'end' as const,
            className: 'w-24',
            cell: (row: EpisodeRow) => (
              <span className="num whitespace-nowrap">{formatTemperature(row.value)}</span>
            ),
          },
          {
            header: 'Amostras',
            align: 'end' as const,
            className: 'w-24',
            cell: (row: EpisodeRow) => <span className="num">{formatInteger(row.samples ?? 0)}</span>,
          },
        ]
      : []),
    { header: 'Detalhe', align: 'end', className: 'w-36', cell: (row) => <ChartLink row={row} now={now} /> },
  ]

  const csv: CsvColumn<EpisodeRow>[] = withValues
    ? [
        ...EPISODE_CSV,
        { header: 'Valor (°C)', value: (row) => row.value ?? null },
        { header: 'Amostras', value: (row) => row.samples ?? null },
      ]
    : EPISODE_CSV

  return (
    <ReportCard
      id={id}
      title={title}
      description={description}
      action={<CsvButton filename={filename} columns={csv} rows={rows} />}
    >
      {rows.length === 0 ? (
        <p className="border-borda border-t px-4 py-5 text-corpo text-texto-3 md:px-5">{empty}</p>
      ) : (
        <DataTable
          label={title}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.key}
          mobileRow={(row) => (
            <div className="flex flex-col gap-1.5">
              <EnvironmentCell row={row} name={name(row)} />
              <p className="num flex flex-wrap gap-x-1.5 text-apoio text-texto-2">
                {/* O separador fica no fim do trecho: quando a linha quebra, ela não começa com "·" */}
                {mobileFacts(row, withValues).map((part, index, parts) => (
                  <span key={part} className="whitespace-nowrap">
                    {part}
                    {index < parts.length - 1 && <span aria-hidden="true"> ·</span>}
                  </span>
                ))}
              </p>
              <ChartLink row={row} now={now} />
            </div>
          )}
        />
      )}
    </ReportCard>
  )
}

const stuckRows = (report: Report): EpisodeRow[] =>
  report.stuckEpisodes.map((episode: StuckEpisode) => ({
    ...episode,
    key: `${episode.deviceId}-${episode.from}`,
  }))

const gapRows = (report: Report): EpisodeRow[] =>
  [...report.gaps]
    .sort((a: Gap, b: Gap) => a.from.localeCompare(b.from))
    .map((gap) => ({ ...gap, key: `${gap.deviceId}-${gap.from}` }))

/* --------------------------------------------------------------------------------------------- */

/** O relatório inteiro, na ordem de leitura de um relatório de engenharia: números, motivos, casos. */
export function QualityReportView({ report }: { report: Report }) {
  const { packets, samples } = report
  const late = packets.late
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Resumo" className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <Kpi
          label="Pacotes recebidos"
          value={formatInteger(packets.total)}
          context={packets.invalid ? plural(packets.invalid, 'inválido', 'inválidos') : 'Nenhum inválido'}
        />
        <Kpi
          label="Duplicatas exatas"
          value={formatInteger(packets.exactDuplicates)}
          context={`${formatPercent((packets.exactDuplicates / packets.total) * 100)} dos pacotes`}
        />
        <Kpi
          label="Pacotes atrasados"
          value={formatInteger(late.packets)}
          context={`até ${formatDuration(late.maxMinutes, 'calendar')}`}
        />
        <Kpi
          label="Amostras válidas"
          value={formatPercent((samples.valid / samples.total) * 100).replace('%', '')}
          unit="%"
          // Curto o bastante para o cartão de 320 px: número de contexto nunca é cortado
          context={plural(samples.total - samples.valid, 'descarte', 'descartes')}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <DiscardBreakdown report={report} className="lg:col-span-7" />
        <Devices report={report} className="lg:col-span-5" />
      </div>

      <Anomalies report={report} />

      <EpisodeTable
        id="qualidade-travado"
        title="Sensor travado"
        description="Valor idêntico por 60 min ou mais. O link abre o ambiente no menor período que mostra o episódio inteiro."
        filename="qualidade-sensor-travado.csv"
        rows={stuckRows(report)}
        withValues
        empty="Nenhum episódio: nenhuma sequência de valor idêntico chegou a 60 min."
      />

      <EpisodeTable
        id="qualidade-lacunas"
        title="Lacunas sem dado"
        description="Trechos sem pacote nem saved_data para cobrir. No gráfico, aparecem com a hachura de sem dados."
        filename="qualidade-lacunas.csv"
        rows={gapRows(report)}
        withValues={false}
        empty="Nenhum trecho longo sem pacote."
      />

      <footer className="flex flex-col gap-2 text-apoio text-texto-3">
        <p>
          Os horários estão no horário de Brasília; o CSV usa UTC. Para recalcular o relatório, na pasta do
          projeto:
        </p>
        <div className="flex max-w-full items-start gap-1 self-start rounded-md bg-superficie-3 py-1 ps-3 pe-1">
          <code className="id-tecnico min-w-0 break-words py-1 text-texto-2">{RECOMPUTE_COMMAND}</code>
          <CopyButton text={RECOMPUTE_COMMAND} label="Copiar comando" />
        </div>
      </footer>
    </div>
  )
}
