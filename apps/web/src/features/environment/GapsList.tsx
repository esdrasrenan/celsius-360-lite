import type { Discarded, DiscardReason, Gap, Series } from '@celsius/contracts'
import { ZoomInAreaIcon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { Hint } from '../../components/Hint'
import { formatAxisTick, formatDuration, formatInteger, formatTime, MISSING, plural } from '../../lib/format'
import { DISCARD_REASON, gapState } from '../../lib/states'
import { gapMinutes, overlapMinutes, unbrokenDuration } from './detail'

/** "seg 26/01 01:45": o dia da semana importa, porque o expediente muda com ele. */
const when = (value: string, timeZone: string) =>
  `${formatAxisTick(value, timeZone, '7d')} ${formatTime(value, timeZone)}`

function GapBadge({ gap }: { gap: Gap }) {
  const state = gapState(gap)
  return (
    <Hint content={state.hint}>
      <Badge tone={state.tone}>
        <span
          aria-hidden="true"
          className={clsx('size-3 rounded-xs ring-1 ring-borda-forte ring-inset', state.hatchClass)}
        />
        {state.label}
      </Badge>
    </Hint>
  )
}

const DISCARDED_KEYS: Array<[keyof Discarded, DiscardReason]> = [
  ['stuck', 'stuck'],
  ['sensorError', 'sensor_error'],
  ['spike', 'spike'],
  ['outOfRange', 'out_of_range'],
]

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

/** Rodapé "Leituras descartadas: 3 erro do sensor · 1.304 sensor travado" (seção 5.5). */
function DiscardedSummary({ discarded }: { discarded: Discarded }) {
  const parts = DISCARDED_KEYS.filter(([key]) => discarded[key] > 0)
  if (parts.length === 0)
    return <p className="text-apoio text-texto-3">Nenhuma leitura descartada no período.</p>
  // No celular cada motivo fica numa linha, sem o separador sobrando no começo da seguinte
  return (
    <dl className="flex flex-col gap-1 text-apoio sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-1.5">
      <dt className="inline-flex items-center gap-2 text-texto-3">
        <span
          aria-hidden="true"
          className="hachura-descartada size-3 rounded-xs ring-1 ring-alerta-borda ring-inset"
        />
        Leituras descartadas:
      </dt>
      {parts.map(([key, reason], index) => (
        <dd key={key} className="inline-flex items-center gap-1.5 ps-5 text-texto-2 sm:ps-0">
          {index > 0 && (
            <span aria-hidden="true" className="hidden text-texto-3 sm:inline">
              ·
            </span>
          )}
          <Hint content={DISCARD_REASON[reason].hint}>
            <span>
              <span className="num font-medium text-texto">{formatInteger(discarded[key])}</span>{' '}
              {lowerFirst(DISCARD_REASON[reason].label)}
            </span>
          </Hint>
        </dd>
      ))}
    </dl>
  )
}

/**
 * Lista "Lacunas e descartes" (seção 5.5): tabela no desktop e lista no celular, com a parte de
 * cada lacuna que caiu no horário de funcionamento e o atalho "Ver no gráfico".
 */
export function GapsList({
  series,
  discarded,
  timeZone,
  onShow,
}: {
  series: Series
  discarded: Discarded
  timeZone: string
  onShow: (gap: Gap) => void
}) {
  const rows = series.gaps.map((gap) => ({
    gap,
    minutes: gapMinutes(gap),
    inHours: overlapMinutes(gap.from, gap.to, series.openIntervals),
    label: `${gapState(gap).label} de ${when(gap.from, timeZone)} a ${when(gap.to, timeZone)}`,
  }))
  const total = rows.reduce((sum, row) => sum + row.minutes, 0)
  const inHours = rows.reduce((sum, row) => sum + row.inHours, 0)

  return (
    <section aria-labelledby="lacunas-titulo" className="cartao flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-4 pb-3 md:px-5 md:pt-5">
        <h2 id="lacunas-titulo" className="text-texto text-titulo-3">
          Lacunas e descartes
        </h2>
        {rows.length > 0 && (
          <p className="num text-apoio text-texto-3">
            {plural(rows.length, 'trecho', 'trechos')} · {unbrokenDuration(total, 'calendar')} ·{' '}
            {unbrokenDuration(inHours)} no horário
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-corpo text-texto-3 md:px-5">
          Nenhum trecho de 10 min ou mais sem leitura válida neste período.
        </p>
      ) : (
        <>
          <table className="hidden w-full table-fixed md:table">
            <colgroup>
              <col className="w-40" />
              <col className="w-40" />
              <col className="w-28" />
              <col className="w-28" />
              <col />
              <col className="w-40 print:hidden" />
            </colgroup>
            <thead>
              <tr className="h-cabecalho-tabela border-borda border-y bg-superficie-2 text-legenda text-texto-3">
                <th scope="col" className="ps-5 text-start font-medium">
                  Início
                </th>
                <th scope="col" className="px-3 text-start font-medium">
                  Fim
                </th>
                <th scope="col" className="px-3 text-end font-medium">
                  Duração
                </th>
                <th scope="col" className="px-3 text-end font-medium">
                  No horário
                </th>
                <th scope="col" className="ps-6 pe-3 text-start font-medium">
                  Motivo
                </th>
                <th scope="col" className="pe-5 text-end font-medium print:hidden">
                  <span className="so-leitor">Ação</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.gap.from} className="h-linha-ambiente border-borda border-t first:border-t-0">
                  <td className="num ps-5 text-corpo text-texto">{when(row.gap.from, timeZone)}</td>
                  <td className="num px-3 text-corpo text-texto">{when(row.gap.to, timeZone)}</td>
                  <td className="num whitespace-nowrap px-3 text-end text-corpo text-texto-2">
                    {formatDuration(row.minutes, 'calendar')}
                  </td>
                  <td className="num whitespace-nowrap px-3 text-end text-corpo">
                    {row.inHours > 0 ? (
                      <span className="font-medium text-texto">{formatDuration(row.inHours)}</span>
                    ) : (
                      <Hint content="A lacuna caiu inteira com a loja fechada">
                        <span className="text-texto-3">{MISSING}</span>
                      </Hint>
                    )}
                  </td>
                  <td className="ps-6 pe-3">
                    <GapBadge gap={row.gap} />
                  </td>
                  <td className="pe-4 text-end print:hidden">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={ZoomInAreaIcon}
                      aria-label={`Ver no gráfico: ${row.label}`}
                      onClick={() => onShow(row.gap)}
                    >
                      Ver no gráfico
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="flex flex-col border-borda border-t md:hidden">
            {rows.map((row) => (
              <li
                key={row.gap.from}
                className="flex flex-col gap-1.5 border-borda border-t px-4 py-3 first:border-t-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <GapBadge gap={row.gap} />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={ZoomInAreaIcon}
                    aria-label={`Ver no gráfico: ${row.label}`}
                    onClick={() => onShow(row.gap)}
                    className="-me-2"
                  >
                    Ver no gráfico
                  </Button>
                </div>
                <p className="num text-corpo text-texto">
                  {when(row.gap.from, timeZone)} – {when(row.gap.to, timeZone)}
                </p>
                <p className="num text-apoio text-texto-3">
                  {unbrokenDuration(row.minutes, 'calendar')} ·{' '}
                  {row.inHours > 0 ? `${unbrokenDuration(row.inHours)} no horário` : 'com a loja fechada'}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-auto border-borda border-t px-4 py-3 md:px-5">
        <DiscardedSummary discarded={discarded} />
      </div>
    </section>
  )
}
