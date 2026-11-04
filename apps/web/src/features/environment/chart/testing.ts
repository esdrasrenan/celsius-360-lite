import type { Series, SeriesPoint } from '@celsius/contracts'
import type { ChartTokens } from '../../../lib/chart-theme'
import type { ChartTheme } from './layers'

/**
 * Dados de teste do gráfico (só os testes importam este arquivo): dois dias de Recife (UTC−3) em
 * médias de 1 h, loja aberta das 10h às 22h, um pico acima da faixa, uma queda abaixo e uma lacuna
 * de sensor travado.
 */

export const TZ = 'America/Recife'
export const HOUR = 3_600_000
/** 09/02 00:00 em Recife. */
export const FROM = Date.parse('2026-02-09T03:00:00Z')

export const iso = (ms: number) => new Date(ms).toISOString()
/** Instante `hours` horas depois de 09/02 00:00 local. */
export const at = (hours: number) => FROM + hours * HOUR

const point = (hour: number, avg: number | null): SeriesPoint => ({
  t: iso(at(hour)),
  avg,
  min: avg == null ? null : avg - 0.5,
  max: avg == null ? null : avg + 0.5,
})

export function sampleSeries(overrides: Partial<Series> = {}): Series {
  const points = Array.from({ length: 48 }, (_, hour) => {
    const local = hour % 24
    if (hour === 37 || hour === 38) return point(hour, null) // 10/02 13h–15h: sensor travado
    if (hour === 15) return point(hour, 26.4) // 09/02 15h: acima
    if (hour === 42) return point(hour, 19.2) // 10/02 18h: abaixo
    return point(hour, local >= 10 && local < 22 ? 24 : 23)
  })
  return {
    bucket: '1h',
    from: iso(FROM),
    to: iso(at(48)),
    now: iso(at(48) - 60_000),
    comfortRange: { min: 21, max: 25 },
    points,
    outdoor: Array.from({ length: 48 }, (_, hour) => ({
      t: iso(at(hour)),
      value: hour % 24 >= 12 ? 31 : 28,
    })),
    gaps: [{ from: iso(at(37)), to: iso(at(39)), kind: 'discarded', reason: 'stuck' }],
    openIntervals: [
      { from: iso(at(10)), to: iso(at(22)) },
      { from: iso(at(34)), to: iso(at(46)) },
    ],
    ...overrides,
  }
}

/** Tema com o nome do token no lugar da cor: o teste confere qual token cada camada usa. */
export const theme: ChartTheme = {
  tokens: new Proxy({} as ChartTokens, { get: (_, key) => String(key) }),
  hatches: { semDados: 'hachura-sem-dados', descartada: 'hachura-descartada' },
}
