import { clsx } from 'clsx'
import type { ReactNode } from 'react'

export interface Column<T> {
  header: string
  cell: (row: T) => ReactNode
  /** Números e ações à direita. */
  align?: 'end'
  /** Largura da coluna (classe de largura do Tailwind). */
  className?: string
}

/**
 * Tabela do relatório: <table> a partir de lg e lista empilhada abaixo dele, com o mesmo conteúdo.
 * As colunas fixas somam quase 700 px, e no tablet a coluna do nome ficaria com dois caracteres.
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  mobileRow,
  muted,
}: {
  label: string
  columns: readonly Column<T>[]
  rows: readonly T[]
  rowKey: (row: T) => string
  mobileRow: (row: T) => ReactNode
  /** Linha esmaecida (regra que não disparou). */
  muted?: (row: T) => boolean
}) {
  return (
    <>
      <table className="hidden w-full table-fixed border-collapse text-corpo lg:table">
        <caption className="so-leitor">{label}</caption>
        <thead>
          <tr className="h-cabecalho-tabela bg-superficie-2 text-legenda text-texto-3">
            {columns.map((column) => (
              <th
                key={column.header}
                scope="col"
                className={clsx(
                  'px-3 font-medium first:ps-5 last:pe-5',
                  column.align === 'end' ? 'text-right' : 'text-left',
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={clsx('border-borda border-t align-top', muted?.(row) && 'text-texto-3')}
            >
              {columns.map((column) => (
                <td
                  key={column.header}
                  className={clsx('px-3 py-3 first:ps-5 last:pe-5', column.align === 'end' && 'text-right')}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul aria-label={label} className="divide-y divide-borda border-borda border-t lg:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className={clsx('px-4 py-3', muted?.(row) && 'text-texto-3')}>
            {mobileRow(row)}
          </li>
        ))}
      </ul>
    </>
  )
}
