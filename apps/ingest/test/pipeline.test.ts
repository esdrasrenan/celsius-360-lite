import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Quality } from '@celsius/domain'
import { createTestEnvironment, expected, type TestEnvironment } from './support'

let env: TestEnvironment

const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await env.pool.query<T>(sql, params)).rows[0] as T
const rawCount = async () => {
  const result = await env.clickhouse.query({
    query: `SELECT count() AS total, countIf(NOT valid) AS invalid FROM raw.telemetry_packet FINAL
            WHERE source = {source:String}`,
    query_params: { source: env.source },
    format: 'JSONEachRow',
  })
  const [row] = await result.json<{ total: string; invalid: string }>()
  return { total: Number(row?.total), invalid: Number(row?.invalid) }
}
const fingerprint = () =>
  one<{ readings: number; checksum: number; buckets: number; samples: number }>(
    `SELECT (SELECT count(*) FROM telemetry.reading) AS readings,
       (SELECT sum(value::numeric * 10 + quality) FROM telemetry.reading) AS checksum,
       (SELECT count(*) FROM telemetry.reading_5m) AS buckets,
       (SELECT sum(samples) FROM telemetry.reading_1h) AS samples`,
  )

beforeAll(async () => {
  env = await createTestEnvironment()
  await env.replay()
}, 120_000)

afterAll(async () => {
  await env?.cleanup()
})

describe('ingestão da telemetria', () => {
  test('guarda no cru todas as linhas, inclusive a corrompida, na ordem de chegada', async () => {
    expect(await rawCount()).toEqual({ total: expected.lines, invalid: expected.invalidLines })
  })

  test('a série tratada tem uma amostra por dispositivo e instante, sem as duplicatas', async () => {
    const totalPackets = Object.values(expected.devices).reduce((sum, count) => sum + count, 0)
    const row = await one<{ count: number }>('SELECT count(*) AS count FROM telemetry.reading')
    expect(row.count).toBe(totalPackets * 12)
  })

  test('classifica erros do sensor e sensor travado', async () => {
    const counts = Object.fromEntries(
      (
        await env.pool.query<{ quality: number; count: number }>(
          'SELECT quality, count(*) AS count FROM telemetry.reading GROUP BY quality',
        )
      ).rows.map((row) => [row.quality, row.count]),
    )
    expect(counts[Quality.SensorError]).toBe(expected.sensorErrorSamples)
    expect(counts[Quality.Stuck]).toBe(expected.stuckSamples)
    expect(counts[Quality.Spike]).toBeUndefined()
  })

  test('dispositivo fora do cadastro vai para quarentena e não entra na série', async () => {
    const unknown = await one<{ device_id: string }>('SELECT device_id FROM state.unknown_device')
    expect(unknown.device_id).toBe('DEV-X')
    const readings = await one<{ count: number }>(
      "SELECT count(*) AS count FROM telemetry.reading WHERE device_id = 'DEV-X'",
    )
    expect(readings.count).toBe(0)
  })

  test('"agora" é o horário do último pacote processado', async () => {
    const row = await one<{ now_ts: Date; last_seq: number }>('SELECT now_ts, last_seq FROM state.ingestion')
    expect(row.now_ts.toISOString()).toBe(expected.now)
    expect(row.last_seq).toBe(expected.lines)
  })

  test('pacotes atrasados (saved_data) preenchem a lacuna no lugar certo', async () => {
    const row = await one<{ count: number }>(
      `SELECT count(*) AS count FROM telemetry.reading
       WHERE device_id = 'DEV-C' AND ts >= '2026-03-03T11:00:00Z' AND ts < '2026-03-03T12:00:00Z'`,
    )
    expect(row.count).toBe(120)
  })

  test('status no fim: o dispositivo desligado fica offline e a loja dele, parcial', async () => {
    const statuses = Object.fromEntries(
      (
        await env.pool.query<{ environment_id: string; status: string }>(
          'SELECT environment_id, status FROM state.environment_snapshot',
        )
      ).rows.map((row) => [row.environment_id, row.status]),
    )
    expect(statuses).toEqual({ 'AMB-T1': 'online', 'AMB-T2': 'offline', 'AMB-T3': 'online' })
    const store = await one<{ status: string }>(
      "SELECT status FROM state.store_snapshot WHERE store_id = 'LOJA-T-SP' AND period = '1d'",
    )
    expect(store.status).toBe('degraded')
  })

  test('os agregados contínuos contam as mesmas amostras da série', async () => {
    const { readings, samples } = await fingerprint()
    expect(samples).toBe(readings)
  })

  test('reprocessar desde o início não duplica nem altera nada', async () => {
    const before = await fingerprint()
    const raw = await rawCount()
    await env.replay({ fromStart: true })
    expect(await fingerprint()).toEqual(before)
    expect(await rawCount()).toEqual(raw)
  }, 120_000)

  test('rodar de novo retoma do checkpoint e não processa nada', async () => {
    const summary = await env.replay()
    expect(summary.packets).toBe(0)
  })

  test('relatório de qualidade descreve o que foi encontrado no cru', async () => {
    const report = await env.qualityReport()
    expect(report.packets.exactDuplicates).toBe(expected.exactDuplicates)
    expect(report.packets.invalid).toBe(expected.invalidLines)
    expect(report.packets.savedData).toBe(expected.savedDataPackets)
    expect(report.packets.late.withSavedData).toBe(expected.savedDataPackets)
    expect(report.devices.unknown).toEqual([
      expect.objectContaining({ deviceId: 'DEV-X', packets: expected.unknownDevicePackets }),
    ])
    expect(report.stuckEpisodes).toHaveLength(1)
    expect(report.stuckEpisodes[0]).toMatchObject({ deviceId: 'DEV-A', value: 22.4 })
    expect(report.gaps.map((gap) => gap.deviceId)).toEqual(['DEV-B', 'DEV-B'])
  })

  test('duplicata exata não conta duas vezes o código de erro nem o reinício', async () => {
    // Os pacotes com o -127 do DEV-A e os que começam com o 85 do reinício do DEV-B chegam duas vezes
    const repeated = (line: string) => line.includes(',-127,') || line.includes('"Temperature":[85,')
    let reboots = 0
    const twice = await createTestEnvironment({
      telemetry: (lines) => {
        reboots = lines.filter((line) => line.includes('"Temperature":[85,')).length
        return lines.flatMap((line) => (repeated(line) ? [line, line] : [line]))
      },
    })
    try {
      await twice.replay()
      const report = await twice.qualityReport()
      expect(report.packets.exactDuplicates).toBe(expected.exactDuplicates + reboots + 1)
      const { sensorError, rawErrorCodes } = report.samples
      expect(sensorError).toBe(expected.sensorErrorSamples)
      expect(rawErrorCodes).toEqual({ minus127: 1, plus85: reboots })
      expect(rawErrorCodes.minus127 + rawErrorCodes.plus85).toBe(sensorError)
      expect(report.devices.reboots).toBe(reboots)
    } finally {
      await twice.cleanup()
    }
  }, 120_000)
})
