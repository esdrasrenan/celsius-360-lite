import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type {
  DailySeries,
  EnvironmentSummary,
  Series,
  SessionUser,
  StoreList,
  WeeklyProfile,
} from '@celsius/contracts'
import { createTestEnvironment, expected, type TestEnvironment } from '../../ingest/test/support'
import { startApi, type TestApi } from './support'

let env: TestEnvironment
let api: TestApi

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
  api = await startApi(env)
}, 180_000)

afterAll(async () => {
  await api?.close()
  await env?.cleanup()
})

describe('sessão', () => {
  test('sem cookie, a API responde 401 em formato problem+json', async () => {
    const response = await fetch(`${api.base}/api/v1/stores`)
    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
  })

  test('senha errada não entra', async () => {
    expect((await api.login('admin@teste.example', 'errada')).status).toBe(401)
  })

  test('o cookie é httpOnly e /auth/me devolve o escopo', async () => {
    const response = await api.login('gerente@teste.example')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    const { body } = await api.get<SessionUser>('/api/v1/auth/me', 'gerente')
    expect(body).toMatchObject({ role: 'gerente_loja', allStores: false, storeIds: ['LOJA-T-PE'] })
  })
})

describe('visão da rede', () => {
  test('administrador vê todas as lojas, com status e indicadores', async () => {
    const { status, body } = await api.get<StoreList>('/api/v1/stores?period=1d', 'admin')
    expect(status).toBe(200)
    expect(body.total).toBe(2)
    expect(body.now).toBe(expected.now)
    expect(body.totals).toMatchObject({ stores: 2, environments: 3, online: 2, offline: 1 })
    const centro = body.items.find((store) => store.id === 'LOJA-T-SP')
    expect(centro?.status).toBe('degraded')
    expect(centro?.timezone).toBe('America/Sao_Paulo')
    expect(centro?.environments.map((environment) => environment.status)).toEqual(['online', 'offline'])
    expect(centro?.environments[0]).toMatchObject({ deviceId: 'DEV-A', lastContactAt: expect.any(String) })
  })

  test('a ordenação padrão traz primeiro a loja com problema', async () => {
    const { body } = await api.get<StoreList>('/api/v1/stores', 'admin')
    expect(body.items[0]?.id).toBe('LOJA-T-SP')
  })

  test('filtra por status, busca sem acento e pagina', async () => {
    const degraded = await api.get<StoreList>('/api/v1/stores?status=degraded', 'admin')
    expect(degraded.body.items.map((store) => store.id)).toEqual(['LOJA-T-SP'])
    const search = await api.get<StoreList>('/api/v1/stores?search=sao%20paulo', 'admin')
    expect(search.body.items.map((store) => store.id)).toEqual(['LOJA-T-SP'])
    const page = await api.get<StoreList>('/api/v1/stores?sort=name&pageSize=1&page=2', 'admin')
    expect(page.body).toMatchObject({ total: 2, page: 2, pageSize: 1 })
    expect(page.body.items.map((store) => store.name)).toEqual(['Loja Centro'])
  })

  test('parâmetro inválido vira 400 com o campo na resposta', async () => {
    const { status, body } = await api.get<{ errors: Array<{ field: string }> }>(
      '/api/v1/stores?sort=qualquer',
      'admin',
    )
    expect(status).toBe(400)
    expect(body.errors.map((error) => error.field)).toContain('sort')
  })

  test('"agora" é meia-noite em São Paulo: só a sala técnica 24 h está aberta, e cada loja diz quando abre', async () => {
    const { body } = await api.get<StoreList>('/api/v1/stores', 'admin')
    expect(body.totals.openNow).toBe(1)
    const centro = body.items.find((store) => store.id === 'LOJA-T-SP')
    const recife = body.items.find((store) => store.id === 'LOJA-T-PE')
    expect(centro?.environmentCounts.openNow).toBe(1)
    // Um ambiente aberto basta para a loja não ter "abre às"
    expect(centro?.nextOpenAt).toBeNull()
    expect(centro?.environments.find((environment) => environment.id === 'AMB-T2')).toMatchObject({
      openNow: true,
      nextOpenAt: null,
    })
    // Quarta, 04/03: o salão abre às 09:00 de São Paulo; Recife, às 08:00
    expect(centro?.environments.find((environment) => environment.id === 'AMB-T1')).toMatchObject({
      openNow: false,
      nextOpenAt: '2026-03-04T12:00:00.000Z',
    })
    expect(recife?.nextOpenAt).toBe('2026-03-04T11:00:00.000Z')
  })
})

describe('multi-tenant', () => {
  test('gestor do cliente vê só as lojas do cliente', async () => {
    const { body } = await api.get<StoreList>('/api/v1/stores', 'gestor')
    expect(body.items.map((store) => store.id)).toEqual(['LOJA-T-SP'])
    const clients = await api.get<Array<{ id: string }>>('/api/v1/clients', 'gestor')
    expect(clients.body.map((client) => client.id)).toEqual(['CLI-T1'])
  })

  test('gerente vê só a loja dele, mesmo pedindo outra pelo id', async () => {
    const { body } = await api.get<StoreList>('/api/v1/stores', 'gerente')
    expect(body.items.map((store) => store.id)).toEqual(['LOJA-T-PE'])
    const other = await api.get<StoreList>('/api/v1/stores?storeId=LOJA-T-SP', 'gerente')
    expect(other.body.total).toBe(0)
  })

  test('ambiente de outro cliente responde 404 em todos os endpoints, como se não existisse', async () => {
    for (const path of ['summary', 'series', 'profile', 'daily']) {
      expect((await api.get(`/api/v1/environments/AMB-T3/${path}`, 'gestor')).status).toBe(404)
      expect((await api.get(`/api/v1/environments/AMB-T3/${path}`, 'gerente')).status).toBe(200)
    }
  })

  test('relatório de qualidade só para o administrador da Diel', async () => {
    const admin = await api.get<{ packets: { exactDuplicates: number } }>('/api/v1/quality', 'admin')
    expect(admin.status).toBe(200)
    expect(admin.body.packets.exactDuplicates).toBe(expected.exactDuplicates)
    expect((await api.get('/api/v1/quality', 'gestor')).status).toBe(403)
  })
})

describe('detalhe do ambiente', () => {
  const summaryOf = async (query: string, id = 'AMB-T1') =>
    (await api.get<EnvironmentSummary>(`/api/v1/environments/${id}/summary?${query}`, 'admin')).body

  test('o resumo traz status, indicadores e o que foi descartado no período', async () => {
    const body = await summaryOf('period=7d')
    expect(body.status.device).toBe('online')
    expect(body.indicators.discarded).toMatchObject({ stuck: expected.stuckSamples, sensorError: 1 })
    expect(body.indicators.comfortPct).toBeGreaterThan(0)
    // Só há 2 dos 7 dias com dados: a cobertura mostra isso em vez de esconder
    expect(body.indicators.coveragePct).toBeLessThan(40)
    const day = await summaryOf('period=1d')
    expect(day.indicators.coveragePct).toBeGreaterThan(95)
  })

  test('cobertura, temperatura no horário e lacunas no horário são coerentes entre si', async () => {
    const { indicators, status } = await summaryOf('period=7d')
    expect(status).toMatchObject({ openNow: false, nextOpenAt: '2026-03-04T12:00:00.000Z' })
    // 7 dias de 9 h, menos o domingo
    expect(indicators.minutesExpected).toBe(6 * 9 * 60)
    expect(indicators.coveragePct).toBeCloseTo(
      (100 * indicators.minutesInHours) / indicators.minutesExpected,
      1,
    )
    expect(indicators.valueAvgInHours).not.toBeNull()
    expect(indicators.valueMinInHours as number).toBeGreaterThanOrEqual(indicators.valueMin as number)
    expect(indicators.valueMaxInHours as number).toBeLessThanOrEqual(indicators.valueMax as number)
    expect(indicators.gapCountInHours).toBeLessThanOrEqual(indicators.gapCount)
    expect(indicators.gapMinutesInHours).toBeGreaterThan(0)
    expect(indicators.gapMinutesInHours).toBeLessThan(indicators.gapMinutes)
  })

  test('intervalo de 1 minuto sai da série, com limites exatos (sem bucket pela metade)', async () => {
    const body = await summaryOf('from=2026-03-03T15:01:00Z&to=2026-03-03T15:02:00Z')
    expect(body.period).toEqual({
      key: null,
      from: '2026-03-03T15:01:00.000Z',
      to: '2026-03-03T15:02:00.000Z',
    })
    expect(body.indicators).toMatchObject({ minutesExpected: 1, minutesInHours: 1, coveragePct: 100 })
    expect(body.indicators.comfortPct).not.toBeNull()
  })

  test('intervalo desalinhado acima de 8 h é alinhado aos buckets, e a janela efetiva volta em period', async () => {
    const body = await summaryOf('from=2026-03-03T02:07:00Z&to=2026-03-03T14:53:00Z')
    expect(body.period).toEqual({
      key: null,
      from: '2026-03-03T02:05:00.000Z',
      to: '2026-03-03T14:55:00.000Z',
    })
    // Abre às 09:00 de São Paulo (12:00 UTC): 2 h 55 min de expediente na janela efetiva
    expect(body.indicators.minutesExpected).toBe(175)
    expect(body.indicators.minutesInHours).toBeLessThanOrEqual(175)
  })

  test('a série escolhe a agregação pelo intervalo e marca o sensor travado', async () => {
    const week = await api.get<Series>('/api/v1/environments/AMB-T1/series?period=7d', 'admin')
    expect(week.body.bucket).toBe('15m')
    expect(week.body.points).toHaveLength(7 * 96)
    expect(week.body.gaps).toContainEqual(expect.objectContaining({ kind: 'discarded', reason: 'stuck' }))
    expect(week.body.outdoor.length).toBeGreaterThan(0)
    const hours = await api.get<Series>(
      '/api/v1/environments/AMB-T1/series?from=2026-03-03T12:00:00Z&to=2026-03-03T18:00:00Z',
      'admin',
    )
    expect(hours.body.bucket).toBe('raw')
  })

  test('bucket explícito que passaria de 5.000 pontos responde 400 em português', async () => {
    const range = 'from=2026-03-02T00:00:00Z&to=2026-03-04T00:00:00Z'
    const raw = await api.get<{ detail: string }>(
      `/api/v1/environments/AMB-T1/series?${range}&bucket=raw`,
      'admin',
    )
    expect(raw.status).toBe(400)
    expect(raw.body.detail).toContain('bucket=auto')
    const fine = await api.get<Series>(`/api/v1/environments/AMB-T1/series?${range}&bucket=5m`, 'admin')
    expect(fine.status).toBe(200)
    expect(fine.body.points).toHaveLength(2 * 288)
  })

  test('dispositivo desligado aparece como lacuna sem dados até "agora"', async () => {
    const { body } = await api.get<Series>('/api/v1/environments/AMB-T2/series?period=1d', 'admin')
    expect(body.gaps.at(-1)).toMatchObject({ kind: 'no_data', to: expected.now })
  })
})

describe('perfil semanal e conforto por dia', () => {
  test('o perfil tem 168 células no fuso da loja, com o horário do cadastro e sem zero inventado', async () => {
    const { status, body } = await api.get<WeeklyProfile>(
      '/api/v1/environments/AMB-T1/profile?period=7d',
      'admin',
    )
    expect(status).toBe(200)
    expect(body.timezone).toBe('America/Sao_Paulo')
    expect(body.cells).toHaveLength(168)
    const cell = (weekday: number, hour: number) =>
      body.cells.find((item) => item.weekday === weekday && item.hour === hour)
    // Segunda (ISO 1) abre das 09:00 às 18:00; domingo (ISO 7) não abre
    expect(cell(1, 8)?.open).toBe(false)
    expect(cell(1, 9)?.open).toBe(true)
    expect(cell(1, 17)?.open).toBe(true)
    expect(cell(1, 18)?.open).toBe(false)
    expect(body.cells.filter((item) => item.weekday === 7).every((item) => !item.open)).toBe(true)

    // Terça, 03/03, 10:00 local: um dia com leitura, percentuais fecham 100%
    const tuesday = cell(2, 10)
    expect(tuesday?.days).toBe(1)
    expect(tuesday?.minutesInHours).toBe(60)
    const sum = (tuesday?.withinPct ?? 0) + (tuesday?.abovePct ?? 0) + (tuesday?.belowPct ?? 0)
    expect(sum).toBeCloseTo(100, 1)
    // Sexta não tem leitura no fixture: nulo, nunca 0%
    expect(cell(5, 10)).toMatchObject({ days: 0, minutesInHours: 0, withinPct: null, valueAvg: null })
  })

  test('o conforto por dia cobre os dias locais do período e soma o mesmo que o resumo', async () => {
    const { body } = await api.get<DailySeries>('/api/v1/environments/AMB-T1/daily?period=7d', 'admin')
    expect(body.days.map((day) => day.day)).toEqual([
      '2026-02-25',
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
    ])
    const sunday = body.days.find((day) => day.day === '2026-03-01')
    expect(sunday).toMatchObject({
      minutesExpected: 0,
      minutesInHours: 0,
      coveragePct: null,
      comfortPct: null,
    })
    expect(body.days.find((day) => day.day === '2026-03-02')?.minutesExpected).toBe(9 * 60)

    const summary = await api.get<EnvironmentSummary>(
      '/api/v1/environments/AMB-T1/summary?period=7d',
      'admin',
    )
    const total = (key: 'minutesInHours' | 'minutesWithin' | 'minutesExpected') =>
      body.days.reduce((sum, day) => sum + day[key], 0)
    expect(total('minutesInHours')).toBe(summary.body.indicators.minutesInHours)
    expect(total('minutesWithin')).toBe(summary.body.indicators.minutesWithin)
    expect(total('minutesExpected')).toBe(summary.body.indicators.minutesExpected)
  })
})

describe('tempo real', () => {
  test('o ciclo de projeção avisa o SSE só com type, now e lastSeq', async () => {
    const controller = new AbortController()
    const response = await fetch(`${api.base}/api/v1/events`, {
      headers: { cookie: api.cookie('gestor'), accept: 'text/event-stream' },
      signal: controller.signal,
    })
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    await Bun.sleep(300)
    // Sem pacote novo, a ingestão ainda roda um ciclo de projeção (e o NOTIFY) ao subir
    await env.replay()

    let received = ''
    const deadline = Date.now() + 5000
    while (!received.includes('event: state_updated') && Date.now() < deadline) {
      const { value } = await reader.read()
      received += new TextDecoder().decode(value)
    }
    controller.abort()
    const block = received.slice(received.indexOf('event: state_updated'))
    const data = block.split('\n').find((line) => line.startsWith('data:'))
    expect(JSON.parse(data?.slice(5) ?? '{}')).toEqual({
      type: 'state_updated',
      now: expected.now,
      lastSeq: expected.lines,
    })
  })
})

describe('operação', () => {
  test('readiness informa o "agora" da ingestão', async () => {
    const { status, body } = await api.get<{ ingestionNow: string }>('/health/ready')
    expect(status).toBe(200)
    expect(body.ingestionNow).toBe(expected.now)
  })

  test('métricas Prometheus expostas', async () => {
    const response = await fetch(`${api.base}/metrics`)
    expect(await response.text()).toContain('celsius_http_request_duration_seconds')
  })
})
