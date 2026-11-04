import { PERIOD_KEYS, type PeriodKey, periodRange } from '@celsius/domain'
import { Inject, Injectable } from '@nestjs/common'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, ValidateBy } from 'class-validator'
import type pg from 'pg'
import { PG_POOL } from '../database/database.module'
import { invalidField } from './problem.filter'

const MAX_RANGE_DAYS = 92
const INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/

/**
 * Epoch ms de um ISO 8601 com fuso explícito, ou null. Sem fuso, a mesma URL daria resultados
 * diferentes conforme o fuso do servidor; por isso o fuso é obrigatório.
 */
export function parseInstant(text: string): number | null {
  const match = INSTANT.exec(text)
  if (!match) return null
  const local = `${match[1]}:${match[2] ?? '00'}`
  // Date.parse normaliza 30/02 para 02/03; a volta pelo toISOString garante que a data existe
  const asUtc = Date.parse(`${local}Z`)
  if (!Number.isFinite(asUtc) || new Date(asUtc).toISOString().slice(0, 19) !== local) return null
  const instant = Date.parse(text)
  return Number.isFinite(instant) ? instant : null
}

const IsInstant = () =>
  ValidateBy({
    name: 'isInstant',
    validator: { validate: (value) => typeof value === 'string' && parseInstant(value) !== null },
  })

export class RangeQueryDto {
  @ApiPropertyOptional({ enum: PERIOD_KEYS, default: '1d', description: 'Período terminando em "agora"' })
  @IsOptional()
  @IsIn(PERIOD_KEYS)
  period?: PeriodKey

  @ApiPropertyOptional({
    description: `Início do intervalo, ISO 8601 com fuso (ex.: 2026-02-10T00:00:00-03:00). Junto com "to", substitui o período; até ${MAX_RANGE_DAYS} dias`,
  })
  @IsOptional()
  @IsInstant()
  from?: string

  @ApiPropertyOptional({
    description: 'Fim do intervalo, ISO 8601 com fuso (ex.: 2026-02-10T23:59:59-03:00)',
  })
  @IsOptional()
  @IsInstant()
  to?: string
}

export interface ResolvedRange {
  period: PeriodKey | null
  from: number
  to: number
}

/** Intervalo pedido em epoch ms. Lança 400 para qualquer entrada que não vire um intervalo válido. */
export function resolveRange(query: RangeQueryDto, now: number): ResolvedRange {
  if (query.from || query.to) {
    if (!query.from || !query.to) {
      throw invalidField(query.from ? 'to' : 'from', 'Informe o início (from) e o fim (to) juntos.')
    }
    const from = parseInstant(query.from)
    const to = parseInstant(query.to)
    if (from === null) throw invalidField('from', 'Início inválido: use ISO 8601 com fuso.')
    if (to === null) throw invalidField('to', 'Fim inválido: use ISO 8601 com fuso.')
    if (to <= from) throw invalidField('to', 'O fim (to) precisa ser depois do início (from).')
    if (to - from > MAX_RANGE_DAYS * 86_400_000) {
      throw invalidField('to', `O intervalo aceita no máximo ${MAX_RANGE_DAYS} dias.`)
    }
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
