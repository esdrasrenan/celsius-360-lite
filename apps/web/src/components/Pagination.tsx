import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import { formatInteger, plural, pluralWord } from '../lib/format'
import { buttonClass } from './Button'
import { Icon } from './Icon'
import { Select } from './Select'

/**
 * Páginas visíveis com reticências: "1 2 3 … 16", "1 … 7 8 9 … 16", "1 … 14 15 16". Uma página
 * só escondida entre dois números aparece no lugar da reticência.
 */
export function pageList(current: number, last: number): Array<number | '…'> {
  if (last <= 7) return Array.from({ length: last }, (_, index) => index + 1)
  const pages = new Set([
    1,
    last,
    current - 1,
    current,
    current + 1,
    // Nas pontas, mostra três números seguidos ("1 2 3 … 16")
    ...(current <= 2 ? [2, 3] : []),
    ...(current >= last - 1 ? [last - 1, last - 2] : []),
  ])
  const sorted = [...pages].filter((page) => page >= 1 && page <= last).sort((a, b) => a - b)
  const out: Array<number | '…'> = []
  for (const page of sorted) {
    const previous = out.at(-1)
    if (typeof previous === 'number' && page - previous === 2) out.push(previous + 1)
    else if (typeof previous === 'number' && page - previous > 2) out.push('…')
    out.push(page)
  }
  return out
}

/**
 * Rodapé de paginação do cartão (seção 3.12): contagem à esquerda ("1–20 de 312 lojas") e, à
 * direita, "Por página", Anterior, números e Próxima. Com uma página só, sobram a contagem e o
 * "Por página" (se houver mais lojas que o menor tamanho). No celular, "‹ 3 de 16 ›".
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  onPageIntent,
  pageSizes = [20, 50, 100],
  noun = ['loja', 'lojas'],
  className,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  /** Hover em "Próxima" ou num número: pré-carrega aquela página. */
  onPageIntent?: (page: number) => void
  pageSizes?: readonly number[]
  /** Singular e plural do que é contado. */
  noun?: readonly [string, string]
  className?: string
}) {
  const last = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), last)
  const start = total === 0 ? 0 : (current - 1) * pageSize + 1
  const end = Math.min(current * pageSize, total)
  const count =
    last === 1
      ? plural(total, noun[0], noun[1])
      : `${formatInteger(start)}–${formatInteger(end)} de ${plural(total, noun[0], noun[1])}`
  const showSize = onPageSizeChange && total > (pageSizes[0] ?? 0)
  const go = (target: number) => target !== current && onPageChange(target)

  return (
    <div
      className={clsx(
        'flex h-14 items-center justify-between gap-3 border-borda border-t px-4 text-apoio text-texto-3',
        className,
      )}
    >
      <p className="num truncate">{count}</p>
      <div className="flex shrink-0 items-center gap-3">
        {showSize && (
          // No celular sobra só "‹ 3 de 16 ›": a contagem não pode ser cortada
          <div className="hidden items-center gap-2 sm:flex">
            <span aria-hidden="true" className="hidden md:inline">
              Por página
            </span>
            <Select
              size="sm"
              label="Por página"
              value={String(pageSize)}
              onValueChange={(value) => onPageSizeChange(Number(value))}
              options={pageSizes.map((size) => ({ value: String(size), label: String(size) }))}
              className="w-20"
            />
          </div>
        )}
        {last > 1 && (
          <nav aria-label="Paginação" className="flex items-center gap-1">
            <button
              type="button"
              disabled={current === 1}
              aria-label="Página anterior"
              onClick={() => go(current - 1)}
              className={buttonClass('ghost', 'sm', 'px-2')}
            >
              <Icon icon={ArrowLeft01Icon} />
              <span className="hidden sm:inline">Anterior</span>
            </button>
            <ul className="hidden items-center gap-1 sm:flex">
              {pageList(current, last).map((item, index) =>
                item === '…' ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: as reticências não têm identidade própria
                  <li key={`gap-${index}`} aria-hidden="true" className="px-1">
                    …
                  </li>
                ) : (
                  <li key={item}>
                    <button
                      type="button"
                      aria-label={`Página ${item}`}
                      aria-current={item === current ? 'page' : undefined}
                      onClick={() => go(item)}
                      onPointerEnter={() => item !== current && onPageIntent?.(item)}
                      className={clsx(
                        'pressionavel num inline-flex h-controle-sm min-w-8 items-center justify-center rounded-sm px-2 text-apoio',
                        item === current
                          ? 'bg-inverso font-semibold text-texto-inverso'
                          : 'font-medium text-texto-3 hover:bg-realce hover:text-texto',
                      )}
                    >
                      {formatInteger(item)}
                    </button>
                  </li>
                ),
              )}
            </ul>
            <span className="num px-1 font-medium text-texto-2 sm:hidden">
              {current} de {last}
              <span className="so-leitor"> {pluralWord(last, 'página', 'páginas')}</span>
            </span>
            <button
              type="button"
              disabled={current === last}
              aria-label="Próxima página"
              onClick={() => go(current + 1)}
              onPointerEnter={() => current < last && onPageIntent?.(current + 1)}
              className={buttonClass('ghost', 'sm', 'px-2')}
            >
              <span className="hidden sm:inline">Próxima</span>
              <Icon icon={ArrowRight01Icon} />
            </button>
          </nav>
        )}
      </div>
    </div>
  )
}
