import { describe, expect, test } from 'bun:test'
import {
  type ClassifiedSample,
  classifyValue,
  markSpikes,
  Quality,
  type QualityCode,
  StuckDetector,
} from './quality'

describe('classifyValue', () => {
  test('reconhece os códigos de erro do sensor', () => {
    expect(classifyValue(-127)).toBe(Quality.SensorError)
    expect(classifyValue(85)).toBe(Quality.SensorError)
  })

  test('descarta valores fisicamente impossíveis para um ambiente interno', () => {
    expect(classifyValue(70)).toBe(Quality.OutOfRange)
    expect(classifyValue(-30)).toBe(Quality.OutOfRange)
  })

  test('aceita valores plausíveis, inclusive extremos de uma sala sem climatização', () => {
    expect(classifyValue(23.4)).toBe(Quality.Ok)
    expect(classifyValue(38.5)).toBe(Quality.Ok)
  })
})

describe('markSpikes', () => {
  const run = (values: number[], previous?: number) => {
    const qualities: QualityCode[] = values.map(classifyValue)
    markSpikes(values, qualities, previous)
    return qualities
  }

  test('marca a amostra que destoa das duas vizinhas para o mesmo lado', () => {
    expect(run([22, 22.1, 29, 22.1, 22])).toEqual([0, 0, Quality.Spike, 0, 0])
  })

  test('não confunde degrau (mudança que permanece) com pico', () => {
    expect(run([22.8, 22.8, 26.7, 26.5, 26.6])).toEqual([0, 0, 0, 0, 0])
  })

  test('usa a última amostra do pacote anterior como vizinha da primeira', () => {
    expect(run([29, 22, 22], 22)).toEqual([Quality.Spike, 0, 0])
    expect(run([29, 22, 22])).toEqual([0, 0, 0])
  })

  test('ignora amostras com erro do sensor ao procurar vizinhas', () => {
    expect(run([22, -127, 22.1, 22])).toEqual([0, Quality.SensorError, 0, 0])
  })
})

describe('StuckDetector', () => {
  const minute = 60_000
  const series = (start: number, minutes: number, value: number): ClassifiedSample[] =>
    Array.from({ length: minutes * 2 }, (_, index) => ({
      ts: start + index * 30_000,
      value,
      quality: Quality.Ok,
    }))

  test('marca a sequência inteira quando o valor fica idêntico por 60 minutos', () => {
    const detector = new StuckDetector()
    const samples = series(0, 61, 22.8)
    expect(detector.observe('IOT014', samples)).toBeNull()
    expect(samples.every((sample) => sample.quality === Quality.Stuck)).toBe(true)
  })

  test('devolve o trecho de lotes anteriores que precisa ser remarcado no banco', () => {
    const detector = new StuckDetector()
    const first = series(0, 40, 23.2)
    const second = series(40 * minute, 30, 23.2)
    expect(detector.observe('IOT009', first)).toBeNull()
    const retro = detector.observe('IOT009', second)
    expect(retro).toEqual({ deviceId: 'IOT009', from: 0, to: 40 * minute - 1, value: 23.2 })
    expect(second.every((sample) => sample.quality === Quality.Stuck)).toBe(true)
  })

  test('valor que oscila não é sensor travado', () => {
    const detector = new StuckDetector()
    const samples = series(0, 120, 22).map((sample, index) => ({ ...sample, value: index % 2 ? 22.1 : 22 }))
    detector.observe('IOT001', samples)
    expect(samples.some((sample) => sample.quality === Quality.Stuck)).toBe(false)
  })

  test('uma lacuna longa interrompe a sequência', () => {
    const detector = new StuckDetector()
    detector.observe('IOT001', series(0, 40, 22))
    const after = series(60 * minute, 30, 22)
    expect(detector.observe('IOT001', after)).toBeNull()
    expect(after.some((sample) => sample.quality === Quality.Stuck)).toBe(false)
  })

  test('pacote repetido não interrompe a sequência em curso', () => {
    const detector = new StuckDetector()
    const first = series(0, 40, 22)
    detector.observe('IOT001', first)
    detector.observe('IOT001', series(30 * minute, 5, 22))
    const retro = detector.observe('IOT001', series(40 * minute, 25, 22))
    expect(retro?.from).toBe(0)
  })

  test('ao restaurar uma sequência já marcada, continua marcando sem remarcar o passado', () => {
    const detector = new StuckDetector()
    detector.restore('IOT009', { value: 23.2, startTs: 0, lastTs: 90 * minute })
    const next = series(90 * minute + 30_000, 5, 23.2)
    expect(detector.observe('IOT009', next)).toBeNull()
    expect(next.every((sample) => sample.quality === Quality.Stuck)).toBe(true)
  })
})
