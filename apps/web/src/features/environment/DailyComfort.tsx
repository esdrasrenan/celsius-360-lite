import type { DailyComfort as Day } from '@celsius/contracts'
import { clsx } from 'clsx'
import { useState } from 'react'
import { formatDuration, formatPercent } from '../../lib/format'
import { COMFORT_TARGET_PCT } from '../../lib/states'
import { CellHintRoot, CellHintTrigger, createCellHint } from './CellHint'
import { type DailyState, dailyAxisLabels, dailyState, localDay } from './detail'
import { useRovingGrid } from './roving'

const SEGMENTS = [
  { key: 'within', label: 'Na faixa', className: 'bg-na-faixa', minutes: 'minutesWithin' },
  { key: 'below', label: 'Abaixo', className: 'bg-frio', minutes: 'minutesBelow' },
  { key: 'above', label: 'Acima', className: 'bg-quente', minutes: 'minutesAbove' },
] as const

const CLOSED_CLASS = 'border border-dashed border-borda-forte'
const EMPTY_CLASS = 'hachura-sem-dados ring-1 ring-borda ring-inset'

function dayPayload(day: Day, state: DailyState) {
  const { weekday, date } = localDay(day.day)
  const title = `${weekday} ${date}`
  if (state.kind === 'closed') return { title, lines: ['Loja fechada o dia todo'] }
  if (state.kind === 'empty') return { title, lines: ['Sem leitura válida no horário'] }
  return {
    title,
    lines: [
      ...SEGMENTS.map((segment) => {
        const minutes = day[segment.minutes]
        return `${segment.label} ${formatPercent(state[segment.key])}${minutes > 0 ? ` (${formatDuration(minutes)})` : ''}`
      }),
      `Cobertura ${formatPercent(day.coveragePct)}`,
    ],
  }
}

function LegendItem({ className, children }: { className: string; children: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={clsx('size-3 rounded-xs', className)} />
      {children}
    </li>
  )
}

/**
 * Conforto por dia (seção 5.12): colunas empilhadas a 100% com a parte do horário na faixa,
 * abaixo e acima. "Na faixa" começa no zero, então o topo dele se compara direto com a linha da
 * meta. Dia sem expediente fica tracejado e dia sem leitura, hachurado.
 */
export function DailyComfort({ days }: { days: Day[] }) {
  const [hint] = useState(createCellHint)
  const grid = useRovingGrid(1, days.length)
  const states = days.map(dailyState)
  const dense = days.length > 10
  const labels = dailyAxisLabels(days.map((day) => day.day))
  const hasClosed = states.some((state) => state.kind === 'closed')
  const hasEmpty = states.some((state) => state.kind === 'empty')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <div aria-hidden="true" className="relative h-40 w-9 shrink-0 text-end text-legenda text-texto-3">
          <span className="absolute end-0 bottom-0 translate-y-1/2">0%</span>
          <span className="absolute end-0 bottom-1/2 translate-y-1/2">50%</span>
          <span className="absolute end-0 bottom-9/10 translate-y-1/2 font-medium text-texto-2">
            {COMFORT_TARGET_PCT}%
          </span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-40">
            <span className="absolute inset-x-0 bottom-1/2 border-borda border-t" />
          </div>
          <table
            aria-labelledby="diario-titulo"
            aria-describedby="diario-descricao"
            onKeyDown={grid.onKeyDown}
            className={clsx(
              'relative w-full table-fixed border-separate',
              dense ? 'border-spacing-x-0.5' : 'border-spacing-x-2',
            )}
          >
            {/* Os dias são cabeçalhos de coluna; table-footer-group os desenha abaixo das barras */}
            <thead className="table-footer-group">
              <tr>
                {days.map((day, index) => {
                  const { weekday, day: dayOfMonth, date } = localDay(day.day)
                  const label = labels[index]
                  return (
                    <th
                      key={day.day}
                      scope="col"
                      className="p-0 pt-2 align-top font-normal text-legenda text-texto-3"
                    >
                      {!dense ? (
                        // No celular a coluna não comporta "04/02": fica o dia do mês (o mês está no intervalo)
                        <span className="flex flex-col items-center">
                          <span>{weekday}</span>
                          <span className="num sm:hidden">{dayOfMonth}</span>
                          <span className="num hidden sm:inline">{date}</span>
                        </span>
                      ) : label ? (
                        // Rótulo mais largo que a coluna: o flex decide para que lado ele transborda
                        <span
                          className={clsx(
                            'flex',
                            label.align === 'end' && 'justify-end',
                            !label.mobile && 'max-sm:so-leitor',
                          )}
                        >
                          <span className="num whitespace-nowrap">{date}</span>
                        </span>
                      ) : (
                        <span className="so-leitor">{date}</span>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              <tr>
                {days.map((day, index) => {
                  const state = states[index] ?? { kind: 'empty' }
                  const payload = dayPayload(day, state)
                  return (
                    <CellHintTrigger
                      key={day.day}
                      handle={hint}
                      payload={payload}
                      render={
                        <td
                          {...grid.cell(index)}
                          aria-label={`${payload.title}: ${payload.lines.join(', ')}`}
                          className={clsx(
                            'h-40 rounded-xs p-0 align-bottom focus-visible:outline-offset-1',
                            state.kind === 'closed' && CLOSED_CLASS,
                            state.kind === 'empty' && EMPTY_CLASS,
                          )}
                        >
                          {state.kind === 'value' && (
                            <span className="flex h-40 flex-col-reverse gap-px overflow-hidden rounded-xs">
                              {SEGMENTS.map((segment) =>
                                state[segment.key] > 0 ? (
                                  <span
                                    key={segment.key}
                                    className={clsx('min-h-0.5 w-full shrink', segment.className)}
                                    style={{ height: `${state[segment.key]}%` }}
                                  />
                                ) : null,
                              )}
                            </span>
                          )}
                        </td>
                      }
                    />
                  )
                })}
              </tr>
            </tbody>
          </table>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-4 border-texto-2 border-t border-dashed"
          />
        </div>
      </div>
      <CellHintRoot handle={hint} />
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 ps-11 text-legenda text-texto-2">
        {SEGMENTS.map((segment) => (
          <LegendItem key={segment.key} className={segment.className}>
            {segment.label}
          </LegendItem>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="w-3 border-texto-2 border-t border-dashed" />
          Meta de {COMFORT_TARGET_PCT}%
        </li>
        {hasClosed && <LegendItem className={CLOSED_CLASS}>Fechada</LegendItem>}
        {hasEmpty && <LegendItem className={EMPTY_CLASS}>Sem dados</LegendItem>}
      </ul>
    </div>
  )
}
