export const Quality = {
  Ok: 0,
  SensorError: 1,
  OutOfRange: 2,
  Spike: 3,
  Stuck: 4,
} as const

export type QualityCode = (typeof Quality)[keyof typeof Quality]

export const QUALITY_LABEL: Record<QualityCode, string> = {
  0: 'válida',
  1: 'código de erro do sensor',
  2: 'fora da faixa física',
  3: 'pico isolado',
  4: 'sensor travado',
}

/**
 * Códigos que o sensor (DS18B20) devolve em falha: -127 quando desconectado e 85 no
 * power-on, que nos dados aparece como primeira amostra depois de cada reinício.
 */
export const SENSOR_ERROR_CODES: ReadonlySet<number> = new Set([-127, 85])

/** Faixa fisicamente plausível para ambientes internos climatizados. */
export const PLAUSIBLE_RANGE = { min: -20, max: 60 } as const

/** Diferença mínima, em °C, para uma amostra ser pico em relação às duas vizinhas. */
export const SPIKE_DELTA_C = 3

/** Valor idêntico por este tempo ou mais caracteriza sensor travado. */
export const STUCK_MIN_DURATION_MS = 60 * 60_000

/** Intervalo máximo entre amostras iguais para considerar a mesma sequência (tolera um pacote perdido). */
export const STUCK_MAX_STEP_MS = 15 * 60_000

export function classifyValue(value: number): QualityCode {
  if (SENSOR_ERROR_CODES.has(value)) return Quality.SensorError
  if (value < PLAUSIBLE_RANGE.min || value > PLAUSIBLE_RANGE.max) return Quality.OutOfRange
  return Quality.Ok
}

/**
 * Marca picos isolados: amostra que difere SPIKE_DELTA_C ou mais das vizinhas válidas,
 * para o mesmo lado. Um degrau (o valor muda e permanece) não é pico.
 * `previous` é a última amostra válida antes do pacote, quando conhecida.
 */
export function markSpikes(values: readonly number[], qualities: QualityCode[], previous?: number): void {
  const valid = values.map((_, index) => index).filter((index) => qualities[index] === Quality.Ok)
  valid.forEach((index, position) => {
    const left = position > 0 ? values[valid[position - 1] as number] : previous
    const rightIndex = valid[position + 1]
    if (left === undefined || rightIndex === undefined) return
    const value = values[index] as number
    const toLeft = value - left
    const toRight = value - (values[rightIndex] as number)
    if (
      Math.abs(toLeft) >= SPIKE_DELTA_C &&
      Math.abs(toRight) >= SPIKE_DELTA_C &&
      Math.sign(toLeft) === Math.sign(toRight)
    ) {
      qualities[index] = Quality.Spike
    }
  })
}

export interface ClassifiedSample {
  ts: number
  value: number
  quality: QualityCode
}

export interface ValidReading {
  ts: number
  value: number
}

interface Run {
  value: number
  startTs: number
  lastTs: number
  flagged: boolean
  /** Última leitura válida antes da sequência começar */
  validBefore: ValidReading | null
}

export interface StuckRange {
  deviceId: string
  from: number
  to: number
  value: number
}

export interface StuckDetection {
  /** Início da sequência travada */
  startTs: number
  /** Trecho que chegou em lotes anteriores e precisa ser remarcado no banco (null se começou neste lote) */
  retro: StuckRange | null
  /** Para onde volta o "último valor válido" do dispositivo: o que veio depois era o sensor travado */
  validBefore: ValidReading | null
}

/**
 * Detecta sensor travado em fluxo. Recebe as amostras de cada dispositivo em ordem temporal
 * (pacotes ao vivo; pacotes atrasados não passam por aqui) e:
 * - marca como Stuck, no próprio lote, as amostras de uma sequência que já atingiu o limite;
 * - no lote em que a sequência atinge o limite, devolve o trecho anterior, já gravado, que precisa
 *   ser remarcado no banco e a última leitura válida antes dela.
 */
export class StuckDetector {
  private readonly runs = new Map<string, Run>()

  constructor(
    private readonly minDurationMs = STUCK_MIN_DURATION_MS,
    private readonly maxStepMs = STUCK_MAX_STEP_MS,
  ) {}

  /** Restaura a sequência em curso de um dispositivo (ex.: ao retomar a ingestão de um checkpoint). */
  restore(
    deviceId: string,
    run: Omit<Run, 'flagged' | 'validBefore'> & { validBefore?: ValidReading | null },
  ): void {
    this.runs.set(deviceId, {
      ...run,
      validBefore: run.validBefore ?? null,
      flagged: run.lastTs - run.startTs >= this.minDurationMs,
    })
  }

  observe(deviceId: string, samples: ClassifiedSample[]): StuckDetection | null {
    let detection: StuckDetection | null = null
    let retro: StuckRange | null = null
    let batchStartTs: number | null = null
    for (const sample of samples) {
      if (sample.quality !== Quality.Ok) continue
      batchStartTs ??= sample.ts
      const run = this.runs.get(deviceId)
      // Amostra repetida ou fora de ordem não estende nem interrompe a sequência
      if (run && sample.ts <= run.lastTs) continue
      if (run && run.value === sample.value && sample.ts - run.lastTs <= this.maxStepMs) {
        run.lastTs = sample.ts
      } else {
        this.runs.set(deviceId, {
          value: sample.value,
          startTs: sample.ts,
          lastTs: sample.ts,
          flagged: false,
          validBefore: run ? (run.flagged ? run.validBefore : { ts: run.lastTs, value: run.value }) : null,
        })
        continue
      }
      if (run.lastTs - run.startTs < this.minDurationMs) continue
      sample.quality = Quality.Stuck
      if (!run.flagged) {
        run.flagged = true
        // Amostras da sequência que chegaram em lotes anteriores precisam ser remarcadas
        if (run.startTs < batchStartTs) {
          retro = { deviceId, from: run.startTs, to: batchStartTs - 1, value: run.value }
        }
        detection = { startTs: run.startTs, retro, validBefore: run.validBefore }
        // Amostras da sequência que estão neste mesmo lote, antes desta
        for (const earlier of samples) {
          if (earlier === sample) break
          if (earlier.quality === Quality.Ok && earlier.ts >= run.startTs && earlier.value === run.value) {
            earlier.quality = Quality.Stuck
          }
        }
      }
    }
    return detection
  }
}
