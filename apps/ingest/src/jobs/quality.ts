import { BUCKET_MS, CLOCK_TOLERANCE_MS, findGaps, Quality } from '@celsius/domain'
import type { ClickHouseClient } from '@clickhouse/client'
import type pg from 'pg'
import type { Logger } from '../infra'
import { SYNTHETIC_CLIENT_ID } from '../registry'

const LATE_THRESHOLD_S = 15 * 60
const REPORTED_GAP_MS = 30 * 60_000

async function rows<T>(
  clickhouse: ClickHouseClient,
  query: string,
  params: Record<string, unknown>,
): Promise<T[]> {
  const result = await clickhouse.query({ query, query_params: params, format: 'JSONEachRow' })
  return result.json<T>()
}

const num = (value: unknown) => Number(value ?? 0)
const minutes = (from: number, to: number) => Math.round((to - from) / 60_000)
/** DateTime do ClickHouse ("2026-02-03 02:59:46", em UTC) para ISO 8601 */
const isoFromClickHouse = (value: string) => new Date(`${value.replace(' ', 'T')}Z`).toISOString()

interface DeviceWindow {
  device_id: string
  packets: string
  first: string
  last: string
}

/**
 * Relatório de qualidade da telemetria: o que veio no dado cru (ClickHouse) e como foi tratado na
 * série (Postgres). Fica salvo em state.quality_report, servido pela API e reproduzível pela CLI.
 */
export async function buildQualityReport(
  pool: pg.Pool,
  clickhouse: ClickHouseClient,
  source: string,
  logger: Logger,
) {
  const registered = (
    await pool.query<{ id: string; environment_id: string }>(
      `SELECT d.id, e.id AS environment_id
       FROM registry.device d
       JOIN registry.environment e ON e.device_id = d.id
       JOIN registry.store s ON s.id = e.store_id
       WHERE s.client_id <> $1`,
      [SYNTHETIC_CLIENT_ID],
    )
  ).rows
  const environmentOf = new Map(registered.map((row) => [row.id, row.environment_id]))
  const params = { source, known: registered.map((row) => row.id) }

  const [packets] = await rows<Record<string, unknown>>(
    clickhouse,
    `SELECT count() AS total, countIf(NOT valid AND error != 'timestamp_futuro') AS invalid,
            countIf(saved_data) AS saved_data,
            uniqExactIf(device_id, valid) AS devices,
            sum(arrayCount(x -> x = -127, samples)) AS code_minus_127,
            sum(arrayCount(x -> x = 85, samples)) AS code_85,
            countIf(valid AND length(samples) > 0 AND samples[1] = 85) AS reboots
     FROM raw.telemetry_packet FINAL WHERE source = {source:String}`,
    params,
  )
  const [duplicates] = await rows<Record<string, unknown>>(
    clickhouse,
    `SELECT sum(c - 1) AS packets FROM (
       SELECT count() AS c FROM raw.telemetry_packet FINAL
       WHERE source = {source:String} AND valid GROUP BY device_id, sent_at, payload_hash HAVING c > 1)`,
    params,
  )
  // Atraso na chegada: quanto o pacote está atrás do maior horário da frota cadastrada quando chegou
  const [late] = await rows<Record<string, unknown>>(
    clickhouse,
    `SELECT countIf(lag > ${LATE_THRESHOLD_S}) AS packets, countIf(lag > ${LATE_THRESHOLD_S} AND saved_data) AS with_saved_data,
            max(lag) AS max_seconds
     FROM (SELECT saved_data,
             dateDiff('second', sent_at, max(sent_at) OVER (ORDER BY seq ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) AS lag
           FROM raw.telemetry_packet FINAL
           WHERE source = {source:String} AND valid AND device_id IN {known:Array(String)})`,
    params,
  )
  const unknown = await rows<DeviceWindow>(
    clickhouse,
    `SELECT device_id, count() AS packets, toString(min(sent_at)) AS first, toString(max(sent_at)) AS last
     FROM raw.telemetry_packet FINAL
     WHERE source = {source:String} AND valid AND device_id NOT IN {known:Array(String)}
     GROUP BY device_id ORDER BY device_id`,
    params,
  )
  // Relógio adiantado sem confirmação de outro dispositivo: ficou no cru, fora da série e do "agora"
  const future = await rows<DeviceWindow>(
    clickhouse,
    `SELECT device_id, count() AS packets, toString(min(sent_at)) AS first, toString(max(sent_at)) AS last
     FROM raw.telemetry_packet FINAL
     WHERE source = {source:String} AND error = 'timestamp_futuro'
     GROUP BY device_id ORDER BY device_id`,
    params,
  )

  const byQuality = new Map(
    (
      await pool.query<{ quality: number; count: number }>(
        'SELECT quality, count(*) AS count FROM telemetry.reading GROUP BY quality',
      )
    ).rows.map((row) => [row.quality, row.count]),
  )
  const stuckEpisodes = (
    await pool.query<{ device_id: string; from_ts: Date; to_ts: Date; value: number; samples: number }>(
      `SELECT device_id, min(ts) AS from_ts, max(ts) AS to_ts, min(value) AS value, count(*) AS samples
     FROM (SELECT device_id, ts, value,
             ts - (row_number() OVER (PARTITION BY device_id ORDER BY ts)) * interval '30 seconds' AS island
           FROM telemetry.reading WHERE quality = ${Quality.Stuck}) t
     GROUP BY device_id, island HAVING count(*) >= 10 ORDER BY from_ts`,
    )
  ).rows.map((row) => ({
    deviceId: row.device_id,
    environmentId: environmentOf.get(row.device_id) ?? null,
    from: row.from_ts.toISOString(),
    to: row.to_ts.toISOString(),
    minutes: minutes(row.from_ts.getTime(), row.to_ts.getTime()),
    value: row.value,
    samples: row.samples,
  }))

  const bounds = (
    await pool.query<{ from_ts: Date | null; to_ts: Date | null }>(
      'SELECT min(ts) AS from_ts, max(ts) AS to_ts FROM telemetry.reading',
    )
  ).rows[0]
  const gaps: Array<{
    deviceId: string
    environmentId: string | null
    from: string
    to: string
    minutes: number
  }> = []
  if (bounds?.from_ts && bounds.to_ts) {
    const { rows: buckets } = await pool.query<{
      device_id: string
      bucket: Date
      samples: number
      samples_ok: number
      sensor_error: number
      out_of_range: number
      spike: number
      stuck: number
    }>(
      `SELECT device_id, bucket, samples, samples_ok, sensor_error, out_of_range, spike, stuck
       FROM telemetry.reading_5m ORDER BY device_id, bucket`,
    )
    for (const [deviceId, list] of Map.groupBy(buckets, (row) => row.device_id)) {
      const found = findGaps(
        list.map((row) => ({
          bucket: row.bucket.getTime(),
          samples: row.samples,
          samplesOk: row.samples_ok,
          sensorError: row.sensor_error,
          outOfRange: row.out_of_range,
          spike: row.spike,
          stuck: row.stuck,
        })),
        bounds.from_ts.getTime(),
        bounds.to_ts.getTime(),
        BUCKET_MS['5m'],
        REPORTED_GAP_MS,
      ).filter((gap) => gap.kind === 'no_data')
      for (const gap of found) {
        gaps.push({
          deviceId,
          environmentId: environmentOf.get(deviceId) ?? null,
          from: new Date(gap.from).toISOString(),
          to: new Date(gap.to).toISOString(),
          minutes: minutes(gap.from, gap.to),
        })
      }
    }
  }

  const totalSamples = [...byQuality.values()].reduce((sum, count) => sum + count, 0)
  const report = {
    source,
    packets: {
      total: num(packets?.total),
      invalid: num(packets?.invalid),
      exactDuplicates: num(duplicates?.packets),
      savedData: num(packets?.saved_data),
      late: {
        packets: num(late?.packets),
        withSavedData: num(late?.with_saved_data),
        maxMinutes: Math.round(num(late?.max_seconds) / 60),
        thresholdMinutes: LATE_THRESHOLD_S / 60,
      },
      futureTimestamp: {
        packets: future.reduce((sum, row) => sum + num(row.packets), 0),
        toleranceMinutes: CLOCK_TOLERANCE_MS / 60_000,
        devices: future.map((row) => ({
          deviceId: row.device_id,
          environmentId: environmentOf.get(row.device_id) ?? null,
          packets: num(row.packets),
          from: isoFromClickHouse(row.first),
          to: isoFromClickHouse(row.last),
        })),
      },
    },
    devices: {
      registered: registered.length,
      reporting: num(packets?.devices),
      unknown: unknown.map((row) => ({
        deviceId: row.device_id,
        packets: num(row.packets),
        from: isoFromClickHouse(row.first),
        to: isoFromClickHouse(row.last),
      })),
      reboots: num(packets?.reboots),
    },
    samples: {
      total: totalSamples,
      valid: byQuality.get(Quality.Ok) ?? 0,
      sensorError: byQuality.get(Quality.SensorError) ?? 0,
      outOfRange: byQuality.get(Quality.OutOfRange) ?? 0,
      spike: byQuality.get(Quality.Spike) ?? 0,
      stuck: byQuality.get(Quality.Stuck) ?? 0,
      rawErrorCodes: { minus127: num(packets?.code_minus_127), plus85: num(packets?.code_85) },
    },
    stuckEpisodes,
    gaps: gaps.sort((a, b) => a.from.localeCompare(b.from)),
  }

  await pool.query(
    `INSERT INTO state.quality_report (id, generated_at, report) VALUES (1, now(), $1)
     ON CONFLICT (id) DO UPDATE SET generated_at = now(), report = EXCLUDED.report`,
    [JSON.stringify(report)],
  )
  logger.info(
    {
      packets: report.packets,
      unknownDevices: report.devices.unknown.map((device) => device.deviceId),
      reboots: report.devices.reboots,
      samples: report.samples,
      stuckEpisodes: stuckEpisodes.length,
      gaps: gaps.length,
    },
    'relatório de qualidade dos dados atualizado',
  )
  return report
}
