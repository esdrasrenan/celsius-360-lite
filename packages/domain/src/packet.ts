import { z } from 'zod'

const LOCAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/

/** Pacote como chega do broker MQTT: horário local do envio e amostras em ordem cronológica. */
export const telemetryPacketSchema = z.object({
  dev_id: z.string().trim().min(1),
  timestamp: z.string().regex(LOCAL_TIMESTAMP),
  GMT: z.number().int().min(-12).max(14),
  samplingTime: z.number().int().min(1).max(3600),
  Temperature: z.array(z.number()).min(1).max(720),
  saved_data: z.boolean().optional(),
})

export type TelemetryPacket = z.infer<typeof telemetryPacketSchema>

export type ParseError = 'json_invalido' | 'esquema_invalido' | 'timestamp_invalido'

export type ParsedLine =
  | { ok: true; packet: TelemetryPacket; sentAt: number }
  | { ok: false; error: ParseError; deviceId: string | null }

export interface Sample {
  /** Instante da amostra em UTC (epoch ms) */
  ts: number
  value: number
}

/** Converte "AAAA-MM-DDThh:mm:ss" no fuso GMT informado (em horas) para epoch ms UTC. */
export function localToUtc(local: string, gmtHours: number): number {
  const asUtc = Date.parse(`${local}Z`)
  // Date.parse aceita datas como 2026-02-30 e as normaliza; a volta garante que a data existe
  if (Number.isNaN(asUtc) || new Date(asUtc).toISOString().slice(0, 19) !== local) return Number.NaN
  return asUtc - gmtHours * 3_600_000
}

export function parsePacketLine(line: string): ParsedLine {
  let json: unknown
  try {
    json = JSON.parse(line)
  } catch {
    return { ok: false, error: 'json_invalido', deviceId: null }
  }
  const deviceId =
    typeof json === 'object' && json !== null && typeof (json as { dev_id?: unknown }).dev_id === 'string'
      ? (json as { dev_id: string }).dev_id
      : null

  const result = telemetryPacketSchema.safeParse(json)
  if (!result.success) return { ok: false, error: 'esquema_invalido', deviceId }

  const sentAt = localToUtc(result.data.timestamp, result.data.GMT)
  if (Number.isNaN(sentAt)) return { ok: false, error: 'timestamp_invalido', deviceId }
  return { ok: true, packet: result.data, sentAt }
}

/** O timestamp do pacote é o da última amostra; as anteriores recuam samplingTime segundos cada. */
export function expandSamples(packet: TelemetryPacket, sentAt: number): Sample[] {
  const count = packet.Temperature.length
  const stepMs = packet.samplingTime * 1000
  return packet.Temperature.map((value, index) => ({ ts: sentAt - (count - 1 - index) * stepMs, value }))
}
