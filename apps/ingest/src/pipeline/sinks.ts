import type { ClickHouseClient } from '@clickhouse/client'
import type pg from 'pg'
import type { Batch, DeviceMemory, RawRow } from './processor'

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())

/**
 * Dado cru no ClickHouse. A maior posição já gravada da fonte funciona como marca d'água:
 * reprocessar o mesmo arquivo pula o que já existe, então nada se duplica.
 */
export class RawSink {
  private highWaterMark = 0

  constructor(
    private readonly clickhouse: ClickHouseClient,
    private readonly source: string,
  ) {}

  async init(): Promise<number> {
    const result = await this.clickhouse.query({
      query: 'SELECT max(seq) AS seq FROM raw.telemetry_packet WHERE source = {source:String}',
      query_params: { source: this.source },
      format: 'JSONEachRow',
    })
    const [row] = await result.json<{ seq: string | number }>()
    this.highWaterMark = Number(row?.seq ?? 0)
    return this.highWaterMark
  }

  async write(rows: readonly RawRow[]): Promise<number> {
    const fresh = rows.filter((row) => row.seq > this.highWaterMark)
    if (fresh.length === 0) return 0
    await this.clickhouse.insert({ table: 'raw.telemetry_packet', values: fresh, format: 'JSONEachRow' })
    this.highWaterMark = Math.max(this.highWaterMark, ...fresh.map((row) => row.seq))
    return fresh.length
  }
}

/**
 * Série tratada e estado no Postgres, numa transação por lote junto com o checkpoint da fonte.
 * Todas as escritas são idempotentes: amostra repetida é ignorada (primeira gravação vence),
 * e estado e checkpoint só avançam (GREATEST), então reprocessar não corrompe nada. A exceção é o
 * último valor válido de um sensor que acabou de ser detectado como travado, que volta no tempo.
 */
export class SeriesSink {
  constructor(private readonly pool: pg.Pool) {}

  async write(batch: Batch): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')

      if (batch.readings.length > 0) {
        const r = batch.readings
        await client.query(
          `INSERT INTO telemetry.reading (device_id, ts, value, quality, in_hours, comfort)
           SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::real[], $4::smallint[], $5::boolean[], $6::smallint[])
           ON CONFLICT (device_id, ts) DO NOTHING`,
          [
            r.map((row) => row.deviceId),
            r.map((row) => new Date(row.ts).toISOString()),
            r.map((row) => row.value),
            r.map((row) => row.quality),
            r.map((row) => row.inHours),
            r.map((row) => row.comfort),
          ],
        )
      }

      // Sensor travado detectado depois: remarca o início da sequência já gravado
      for (const range of batch.stuck) {
        await client.query(
          `UPDATE telemetry.reading SET quality = 4, comfort = NULL
           WHERE device_id = $1 AND ts BETWEEN $2 AND $3 AND quality = 0 AND value = $4::real`,
          [range.deviceId, iso(range.from), iso(range.to), range.value],
        )
      }

      if (batch.devices.size > 0) await upsertDevices(client, batch.devices)
      // Sensor travado detectado: o último valor válido volta no tempo, o que o upsert acima não faz
      for (const deviceId of batch.validReset) {
        const state = batch.devices.get(deviceId)
        await client.query(
          'UPDATE state.device SET last_valid_at = $2, last_valid_value = $3 WHERE device_id = $1',
          [deviceId, iso(state?.lastValidAt ?? null), state?.lastValidValue ?? null],
        )
      }

      for (const [deviceId, seen] of batch.unknownDevices) {
        await client.query(
          `INSERT INTO state.unknown_device (device_id, first_seen_at, last_seen_at) VALUES ($1, $2, $3)
           ON CONFLICT (device_id) DO UPDATE SET
             first_seen_at = LEAST(state.unknown_device.first_seen_at, EXCLUDED.first_seen_at),
             last_seen_at = GREATEST(state.unknown_device.last_seen_at, EXCLUDED.last_seen_at)`,
          [deviceId, iso(seen.firstSeen), iso(seen.lastSeen)],
        )
      }

      await client.query(
        `INSERT INTO state.ingestion (source, last_seq, now_ts, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (source) DO UPDATE SET
           last_seq = GREATEST(state.ingestion.last_seq, EXCLUDED.last_seq),
           now_ts = GREATEST(state.ingestion.now_ts, EXCLUDED.now_ts),
           updated_at = now()`,
        [batch.source, batch.lastSeq, iso(batch.now)],
      )

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

async function upsertDevices(client: pg.PoolClient, devices: Map<string, DeviceMemory>) {
  const entries = [...devices.entries()]
  await client.query(
    `INSERT INTO state.device (device_id, last_contact_at, last_sample_at, last_valid_at, last_valid_value)
     SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::timestamptz[], $4::timestamptz[], $5::real[])
     ON CONFLICT (device_id) DO UPDATE SET
       last_contact_at = GREATEST(state.device.last_contact_at, EXCLUDED.last_contact_at),
       last_sample_at = GREATEST(state.device.last_sample_at, EXCLUDED.last_sample_at),
       last_valid_value = CASE
         WHEN EXCLUDED.last_valid_at > coalesce(state.device.last_valid_at, '-infinity') THEN EXCLUDED.last_valid_value
         ELSE state.device.last_valid_value END,
       last_valid_at = GREATEST(state.device.last_valid_at, EXCLUDED.last_valid_at)`,
    [
      entries.map(([id]) => id),
      entries.map(([, state]) => iso(state.lastContactAt)),
      entries.map(([, state]) => iso(state.lastSampleAt)),
      entries.map(([, state]) => iso(state.lastValidAt)),
      entries.map(([, state]) => state.lastValidValue),
    ],
  )
}
