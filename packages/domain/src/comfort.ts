export interface ComfortRange {
  min: number
  max: number
}

export type ComfortLevel = -1 | 0 | 1

/** Limites inclusivos: 25,0 °C numa faixa de 21 a 25 está dentro. */
export function comfortLevel(value: number, range: ComfortRange): ComfortLevel {
  if (value < range.min) return -1
  if (value > range.max) return 1
  return 0
}

/** Meta de conforto: abaixo dela o ambiente aparece como ponto de atenção na visão da rede. */
export const COMFORT_TARGET_PCT = 90

/** Intervalo nominal entre amostras, usado para estimar quantas amostras eram esperadas no horário. */
export const EXPECTED_SAMPLING_MS = 30_000

export interface ComfortCounts {
  /** Amostras válidas dentro do horário de funcionamento */
  inHours: number
  within: number
  above: number
  below: number
  /** Amostras esperadas no horário de funcionamento do período */
  expected: number
}

export interface ComfortIndicator {
  /** Percentual do tempo de funcionamento com dado dentro da faixa */
  comfortPct: number | null
  abovePct: number | null
  belowPct: number | null
  /** Percentual do horário de funcionamento coberto por leituras válidas */
  coveragePct: number | null
}

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 10_000) / 100 : null)

/**
 * O percentual de conforto considera só o tempo com leitura válida: lacunas não contam como
 * dentro nem fora da faixa, e aparecem à parte na cobertura.
 */
export function comfortIndicator(counts: ComfortCounts): ComfortIndicator {
  return {
    comfortPct: pct(counts.within, counts.inHours),
    abovePct: pct(counts.above, counts.inHours),
    belowPct: pct(counts.below, counts.inHours),
    coveragePct: counts.expected > 0 ? Math.min(100, pct(counts.inHours, counts.expected) ?? 0) : null,
  }
}

export function sumCounts(items: readonly ComfortCounts[]): ComfortCounts {
  return items.reduce<ComfortCounts>(
    (total, item) => ({
      inHours: total.inHours + item.inHours,
      within: total.within + item.within,
      above: total.above + item.above,
      below: total.below + item.below,
      expected: total.expected + item.expected,
    }),
    { inHours: 0, within: 0, above: 0, below: 0, expected: 0 },
  )
}
