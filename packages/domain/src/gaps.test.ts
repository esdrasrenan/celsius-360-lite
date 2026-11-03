import { describe, expect, test } from 'bun:test'
import { type BucketCounts, findGaps } from './gaps'
import { BUCKET_MS, chooseBucket, periodRange } from './period'

const FIVE = BUCKET_MS['5m']
const row = (bucket: number, overrides: Partial<BucketCounts> = {}): BucketCounts => ({
  bucket,
  samples: 10,
  samplesOk: 10,
  sensorError: 0,
  outOfRange: 0,
  spike: 0,
  stuck: 0,
  ...overrides,
})

describe('findGaps', () => {
  test('sem nenhum dado, o intervalo inteiro é lacuna', () => {
    expect(findGaps([], 0, 6 * FIVE, FIVE)).toEqual([
      { from: 0, to: 6 * FIVE, kind: 'no_data', reason: null },
    ])
  })

  test('junta buckets vizinhos sem dados e ignora falha de um bucket só', () => {
    const rows = [row(0), row(2 * FIVE), row(3 * FIVE), row(7 * FIVE)]
    expect(findGaps(rows, 0, 8 * FIVE, FIVE)).toEqual([
      { from: 4 * FIVE, to: 7 * FIVE, kind: 'no_data', reason: null },
    ])
  })

  test('pacote sem leitura válida vira indisponibilidade com o motivo predominante', () => {
    const rows = [
      row(0),
      row(FIVE, { samplesOk: 0, stuck: 10 }),
      row(2 * FIVE, { samplesOk: 0, stuck: 9, sensorError: 1 }),
      row(3 * FIVE),
    ]
    expect(findGaps(rows, 0, 4 * FIVE, FIVE)).toEqual([
      { from: FIVE, to: 3 * FIVE, kind: 'invalid', reason: 'stuck' },
    ])
  })

  test('recorta a lacuna nas bordas do intervalo pedido', () => {
    expect(findGaps([], 1000, 3 * FIVE, FIVE)).toEqual([
      { from: 1000, to: 3 * FIVE, kind: 'no_data', reason: null },
    ])
  })
})

describe('periodRange e chooseBucket', () => {
  const now = Date.parse('2026-02-11T02:59:56Z')

  test('o último dia termina na borda seguinte de 5 minutos', () => {
    const { from, to } = periodRange('1d', now)
    expect(new Date(to).toISOString()).toBe('2026-02-11T03:00:00.000Z')
    expect(to - from).toBe(24 * 3_600_000)
  })

  test('30 dias usa buckets de 1 hora', () => {
    const { from, to } = periodRange('30d', now)
    expect(new Date(from).toISOString()).toBe('2026-01-12T03:00:00.000Z')
    expect(chooseBucket(from, to)).toBe('1h')
  })

  test('a agregação acompanha o tamanho do intervalo', () => {
    const hour = 3_600_000
    expect(chooseBucket(0, 6 * hour)).toBe('raw')
    expect(chooseBucket(0, 24 * hour)).toBe('5m')
    expect(chooseBucket(0, 7 * 24 * hour)).toBe('15m')
    expect(chooseBucket(0, 30 * 24 * hour)).toBe('1h')
  })
})
