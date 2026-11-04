import type { DiscardReason, PeriodKey, QualityReport } from '@celsius/contracts'
import { type CsvValue, toCsv } from '../../lib/csv'
import {
  formatDuration,
  formatInteger,
  formatPercent,
  formatTemperature,
  plural,
  pluralWord,
} from '../../lib/format'

/*
 * Leitura do QualityReport para a página /qualidade: as anomalias com evidência, os descartes por
 * motivo e o período em que cada episódio aparece no detalhe do ambiente. Tudo puro, para testar.
 */

export interface Anomaly {
  id: string
  label: string
  count: number
  /** Unidade da contagem, já no plural certo ("pacotes", "trecho"). */
  unit: string
  evidence: string
  treatment: string
}

const share = (part: number, total: number) => (total > 0 ? formatPercent((part / total) * 100) : '—')

/** Lista de nomes curta: "IOT004, IOT007 e IOT010". */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`
}

/**
 * As anomalias do arquivo, na ordem do relatório de engenharia (docs/qualidade-dos-dados.md). As
 * regras que não dispararam ficam no fim, com contagem zero: mostram que a defesa existe.
 */
export function anomalies(report: QualityReport): Anomaly[] {
  const { packets, samples, devices } = report
  const late = packets.late
  const future = packets.futureTimestamp
  const stuckEpisodes = report.stuckEpisodes
  const gapMinutes = report.gaps.map((gap) => gap.minutes)

  const rows: Anomaly[] = [
    {
      id: 'duplicate',
      label: 'Pacote duplicado exato',
      count: packets.exactDuplicates,
      unit: pluralWord(packets.exactDuplicates, 'pacote', 'pacotes'),
      evidence: `${share(packets.exactDuplicates, packets.total)} dos pacotes. Mesmo dispositivo, horário e conteúdo.`,
      treatment: 'A primeira gravação vence; o dado cru guarda todas as chegadas.',
    },
    {
      id: 'late',
      label: 'Pacote atrasado',
      count: late.packets,
      unit: pluralWord(late.packets, 'pacote', 'pacotes'),
      evidence: `Chegaram de ${late.thresholdMinutes} min a ${formatDuration(late.maxMinutes, 'calendar')} depois; ${
        late.withSavedData === late.packets ? 'todos' : formatInteger(late.withSavedData)
      } com saved_data, guardado pelo dispositivo sem conexão.`,
      treatment: 'As amostras entram no instante certo e os agregados do trecho são recalculados.',
    },
    {
      id: 'minus127',
      label: 'Código −127',
      count: samples.rawErrorCodes.minus127,
      unit: pluralWord(samples.rawErrorCodes.minus127, 'amostra', 'amostras'),
      evidence: 'Valor que o DS18B20 envia com o sensor desconectado.',
      treatment: 'Descartada como erro do sensor.',
    },
    {
      id: 'plus85',
      label: 'Código 85',
      count: samples.rawErrorCodes.plus85,
      unit: pluralWord(samples.rawErrorCodes.plus85, 'amostra', 'amostras'),
      evidence: `Valor de power-on do DS18B20; ${plural(devices.reboots, 'reinício detectado', 'reinícios detectados')}.`,
      treatment: 'Descartada como erro do sensor.',
    },
    {
      id: 'stuck',
      label: 'Sensor travado',
      count: samples.stuck,
      unit: pluralWord(samples.stuck, 'amostra', 'amostras'),
      evidence: stuckEpisodes.length
        ? `${plural(stuckEpisodes.length, 'episódio', 'episódios')}: ${stuckEpisodes
            .map(
              (episode) =>
                `${episode.deviceId} em ${formatTemperature(episode.value)} por ${formatDuration(episode.minutes, 'calendar')}`,
            )
            .join('; ')}.`
        : 'Nenhuma sequência de valor idêntico chegou a 60 min.',
      treatment: 'Valor idêntico por 60 min ou mais: descartado desde o início da sequência.',
    },
    {
      id: 'unknown-device',
      label: 'Dispositivo fora do cadastro',
      count: devices.unknown.length,
      unit: pluralWord(devices.unknown.length, 'dispositivo', 'dispositivos'),
      evidence: devices.unknown.length
        ? `${devices.unknown.map((device) => `${device.deviceId}: ${plural(device.packets, 'pacote', 'pacotes')}`).join('; ')}.`
        : 'Todos os pacotes vieram de dispositivos cadastrados.',
      treatment: 'Quarentena: fica fora da série e dos indicadores.',
    },
    {
      id: 'gap',
      label: 'Lacuna sem dado',
      count: report.gaps.length,
      unit: pluralWord(report.gaps.length, 'trecho', 'trechos'),
      evidence: gapMinutes.length
        ? `De ${formatDuration(Math.min(...gapMinutes), 'calendar')} a ${formatDuration(Math.max(...gapMinutes), 'calendar')} sem pacote, em ${listNames(
            [...new Set(report.gaps.map((gap) => gap.deviceId))].sort(),
          )}; sem saved_data para cobrir.`
        : 'Nenhum trecho longo sem pacote.',
      treatment: 'Vira indisponibilidade "Sem dados" no gráfico e fica fora do conforto.',
    },
    {
      id: 'future',
      label: 'Relógio adiantado',
      count: future.packets,
      unit: pluralWord(future.packets, 'pacote', 'pacotes'),
      evidence: future.packets
        ? `Mais de ${future.toleranceMinutes} min à frente do "agora", sem outro dispositivo que confirmasse o horário: ${listNames(
            future.devices.map((device) => device.deviceId),
          )}.`
        : `Nenhum pacote mais de ${future.toleranceMinutes} min à frente do "agora".`,
      treatment: 'Fica fora da série e não adianta o "agora" da ingestão.',
    },
    {
      id: 'invalid',
      label: 'Linha inválida',
      count: packets.invalid,
      unit: pluralWord(packets.invalid, 'pacote', 'pacotes'),
      evidence: 'JSON, esquema ou horário inválido.',
      treatment: 'Vai para o dado cru com o motivo; a ingestão continua.',
    },
    {
      id: 'spike',
      label: 'Pico isolado',
      count: samples.spike,
      unit: pluralWord(samples.spike, 'amostra', 'amostras'),
      evidence: '3 °C ou mais acima ou abaixo das duas vizinhas válidas.',
      treatment: 'Descartada como pico.',
    },
    {
      id: 'out-of-range',
      label: 'Fora da faixa física',
      count: samples.outOfRange,
      unit: pluralWord(samples.outOfRange, 'amostra', 'amostras'),
      evidence: 'Abaixo de −20 °C ou acima de 60 °C, além dos códigos de erro.',
      treatment: 'Descartada como fora da faixa física.',
    },
  ]
  return [...rows.filter((row) => row.count > 0), ...rows.filter((row) => row.count === 0)]
}

export interface DiscardShare {
  reason: DiscardReason
  samples: number
  /** Parte do total descartado, de 0 a 100. */
  pct: number
}

/** Amostras descartadas por motivo, da maior para a menor; os motivos sem ocorrência vão no fim. */
export function discardsByReason(report: QualityReport): { total: number; reasons: DiscardShare[] } {
  const { sensorError, outOfRange, spike, stuck } = report.samples
  const counts: Array<[DiscardReason, number]> = [
    ['stuck', stuck],
    ['sensor_error', sensorError],
    ['spike', spike],
    ['out_of_range', outOfRange],
  ]
  const total = counts.reduce((sum, [, samples]) => sum + samples, 0)
  const reasons = counts
    .map(([reason, samples]) => ({ reason, samples, pct: total > 0 ? (samples / total) * 100 : 0 }))
    .sort((a, b) => b.samples - a.samples)
  return { total, reasons }
}

const DAY_MS = 86_400_000

/**
 * Menor período do detalhe que mostra o trecho inteiro, contado a partir do "agora" da ingestão.
 * Sem o "agora" (SSE ainda conectando), 30 dias, que cobre o conjunto todo.
 */
export function periodCovering(from: string, now: string | null): PeriodKey {
  if (!now) return '30d'
  const age = Date.parse(now) - Date.parse(from)
  if (age <= DAY_MS) return '1d'
  if (age <= 7 * DAY_MS) return '7d'
  return '30d'
}

export function environmentHref(environmentId: string, from: string, now: string | null): string {
  return `/ambientes/${encodeURIComponent(environmentId)}?periodo=${periodCovering(from, now)}`
}

/* --------------------------------------------------------------------------------------------- */

export interface CsvColumn<T> {
  header: string
  value: (row: T) => CsvValue
}

/** CSV de uma tabela do relatório. lib/csv.ts neutraliza a fórmula, como num dev_id cru da telemetria. */
export function tableCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  return toCsv([
    columns.map((column) => column.header),
    ...rows.map((row) => columns.map((column) => column.value(row))),
  ])
}
