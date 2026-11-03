import type pg from 'pg'

const HOUR_MS = 3_600_000

/** Ordem importa: cada agregado é calculado a partir do anterior. */
export const CONTINUOUS_AGGREGATES = [
  'telemetry.reading_5m',
  'telemetry.reading_15m',
  'telemetry.reading_1h',
] as const

/**
 * Acumula o intervalo de tempo tocado pelos lotes e atualiza os agregados contínuos só nesse trecho.
 * As políticas automáticas do TimescaleDB usam o relógio do servidor; como os dados são históricos
 * e "agora" é o horário do último pacote, a atualização é disparada pela própria ingestão.
 * Dados atrasados caem em buckets antigos e entram no mesmo mecanismo.
 */
export class AggregateRefresher {
  private pending: { from: number; to: number } | null = null

  constructor(private readonly pool: pg.Pool) {}

  mark(range: { from: number; to: number } | null) {
    if (!range) return
    this.pending = this.pending
      ? { from: Math.min(this.pending.from, range.from), to: Math.max(this.pending.to, range.to) }
      : { ...range }
  }

  get hasPending(): boolean {
    return this.pending !== null
  }

  async flush(): Promise<{ from: number; to: number } | null> {
    if (!this.pending) return null
    const from = Math.floor(this.pending.from / HOUR_MS) * HOUR_MS
    const to = Math.ceil((this.pending.to + 1) / HOUR_MS) * HOUR_MS
    this.pending = null
    for (const view of CONTINUOUS_AGGREGATES) {
      await this.pool.query(
        'CALL refresh_continuous_aggregate($1::regclass, $2::timestamptz, $3::timestamptz)',
        [view, new Date(from).toISOString(), new Date(to).toISOString()],
      )
    }
    return { from, to }
  }
}
