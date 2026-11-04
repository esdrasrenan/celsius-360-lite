import type { Series } from '@celsius/contracts'
import {
  ArrowDown02Icon,
  ArrowRight01Icon,
  ArrowUp02Icon,
  Clock01Icon,
  Download04Icon,
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { clsx } from 'clsx'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { Pagination } from '../../components/Pagination'
import { formatDateTime, formatDecimal, plural } from '../../lib/format'
import { type PointSituation, seriesRows } from './detail'

const PAGE_SIZE = 50

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const SITUATION_STYLE: Record<PointSituation, { className: string; icon?: IconSvgElement }> = {
  within: { className: 'text-texto-3' },
  above: { className: 'text-quente-texto', icon: ArrowUp02Icon },
  below: { className: 'text-frio-texto', icon: ArrowDown02Icon },
  closed: { className: 'text-texto-3', icon: Clock01Icon },
  gap: { className: 'text-alerta-texto' },
  missing: { className: 'text-texto-3' },
}

export const BUCKET_LABEL: Record<Series['bucket'], string> = {
  raw: 'amostras de 30 s',
  '5m': 'médias de 5 min',
  '15m': 'médias de 15 min',
  '1h': 'médias de 1 h',
}

/**
 * "Ver dados em tabela" (seção 5.10): a série do gráfico em <details>, paginada de 50 em 50, com
 * Data e hora, Média, Mín., Máx., Externa e Situação. No celular ficam data, média e situação; o
 * resto está no CSV.
 */
export function DataTable({
  series,
  timeZone,
  timeZoneLabel,
  open,
  onOpenChange,
  onDownload,
}: {
  series: Series
  timeZone: string
  timeZoneLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownload: () => void
}) {
  const [page, setPage] = useState(1)
  const rows = seriesRows(series)
  const last = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(page, last)
  const visible = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  return (
    <details
      id="tabela-dados"
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      className="group cartao nao-imprimir overflow-clip"
    >
      <summary className="flex h-14 cursor-pointer select-none list-none items-center gap-2 rounded-xl px-4 font-medium text-corpo text-texto transition-colors duration-100 ease-linear hover:bg-realce group-open:rounded-b-none md:px-5">
        <Icon
          icon={ArrowRight01Icon}
          className="text-texto-3 transition-transform duration-200 ease-saida group-open:rotate-90"
        />
        Ver dados em tabela
        <span className="ms-auto hidden font-normal text-apoio text-texto-3 sm:inline">
          {plural(rows.length, 'linha', 'linhas')} · {BUCKET_LABEL[series.bucket]}
        </span>
      </summary>
      <div className="flex flex-wrap items-center justify-between gap-3 border-borda border-t px-4 py-3 md:px-5">
        <p className="text-apoio text-texto-3">
          {capitalize(BUCKET_LABEL[series.bucket])} em °C ·{' '}
          <span className="whitespace-nowrap">{timeZoneLabel}</span>
          <span className="sm:hidden"> · mín., máx. e externa no CSV</span>
        </p>
        <Button size="sm" icon={Download04Icon} onClick={onDownload}>
          Baixar CSV
        </Button>
      </div>
      <table className="w-full table-fixed">
        <caption className="so-leitor">
          Leituras do período, página {current} de {last}
        </caption>
        {/* Números em colunas estreitas e juntas; a situação fica com o resto da largura */}
        <colgroup>
          <col className="w-26 sm:w-36 md:w-40" />
          <col className="w-16 sm:w-24" />
          <col className="hidden sm:table-column sm:w-24" />
          <col className="hidden sm:table-column sm:w-24" />
          <col className="hidden sm:table-column sm:w-24" />
          <col />
        </colgroup>
        <thead>
          <tr className="h-cabecalho-tabela border-borda border-y bg-superficie-2 text-legenda text-texto-3">
            <th scope="col" className="ps-4 text-start font-medium md:ps-5">
              Data e hora
            </th>
            <th scope="col" className="px-2 text-end font-medium">
              Média
            </th>
            <th scope="col" className="hidden px-2 text-end font-medium sm:table-cell">
              Mín.
            </th>
            <th scope="col" className="hidden px-2 text-end font-medium sm:table-cell">
              Máx.
            </th>
            <th scope="col" className="hidden px-2 text-end font-medium sm:table-cell">
              Externa
            </th>
            <th scope="col" className="ps-4 pe-4 text-start font-medium sm:ps-8 md:pe-5">
              Situação
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const style = SITUATION_STYLE[row.state.situation]
            return (
              <tr key={row.t} className="h-10 border-borda border-t first:border-t-0 text-corpo">
                <td className="num ps-4 text-texto md:ps-5">{formatDateTime(row.t, timeZone)}</td>
                <td className="num px-2 text-end font-medium text-texto">{formatDecimal(row.avg)}</td>
                <td className="num hidden px-2 text-end text-texto-2 sm:table-cell">
                  {formatDecimal(row.min)}
                </td>
                <td className="num hidden px-2 text-end text-texto-2 sm:table-cell">
                  {formatDecimal(row.max)}
                </td>
                <td className="num hidden px-2 text-end text-texto-2 sm:table-cell">
                  {formatDecimal(row.outdoor)}
                </td>
                <td className={clsx('ps-4 pe-4 text-apoio sm:ps-8 md:pe-5', style.className)}>
                  <span className="inline-flex min-w-0 items-center gap-1">
                    {style.icon && <Icon icon={style.icon} size={12} />}
                    <span className="truncate">{row.state.label}</span>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <Pagination
        page={current}
        pageSize={PAGE_SIZE}
        total={rows.length}
        onPageChange={setPage}
        noun={['linha', 'linhas']}
      />
    </details>
  )
}
