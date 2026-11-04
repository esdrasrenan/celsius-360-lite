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

/** Motivo gravado no cru quando o pacote não entra na série. */
export type RejectReason = ParseError | 'timestamp_futuro'

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

/** Quanto um pacote pode estar à frente do "agora" sem que outro dispositivo confirme o horário. */
export const CLOCK_TOLERANCE_MS = 10 * 60_000

/**
 * "Agora" da ingestão: o horário mais recente dos dispositivos cadastrados, protegido contra relógio
 * adiantado (GMT errado, RTC desregulado). Um pacote até 10 min à frente do agora é aceito e o avança.
 * Um salto maior só vale quando outro dispositivo cadastrado já informou um horário a até 10 min do
 * pacote, como acontece quando a frota inteira volta de uma interrupção. Sem confirmação, o pacote é
 * recusado e não move o agora, mas o horário dele fica registrado e pode confirmar o de outro.
 * Com um único dispositivo cadastrado não há quem confirme, e vale o maior horário.
 *
 * Antes do primeiro agora não há referência: nada é recusado, e o agora começa no primeiro horário
 * confirmado por outro dispositivo (ou pelo próprio, no pacote seguinte, se ele é o único a enviar).
 */
export class FleetClock {
  /** Maior horário informado por cada dispositivo, aceito ou não */
  private readonly reported = new Map<string, number>()

  constructor(
    private readonly fleetSize: number,
    private current: number | null = null,
    reported: Iterable<readonly [string, number]> = [],
  ) {
    for (const [deviceId, at] of reported) this.reported.set(deviceId, at)
  }

  get now(): number | null {
    return this.current
  }

  /** Registra o horário do pacote e diz se ele entra na série. */
  accept(deviceId: string, sentAt: number): boolean {
    const confirmed = this.confirmed(deviceId, sentAt)
    this.reported.set(deviceId, Math.max(this.reported.get(deviceId) ?? sentAt, sentAt))
    if (confirmed) this.current = Math.max(this.current ?? sentAt, sentAt)
    return confirmed || this.current === null
  }

  private confirmed(deviceId: string, sentAt: number): boolean {
    if (this.fleetSize <= 1) return true
    if (this.current !== null && sentAt <= this.current + CLOCK_TOLERANCE_MS) return true
    const near = (at: number | undefined) => at !== undefined && Math.abs(at - sentAt) <= CLOCK_TOLERANCE_MS
    for (const [other, at] of this.reported) if (other !== deviceId && near(at)) return true
    return this.current === null && this.reported.size === 1 && near(this.reported.get(deviceId))
  }
}
