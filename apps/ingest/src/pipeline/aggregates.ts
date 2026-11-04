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

  async flush(): Promise<void> {
    const range = this.pending
    if (!range) return
    const from = Math.floor(range.from / HOUR_MS) * HOUR_MS
    const to = Math.ceil((range.to + 1) / HOUR_MS) * HOUR_MS
    this.pending = null
    try {
      for (const view of CONTINUOUS_AGGREGATES) {
        await this.pool.query(
          'CALL refresh_continuous_aggregate($1::regclass, $2::timestamptz, $3::timestamptz)',
          [view, new Date(from).toISOString(), new Date(to).toISOString()],
        )
      }
    } catch (error) {
      // O trecho volta para a fila: a próxima tentativa o atualiza junto com o que chegar
      this.mark(range)
      throw error
    }
  }

  /**
   * Atualiza tudo o que o TimescaleDB marcou como invalidado e ainda não foi materializado. O trecho
   * pendente só existe em memória: se o processo cai entre a gravação do lote (que já avançou o
   * checkpoint) e a atualização, a retomada não sabe dele, e a atualização seguinte passaria a marca
   * d'água por cima, deixando um buraco permanente. Sem invalidação pendente, custa quase nada.
   */
  async catchUp(): Promise<void> {
    for (const view of CONTINUOUS_AGGREGATES) {
      await this.pool.query('CALL refresh_continuous_aggregate($1::regclass, NULL, NULL)', [view])
    }
  }
}
