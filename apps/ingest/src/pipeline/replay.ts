import { basename } from 'node:path'
import { Quality, STUCK_MAX_STEP_MS } from '@celsius/domain'
import type { ClickHouseClient } from '@clickhouse/client'
import type pg from 'pg'
import { type Config, telemetryPath } from '../config'
import type { Logger } from '../infra'
import type { IngestMetrics } from '../metrics'
import { loadEnvironments } from '../registry'
import { AggregateRefresher } from './aggregates'
import { readLines } from './lines'
import { type DeviceMemory, TelemetryProcessor } from './processor'
import { Projector } from './projections'
import { RawSink, SeriesSink } from './sinks'

export interface ReplayOptions {
  /** Relê a fonte desde o início; as escritas idempotentes garantem que nada duplique */
  fromStart: boolean
  /** Pacotes por segundo; 0 = sem limite */
  rate: number
  batchSize: number
  refreshIntervalMs: number
}

export interface ReplaySummary {
  source: string
  packets: number
  rawInserted: number
  lastSeq: number
  now: string | null
  seconds: number
}

interface Deps {
  pool: pg.Pool
  clickhouse: ClickHouseClient
  logger: Logger
  metrics: IngestMetrics
}

async function loadDeviceMemory(pool: pg.Pool): Promise<Map<string, DeviceMemory>> {
  const { rows } = await pool.query<{
    device_id: string
    last_contact_at: Date
    last_sample_at: Date
    last_valid_at: Date | null
    last_valid_value: number | null
  }>('SELECT device_id, last_contact_at, last_sample_at, last_valid_at, last_valid_value FROM state.device')
  return new Map(
    rows.map((row) => [
      row.device_id,
      {
        lastContactAt: row.last_contact_at.getTime(),
        lastSampleAt: row.last_sample_at.getTime(),
        lastValidAt: row.last_valid_at?.getTime() ?? null,
        lastValidValue: row.last_valid_value,
      },
    ]),
  )
}

/** Ao retomar de um checkpoint, reconstrói a sequência de valores idênticos em curso de cada dispositivo. */
async function restoreStuckRuns(pool: pg.Pool, processor: TelemetryProcessor) {
  const { rows } = await pool.query<{ device_id: string; ts: Date; value: number; quality: number }>(
    `SELECT r.device_id, r.ts, r.value, r.quality
     FROM telemetry.reading r JOIN state.device d ON d.device_id = r.device_id
     WHERE r.quality IN (${Quality.Ok}, ${Quality.Stuck}) AND r.ts > d.last_sample_at - interval '3 hours'
     ORDER BY r.device_id, r.ts DESC`,
  )
  const byDevice = Map.groupBy(rows, (row) => row.device_id)
  for (const [deviceId, recent] of byDevice) {
    const [latest] = recent
    if (!latest) continue
    let start = latest.ts.getTime()
    let end = 1
    for (; end < recent.length; end++) {
      const row = recent[end] as (typeof recent)[number]
      if (row.value !== latest.value || start - row.ts.getTime() > STUCK_MAX_STEP_MS) break
      start = row.ts.getTime()
    }
    // Para onde volta o último valor válido se a sequência virar travamento depois da retomada
    const before = recent.slice(end).find((row) => row.quality === Quality.Ok)
    processor.restoreStuckRun(deviceId, {
      value: latest.value,
      startTs: start,
      lastTs: latest.ts.getTime(),
      validBefore: before ? { ts: before.ts.getTime(), value: before.value } : null,
    })
  }
}

/**
 * Lê telemetrias.jsonl na ordem de chegada, como se os pacotes viessem do broker:
 * a cada lote grava o dado cru (ClickHouse) e, numa transação, a série tratada, o estado e o
 * checkpoint (Postgres); a cada intervalo atualiza agregados e projeções e avisa a API (NOTIFY).
 */
export async function replay(deps: Deps, config: Config, options: ReplayOptions): Promise<ReplaySummary> {
  const { pool, clickhouse, logger, metrics } = deps
  const path = telemetryPath(config)
  if (!(await Bun.file(path).exists())) {
    throw new Error(
      `Arquivo de telemetria não encontrado em ${path}. Copie os dados do desafio para a pasta dados/.`,
    )
  }
  const source = basename(path).replace(/\.gz$/, '')

  const environments = await loadEnvironments(pool)
  if (environments.length === 0) throw new Error('Cadastro vazio: rode o seed antes da ingestão')

  const checkpoint = await pool.query<{ last_seq: number; now_ts: Date | null }>(
    'SELECT last_seq, now_ts FROM state.ingestion WHERE source = $1',
    [source],
  )
  const resumeAfter = options.fromStart ? 0 : (checkpoint.rows[0]?.last_seq ?? 0)
  const devices = await loadDeviceMemory(pool)
  const processor = new TelemetryProcessor(
    source,
    environments,
    devices,
    checkpoint.rows[0]?.now_ts?.getTime() ?? null,
  )
  if (resumeAfter > 0) await restoreStuckRuns(pool, processor)

  const rawSink = new RawSink(clickhouse, source)
  const rawHighWaterMark = await rawSink.init()
  const seriesSink = new SeriesSink(pool)
  const aggregates = new AggregateRefresher(pool)
  const projector = new Projector(pool, environments)

  logger.info(
    {
      source,
      resumeAfter,
      rawHighWaterMark,
      rate: options.rate || 'sem limite',
      environments: environments.length,
    },
    resumeAfter > 0 ? 'retomando a ingestão do checkpoint' : 'iniciando a ingestão',
  )

  let stopping = false
  const stop = () => {
    if (!stopping) logger.warn('sinal recebido: gravando o lote atual e encerrando')
    stopping = true
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  const started = performance.now()
  let packets = 0
  let rawInserted = 0
  let lastSeq = resumeAfter
  let lastFlush = started
  let lastRefresh = started
  let lastLog = started

  const flush = async () => {
    const batch = processor.drain()
    if (batch.stats.packets === 0) return
    const batchStart = performance.now()
    rawInserted += await rawSink.write(batch.raw)
    await seriesSink.write(batch)
    aggregates.mark(batch.touched)
    lastSeq = batch.lastSeq
    metrics.observeBatch(batch, performance.now() - batchStart)
  }
  const refresh = async () => {
    await aggregates.flush()
    await projector.refresh(processor.currentNow, devices, lastSeq)
  }

  try {
    for await (const entry of readLines(path, resumeAfter)) {
      processor.process(entry, Date.now())
      packets++
      const elapsed = performance.now()
      if (processor.pending >= options.batchSize || (options.rate > 0 && elapsed - lastFlush >= 250)) {
        await flush()
        lastFlush = performance.now()
      }
      if (elapsed - lastRefresh >= options.refreshIntervalMs) {
        await flush()
        await refresh()
        lastRefresh = performance.now()
      }
      if (elapsed - lastLog >= 5000) {
        const now = processor.currentNow
        logger.info(
          {
            seq: entry.seq,
            packets,
            perSecond: Math.round(packets / ((elapsed - started) / 1000)),
            now: now ? new Date(now).toISOString() : null,
          },
          'ingestão em andamento',
        )
        lastLog = elapsed
      }
      if (options.rate > 0) {
        const ahead = (packets / options.rate) * 1000 - (performance.now() - started)
        if (ahead > 5) await Bun.sleep(ahead)
      }
      if (stopping) break
    }
    await flush()
    // Roda mesmo sem pacote novo (fonte já no fim): colunas que uma migração acrescentou às
    // projeções ficam preenchidas na subida, sem reprocessar a série
    await refresh()
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }

  const now = processor.currentNow
  const summary: ReplaySummary = {
    source,
    packets,
    rawInserted,
    lastSeq,
    now: now ? new Date(now).toISOString() : null,
    seconds: Math.round((performance.now() - started) / 100) / 10,
  }
  logger.info(summary, stopping ? 'ingestão interrompida no checkpoint' : 'ingestão concluída')
  return summary
}
