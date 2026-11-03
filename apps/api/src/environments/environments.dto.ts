import type {
  Discarded,
  EnvironmentInfo,
  EnvironmentStatus,
  EnvironmentSummary,
  Gap,
  Indicators,
  Interval,
  OutdoorPoint,
  Series,
  SeriesPoint,
  StoreRef,
} from '@celsius/contracts'
import type { Bucket } from '@celsius/domain'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional } from 'class-validator'
import { RangeQueryDto } from '../common/time'
import { ClientRefDto, ComfortRangeDto, PeriodDto } from '../stores/stores.dto'

const BUCKETS = ['auto', 'raw', '5m', '15m', '1h'] as const

export class SeriesQueryDto extends RangeQueryDto {
  @ApiPropertyOptional({
    enum: BUCKETS,
    default: 'auto',
    description:
      'auto escolhe pelo tamanho do intervalo: até 8 h, 30 s; até 3,5 dias, 5 min; até 10 dias, 15 min; acima, 1 h',
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
  @ApiPropertyOptional({ nullable: true, example: 'IOT003' }) deviceId: string | null
}

export class EnvironmentStatusDto implements EnvironmentStatus {
  @ApiProperty({ enum: ['online', 'sensor_fault', 'offline', 'no_data'] }) device: string
  @ApiProperty({ enum: ['within', 'above', 'below', 'closed', 'unknown'] }) situation: string
  @ApiPropertyOptional({ nullable: true }) lastValue: number | null
  @ApiPropertyOptional({ nullable: true }) lastValidAt: string | null
  @ApiPropertyOptional({ nullable: true }) lastContactAt: string | null
}

export class DiscardedDto implements Discarded {
  @ApiProperty({ description: 'Códigos de erro do sensor (-127 e 85)' }) sensorError: number
  @ApiProperty() outOfRange: number
  @ApiProperty() spike: number
  @ApiProperty({ description: 'Sensor travado (valor idêntico por 60 min ou mais)' }) stuck: number
}

export class IndicatorsDto implements Indicators {
  @ApiPropertyOptional({ nullable: true, description: '% do horário de funcionamento dentro da faixa' })
  comfortPct: number | null
  @ApiPropertyOptional({ nullable: true }) abovePct: number | null
  @ApiPropertyOptional({ nullable: true }) belowPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '% do horário de funcionamento com leitura válida' })
  coveragePct: number | null
  @ApiProperty({ description: 'Minutos de funcionamento com leitura válida' }) minutesInHours: number
  @ApiProperty() minutesWithin: number
  @ApiProperty() minutesAbove: number
  @ApiProperty() minutesBelow: number
  @ApiPropertyOptional({ nullable: true }) valueAvg: number | null
  @ApiPropertyOptional({ nullable: true }) valueMin: number | null
  @ApiPropertyOptional({ nullable: true }) valueMax: number | null
  @ApiProperty({ description: 'Amostras descartadas no período' }) samplesDiscarded: number
  @ApiProperty({ type: DiscardedDto }) discarded: DiscardedDto
  @ApiProperty({ description: 'Trechos de 10 min ou mais sem leitura válida' }) gapCount: number
  @ApiProperty() gapMinutes: number
}

export class EnvironmentSummaryDto implements EnvironmentSummary {
  @ApiProperty({ type: EnvironmentInfoDto }) environment: EnvironmentInfoDto
  @ApiProperty({ type: StoreRefDto }) store: StoreRefDto
  @ApiProperty({ type: EnvironmentStatusDto }) status: EnvironmentStatusDto
  @ApiProperty({ type: PeriodDto }) period: PeriodDto
  @ApiProperty({ type: IndicatorsDto }) indicators: IndicatorsDto
  @ApiPropertyOptional({ nullable: true }) now: string | null
}

export class SeriesPointDto implements SeriesPoint {
  @ApiProperty({ description: 'Início do bucket (ou instante da amostra)' }) t: string
  @ApiPropertyOptional({ nullable: true, description: 'Média; nulo quando não há leitura válida' }) avg:
    | number
    | null
  @ApiPropertyOptional({ nullable: true }) min: number | null
  @ApiPropertyOptional({ nullable: true }) max: number | null
}

export class OutdoorPointDto implements OutdoorPoint {
  @ApiProperty() t: string
  @ApiProperty() value: number
}

export class GapDto implements Gap {
  @ApiProperty() from: string
  @ApiProperty() to: string
  @ApiProperty({
    enum: ['no_data', 'invalid'],
    description: 'no_data: sem pacotes; invalid: só leituras descartadas',
  })
  kind: string
  @ApiPropertyOptional({ nullable: true, enum: ['sensor_error', 'out_of_range', 'spike', 'stuck'] })
  reason: string | null
}

export class IntervalDto implements Interval {
  @ApiProperty() from: string
  @ApiProperty() to: string
}

export class SeriesDto implements Series {
  @ApiProperty({ enum: ['raw', '5m', '15m', '1h'] }) bucket: Bucket
  @ApiProperty() from: string
  @ApiProperty() to: string
  @ApiPropertyOptional({ nullable: true }) now: string | null
  @ApiProperty({ type: ComfortRangeDto }) comfortRange: ComfortRangeDto
  @ApiProperty({ type: [SeriesPointDto], description: 'Série densa: buckets sem dado vêm com avg nulo' })
  points: SeriesPointDto[]
  @ApiProperty({ type: [OutdoorPointDto], description: 'Temperatura externa horária (Open-Meteo)' })
  outdoor: OutdoorPointDto[]
  @ApiProperty({ type: [GapDto] }) gaps: GapDto[]
  @ApiProperty({ type: [IntervalDto], description: 'Horário de funcionamento dentro do intervalo' })
  openIntervals: IntervalDto[]
}
