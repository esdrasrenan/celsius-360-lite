import type { WeeklyProfile as Profile, ProfileCell } from '@celsius/contracts'
import { clsx } from 'clsx'
import { type ReactNode, useState } from 'react'
import { Hint } from '../../components/Hint'
import { formatPercent, formatTemperature, plural } from '../../lib/format'
import { CellHintRoot, CellHintTrigger, createCellHint } from './CellHint'
import { PROFILE_LEVELS, type ProfileSide, type ProfileStep, profileStep, WEEKDAYS } from './detail'
import { useRovingGrid } from './roving'

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

/** Escala divergente pelo lado dominante: o degrau 0 (até 5% fora) é neutro dos dois lados. */
const LEVEL_CLASS: Record<ProfileSide, readonly string[]> = {
  quente: ['bg-superficie-3', 'bg-quente/25', 'bg-quente/45', 'bg-quente/70', 'bg-quente'],
  frio: ['bg-superficie-3', 'bg-frio/25', 'bg-frio/45', 'bg-frio/70', 'bg-frio'],
}

const CLOSED_CLASS = 'border border-dashed border-borda-forte'
const EMPTY_CLASS = 'hachura-sem-dados ring-1 ring-borda ring-inset'

/** Chave do degrau, compartilhada entre a célula e a legenda (o degrau 0 não tem lado). */
function stepKey(step: ProfileStep): string {
  if (step.kind !== 'value') return step.kind
  return step.level === 0 ? 'neutro' : `${step.side}-${step.level}`
}

function stepClass(step: ProfileStep): string {
  if (step.kind === 'closed') return CLOSED_CLASS
  if (step.kind === 'empty') return EMPTY_CLASS
  return LEVEL_CLASS[step.side][step.level] ?? ''
}

function levelRange(level: number): string {
  const lower = PROFILE_LEVELS[level - 1]
  const upper = PROFILE_LEVELS[level]
  return upper == null ? `${lower}% ou mais` : `${lower}% a ${upper}%`
}

function cellPayload(cell: ProfileCell, step: ProfileStep) {
  const day = WEEKDAYS[cell.weekday - 1] ?? WEEKDAYS[0]
  const title = `${day.long}, ${cell.hour}h–${cell.hour + 1}h`
  const days = plural(cell.days, day.plural[0], day.plural[1])
  const average = cell.valueAvg == null ? null : `média ${formatTemperature(cell.valueAvg)}`
  let lines: string[]
  if (step.kind === 'closed') {
    lines = ['Loja fechada', ...(average ? [`${average} com a loja fechada`] : [])]
  } else if (step.kind === 'empty') {
    lines = ['Sem leitura válida no horário']
  } else {
    const above = cell.abovePct ?? 0
    const below = cell.belowPct ?? 0
    const split =
      above > 0 && below > 0
        ? `${formatPercent(above)} do tempo acima · ${formatPercent(below)} abaixo`
        : above > 0
          ? `${formatPercent(above)} do tempo acima`
          : below > 0
            ? `${formatPercent(below)} do tempo abaixo`
            : `${formatPercent(cell.withinPct)} do tempo na faixa`
    lines = [split, ...(average ? [average] : [])]
  }
  return { title, lines: [...lines, days] }
}

interface LegendStep {
  key: string
  className: string
  hint: string
}

const LEGEND_SCALE: LegendStep[] = [
  ...[4, 3, 2, 1].map((level) => ({
    key: `frio-${level}`,
    className: LEVEL_CLASS.frio[level] ?? '',
    hint: `${levelRange(level)} do horário abaixo da faixa`,
  })),
  { key: 'neutro', className: LEVEL_CLASS.quente[0] ?? '', hint: 'Até 5% do horário fora da faixa' },
  ...[1, 2, 3, 4].map((level) => ({
    key: `quente-${level}`,
    className: LEVEL_CLASS.quente[level] ?? '',
    hint: `${levelRange(level)} do horário acima da faixa`,
  })),
]

function LegendSwatch({
  step,
  onHighlight,
  children,
}: {
  step: LegendStep
  onHighlight: (key: string | null) => void
  children?: ReactNode
}) {
  const on = () => onHighlight(step.key)
  const off = () => onHighlight(null)
  return (
    <Hint content={step.hint}>
      <button
        type="button"
        aria-label={`Destacar: ${step.hint}`}
        onPointerEnter={on}
        onPointerLeave={off}
        onFocus={on}
        onBlur={off}
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-xs text-texto-3 hover:text-texto',
          !children && 'max-sm:w-full',
        )}
      >
        <span
          aria-hidden="true"
          className={clsx('h-3 rounded-xs', children ? 'w-3' : 'w-3 max-sm:w-full', step.className)}
        />
        {children}
      </button>
    </Hint>
  )
}

/**
 * Perfil semanal (seção 5.12): heatmap 7 × 24 no fuso da loja com a parte do horário fora da
 * faixa pelo lado dominante. Hora fechada fica tracejada e hora sem leitura, hachurada: ausência
 * nunca vira 0. Uma grade com foco itinerante: as setas andam entre as células e mostram a dica.
 */
export function WeeklyProfile({ profile }: { profile: Profile }) {
  const [hint] = useState(createCellHint)
  const [highlight, setHighlight] = useState<string | null>(null)
  const grid = useRovingGrid(7, 24)
  const byKey = new Map(profile.cells.map((cell) => [`${cell.weekday}-${cell.hour}`, cell]))

  return (
    <div className="flex flex-col gap-4">
      <table
        aria-labelledby="perfil-titulo"
        aria-describedby="perfil-descricao"
        onKeyDown={grid.onKeyDown}
        className="w-full table-fixed border-separate border-spacing-0.5"
      >
        <colgroup>
          <col className="w-9" />
          {HOURS.map((hour) => (
            <col key={hour} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <td />
            {HOURS.map((hour) => (
              <th
                key={hour}
                scope="col"
                className="h-5 p-0 text-start align-bottom font-normal text-legenda text-texto-3"
              >
                <span className={hour % 3 === 0 ? 'whitespace-nowrap' : 'so-leitor'}>{hour}h</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WEEKDAYS.map((day, row) => (
            <tr key={day.short}>
              <th scope="row" className="pe-1 text-start font-normal text-legenda text-texto-3">
                {day.short}
              </th>
              {HOURS.map((hour) => {
                const cell = byKey.get(`${row + 1}-${hour}`)
                const step: ProfileStep = cell ? profileStep(cell) : { kind: 'empty' }
                const payload = cell
                  ? cellPayload(cell, step)
                  : { title: `${day.long}, ${hour}h–${hour + 1}h`, lines: ['Sem leitura válida no horário'] }
                const key = stepKey(step)
                return (
                  <CellHintTrigger
                    key={hour}
                    handle={hint}
                    payload={payload}
                    render={
                      <td
                        {...grid.cell(row * 24 + hour)}
                        aria-label={`${payload.title}: ${payload.lines.join(', ')}`}
                        className={clsx(
                          'h-4 rounded-xs p-0 transition-opacity duration-100 ease-linear focus-visible:outline-offset-1 md:h-5',
                          stepClass(step),
                          highlight != null && highlight !== key && 'opacity-25',
                        )}
                      />
                    }
                  />
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <CellHintRoot handle={hint} />

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-legenda text-texto-3 sm:ps-10">
        {/* No celular as pontas descem para baixo da escala, que ocupa a largura toda */}
        <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
          <span aria-hidden="true" className="hidden whitespace-nowrap sm:inline">
            ≥ 50% abaixo
          </span>
          <ul aria-label="Escala: parte do horário fora da faixa" className="flex items-center gap-0.5">
            {LEGEND_SCALE.map((step) => (
              <li key={step.key} className="flex max-sm:flex-1">
                <LegendSwatch step={step} onHighlight={setHighlight} />
              </li>
            ))}
          </ul>
          <span aria-hidden="true" className="hidden whitespace-nowrap sm:inline">
            ≥ 50% acima
          </span>
          <span aria-hidden="true" className="flex justify-between sm:hidden">
            <span>≥ 50% abaixo</span>
            <span>≥ 50% acima</span>
          </span>
        </div>
        <ul className="flex items-center gap-4">
          <li className="flex">
            <LegendSwatch
              step={{ key: 'closed', className: CLOSED_CLASS, hint: 'Hora em que a loja fica fechada' }}
              onHighlight={setHighlight}
            >
              Fechada
            </LegendSwatch>
          </li>
          <li className="flex">
            <LegendSwatch
              step={{
                key: 'empty',
                className: EMPTY_CLASS,
                hint: 'Hora de funcionamento sem leitura válida',
              }}
              onHighlight={setHighlight}
            >
              Sem leitura
            </LegendSwatch>
          </li>
        </ul>
      </div>
    </div>
  )
}
