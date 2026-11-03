import { PERIOD_KEYS, type PeriodKey, periodRange } from '@celsius/domain'
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsISO8601, IsOptional } from 'class-validator'
import type pg from 'pg'
import { PG_POOL } from '../database/database.module'

const MAX_RANGE_MS = 92 * 86_400_000

export class RangeQueryDto {
  @ApiPropertyOptional({ enum: PERIOD_KEYS, default: '1d', description: 'Período terminando em "agora"' })
  @IsOptional()
  @IsIn(PERIOD_KEYS)
  period?: PeriodKey

  @ApiPropertyOptional({ description: 'Início do intervalo (ISO 8601). Junto com "to", substitui o período' })
  @IsOptional()
  @IsISO8601()
  from?: string

  @ApiPropertyOptional({ description: 'Fim do intervalo (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  to?: string
}

export interface ResolvedRange {
  period: PeriodKey | null
  from: number
  to: number
}

export function resolveRange(query: RangeQueryDto, now: number): ResolvedRange {
  if (query.from || query.to) {
    if (!query.from || !query.to) throw new BadRequestException('Informe "from" e "to" juntos')
    const from = Date.parse(query.from)
    const to = Date.parse(query.to)
    if (to <= from) throw new BadRequestException('"to" precisa ser depois de "from"')
    if (to - from > MAX_RANGE_MS) throw new BadRequestException('Intervalo máximo de 92 dias')
    return { period: null, from, to }
  }
  const period = query.period ?? '1d'
  return { period, ...periodRange(period, now) }
}

/**
 * "Agora" do sistema: o horário do último pacote processado pela ingestão (regra do desafio).
 * Status e períodos usam esta referência, nunca o relógio do servidor.
 */
@Injectable()
export class NowService {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async current(): Promise<number | null> {
    const { rows } = await this.pool.query<{ now: Date | null }>(
      'SELECT max(now_ts) AS now FROM state.ingestion',
    )
    return rows[0]?.now?.getTime() ?? null
  }
}

export const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString())
