/**
 * Contador de tentativas por chave, em janela fixa que começa na primeira tentativa. As entradas
 * vencidas saem a cada registro; como a janela é igual para todas, o Map fica em ordem de
 * vencimento e a limpeza para na primeira entrada ainda válida.
 */
export class AttemptLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Milissegundos até a chave poder tentar de novo; 0 se ainda não atingiu o limite. */
  retryAfterMs(key: string, now = Date.now()): number {
    const entry = this.entries.get(key)
    return entry && entry.resetAt > now && entry.count >= this.limit ? entry.resetAt - now : 0
  }

  hit(key: string, now = Date.now()): void {
    this.sweep(now)
    const entry = this.entries.get(key)
    if (entry) entry.count++
    else this.entries.set(key, { count: 1, resetAt: now + this.windowMs })
  }

  reset(key: string): void {
    this.entries.delete(key)
  }

  get size(): number {
    return this.entries.size
  }

  private sweep(now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt > now) break
      this.entries.delete(key)
    }
  }
}
