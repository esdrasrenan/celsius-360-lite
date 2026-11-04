import type { Period, PeriodKey } from '@celsius/contracts'
import { PERIOD_KEYS } from '@celsius/domain'
import {
  ArrowDataTransferHorizontalIcon,
  ArrowDown01Icon,
  Csv01Icon,
  Download04Icon,
  PrinterIcon,
  Table01Icon,
} from '@hugeicons/core-free-icons'
import { Button } from '../../components/Button'
import { Hint } from '../../components/Hint'
import { Icon } from '../../components/Icon'
import { Menu } from '../../components/Menu'
import { SegmentedControl } from '../../components/SegmentedControl'
import { formatPeriod, formatTimeZoneLabel } from '../../lib/format'
import { PERIOD_FULL_LABEL, PERIOD_LABEL } from '../../lib/states'
import { type Availability, periodRangeEndingAt } from './detail'

/** Série do período atual: pronta, ainda carregando (ou na troca de período) ou com erro. */
export type SeriesStatus = 'ready' | 'loading' | 'error'

/**
 * Barra do cartão do período: segmentado (com pré-carga e push), intervalo no fuso da loja e as
 * ações Comparar, Ver tabela e Exportar. Tabela e CSV esperam a série do período atual; as ações
 * não vão para a impressão.
 */
export function PeriodToolbar({
  period,
  range,
  timeZone,
  onPeriodChange,
  onPeriodIntent,
  compare,
  compareAvailability,
  onCompareChange,
  seriesStatus,
  onShowTable,
  onDownloadSeries,
  onDownloadGaps,
  gapCount,
  onPrint,
}: {
  period: PeriodKey
  range: Period
  timeZone: string
  onPeriodChange: (period: PeriodKey) => void
  onPeriodIntent: (period: PeriodKey) => void
  compare: boolean
  compareAvailability: Availability
  onCompareChange: (compare: boolean) => void
  seriesStatus: SeriesStatus
  onShowTable: () => void
  onDownloadSeries: () => void
  onDownloadGaps: () => void
  gapCount: number
  onPrint: () => void
}) {
  const zone = formatTimeZoneLabel(timeZone, range.to)
  const options = PERIOD_KEYS.map((value) => {
    const exact = periodRangeEndingAt(value, range.to)
    return {
      value,
      label: PERIOD_LABEL[value],
      accessibleLabel: PERIOD_FULL_LABEL[value],
      hint: `${formatPeriod(exact.from, exact.to, timeZone)} · ${zone}`,
    }
  })
  const compareLabel = `Comparar com ${PERIOD_LABEL[period]} anteriores`
  const unavailable = !compareAvailability.ok
  // Sem a série atual, "Nenhuma" lacuna seria uma afirmação sobre um dado que não se tem
  const seriesMissing =
    seriesStatus === 'ready' ? null : seriesStatus === 'error' ? 'Indisponível' : 'Carregando'

  return (
    <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:py-2 print:py-3">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <SegmentedControl
          legend="Período"
          value={period}
          options={options}
          onValueChange={onPeriodChange}
          onIntent={onPeriodIntent}
          className="nao-imprimir"
        />
        <p className="num text-apoio text-texto-3">
          <span className="hidden font-medium text-texto-2 print:inline">{PERIOD_FULL_LABEL[period]} · </span>
          {/* Quebra entre o intervalo e o fuso, nunca no meio de um deles */}
          <span className="whitespace-nowrap">{formatPeriod(range.from, range.to, timeZone)} ·</span>{' '}
          <span className="whitespace-nowrap">{zone}</span>
        </p>
      </div>
      {/* As ações não encolhem: em 1024 o intervalo quebra antes de o Exportar cair sozinho */}
      <div className="nao-imprimir flex flex-wrap items-center gap-2 lg:shrink-0">
        <Hint
          content={
            compareAvailability.ok
              ? `Sobrepõe o período anterior ao gráfico e mostra a variação nos indicadores`
              : compareAvailability.reason
          }
        >
          <Button
            icon={ArrowDataTransferHorizontalIcon}
            aria-pressed={compare && !unavailable}
            aria-disabled={unavailable || undefined}
            aria-label={compareLabel}
            onClick={() => !unavailable && onCompareChange(!compare)}
            className="aria-disabled:opacity-50 aria-pressed:bg-selecionado aria-pressed:text-acento aria-pressed:ring-acento max-sm:flex-1"
          >
            <span>
              Comparar<span className="hidden xl:inline"> com {PERIOD_LABEL[period]} anteriores</span>
            </span>
          </Button>
        </Hint>
        {/* No celular, Tabela e Exportar ficam só com o ícone (o nome acessível continua) */}
        <Hint
          content={
            seriesStatus === 'error' ? 'A série do período não carregou' : 'Carregando a série do período…'
          }
          disabled={seriesMissing == null}
        >
          <Button
            icon={Table01Icon}
            aria-label="Ver tabela"
            aria-disabled={seriesMissing != null || undefined}
            onClick={() => seriesMissing == null && onShowTable()}
            className="aria-disabled:opacity-50 max-sm:px-3"
          >
            <span className="hidden sm:inline">Ver tabela</span>
          </Button>
        </Hint>
        <Menu
          trigger={
            <Button icon={Download04Icon} aria-label="Exportar" className="max-sm:gap-1 max-sm:px-3">
              <span className="hidden sm:inline">Exportar</span>
              <Icon icon={ArrowDown01Icon} size={12} className="-ms-1 text-texto-3 max-sm:ms-0" />
            </Button>
          }
          items={[
            {
              label: 'Baixar CSV da série',
              icon: Csv01Icon,
              onSelect: onDownloadSeries,
              disabled: seriesMissing != null,
              aux: seriesMissing ?? undefined,
            },
            {
              label: 'Baixar CSV das lacunas',
              icon: Csv01Icon,
              onSelect: onDownloadGaps,
              disabled: seriesMissing != null || gapCount === 0,
              aux: seriesMissing ?? (gapCount === 0 ? 'Nenhuma' : undefined),
            },
            'separator',
            { label: 'Imprimir ou salvar PDF', icon: PrinterIcon, onSelect: onPrint },
          ]}
        />
      </div>
    </div>
  )
}
