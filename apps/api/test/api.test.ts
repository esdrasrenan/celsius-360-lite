import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { EnvironmentSummary, Series, SessionUser, StoreList } from '@celsius/contracts'
import type { INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import {
  createTestEnvironment,
  expected,
  TEST_PASSWORD,
  type TestEnvironment,
} from '../../ingest/test/support'

let env: TestEnvironment
let app: INestApplication
let base = ''
const cookies: Record<string, string> = {}

async function login(email: string, password = TEST_PASSWORD) {
  return fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

async function get<T>(
  path: string,
  as?: 'admin' | 'gestor' | 'gerente',
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, { headers: as ? { cookie: cookies[as] as string } : {} })
  return { status: response.status, body: (await response.json().catch(() => null)) as T }
}

beforeAll(async () => {
  env = await createTestEnvironment()
  await env.replay()
  await env.qualityReport()
  // Temperatura externa sintética: os testes não dependem da API do Open-Meteo
  await env.pool.query(
    `INSERT INTO telemetry.outdoor_temperature (store_id, ts, value, source)
     SELECT 'LOJA-T-SP', ts, 26, 'teste'
     FROM generate_series('2026-03-02T00:00:00Z'::timestamptz, '2026-03-04T03:00:00Z', interval '1 hour') AS ts`,
  )
  Object.assign(process.env, {
    DATABASE_URL: env.databaseUrl,
    JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
    DEMO_MODE: 'true',
    LOG_LEVEL: 'silent',
  })
  const { AppModule } = await import('../src/app.module')
  const { configureApp } = await import('../src/setup')
  app = await NestFactory.create(AppModule, { logger: false })
  configureApp(app)
  await app.listen(0, '127.0.0.1')
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`

  for (const [key, email] of [
    ['admin', 'admin@teste.example'],
    ['gestor', 'gestor@teste.example'],
    ['gerente', 'gerente@teste.example'],
  ] as const) {
    const response = await login(email)
    cookies[key] = (response.headers.get('set-cookie') ?? '').split(';')[0] as string
  }
}, 180_000)

afterAll(async () => {
  await app?.close()
  await env?.cleanup()
})

describe('sessão', () => {
  test('sem cookie, a API responde 401 em formato problem+json', async () => {
    const response = await fetch(`${base}/api/v1/stores`)
    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
  })

  test('senha errada não entra', async () => {
    expect((await login('admin@teste.example', 'errada')).status).toBe(401)
  })

  test('o cookie é httpOnly e /auth/me devolve o escopo', async () => {
    const response = await login('gerente@teste.example')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    const { body } = await get<SessionUser>('/api/v1/auth/me', 'gerente')
    expect(body).toMatchObject({ role: 'gerente_loja', allStores: false, storeIds: ['LOJA-T-PE'] })
  })
})

describe('visão da rede', () => {
  test('administrador vê todas as lojas, com status e indicadores', async () => {
    const { status, body } = await get<StoreList>('/api/v1/stores?period=1d', 'admin')
    expect(status).toBe(200)
    expect(body.total).toBe(2)
    expect(body.now).toBe(expected.now)
    expect(body.totals).toMatchObject({ stores: 2, environments: 3, online: 2, offline: 1 })
    const centro = body.items.find((store) => store.id === 'LOJA-T-SP')
    expect(centro?.status).toBe('degraded')
    expect(centro?.environments.map((environment) => environment.status)).toEqual(['online', 'offline'])
  })

  test('a ordenação padrão traz primeiro a loja com problema', async () => {
    const { body } = await get<StoreList>('/api/v1/stores', 'admin')
    expect(body.items[0]?.id).toBe('LOJA-T-SP')
  })

  test('filtra por status, busca sem acento e pagina', async () => {
    const degraded = await get<StoreList>('/api/v1/stores?status=degraded', 'admin')
    expect(degraded.body.items.map((store) => store.id)).toEqual(['LOJA-T-SP'])
    const search = await get<StoreList>('/api/v1/stores?search=sao%20paulo', 'admin')
    expect(search.body.items.map((store) => store.id)).toEqual(['LOJA-T-SP'])
    const page = await get<StoreList>('/api/v1/stores?sort=name&pageSize=1&page=2', 'admin')
    expect(page.body).toMatchObject({ total: 2, page: 2, pageSize: 1 })
    expect(page.body.items.map((store) => store.name)).toEqual(['Loja Centro'])
  })

  test('parâmetro inválido vira 400 com a mensagem da validação', async () => {
    const { status, body } = await get<{ detail: string }>('/api/v1/stores?sort=qualquer', 'admin')
    expect(status).toBe(400)
    expect(body.detail).toContain('sort')
  })
})

describe('multi-tenant', () => {
  test('gestor do cliente vê só as lojas do cliente', async () => {
    const { body } = await get<StoreList>('/api/v1/stores', 'gestor')
    expect(body.items.map((store) => store.id)).toEqual(['LOJA-T-SP'])
    const clients = await get<Array<{ id: string }>>('/api/v1/clients', 'gestor')
    expect(clients.body.map((client) => client.id)).toEqual(['CLI-T1'])
  })

  test('gerente vê só a loja dele', async () => {
    const { body } = await get<StoreList>('/api/v1/stores', 'gerente')
    expect(body.items.map((store) => store.id)).toEqual(['LOJA-T-PE'])
  })

  test('ambiente de outro cliente responde 404, como se não existisse', async () => {
    expect((await get('/api/v1/environments/AMB-T3/summary', 'gestor')).status).toBe(404)
    expect((await get('/api/v1/environments/AMB-T3/series', 'gestor')).status).toBe(404)
    expect((await get('/api/v1/environments/AMB-T3/summary', 'gerente')).status).toBe(200)
  })

  test('relatório de qualidade só para o administrador da Diel', async () => {
    const admin = await get<{ packets: { exactDuplicates: number } }>('/api/v1/quality', 'admin')
    expect(admin.status).toBe(200)
    expect(admin.body.packets.exactDuplicates).toBe(expected.exactDuplicates)
    expect((await get('/api/v1/quality', 'gestor')).status).toBe(403)
  })
})

describe('detalhe do ambiente', () => {
  test('o resumo traz status, indicadores e o que foi descartado no período', async () => {
    const { body } = await get<EnvironmentSummary>('/api/v1/environments/AMB-T1/summary?period=7d', 'admin')
    expect(body.status.device).toBe('online')
    expect(body.indicators.discarded).toMatchObject({ stuck: expected.stuckSamples, sensorError: 1 })
    expect(body.indicators.comfortPct).toBeGreaterThan(0)
    // Só há 2 dos 7 dias com dados: a cobertura mostra isso em vez de esconder
    expect(body.indicators.coveragePct).toBeLessThan(40)
    const day = await get<EnvironmentSummary>('/api/v1/environments/AMB-T1/summary?period=1d', 'admin')
    expect(day.body.indicators.coveragePct).toBeGreaterThan(95)
  })

  test('a série escolhe a agregação pelo intervalo e marca o sensor travado', async () => {
    const week = await get<Series>('/api/v1/environments/AMB-T1/series?period=7d', 'admin')
    expect(week.body.bucket).toBe('15m')
    expect(week.body.points).toHaveLength(7 * 96)
    expect(week.body.gaps).toContainEqual(expect.objectContaining({ kind: 'invalid', reason: 'stuck' }))
    expect(week.body.outdoor.length).toBeGreaterThan(0)
    const hours = await get<Series>(
      '/api/v1/environments/AMB-T1/series?from=2026-03-03T12:00:00Z&to=2026-03-03T18:00:00Z',
      'admin',
    )
    expect(hours.body.bucket).toBe('raw')
  })

  test('dispositivo desligado aparece como lacuna sem dados até "agora"', async () => {
    const { body } = await get<Series>('/api/v1/environments/AMB-T2/series?period=1d', 'admin')
    expect(body.gaps.at(-1)).toMatchObject({ kind: 'no_data', to: expected.now })
  })
})

describe('tempo real (SSE)', () => {
  test('cada usuário recebe só os eventos das lojas do seu escopo', async () => {
    const controller = new AbortController()
    const response = await fetch(`${base}/api/v1/events`, {
      headers: { cookie: cookies.gestor as string, accept: 'text/event-stream' },
      signal: controller.signal,
    })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    const notify = (storeIds: string[]) =>
      env.pool.query("SELECT pg_notify('celsius_events', $1)", [
        JSON.stringify({ type: 'state_updated', now: expected.now, lastSeq: 1, storeIds }),
      ])

    await Bun.sleep(300)
    await notify(['LOJA-T-PE'])
    await notify(['LOJA-T-PE', 'LOJA-T-SP'])
    let received = ''
    const deadline = Date.now() + 5000
    while (!received.includes('state_updated') && Date.now() < deadline) {
      const { value } = await reader.read()
      received += new TextDecoder().decode(value)
    }
    controller.abort()
    const data = received.split('\n').find((line) => line.startsWith('data:'))
    expect(JSON.parse(data?.slice(5) ?? '{}').storeIds).toEqual(['LOJA-T-SP'])
  })
})

describe('operação', () => {
  test('readiness informa o "agora" da ingestão', async () => {
    const { status, body } = await get<{ ingestionNow: string }>('/health/ready')
    expect(status).toBe(200)
    expect(body.ingestionNow).toBe(expected.now)
  })

  test('métricas Prometheus expostas', async () => {
    const response = await fetch(`${base}/metrics`)
    expect(await response.text()).toContain('celsius_http_request_duration_seconds')
  })
})
