import {
  classifyValue,
  comfortLevel,
  expandSamples,
  FleetClock,
  isOpenAt,
  markSpikes,
  parsePacketLine,
  Quality,
  type QualityCode,
  type RejectReason,
  StuckDetector,
  type StuckRange,
  type ValidReading,
} from '@celsius/domain'
import type { EnvironmentContext } from '../registry'
import type { SourceLine } from './lines'

export interface RawRow {
  source: string
  seq: number
  received_at: string
  device_id: string
  sent_at: string | null
  gmt_offset: number | null
  sampling_s: number | null
  saved_data: boolean
  samples: number[]
  payload: string
  payload_hash: string
  valid: boolean
  error: RejectReason | ''
}

export interface ReadingRow {
  deviceId: string
  ts: number
  value: number
  quality: QualityCode
  inHours: boolean
  comfort: -1 | 0 | 1 | null
}

export interface DeviceMemory {
  lastContactAt: number
  lastSampleAt: number
  lastValidAt: number | null
  lastValidValue: number | null
}

export interface Batch {
  source: string
  lastSeq: number
  /** "Agora": maior horário de pacote processado até o fim do lote */
  now: number | null
  raw: RawRow[]
  readings: ReadingRow[]
  stuck: StuckRange[]
  devices: Map<string, DeviceMemory>
  /** Dispositivos cujo último valor válido voltou no tempo (sensor travado detectado) */
  validReset: Set<string>
  unknownDevices: Map<string, { firstSeen: number; lastSeen: number }>
  touched: { from: number; to: number } | null
  stats: {
    packets: number
    invalid: number
    unknownDevice: number
    late: number
    future: number
    /** Já processados antes, relidos por um replay desde o início */
    redelivered: number
  }
}

/**
 * Releitura desde o início (`replay --from-start`): os pacotes até a posição do checkpoint já foram
 * processados. A decisão do relógio sobre eles é a que ficou gravada no cru (`refused` lista os
 * recusados como timestamp_futuro), e o estado dos dispositivos já os contém.
 */
export interface Redelivery {
  upTo: number
  refused: ReadonlySet<number>
}

const NO_REDELIVERY: Redelivery = { upTo: 0, refused: new Set() }

const toClickHouseTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19)

/**
 * Enriquecimento de cada pacote, em memória e na ordem de chegada:
 * expande as amostras, classifica a qualidade, avalia horário e conforto e mantém o estado dos
 * dispositivos. Não fala com banco; o lote resultante é gravado pelos sinks.
 *
 * Pacote "ao vivo" é o que começa depois da última amostra já recebida do dispositivo. Os demais
 * (atrasados, reenviados com saved_data ou duplicados) entram na série sem participar da detecção
 * de sensor travado, que depende de ordem temporal.
 *
 * O "agora" vem só dos dispositivos cadastrados (FleetClock); pacote com relógio adiantado e sem
 * confirmação fica no cru como timestamp_futuro, fora da série e do estado.
 */
export class TelemetryProcessor {
  private readonly byDevice: Map<string, EnvironmentContext>
  private readonly stuck = new StuckDetector()
  private readonly clock: FleetClock
  private batch!: Batch

  constructor(
    private readonly source: string,
    environments: readonly EnvironmentContext[],
    private readonly devices: Map<string, DeviceMemory>,
    now: number | null,
    private readonly redelivery: Redelivery = NO_REDELIVERY,
  ) {
    this.byDevice = new Map(
      environments.flatMap((environment) =>
        environment.deviceId ? [[environment.deviceId, environment]] : [],
      ),
    )
    this.clock = new FleetClock(
      this.byDevice.size,
      now,
      [...devices].map(([deviceId, state]) => [deviceId, state.lastSampleAt] as const),
    )
    this.reset()
  }

  get currentNow(): number | null {
    return this.clock.now
  }

  restoreStuckRun(
    deviceId: string,
    run: { value: number; startTs: number; lastTs: number; validBefore?: ValidReading | null },
  ) {
    this.stuck.restore(deviceId, run)
  }

  process({ seq, line }: SourceLine, receivedAt: number): void {
    const batch = this.batch
    batch.lastSeq = seq
    batch.stats.packets++
    const parsed = parsePacketLine(line)
    const base = {
      source: this.source,
      seq,
      received_at: new Date(receivedAt).toISOString(),
      payload: line,
      payload_hash: Bun.hash.cityHash64(line).toString(),
    }

    if (!parsed.ok) {
      batch.stats.invalid++
      batch.raw.push({
        ...base,
        device_id: parsed.deviceId ?? '',
        sent_at: null,
        gmt_offset: null,
        sampling_s: null,
        saved_data: false,
        samples: [],
        valid: false,
        error: parsed.error,
      })
      return
    }

    const { packet, sentAt } = parsed
    const context = this.byDevice.get(packet.dev_id)
    // A reentrega repete a decisão original sem passar pelo relógio, que já está no "agora" final:
    // ali, um salto recusado na época passaria, e o relógio guardaria horários que já viu
    const redelivered = seq <= this.redelivery.upTo
    if (redelivered) batch.stats.redelivered++
    const accepted =
      !context || (redelivered ? !this.redelivery.refused.has(seq) : this.clock.accept(packet.dev_id, sentAt))
    batch.now = this.clock.now
    batch.raw.push({
      ...base,
      device_id: packet.dev_id,
      sent_at: toClickHouseTime(sentAt),
      gmt_offset: packet.GMT,
      sampling_s: packet.samplingTime,
      saved_data: packet.saved_data ?? false,
      samples: packet.Temperature,
      valid: accepted,
      error: accepted ? '' : 'timestamp_futuro',
    })
    if (!accepted) {
      batch.stats.future++
      return
    }

    if (!context) {
      batch.stats.unknownDevice++
      const seen = batch.unknownDevices.get(packet.dev_id)
      batch.unknownDevices.set(packet.dev_id, {
        firstSeen: Math.min(seen?.firstSeen ?? sentAt, sentAt),
        lastSeen: Math.max(seen?.lastSeen ?? sentAt, sentAt),
      })
      return
    }

    const samples = expandSamples(packet, sentAt)
    const state = this.devices.get(packet.dev_id)
    const first = samples[0] as { ts: number }
    const last = samples.at(-1) as { ts: number }
    const live = !redelivered && (!state || first.ts > state.lastSampleAt)
    if (!live && !redelivered) batch.stats.late++

    const values = samples.map((sample) => sample.value)
    const qualities = values.map(classifyValue)
    markSpikes(values, qualities, live ? (state?.lastValidValue ?? undefined) : undefined)
    const classified = samples.map((sample, index) => ({
      ...sample,
      quality: qualities[index] as QualityCode,
    }))
    const detection = live ? this.stuck.observe(packet.dev_id, classified) : null
    if (detection?.retro) {
      batch.stuck.push(detection.retro)
      this.touch(detection.retro.from, detection.retro.to)
    }

    let lastValid: { ts: number; value: number } | null = null
    for (const sample of classified) {
      const inHours = isOpenAt(context.schedule, sample.ts, context.timeZone)
      const valid = sample.quality === Quality.Ok
      if (valid) lastValid = sample
      batch.readings.push({
        deviceId: packet.dev_id,
        ts: sample.ts,
        value: sample.value,
        quality: sample.quality,
        inHours,
        comfort: valid && inHours ? comfortLevel(sample.value, context.range) : null,
      })
    }
    this.touch(first.ts, last.ts)

    // A série é regravada (a chave ignora o que já existe), mas o estado do dispositivo já contém
    // este pacote: registrar o contato de novo usaria o "agora" atual e tiraria do offline um
    // dispositivo que parou de enviar
    if (redelivered) return

    // Antes do primeiro "agora" confirmado, o contato é o horário do próprio pacote
    const now = this.clock.now ?? sentAt
    const next: DeviceMemory = {
      lastContactAt: Math.max(state?.lastContactAt ?? now, now),
      lastSampleAt: Math.max(state?.lastSampleAt ?? last.ts, last.ts),
      lastValidAt: state?.lastValidAt ?? null,
      lastValidValue: state?.lastValidValue ?? null,
    }
    // O que parecia válido desde o início da sequência era o sensor travado: o dispositivo passa a
    // falha no sensor já neste pacote, e o último valor válido volta para o de antes dela
    if (detection && next.lastValidAt !== null && next.lastValidAt >= detection.startTs) {
      next.lastValidAt = detection.validBefore?.ts ?? null
      next.lastValidValue = detection.validBefore?.value ?? null
      batch.validReset.add(packet.dev_id)
    }
    if (lastValid && (next.lastValidAt === null || lastValid.ts > next.lastValidAt)) {
      next.lastValidAt = lastValid.ts
      next.lastValidValue = lastValid.value
    }
    this.devices.set(packet.dev_id, next)
    batch.devices.set(packet.dev_id, next)
  }

  /** Entrega o lote acumulado e começa outro. */
  drain(): Batch {
    const batch = this.batch
    this.reset()
    return batch
  }

  get pending(): number {
    return this.batch.stats.packets
  }

  private touch(from: number, to: number) {
    const touched = this.batch.touched
    this.batch.touched = touched
      ? { from: Math.min(touched.from, from), to: Math.max(touched.to, to) }
      : { from, to }
  }

  private reset() {
    this.batch = {
      source: this.source,
      lastSeq: this.batch?.lastSeq ?? 0,
      now: this.clock.now,
      raw: [],
      readings: [],
      stuck: [],
      devices: new Map(),
      validReset: new Set(),
      unknownDevices: new Map(),
      touched: null,
      stats: { packets: 0, invalid: 0, unknownDevice: 0, late: 0, future: 0, redelivered: 0 },
    }
  }
}
