import type {
  DailyComfort,
  DailySeries,
  DeviceStatus,
  Discarded,
  DiscardReason,
  EnvironmentInfo,
  EnvironmentStatus,
  EnvironmentSummary,
  Gap,
  GapKind,
  Indicators,
  Interval,
  OutdoorPoint,
  ProfileCell,
  Series,
  SeriesPoint,
  Situation,
  StoreRef,
  WeeklyProfile,
} from '@celsius/contracts'
import { type Bucket, MAX_SERIES_POINTS } from '@celsius/domain'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional } from 'class-validator'
import { RangeQueryDto } from '../common/time'
import { ClientRefDto, ComfortRangeDto, DEVICE_STATUSES, PeriodDto, SITUATIONS } from '../stores/stores.dto'

const BUCKETS = ['auto', 'raw', '5m', '15m', '1h'] as const
const NULLABLE_NUMBER = { type: Number, nullable: true } as const
const NULLABLE_INSTANT = { type: String, nullable: true, format: 'date-time' } as const

export class SeriesQueryDto extends RangeQueryDto {
  @ApiPropertyOptional({
    enum: BUCKETS,
    default: 'auto',
    description:
      'auto escolhe pelo tamanho do intervalo: até 8 h, 30 s; até 3,5 dias, 5 min; até 10 dias, 15 min; acima, 1 h. ' +
      `Um bucket explícito que daria mais de ${MAX_SERIES_POINTS.toLocaleString('pt-BR')} pontos responde 400.`,
  })
  @IsOptional()
  @IsIn(BUCKETS)
  bucket: (typeof BUCKETS)[number] = 'auto'
}

export class StoreRefDto implements StoreRef {
  @ApiProperty({ example: 'LOJA-RJ-001' }) id: string
  @ApiProperty({ example: 'Loja Tijuca' }) name: string
  @ApiProperty({ example: 'Rio de Janeiro' }) city: string
  @ApiProperty({ example: 'RJ' }) state: string
  @ApiProperty({ example: 'America/Sao_Paulo' }) timezone: string
  @ApiProperty({ type: ClientRefDto }) client: ClientRefDto
}

export class EnvironmentInfoDto implements EnvironmentInfo {
  @ApiProperty({ example: 'AMB-003' }) id: string
  @ApiProperty({ example: 'Provadores' }) name: string
  @ApiProperty({ type: ComfortRangeDto }) comfortRange: ComfortRangeDto
  @ApiProperty({
    description: 'Horário de funcionamento por dia, como no cadastro',
    example: { seg: ['09:00', '20:00'], dom: null },
  })
  openingHours: Record<string, [string, string] | null>
  @ApiProperty({ type: String, nullable: true, example: 'IOT003' }) deviceId: string | null
}

export class EnvironmentStatusDto implements EnvironmentStatus {
  @ApiProperty({ enum: DEVICE_STATUSES }) device: DeviceStatus
  @ApiProperty({ enum: SITUATIONS }) situation: Situation
  @ApiProperty(NULLABLE_NUMBER) lastValue: number | null
  @ApiProperty(NULLABLE_INSTANT) lastValidAt: string | null
  @ApiProperty(NULLABLE_INSTANT) lastContactAt: string | null
  @ApiProperty({ description: 'No horário de funcionamento agora' }) openNow: boolean
  @ApiProperty({ ...NULLABLE_INSTANT, description: 'Próxima abertura, quando fechado agora' })
  nextOpenAt: string | null
}

export class DiscardedDto implements Discarded {
  @ApiProperty({ type: 'integer', description: 'Códigos de erro do sensor (-127 e 85)' }) sensorError: number
  @ApiProperty({ type: 'integer' }) outOfRange: number
  @ApiProperty({ type: 'integer' }) spike: number
  @ApiProperty({ type: 'integer', description: 'Sensor travado (valor idêntico por 60 min ou mais)' })
  stuck: number
}

export class IndicatorsDto implements Indicators {
  @ApiProperty({ ...NULLABLE_NUMBER, description: '% do horário de funcionamento dentro da faixa' })
  comfortPct: number | null
  @ApiProperty(NULLABLE_NUMBER) abovePct: number | null
  @ApiProperty(NULLABLE_NUMBER) belowPct: number | null
  @ApiProperty({ ...NULLABLE_NUMBER, description: '% do horário de funcionamento com leitura válida' })
  coveragePct: number | null
  @ApiProperty({ description: 'Minutos de funcionamento com leitura válida' }) minutesInHours: number
  @ApiProperty() minutesWithin: number
  @ApiProperty() minutesAbove: number
  @ApiProperty() minutesBelow: number
  @ApiProperty({ description: 'Minutos de funcionamento esperados no período (denominador da cobertura)' })
  minutesExpected: number
  @ApiProperty({ ...NULLABLE_NUMBER, description: 'Média de todas as leituras válidas (24 h por dia)' })
  valueAvg: number | null
  @ApiProperty(NULLABLE_NUMBER) valueMin: number | null
  @ApiProperty(NULLABLE_NUMBER) valueMax: number | null
  @ApiProperty({
    ...NULLABLE_NUMBER,
    description: 'Média só das leituras válidas com a loja aberta (coerente com o conforto)',
  })
  valueAvgInHours: number | null
  @ApiProperty(NULLABLE_NUMBER) valueMinInHours: number | null
  @ApiProperty(NULLABLE_NUMBER) valueMaxInHours: number | null
  @ApiProperty({ type: 'integer', description: 'Amostras descartadas no período' }) samplesDiscarded: number
  @ApiProperty({ type: DiscardedDto }) discarded: DiscardedDto
  @ApiProperty({ type: 'integer', description: 'Trechos de 10 min ou mais sem leitura válida' })
  gapCount: number
  @ApiProperty({ type: 'integer' }) gapMinutes: number
  @ApiProperty({ type: 'integer', description: 'Lacunas que tocam o horário de funcionamento' })
  gapCountInHours: number
  @ApiProperty({ type: 'integer', description: 'Minutos das lacunas dentro do horário de funcionamento' })
  gapMinutesInHours: number
}

export class EnvironmentSummaryDto implements EnvironmentSummary {
  @ApiProperty({ type: EnvironmentInfoDto }) environment: EnvironmentInfoDto
  @ApiProperty({ type: StoreRefDto }) store: StoreRefDto
  @ApiProperty({ type: EnvironmentStatusDto }) status: EnvironmentStatusDto
  @ApiProperty({
    type: PeriodDto,
    description:
      'Janela usada nos indicadores. Num intervalo personalizado acima de 8 h, é o pedido alinhado aos buckets do agregado.',
  })
  period: PeriodDto
  @ApiProperty({ type: IndicatorsDto }) indicators: IndicatorsDto
  @ApiProperty(NULLABLE_INSTANT) now: string | null
}

export class SeriesPointDto implements SeriesPoint {
  @ApiProperty({ format: 'date-time', description: 'Início do bucket (ou instante da amostra)' }) t: string
  @ApiProperty({ ...NULLABLE_NUMBER, description: 'Média; nulo quando não há leitura válida' })
  avg: number | null
  @ApiProperty(NULLABLE_NUMBER) min: number | null
  @ApiProperty(NULLABLE_NUMBER) max: number | null
}

export class OutdoorPointDto implements OutdoorPoint {
  @ApiProperty({ format: 'date-time' }) t: string
  @ApiProperty() value: number
}

export class GapDto implements Gap {
  @ApiProperty({ format: 'date-time' }) from: string
  @ApiProperty({ format: 'date-time' }) to: string
  @ApiProperty({
    enum: ['no_data', 'discarded'],
    description: 'no_data: sem pacotes; discarded: houve pacotes, mas todas as leituras foram descartadas',
  })
  kind: GapKind
  @ApiProperty({ type: String, nullable: true, enum: ['sensor_error', 'out_of_range', 'spike', 'stuck'] })
  reason: DiscardReason | null
}

export class IntervalDto implements Interval {
  @ApiProperty({ format: 'date-time' }) from: string
  @ApiProperty({ format: 'date-time' }) to: string
}

export class SeriesDto implements Series {
  @ApiProperty({ enum: ['raw', '5m', '15m', '1h'] }) bucket: Bucket
  @ApiProperty({ format: 'date-time' }) from: string
  @ApiProperty({ format: 'date-time' }) to: string
  @ApiProperty(NULLABLE_INSTANT) now: string | null
  @ApiProperty({ type: ComfortRangeDto }) comfortRange: ComfortRangeDto
  @ApiProperty({ type: [SeriesPointDto], description: 'Série densa: buckets sem dado vêm com avg nulo' })
  points: SeriesPointDto[]
  @ApiProperty({ type: [OutdoorPointDto], description: 'Temperatura externa horária (Open-Meteo)' })
  outdoor: OutdoorPointDto[]
  @ApiProperty({ type: [GapDto] }) gaps: GapDto[]
  @ApiProperty({ type: [IntervalDto], description: 'Horário de funcionamento dentro do intervalo' })
  openIntervals: IntervalDto[]
}

export class ProfileCellDto implements ProfileCell {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 7,
    description: 'ISO 8601: 1 = segunda ... 7 = domingo',
  })
  weekday: number
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 23, description: 'Hora local da loja' }) hour: number
  @ApiProperty({ description: 'A loja abre nesse horário segundo o cadastro' }) open: boolean
  @ApiProperty({ type: 'integer', description: 'Dias do período com leitura válida nessa hora' }) days: number
  @ApiProperty() minutesInHours: number
  @ApiProperty(NULLABLE_NUMBER) withinPct: number | null
  @ApiProperty(NULLABLE_NUMBER) abovePct: number | null
  @ApiProperty(NULLABLE_NUMBER) belowPct: number | null
  @ApiProperty({ ...NULLABLE_NUMBER, description: 'Média das leituras válidas da célula, °C' })
  valueAvg: number | null
}

export class WeeklyProfileDto implements WeeklyProfile {
  @ApiProperty({ type: PeriodDto, description: 'Janela alinhada às horas cheias' }) period: PeriodDto
  @ApiProperty({ example: 'America/Recife' }) timezone: string
  @ApiProperty({ type: ComfortRangeDto }) comfortRange: ComfortRangeDto
  @ApiProperty({ type: [ProfileCellDto], description: '168 células: 7 dias × 24 horas, segunda primeiro' })
  cells: ProfileCellDto[]
}

export class DailyComfortDto implements DailyComfort {
  @ApiProperty({ example: '2026-02-10', description: 'Dia local da loja (AAAA-MM-DD)' }) day: string
  @ApiProperty() minutesExpected: number
  @ApiProperty() minutesInHours: number
  @ApiProperty() minutesWithin: number
  @ApiProperty() minutesAbove: number
  @ApiProperty() minutesBelow: number
  @ApiProperty(NULLABLE_NUMBER) comfortPct: number | null
  @ApiProperty(NULLABLE_NUMBER) coveragePct: number | null
  @ApiProperty(NULLABLE_NUMBER) valueAvgInHours: number | null
}

export class DailySeriesDto implements DailySeries {
  @ApiProperty({ type: PeriodDto }) period: PeriodDto
  @ApiProperty({ example: 'America/Sao_Paulo' }) timezone: string
  @ApiProperty({
    type: [DailyComfortDto],
    description: 'Um item por dia local que toca o período, inclusive os sem leitura',
  })
  days: DailyComfortDto[]
}
