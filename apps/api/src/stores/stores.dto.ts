import type {
  ClientListItem,
  ClientRef,
  ComfortRange,
  EnvironmentListItem,
  NetworkTotals,
  Period,
  StoreEnvironmentCounts,
  StoreList,
  StoreListItem,
} from '@celsius/contracts'
import { PERIOD_KEYS, type PeriodKey } from '@celsius/domain'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

export const STORE_STATUSES = ['online', 'degraded', 'offline', 'no_data'] as const
export type StoreStatusFilter = (typeof STORE_STATUSES)[number]

export const STORE_SORTS = ['status', 'comfort', 'comfort_desc', 'out_of_range', 'name'] as const
export type StoreSort = (typeof STORE_SORTS)[number]

const toList = ({ value }: { value: unknown }) =>
  value === undefined || value === ''
    ? undefined
    : (Array.isArray(value) ? value : String(value).split(',')).map(String)

export class ListStoresQueryDto {
  @ApiPropertyOptional({
    enum: PERIOD_KEYS,
    default: '1d',
    description: 'Período dos indicadores de conforto',
  })
  @IsOptional()
  @IsIn(PERIOD_KEYS)
  period: PeriodKey = '1d'

  @ApiPropertyOptional({ description: 'Busca por nome da loja, cidade ou cliente (sem acento)' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string

  @ApiPropertyOptional({ example: 'CLI-001' })
  @IsOptional()
  @IsString()
  clientId?: string

  @ApiPropertyOptional({
    enum: STORE_STATUSES,
    isArray: true,
    description: 'Um ou mais status, separados por vírgula',
  })
  @IsOptional()
  @Transform(toList)
  @IsIn(STORE_STATUSES, { each: true })
  status?: StoreStatusFilter[]

  @ApiPropertyOptional({
    enum: STORE_SORTS,
    default: 'status',
    description:
      'status: mais grave primeiro; comfort: pior conforto primeiro; comfort_desc: melhor primeiro; ' +
      'out_of_range: mais ambientes fora da faixa agora; name: alfabética',
  })
  @IsOptional()
  @IsIn(STORE_SORTS)
  sort: StoreSort = 'status'

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20
}

export class ComfortRangeDto implements ComfortRange {
  @ApiProperty({ example: 21 }) min: number
  @ApiProperty({ example: 25 }) max: number
}

export class EnvironmentListItemDto implements EnvironmentListItem {
  @ApiProperty({ example: 'AMB-001' }) id: string
  @ApiProperty({ example: 'Salão de vendas - Vitrine' }) name: string
  @ApiProperty({ enum: ['online', 'sensor_fault', 'offline', 'no_data'] }) status: string
  @ApiProperty({
    enum: ['within', 'above', 'below', 'closed', 'unknown'],
    description: 'Situação agora: dentro, acima ou abaixo da faixa, fora do horário ou desconhecida',
  })
  situation: string
  @ApiPropertyOptional({ nullable: true, example: 23.4, description: 'Última leitura válida, °C' })
  lastValue: number | null
  @ApiPropertyOptional({ nullable: true }) lastValidAt: string | null
  @ApiProperty({ type: ComfortRangeDto }) comfortRange: ComfortRangeDto
  @ApiPropertyOptional({
    nullable: true,
    description: '% do horário de funcionamento dentro da faixa no período',
  })
  comfortPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '% do horário de funcionamento com leitura válida' })
  coveragePct: number | null
}

export class StoreEnvironmentCountsDto implements StoreEnvironmentCounts {
  @ApiProperty() total: number
  @ApiProperty() online: number
  @ApiProperty() sensorFault: number
  @ApiProperty() offline: number
  @ApiProperty() noData: number
  @ApiProperty({ description: 'Ambientes fora da faixa agora, dentro do horário de funcionamento' })
  outOfRange: number
  @ApiProperty({ description: 'Ambientes com conforto no período abaixo da meta (90%)' })
  belowTarget: number
}

export class ClientRefDto implements ClientRef {
  @ApiProperty({ example: 'CLI-001' }) id: string
  @ApiProperty({ example: 'Moda Carioca' }) name: string
}

export class StoreListItemDto implements StoreListItem {
  @ApiProperty({ example: 'LOJA-RJ-001' }) id: string
  @ApiProperty({ example: 'Loja Tijuca' }) name: string
  @ApiProperty({ example: 'loja de rua' }) kind: string
  @ApiProperty({ example: 'Rio de Janeiro' }) city: string
  @ApiProperty({ example: 'RJ' }) state: string
  @ApiProperty({ type: ClientRefDto }) client: ClientRefDto
  @ApiProperty({ enum: STORE_STATUSES }) status: string
  @ApiProperty({ type: StoreEnvironmentCountsDto }) environmentCounts: StoreEnvironmentCountsDto
  @ApiPropertyOptional({ nullable: true }) comfortPct: number | null
  @ApiPropertyOptional({ nullable: true }) coveragePct: number | null
  @ApiProperty({ type: [EnvironmentListItemDto] }) environments: EnvironmentListItemDto[]
}

export class PeriodDto implements Period {
  @ApiPropertyOptional({ enum: PERIOD_KEYS, nullable: true }) key: PeriodKey | null
  @ApiProperty() from: string
  @ApiProperty() to: string
}

export class NetworkTotalsDto implements NetworkTotals {
  @ApiProperty() stores: number
  @ApiProperty() environments: number
  @ApiProperty() online: number
  @ApiProperty() sensorFault: number
  @ApiProperty() offline: number
  @ApiProperty() noData: number
  @ApiProperty() outOfRange: number
  @ApiProperty() belowTarget: number
  @ApiPropertyOptional({ nullable: true }) comfortPct: number | null
}

export class StoreListDto implements StoreList {
  @ApiProperty({ type: [StoreListItemDto] }) items: StoreListItemDto[]
  @ApiProperty() page: number
  @ApiProperty() pageSize: number
  @ApiProperty() total: number
  @ApiProperty({
    type: NetworkTotalsDto,
    description: 'Totais de todas as lojas do filtro, não só da página',
  })
  totals: NetworkTotalsDto
  @ApiPropertyOptional({ nullable: true, description: '"Agora": horário do último pacote processado' })
  now: string | null
  @ApiProperty({ type: PeriodDto }) period: PeriodDto
}

export class ClientListItemDto extends ClientRefDto implements ClientListItem {
  @ApiProperty() stores: number
}
