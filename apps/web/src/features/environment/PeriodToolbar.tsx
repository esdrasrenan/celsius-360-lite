import type { Period, PeriodKey } from '@celsius/contracts'
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
import { type Availability, PERIODS, periodRangeEndingAt } from './detail'

/**
 * Barra do cartão do período: segmentado (com pré-carga e push), intervalo no fuso da loja e as
 * ações Comparar, Ver tabela e Exportar. As ações não vão para a impressão.
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
  onShowTable: () => void
  onDownloadSeries: () => void
  onDownloadGaps: () => void
  gapCount: number
  onPrint: () => void
}) {
  const zone = formatTimeZoneLabel(timeZone, range.to)
  const options = PERIODS.map((value) => {
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

  return (
    <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6 print:py-3">
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
      <div className="nao-imprimir flex flex-wrap items-center gap-2">
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
        <Button icon={Table01Icon} aria-label="Ver tabela" onClick={onShowTable} className="max-sm:px-3">
          <span className="hidden sm:inline">Ver tabela</span>
        </Button>
        <Menu
          trigger={
            <Button icon={Download04Icon} aria-label="Exportar" className="max-sm:gap-1 max-sm:px-3">
              <span className="hidden sm:inline">Exportar</span>
              <Icon icon={ArrowDown01Icon} size={12} className="-ms-1 text-texto-3 max-sm:ms-0" />
            </Button>
          }
          items={[
            { label: 'Baixar CSV da série', icon: Csv01Icon, onSelect: onDownloadSeries },
            {
              label: 'Baixar CSV das lacunas',
              icon: Csv01Icon,
              onSelect: onDownloadGaps,
              disabled: gapCount === 0,
              aux: gapCount === 0 ? 'Nenhuma' : undefined,
            },
            'separator',
            { label: 'Imprimir ou salvar PDF', icon: PrinterIcon, onSelect: onPrint },
          ]}
        />
      </div>
    </div>
  )
}
