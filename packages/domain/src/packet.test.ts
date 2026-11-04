import { describe, expect, test } from 'bun:test'
import { CLOCK_TOLERANCE_MS, expandSamples, FleetClock, localToUtc, parsePacketLine } from './packet'

const line = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    dev_id: 'IOT005',
    timestamp: '2026-01-12T00:05:31',
    GMT: -3,
    samplingTime: 30,
    Temperature: [25.7, 25.8, 25.7, 25.8, 25.8, 25.8, 25.8, 25.8, 25.8, 25.9, 25.8, 25.8],
    ...overrides,
  })

describe('parsePacketLine', () => {
  test('converte o horário local do pacote para UTC usando o campo GMT', () => {
    const parsed = parsePacketLine(line())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(new Date(parsed.sentAt).toISOString()).toBe('2026-01-12T03:05:31.000Z')
    expect(parsed.packet.saved_data).toBeUndefined()
  })

  test('aceita pacote marcado com saved_data', () => {
    const parsed = parsePacketLine(line({ saved_data: true }))
    expect(parsed.ok && parsed.packet.saved_data).toBe(true)
  })

  test('rejeita JSON malformado sem derrubar a ingestão', () => {
    expect(parsePacketLine('{"dev_id": "IOT001", ')).toEqual({
      ok: false,
      error: 'json_invalido',
      deviceId: null,
    })
  })

  test('rejeita pacote fora do esquema e preserva o dispositivo para diagnóstico', () => {
    expect(parsePacketLine(line({ Temperature: 'x' }))).toEqual({
      ok: false,
      error: 'esquema_invalido',
      deviceId: 'IOT005',
    })
    expect(parsePacketLine(line({ samplingTime: 0 })).ok).toBe(false)
    expect(parsePacketLine(line({ Temperature: [] })).ok).toBe(false)
  })

  test('rejeita data inexistente', () => {
    expect(parsePacketLine(line({ timestamp: '2026-02-30T10:00:00' }))).toMatchObject({
      ok: false,
      error: 'timestamp_invalido',
    })
  })
})

describe('localToUtc', () => {
  test('respeita fusos positivos e negativos', () => {
    expect(new Date(localToUtc('2026-01-12T12:00:00', 2)).toISOString()).toBe('2026-01-12T10:00:00.000Z')
    expect(new Date(localToUtc('2026-01-12T23:00:00', -3)).toISOString()).toBe('2026-01-13T02:00:00.000Z')
  })
})

describe('expandSamples', () => {
  test('a última amostra tem o horário do pacote e as anteriores recuam samplingTime', () => {
    const parsed = parsePacketLine(line())
    if (!parsed.ok) throw new Error('pacote de teste inválido')
    const samples = expandSamples(parsed.packet, parsed.sentAt)
    expect(samples).toHaveLength(12)
    expect(new Date(samples.at(-1)?.ts ?? 0).toISOString()).toBe('2026-01-12T03:05:31.000Z')
    expect(new Date(samples[0]?.ts ?? 0).toISOString()).toBe('2026-01-12T03:00:01.000Z')
    expect(samples[9]?.value).toBe(25.9)
  })
})

describe('FleetClock', () => {
  const t0 = Date.parse('2026-02-10T13:00:00Z')
  const minute = 60_000
  const running = () => {
    const clock = new FleetClock(3)
    clock.accept('IOT001', t0)
    clock.accept('IOT002', t0 + 10_000)
    return clock
  }

  test('o agora começa quando um segundo dispositivo confirma o horário', () => {
    const clock = new FleetClock(3)
    expect(clock.accept('IOT001', t0)).toBe(true)
    expect(clock.now).toBeNull()
    expect(clock.accept('IOT002', t0 + 10_000)).toBe(true)
    expect(clock.now).toBe(t0 + 10_000)
  })

  test('um dispositivo que envia sozinho confirma o próprio relógio no pacote seguinte', () => {
    const clock = new FleetClock(3)
    clock.accept('IOT001', t0)
    expect(clock.accept('IOT001', t0 + 6 * minute)).toBe(true)
    expect(clock.now).toBe(t0 + 6 * minute)
  })

  test('pacote até 10 min à frente avança o agora', () => {
    const clock = running()
    expect(clock.accept('IOT001', t0 + 10_000 + CLOCK_TOLERANCE_MS)).toBe(true)
    expect(clock.now).toBe(t0 + 10_000 + CLOCK_TOLERANCE_MS)
  })

  test('um relógio adiantado sozinho não move o agora, nem nos pacotes seguintes', () => {
    const clock = running()
    // GMT -6 no lugar de -3: o pacote chega 3 h à frente
    expect(clock.accept('IOT002', t0 + 3 * 60 * minute)).toBe(false)
    expect(clock.accept('IOT002', t0 + 3 * 60 * minute + 6 * minute)).toBe(false)
    expect(clock.accept('IOT001', t0 + 6 * minute)).toBe(true)
    expect(clock.now).toBe(t0 + 6 * minute)
  })

  test('a frota voltando de uma interrupção confirma o salto a partir do segundo dispositivo', () => {
    const clock = running()
    const back = t0 + 60 * minute
    expect(clock.accept('IOT001', back)).toBe(false)
    expect(clock.accept('IOT002', back + 20_000)).toBe(true)
    expect(clock.now).toBe(back + 20_000)
    expect(clock.accept('IOT001', back + 6 * minute)).toBe(true)
    expect(clock.accept('IOT003', back + 30_000)).toBe(true)
  })

  test('com um único dispositivo cadastrado vale o maior horário', () => {
    const clock = new FleetClock(1, t0)
    expect(clock.accept('IOT001', t0 + 60 * minute)).toBe(true)
    expect(clock.now).toBe(t0 + 60 * minute)
  })

  test('ao retomar, os horários já gravados confirmam saltos como antes', () => {
    const back = t0 + 60 * minute
    const clock = new FleetClock(3, t0, [['IOT001', back]])
    expect(clock.accept('IOT002', back + 20_000)).toBe(true)
  })
})
