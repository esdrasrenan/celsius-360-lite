import { describe, expect, test } from 'bun:test'
import { comfortIndicator, comfortLevel, sumCounts } from './comfort'
import { deviceStatus, ONLINE_WINDOW_MS, situationNow, storeStatus } from './status'

const now = Date.parse('2026-02-11T02:59:56Z')
const range = { min: 21, max: 25 }

describe('deviceStatus', () => {
  test('nunca comunicou: sem dados', () => {
    expect(deviceStatus(null, now)).toBe('no_data')
  })

  test('online até 15 minutos sem contato, offline depois', () => {
    const within = now - ONLINE_WINDOW_MS
    expect(deviceStatus({ lastContactAt: within, lastValidAt: within }, now)).toBe('online')
    expect(deviceStatus({ lastContactAt: within - 1, lastValidAt: within - 1 }, now)).toBe('offline')
  })

  test('comunica mas sem leitura válida recente: falha de sensor', () => {
    expect(deviceStatus({ lastContactAt: now, lastValidAt: now - 2 * ONLINE_WINDOW_MS }, now)).toBe(
      'sensor_fault',
    )
    expect(deviceStatus({ lastContactAt: now, lastValidAt: null }, now)).toBe('sensor_fault')
  })
})

describe('situationNow', () => {
  test('fora do horário de funcionamento a faixa não se aplica', () => {
    expect(situationNow({ status: 'online', lastValue: 30, range, openNow: false })).toBe('closed')
  })

  test('compara a última leitura válida com a faixa', () => {
    expect(situationNow({ status: 'online', lastValue: 25, range, openNow: true })).toBe('within')
    expect(situationNow({ status: 'online', lastValue: 25.1, range, openNow: true })).toBe('above')
    expect(situationNow({ status: 'online', lastValue: 20.9, range, openNow: true })).toBe('below')
  })

  test('sem dispositivo online a situação é desconhecida', () => {
    expect(situationNow({ status: 'offline', lastValue: 22, range, openNow: true })).toBe('unknown')
  })
})

describe('storeStatus', () => {
  test('combina o status dos ambientes', () => {
    expect(storeStatus(['online', 'online'])).toBe('online')
    expect(storeStatus(['online', 'sensor_fault'])).toBe('degraded')
    expect(storeStatus(['online', 'offline'])).toBe('degraded')
    expect(storeStatus(['offline', 'no_data'])).toBe('offline')
    expect(storeStatus(['no_data', 'no_data'])).toBe('no_data')
    expect(storeStatus([])).toBe('no_data')
  })
})

describe('conforto', () => {
  test('limites da faixa são inclusivos', () => {
    expect(comfortLevel(21, range)).toBe(0)
    expect(comfortLevel(25, range)).toBe(0)
    expect(comfortLevel(20.9, range)).toBe(-1)
    expect(comfortLevel(25.1, range)).toBe(1)
  })

  test('percentual de conforto ignora lacunas e a cobertura mostra quanto do horário teve dado', () => {
    const indicator = comfortIndicator({ inHours: 800, within: 600, above: 150, below: 50, expected: 1000 })
    expect(indicator).toEqual({ comfortPct: 75, abovePct: 18.75, belowPct: 6.25, coveragePct: 80 })
  })

  test('sem amostras no horário não há percentual', () => {
    expect(comfortIndicator({ inHours: 0, within: 0, above: 0, below: 0, expected: 0 }).comfortPct).toBeNull()
  })

  test('o indicador da loja pondera os ambientes pelo tempo com leitura', () => {
    const store = sumCounts([
      { inHours: 100, within: 100, above: 0, below: 0, expected: 100 },
      { inHours: 300, within: 0, above: 0, below: 300, expected: 300 },
    ])
    expect(comfortIndicator(store).comfortPct).toBe(25)
  })
})
