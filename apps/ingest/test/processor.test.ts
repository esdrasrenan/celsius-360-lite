import { describe, expect, test } from 'bun:test'
import { compileSchedule, deviceStatus, type OpeningHours, Quality, WEEKDAYS } from '@celsius/domain'
import { type DeviceMemory, TelemetryProcessor } from '../src/pipeline/processor'
import type { EnvironmentContext } from '../src/registry'

const allDay = Object.fromEntries(WEEKDAYS.map((day) => [day, ['00:00', '24:00']])) as Record<
  keyof OpeningHours,
  [string, string]
>

const environment = (deviceId: string): EnvironmentContext => ({
  environmentId: `AMB-${deviceId}`,
  storeId: 'LOJA-1',
  clientId: 'CLI-1',
  deviceId,
  range: { min: 21, max: 25 },
  schedule: compileSchedule(allDay),
  timeZone: 'America/Sao_Paulo',
})

const t0 = Date.parse('2026-02-10T13:00:00Z')
const minute = 60_000

/** Pacote como o broker entrega: horário local no fuso GMT informado e 12 amostras de 30 s. */
function packet(deviceId: string, sentAt: number, values: number[] | number = 23, gmt = -3) {
  const local = new Date(sentAt + gmt * 3_600_000).toISOString().slice(0, 19)
  const temperature = Array.isArray(values) ? values : Array<number>(12).fill(values)
  return JSON.stringify({
    dev_id: deviceId,
    timestamp: local,
    GMT: gmt,
    samplingTime: 30,
    Temperature: temperature,
  })
}

function fleet(...deviceIds: string[]) {
  const devices = new Map<string, DeviceMemory>()
  const processor = new TelemetryProcessor('teste', deviceIds.map(environment), devices, null)
  let seq = 0
  const send = (line: string) => {
    processor.process({ seq: ++seq, line }, 0)
    return processor.drain()
  }
  return { processor, devices, send }
}

describe('"agora" da ingestão', () => {
  test('um pacote com GMT errado vai para o cru como timestamp_futuro e não move o agora', () => {
    const { processor, devices, send } = fleet('IOT001', 'IOT002')
    send(packet('IOT001', t0))
    send(packet('IOT002', t0 + 10_000))
    const before = devices.get('IOT002')

    // Horário local certo, mas com GMT -6 no lugar de -3: em UTC, o pacote fica 3 h à frente
    const batch = send(packet('IOT002', t0 + 6 * minute + 3 * 3_600_000, 23, -6))

    expect(processor.currentNow).toBe(t0 + 10_000)
    expect(batch.raw).toEqual([expect.objectContaining({ valid: false, error: 'timestamp_futuro' })])
    expect(batch.readings).toHaveLength(0)
    expect(batch.stats.future).toBe(1)
    expect(devices.get('IOT002')).toEqual(before)

    // Quem envia em seguida continua online
    send(packet('IOT001', t0 + 6 * minute))
    expect(deviceStatus(devices.get('IOT001') ?? null, processor.currentNow ?? 0)).toBe('online')
  })

  test('dispositivo fora do cadastro não move o agora, nem com horário de 2031', () => {
    const { processor, send } = fleet('IOT001', 'IOT002')
    send(packet('IOT001', t0))
    send(packet('IOT002', t0))
    const batch = send(packet('IOT099', Date.parse('2031-01-01T03:00:00Z')))
    expect(processor.currentNow).toBe(t0)
    expect(batch.unknownDevices.has('IOT099')).toBe(true)
  })

  test('quando a frota volta junta de uma interrupção, o salto é confirmado pelo segundo dispositivo', () => {
    const { processor, send } = fleet('IOT001', 'IOT002', 'IOT003')
    send(packet('IOT001', t0))
    send(packet('IOT002', t0))
    send(packet('IOT003', t0))
    const back = t0 + 90 * minute
    expect(send(packet('IOT001', back)).stats.future).toBe(1)
    expect(send(packet('IOT002', back + 5_000)).readings).toHaveLength(12)
    expect(send(packet('IOT003', back + 9_000)).readings).toHaveLength(12)
    expect(send(packet('IOT001', back + 6 * minute)).readings).toHaveLength(12)
    expect(processor.currentNow).toBe(back + 6 * minute)
  })
})

describe('sensor travado', () => {
  test('o dispositivo passa a falha no sensor no pacote em que o travamento é detectado', () => {
    const { processor, devices, send } = fleet('IOT014', 'IOT015')
    send(packet('IOT014', t0, 23.1))
    // 11 pacotes idênticos: a sequência atinge 60 min no último deles
    for (let index = 1; index <= 10; index++) {
      send(packet('IOT015', t0 + index * 6 * minute, 22 + (index % 2) / 10))
      const batch = send(packet('IOT014', t0 + index * 6 * minute, 22.8))
      expect(batch.validReset.size).toBe(0)
      expect(deviceStatus(devices.get('IOT014') ?? null, processor.currentNow ?? 0)).toBe('online')
    }
    send(packet('IOT015', t0 + 66 * minute, 22))
    const detected = send(packet('IOT014', t0 + 66 * minute, 22.8))

    expect(detected.readings.every((reading) => reading.quality === Quality.Stuck)).toBe(true)
    expect(detected.stuck).toHaveLength(1)
    expect(detected.validReset.has('IOT014')).toBe(true)
    const state = devices.get('IOT014')
    expect(state?.lastValidValue).toBe(23.1)
    expect(state?.lastValidAt).toBe(t0)
    expect(deviceStatus(state ?? null, processor.currentNow ?? 0)).toBe('sensor_fault')
  })

  test('quando o valor volta a variar, o dispositivo volta a online', () => {
    const { processor, devices, send } = fleet('IOT014')
    send(packet('IOT014', t0, 23.1))
    for (let index = 1; index <= 11; index++) send(packet('IOT014', t0 + index * 6 * minute, 22.8))
    expect(deviceStatus(devices.get('IOT014') ?? null, processor.currentNow ?? 0)).toBe('sensor_fault')

    const recovered = Array.from({ length: 12 }, (_, index) => 23 + index / 10)
    send(packet('IOT014', t0 + 72 * minute, recovered))
    expect(devices.get('IOT014')?.lastValidValue).toBe(24.1)
    expect(deviceStatus(devices.get('IOT014') ?? null, processor.currentNow ?? 0)).toBe('online')
  })
})
