import type {
  ClientListItem,
  ClientRef,
  ComfortRange,
  DeviceStatus,
  EnvironmentListItem,
  NetworkTotals,
  Period,
  Situation,
  StoreEnvironmentCounts,
  StoreFacets,
  StoreList,
  StoreListItem,
  StoreSort,
  StoreStatus,
  WorstEnvironment,
} from '@celsius/contracts'
import { COMFORT_TARGET_PCT, PERIOD_KEYS, type PeriodKey } from '@celsius/domain'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  NotContains,
} from 'class-validator'
import { MAX_SEARCH_TERMS } from './search'

export const STORE_STATUSES = [
  'online',
  'degraded',
  'offline',
  'no_data',
] as const satisfies readonly StoreStatus[]
export const DEVICE_STATUSES = [
  'online',
  'sensor_fault',
  'offline',
  'no_data',
] as const satisfies readonly DeviceStatus[]
export const SITUATIONS = [
  'within',
  'above',
  'below',
  'closed',
  'unknown',
] as const satisfies readonly Situation[]
export const STORE_SORTS = [
  'status',
  'comfort',
  'comfort_desc',
  'out_of_range',
  'worst_env',
  'name',
] as const satisfies readonly StoreSort[]
export type { StoreSort }

const toList = ({ value }: { value: unknown }) =>
  value === undefined || value === ''
    ? undefined
    : (Array.isArray(value) ? value : String(value).split(',')).map(String)

// Só "true" e "false" viram booleano; qualquer outro texto chega ao validador e vira 400
const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value

export class ListStoresQueryDto {
  @ApiPropertyOptional({
    enum: PERIOD_KEYS,
    default: '1d',
    description: 'Período dos indicadores de conforto',
  })
  @IsOptional()
  @IsIn(PERIOD_KEYS)
  period: PeriodKey = '1d'

  @ApiPropertyOptional({
    maxLength: 80,
    description:
      `Busca sem acento e sem diferenciar maiúsculas por id, nome, tipo, cidade, UF ou "cidade/UF" da loja, ` +
      `cliente e nome ou dispositivo dos ambientes. Até ${MAX_SEARCH_TERMS} termos separados por espaço, ` +
      'todos obrigatórios; "%" e "_" valem como texto.',
    example: 'provadores tijuca',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @NotContains('\u0000')
  search?: string

  @ApiPropertyOptional({ example: 'CLI-001' })
  @IsOptional()
  @IsString()
  clientId?: string

  @ApiPropertyOptional({ example: 'LOJA-RJ-001', description: 'Uma loja só, pelo id exato' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  storeId?: string

  @ApiPropertyOptional({
    enum: STORE_STATUSES,
    isArray: true,
    description: 'Um ou mais status, separados por vírgula',
  })
  @IsOptional()
  @Transform(toList)
  @IsIn(STORE_STATUSES, { each: true })
  status?: StoreStatus[]

  @ApiPropertyOptional({
    type: Boolean,
    description: `Só lojas com algum ambiente abaixo da meta de conforto (${COMFORT_TARGET_PCT}%) no período`,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  belowTarget?: boolean

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Só lojas com algum ambiente aberto fora da faixa agora',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  outOfRange?: boolean

  @ApiPropertyOptional({
    enum: STORE_SORTS,
    default: 'status',
    description:
      'status: mais grave primeiro; comfort: pior conforto primeiro; comfort_desc: melhor primeiro; ' +
      'out_of_range: mais ambientes fora da faixa agora; worst_env: pior ambiente primeiro; name: alfabética. ' +
      'Empates saem sempre na mesma ordem (nome e id), então a paginação não repete nem pula lojas.',
  })
  @IsOptional()
  @IsIn(STORE_SORTS)
  sort: StoreSort = 'status'

  @ApiPropertyOptional({
    type: 'integer',
    default: 1,
    minimum: 1,
    description: 'Página além da última devolve a última',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @ApiPropertyOptional({ type: 'integer', default: 20, minimum: 1, maximum: 100 })
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

export class WorstEnvironmentDto implements WorstEnvironment {
  @ApiProperty({ example: 'AMB-003' }) id: string
  @ApiProperty({ example: 'Provadores' }) name: string
  @ApiProperty({ example: 'LOJA-RJ-001' }) storeId: string
  @ApiProperty({ example: 'Loja Tijuca' }) storeName: string
  @ApiProperty({ example: 0.3 }) comfortPct: number
}

export class EnvironmentListItemDto implements EnvironmentListItem {
  @ApiProperty({ example: 'AMB-001' }) id: string
  @ApiProperty({ example: 'Salão de vendas - Vitrine' }) name: string
  @ApiProperty({ type: String, nullable: true, example: 'IOT001' }) deviceId: string | null
  @ApiProperty({ enum: DEVICE_STATUSES }) status: DeviceStatus
  @ApiProperty({
    enum: SITUATIONS,
    description: 'Situação agora: dentro, acima ou abaixo da faixa, fora do horário ou desconhecida',
  })
  situation: Situation
  @ApiProperty({ type: Number, nullable: true, example: 23.4, description: 'Última leitura válida, °C' })
  lastValue: number | null
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) lastValidAt: string | null
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) lastContactAt: string | null
  @ApiProperty({ type: ComfortRangeDto }) comfortRange: ComfortRangeDto
  @ApiProperty({
    type: Number,
    nullable: true,
    description: '% do horário de funcionamento com leitura válida dentro da faixa no período',
  })
  comfortPct: number | null
  @ApiProperty({ type: Number, nullable: true, description: '% acima da faixa (mesmo denominador)' })
  abovePct: number | null
  @ApiProperty({ type: Number, nullable: true, description: '% abaixo da faixa (mesmo denominador)' })
  belowPct: number | null
  @ApiProperty({
    type: Number,
    nullable: true,
    description: '% do horário de funcionamento com leitura válida',
  })
  coveragePct: number | null
  @ApiProperty({ description: 'No horário de funcionamento agora' }) openNow: boolean
  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'Próxima abertura, quando fechado agora',
  })
  nextOpenAt: string | null
}

export class StoreEnvironmentCountsDto implements StoreEnvironmentCounts {
  @ApiProperty({ type: 'integer' }) total: number
  @ApiProperty({ type: 'integer' }) online: number
  @ApiProperty({ type: 'integer' }) sensorFault: number
  @ApiProperty({ type: 'integer' }) offline: number
  @ApiProperty({ type: 'integer' }) noData: number
  @ApiProperty({ type: 'integer', description: 'Ambientes abertos agora fora da faixa (acima + abaixo)' })
  outOfRange: number
  @ApiProperty({ type: 'integer' }) above: number
  @ApiProperty({ type: 'integer' }) below: number
  @ApiProperty({
    type: 'integer',
    description: `Ambientes com conforto no período abaixo da meta (${COMFORT_TARGET_PCT}%)`,
  })
  belowTarget: number
  @ApiProperty({ type: 'integer', description: 'Ambientes no horário de funcionamento agora' })
  openNow: number
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
  @ApiProperty({ example: 'America/Sao_Paulo' }) timezone: string
  @ApiProperty({ type: ClientRefDto }) client: ClientRefDto
  @ApiProperty({ enum: STORE_STATUSES }) status: StoreStatus
  @ApiProperty({ type: StoreEnvironmentCountsDto }) environmentCounts: StoreEnvironmentCountsDto
  @ApiProperty({ type: Number, nullable: true, description: 'Ponderado pelo tempo de todos os ambientes' })
  comfortPct: number | null
  @ApiProperty({ type: Number, nullable: true }) abovePct: number | null
  @ApiProperty({ type: Number, nullable: true }) belowPct: number | null
  @ApiProperty({ type: Number, nullable: true }) coveragePct: number | null
  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'Próxima abertura, quando todos os ambientes estão fechados agora',
  })
  nextOpenAt: string | null
  @ApiProperty({ type: WorstEnvironmentDto, nullable: true }) worstEnvironment: WorstEnvironmentDto | null
  @ApiProperty({ type: [EnvironmentListItemDto] }) environments: EnvironmentListItemDto[]
}

export class PeriodDto implements Period {
  @ApiProperty({ enum: PERIOD_KEYS, nullable: true, description: 'Nulo em intervalo personalizado' })
  key: PeriodKey | null
  @ApiProperty({ format: 'date-time' }) from: string
  @ApiProperty({ format: 'date-time' }) to: string
}

export class NetworkTotalsDto implements NetworkTotals {
  @ApiProperty({ type: 'integer' }) stores: number
  @ApiProperty({ type: 'integer' }) environments: number
  @ApiProperty({ type: 'integer' }) online: number
  @ApiProperty({ type: 'integer' }) sensorFault: number
  @ApiProperty({ type: 'integer' }) offline: number
  @ApiProperty({ type: 'integer' }) noData: number
  @ApiProperty({ type: 'integer' }) outOfRange: number
  @ApiProperty({ type: 'integer' }) above: number
  @ApiProperty({ type: 'integer' }) below: number
  @ApiProperty({ type: 'integer' }) belowTarget: number
  @ApiProperty({ type: 'integer' }) openNow: number
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Ponderado pelo tempo: leituras válidas dentro da faixa sobre as leituras válidas no horário, somadas em todos os ambientes',
  })
  comfortPct: number | null
  @ApiProperty({ type: Number, nullable: true }) abovePct: number | null
  @ApiProperty({ type: Number, nullable: true }) belowPct: number | null
  @ApiProperty({ type: Number, nullable: true }) coveragePct: number | null
  @ApiProperty({
    type: WorstEnvironmentDto,
    nullable: true,
    description: 'Pior ambiente com conforto definido entre as lojas do filtro',
  })
  worstEnvironment: WorstEnvironmentDto | null
}

export class StoreStatusFacetsDto implements Record<StoreStatus, number> {
  @ApiProperty({ type: 'integer' }) online: number
  @ApiProperty({ type: 'integer' }) degraded: number
  @ApiProperty({ type: 'integer' }) offline: number
  @ApiProperty({ type: 'integer' }) no_data: number
}

export class StoreFacetsDto implements StoreFacets {
  @ApiProperty({ type: StoreStatusFacetsDto }) status: StoreStatusFacetsDto
  @ApiProperty({ type: 'integer' }) belowTarget: number
  @ApiProperty({ type: 'integer' }) outOfRange: number
}

export class StoreListDto implements StoreList {
  @ApiProperty({ type: [StoreListItemDto] }) items: StoreListItemDto[]
  @ApiProperty({ type: 'integer', description: 'Página devolvida (a última, se a pedida passou do fim)' })
  page: number
  @ApiProperty({ type: 'integer' }) pageSize: number
  @ApiProperty({ type: 'integer' }) total: number
  @ApiProperty({
    type: NetworkTotalsDto,
    description: 'Totais de todas as lojas do filtro, não só da página',
  })
  totals: NetworkTotalsDto
  @ApiProperty({
    type: StoreFacetsDto,
    description:
      'Lojas por filtro, com a busca e o cliente aplicados e sem os filtros de status, meta e faixa',
  })
  facets: StoreFacetsDto
  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description: '"Agora": horário do último pacote processado',
  })
  now: string | null
  @ApiProperty({ type: PeriodDto }) period: PeriodDto
}

export class ClientListItemDto extends ClientRefDto implements ClientListItem {
  @ApiProperty({ type: 'integer' }) stores: number
}
