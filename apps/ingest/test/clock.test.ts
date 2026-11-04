import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestEnvironment, expected, type TestEnvironment } from './support'

// O fixture com três pacotes a mais: dois de dispositivos cadastrados com relógio adiantado e um de
// dispositivo fora do cadastro em 2031. Nenhum deles pode mexer no "agora" nem na série.
const parses = (line: string) => {
  try {
    JSON.parse(line)
    return true
  } catch {
    return false
  }
}
const sameLocalTimeWithGmt = (line: string, gmt: number) => JSON.stringify({ ...JSON.parse(line), GMT: gmt })
const packet = (deviceId: string, timestamp: string) =>
  JSON.stringify({
    dev_id: deviceId,
    timestamp,
    GMT: -3,
    samplingTime: 30,
    Temperature: Array<number>(12).fill(23),
  })

let env: TestEnvironment
const one = async <T extends Record<string, unknown>>(sql: string) =>
  (await env.pool.query<T>(sql)).rows[0] as T

beforeAll(async () => {
  env = await createTestEnvironment({
    telemetry: (lines) => {
      const devC = lines.findIndex((line, index) => index > 700 && line.includes('"DEV-C"') && parses(line))
      return [
        ...lines.slice(0, devC + 1),
        // GMT -6 no lugar de -3: o mesmo horário local, 3 h à frente em UTC
        sameLocalTimeWithGmt(lines[devC] as string, -6),
        ...lines.slice(devC + 1, 900),
        packet('DEV-X', '2031-01-01T00:00:00'),
        ...lines.slice(900),
        packet('DEV-A', '2026-03-05T00:00:00'),
      ]
    },
  })
  await env.replay()
}, 120_000)

afterAll(async () => {
  await env?.cleanup()
})

describe('pacotes com relógio adiantado', () => {
  test('o "agora" termina no mesmo horário do fixture original', async () => {
    const row = await one<{ now_ts: Date; last_seq: number }>('SELECT now_ts, last_seq FROM state.ingestion')
    expect(row.now_ts.toISOString()).toBe(expected.now)
    expect(row.last_seq).toBe(expected.lines + 3)
  })

  test('a série tem exatamente as amostras do fixture original', async () => {
    const totalPackets = Object.values(expected.devices).reduce((sum, count) => sum + count, 0)
    const row = await one<{ count: number }>('SELECT count(*) AS count FROM telemetry.reading')
    expect(row.count).toBe(totalPackets * 12)
  })

  test('os pacotes adiantados ficam no cru com o erro timestamp_futuro', async () => {
    const result = await env.clickhouse.query({
      query: `SELECT device_id FROM raw.telemetry_packet FINAL
              WHERE source = {source:String} AND error = 'timestamp_futuro' ORDER BY seq`,
      query_params: { source: env.source },
      format: 'JSONEachRow',
    })
    expect(await result.json<{ device_id: string }>()).toEqual([
      { device_id: 'DEV-C' },
      { device_id: 'DEV-A' },
    ])
  })

  test('o relatório de qualidade lista os pacotes adiantados à parte das linhas inválidas', async () => {
    const report = await env.qualityReport()
    expect(report.packets.invalid).toBe(expected.invalidLines)
    expect(report.packets.futureTimestamp.packets).toBe(2)
    expect(report.packets.futureTimestamp.devices).toEqual([
      expect.objectContaining({
        deviceId: 'DEV-A',
        environmentId: 'AMB-T1',
        packets: 1,
        from: '2026-03-05T03:00:00.000Z',
      }),
      expect.objectContaining({ deviceId: 'DEV-C', environmentId: 'AMB-T3', packets: 1 }),
    ])
    expect(report.packets.late.withSavedData).toBe(expected.savedDataPackets)
    expect(report.devices.unknown).toEqual([
      expect.objectContaining({ deviceId: 'DEV-X', packets: expected.unknownDevicePackets + 1 }),
    ])
    expect(report.stuckEpisodes).toEqual([
      expect.objectContaining({ deviceId: 'DEV-A', samples: expected.stuckSamples }),
    ])
  })

  test('os status no fim são os mesmos do fixture original', async () => {
    const { rows } = await env.pool.query<{ environment_id: string; status: string }>(
      'SELECT environment_id, status FROM state.environment_snapshot',
    )
    expect(Object.fromEntries(rows.map((row) => [row.environment_id, row.status]))).toEqual({
      'AMB-T1': 'online',
      'AMB-T2': 'offline',
      'AMB-T3': 'online',
    })
  })
})
