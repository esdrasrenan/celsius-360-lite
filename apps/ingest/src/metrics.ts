import client from 'prom-client'
import type { Logger } from './infra'
import type { Batch } from './pipeline/processor'

export class IngestMetrics {
  readonly registry = new client.Registry()

  private readonly packets = new client.Counter({
    name: 'celsius_ingest_packets_total',
    help: 'Pacotes processados, por resultado',
    labelNames: ['result'] as const,
    registers: [this.registry],
  })

  private readonly samples = new client.Counter({
    name: 'celsius_ingest_samples_total',
    help: 'Amostras gravadas na série tratada, por qualidade',
    labelNames: ['quality'] as const,
    registers: [this.registry],
  })

  private readonly batchDuration = new client.Histogram({
    name: 'celsius_ingest_batch_duration_seconds',
    help: 'Tempo para gravar um lote (cru + série + estado)',
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  })

  private readonly watermark = new client.Gauge({
    name: 'celsius_ingest_watermark_seconds',
    help: '"Agora" da ingestão: horário mais recente dos dispositivos cadastrados (epoch)',
    registers: [this.registry],
  })

  private readonly lastSeq = new client.Gauge({
    name: 'celsius_ingest_last_seq',
    help: 'Última posição processada na fonte',
    registers: [this.registry],
  })

  constructor() {
    client.collectDefaultMetrics({ register: this.registry })
  }

  observeBatch(batch: Batch, durationMs: number) {
    const { packets, invalid, unknownDevice, late, future, redelivered } = batch.stats
    this.packets.inc({ result: 'valid' }, packets - invalid - unknownDevice - future)
    if (invalid) this.packets.inc({ result: 'invalid' }, invalid)
    if (unknownDevice) this.packets.inc({ result: 'unknown_device' }, unknownDevice)
    if (future) this.packets.inc({ result: 'future_timestamp' }, future)
    if (late) this.packets.inc({ result: 'late' }, late)
    if (redelivered) this.packets.inc({ result: 'redelivered' }, redelivered)
    const byQuality = new Map<number, number>()
    for (const reading of batch.readings)
      byQuality.set(reading.quality, (byQuality.get(reading.quality) ?? 0) + 1)
    for (const [quality, count] of byQuality) this.samples.inc({ quality: String(quality) }, count)
    this.batchDuration.observe(durationMs / 1000)
    if (batch.now !== null) this.watermark.set(batch.now / 1000)
    this.lastSeq.set(batch.lastSeq)
  }

  /** Expõe /metrics (Prometheus) e /health enquanto a ingestão roda. */
  serve(port: number, logger: Logger) {
    if (port <= 0) return null
    const server = Bun.serve({
      port,
      fetch: async (request) => {
        const { pathname } = new URL(request.url)
        if (pathname === '/metrics') {
          return new Response(await this.registry.metrics(), {
            headers: { 'content-type': this.registry.contentType },
          })
        }
        if (pathname === '/health') return Response.json({ status: 'ok' })
        return new Response('not found', { status: 404 })
      },
    })
    logger.info({ port: server.port }, 'métricas da ingestão em /metrics')
    return server
  }
}
