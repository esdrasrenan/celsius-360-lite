import { parsePacketLine } from '@celsius/domain'
import type pg from 'pg'
import { type Config, telemetryPath } from '../config'
import type { Logger } from '../infra'
import { boundaryLines } from '../pipeline/lines'

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'
const DAY_MS = 86_400_000

type HourlyPoint = [isoUtc: string, celsius: number]

interface WeatherCache {
  source: string
  attribution: string
  range: { start: string; end: string }
  stores: Record<string, { latitude: number; longitude: number; hourly: HourlyPoint[] }>
}

interface StoreRow {
  id: string
  latitude: number
  longitude: number
}

/** Período dos dados, com um dia de folga de cada lado, a partir da primeira e da última linha do arquivo. */
export async function telemetryDateRange(config: Config): Promise<{ start: string; end: string } | null> {
  const lines = await boundaryLines(telemetryPath(config))
  if (!lines) return null
  const first = parsePacketLine(lines.first)
  const last = parsePacketLine(lines.last)
  if (!first.ok || !last.ok) return null
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return {
    start: day(Math.min(first.sentAt, last.sentAt) - DAY_MS),
    end: day(Math.max(first.sentAt, last.sentAt) + DAY_MS),
  }
}

async function fetchArchive(store: StoreRow, range: { start: string; end: string }): Promise<HourlyPoint[]> {
  const url = new URL(ARCHIVE_URL)
  url.search = new URLSearchParams({
    latitude: String(store.latitude),
    longitude: String(store.longitude),
    start_date: range.start,
    end_date: range.end,
    hourly: 'temperature_2m',
    timezone: 'UTC',
  }).toString()

  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error(`Open-Meteo respondeu ${response.status}`)
      const body = (await response.json()) as {
        hourly?: { time: string[]; temperature_2m: Array<number | null> }
      }
      if (!body.hourly) throw new Error('Resposta do Open-Meteo sem série horária')
      const { time, temperature_2m } = body.hourly
      return time.flatMap((hour, index) => {
        const value = temperature_2m[index]
        return value === null || value === undefined ? [] : [[`${hour}:00Z`, value] as HourlyPoint]
      })
    } catch (error) {
      lastError = error
      await Bun.sleep(attempt * 1000)
    }
  }
  throw lastError
}

async function readCache(path: string): Promise<WeatherCache | null> {
  const file = Bun.file(path)
  return (await file.exists()) ? ((await file.json()) as WeatherCache) : null
}

/**
 * Temperatura externa horária de cada loja (Open-Meteo, sem chave de API). Se a API estiver fora do ar,
 * usa o cache versionado no repositório, para o sistema subir do zero mesmo sem internet.
 */
export async function loadOutdoorTemperature(
  pool: pg.Pool,
  config: Config,
  logger: Logger,
  updateCache = false,
) {
  const range = await telemetryDateRange(config)
  if (!range) {
    logger.warn('arquivo de telemetria ausente: temperatura externa não carregada')
    return
  }
  const { rows: stores } = await pool.query<StoreRow>(
    'SELECT id, latitude, longitude FROM registry.store ORDER BY id',
  )
  const cache = await readCache(config.WEATHER_CACHE_FILE)
  const fresh: WeatherCache = {
    source: 'Open-Meteo Historical Weather API (temperature_2m, horário, UTC)',
    attribution: 'Weather data by Open-Meteo.com, licença CC BY 4.0',
    range,
    stores: {},
  }

  for (const store of stores) {
    let points: HourlyPoint[]
    let origin = 'open-meteo'
    try {
      points = await fetchArchive(store, range)
      fresh.stores[store.id] = { latitude: store.latitude, longitude: store.longitude, hourly: points }
    } catch (error) {
      const cached = cache?.stores[store.id]
      if (!cached || cached.latitude !== store.latitude || cached.longitude !== store.longitude) {
        logger.warn(
          { store: store.id, err: (error as Error).message },
          'temperatura externa indisponível para a loja',
        )
        continue
      }
      points = cached.hourly
      origin = 'open-meteo-cache'
      logger.warn(
        { store: store.id, err: (error as Error).message },
        'Open-Meteo indisponível; usando o cache versionado',
      )
    }
    await pool.query(
      `INSERT INTO telemetry.outdoor_temperature (store_id, ts, value, source)
       SELECT $1, ts, value, $4 FROM unnest($2::timestamptz[], $3::real[]) AS t(ts, value)
       ON CONFLICT (store_id, ts) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source`,
      [store.id, points.map(([ts]) => ts), points.map(([, value]) => value), origin],
    )
    logger.info({ store: store.id, hours: points.length, origin }, 'temperatura externa gravada')
  }

  if (updateCache && Object.keys(fresh.stores).length === stores.length) {
    await Bun.write(config.WEATHER_CACHE_FILE, `${JSON.stringify(fresh)}\n`)
    logger.info({ file: config.WEATHER_CACHE_FILE }, 'cache da temperatura externa atualizado')
  }
}
