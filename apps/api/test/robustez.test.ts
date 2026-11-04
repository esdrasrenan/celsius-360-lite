import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ProblemDetails, QualityReport } from '@celsius/contracts'
import { type INestApplication, ServiceUnavailableException } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type pg from 'pg'
import {
  createTestEnvironment,
  expected,
  TEST_PASSWORD,
  type TestEnvironment,
} from '../../ingest/test/support'
import { AttemptLimiter } from '../src/auth/attempt-limiter'
import { parseInstant } from '../src/common/time'
import { ConfigError, loadConfig } from '../src/config'
import { HttpMetrics } from '../src/ops/http-metrics'
import { OpsController } from '../src/ops/ops.controller'

let env: TestEnvironment
let app: INestApplication
let base = ''
const cookies: Record<string, string> = {}

/** IP de origem simulado: a API confia em um salto de proxy, como atrás do nginx. */
function login(
  email: string,
  password = TEST_PASSWORD,
  ip = '198.51.100.1',
  extra: Record<string, string> = {},
) {
  return fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...extra },
    body: JSON.stringify({ email, password }),
  })
}

async function get<T>(
  path: string,
  as?: 'admin' | 'gestor',
): Promise<{ status: number; type: string; body: T }> {
  const response = await fetch(`${base}${path}`, { headers: as ? { cookie: cookies[as] as string } : {} })
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    body: (await response.json().catch(() => null)) as T,
  }
}

/** Lê um fluxo SSE evento a evento (blocos separados por linha em branco). */
async function openEvents(cookie?: string) {
  const controller = new AbortController()
  const response = await fetch(`${base}/api/v1/events`, {
    headers: { accept: 'text/event-stream', ...(cookie ? { cookie } : {}) },
    signal: controller.signal,
  })
  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  async function next(): Promise<{ event: string; data: unknown }> {
    for (;;) {
      const end = buffer.indexOf('\n\n')
      if (end >= 0) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const field = (name: string) =>
          block
            .split('\n')
            .find((line) => line.startsWith(`${name}:`))
            ?.slice(name.length + 1)
            .trim()
        return { event: field('event') ?? 'message', data: JSON.parse(field('data') ?? 'null') }
      }
      const { value, done } = await reader.read()
      if (done) throw new Error('o fluxo SSE terminou')
      buffer += decoder.decode(value, { stream: true })
    }
  }
  return { response, next, close: () => controller.abort() }
}

beforeAll(async () => {
  env = await createTestEnvironment()
  await env.replay()
  await env.qualityReport()
  Object.assign(process.env, {
    DATABASE_URL: env.databaseUrl,
    JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
    JWT_SECRET_FILE: '',
    COOKIE_SECURE: 'false',
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
  ] as const) {
    const response = await login(email)
    cookies[key] = (response.headers.get('set-cookie') ?? '').split(';')[0] as string
  }
}, 180_000)

afterAll(async () => {
  await app?.close()
  await env?.cleanup()
})

describe('from e to (P0 #1)', () => {
  const invalid = ['2026-W05-1', '2026-035', '20260201', '2026-02-30T00:00:00Z', '2026-03-03T00:00:00']

  test('só aceita ISO 8601 com fuso e com data que existe', () => {
    for (const value of invalid) expect(parseInstant(value)).toBeNull()
    expect(parseInstant('2026-02-01T24:00:00Z')).toBeNull()
    expect(parseInstant('2026-03-03T09:00:00-03:00')).toBe(Date.parse('2026-03-03T12:00:00Z'))
    expect(parseInstant('2026-03-03T12:00Z')).toBe(Date.parse('2026-03-03T12:00:00Z'))
    expect(parseInstant('2028-02-29T00:00:00.250Z')).toBe(Date.parse('2028-02-29T00:00:00.250Z'))
  })

  test('cada entrada inválida dá 400 com o campo, e a API continua de pé', async () => {
    const to = '2026-03-04T00:00:00Z'
    for (const route of ['series', 'summary']) {
      for (const value of invalid) {
        const from = encodeURIComponent(value)
        const { status, type, body } = await get<ProblemDetails>(
          `/api/v1/environments/AMB-T1/${route}?from=${from}&to=${to}`,
          'admin',
        )
        expect(status).toBe(400)
        expect(type).toContain('application/problem+json')
        expect(body.errors).toEqual([{ field: 'from', message: expect.stringContaining('fuso') }])
      }
    }
    // Antes, a série com data inválida rejeitava uma promise sem tratamento e o processo caía
    await Bun.sleep(500)
    expect((await get('/health/live')).status).toBe(200)
    const valid = await get(
      `/api/v1/environments/AMB-T1/series?from=2026-03-03T00:00:00-03:00&to=${to}`,
      'admin',
    )
    expect(valid.status).toBe(200)
  })

  test('intervalo invertido, maior que 92 dias ou pela metade dá 400 com mensagem em português', async () => {
    const cases: Array<[string, string, string]> = [
      [
        'from=2026-03-04T00:00:00Z&to=2026-03-03T00:00:00Z',
        'to',
        'O fim (to) precisa ser depois do início (from).',
      ],
      ['from=2025-11-01T00:00:00Z&to=2026-03-04T00:00:00Z', 'to', 'O intervalo aceita no máximo 92 dias.'],
      ['from=2026-03-03T00:00:00Z', 'to', 'Informe o início (from) e o fim (to) juntos.'],
    ]
    for (const [query, field, detail] of cases) {
      const { status, body } = await get<ProblemDetails>(
        `/api/v1/environments/AMB-T1/summary?${query}`,
        'admin',
      )
      expect(status).toBe(400)
      expect(body).toMatchObject({ detail, errors: [{ field, message: detail }] })
    }
  })
})

describe('problem+json (P0 #8)', () => {
  test('validação no formato da RFC 9457, com detail e errors em português', async () => {
    const response = await fetch(`${base}/api/v1/stores?period=2d`, {
      headers: { cookie: cookies.admin as string, 'x-request-id': 'teste-123' },
    })
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    expect(await response.json()).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Período inválido: use 1d, 7d ou 30d.',
      instance: '/api/v1/stores?period=2d',
      requestId: 'teste-123',
      errors: [{ field: 'period', message: 'Período inválido: use 1d, 7d ou 30d.' }],
    })
  })

  test('cada parâmetro errado tem a própria mensagem', async () => {
    const search = 'a'.repeat(81)
    const { body } = await get<ProblemDetails>(`/api/v1/stores?search=${search}&pageSize=0&foo=1`, 'admin')
    expect(body.errors).toEqual(
      expect.arrayContaining([
        { field: 'search', message: 'A busca aceita até 80 caracteres.' },
        { field: 'pageSize', message: 'O tamanho da página precisa ser um número inteiro de 1 a 100.' },
        { field: 'foo', message: 'Parâmetro desconhecido: foo.' },
      ]),
    )
    expect(body.detail).toContain('A busca aceita até 80 caracteres.')

    const filters = await get<ProblemDetails>(
      '/api/v1/stores?search=loja%00tijuca&belowTarget=sim&outOfRange=1',
      'admin',
    )
    expect(filters.body.errors).toEqual(
      expect.arrayContaining([
        { field: 'search', message: 'A busca não aceita o caractere nulo.' },
        { field: 'belowTarget', message: 'belowTarget aceita só true ou false.' },
        { field: 'outOfRange', message: 'outOfRange aceita só true ou false.' },
      ]),
    )
  })

  test('erros fora das rotas (rota inexistente, JSON malformado) também saem em português', async () => {
    const missing = await get<ProblemDetails>('/api/v1/nao-existe', 'admin')
    expect(missing.status).toBe(404)
    expect(missing.body).toMatchObject({ title: 'Not Found', detail: 'Recurso não encontrado.' })
    expect(missing.body.requestId).toBeString()

    const malformed = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"email": ',
    })
    const body = (await malformed.json()) as ProblemDetails
    expect(malformed.status).toBe(400)
    expect(body.detail).toBe('Requisição inválida: confira os parâmetros e o corpo enviado.')
    expect(body.requestId).toBe(malformed.headers.get('x-request-id') as string)
  })

  test('401 e 403 com detail em português', async () => {
    expect((await get<ProblemDetails>('/api/v1/stores')).body).toMatchObject({
      status: 401,
      title: 'Unauthorized',
      detail: 'Sessão ausente ou expirada.',
    })
    expect((await get<ProblemDetails>('/api/v1/quality', 'gestor')).body).toMatchObject({
      status: 403,
      detail: 'Seu perfil não tem acesso a este recurso.',
    })
  })

  test('a readiness não expõe a mensagem do banco', async () => {
    const pool = { query: () => Promise.reject(new Error('password authentication failed')) }
    const controller = new OpsController(pool as unknown as pg.Pool, new HttpMetrics())
    const error = await controller.ready().catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ServiceUnavailableException)
    expect((error as Error).message).toBe('Banco indisponível ou não migrado.')
  })
})

describe('tempo real (P0 #10)', () => {
  test('sem sessão, o SSE responde 401', async () => {
    const { response, close } = await openEvents()
    expect(response.status).toBe(401)
    close()
  })

  test('o primeiro evento é o snapshot da ingestão', async () => {
    await env.pool.query('UPDATE state.ingestion SET updated_at = now()')
    const live = await openEvents(cookies.gestor)
    const first = await live.next()
    live.close()
    expect(first.event).toBe('snapshot')
    expect(first.data).toEqual({
      type: 'snapshot',
      now: expected.now,
      lastSeq: expect.any(Number),
      ingesting: true,
    })
    expect((first.data as { lastSeq: number }).lastSeq).toBeGreaterThan(0)

    await env.pool.query("UPDATE state.ingestion SET updated_at = now() - interval '1 minute'")
    const later = await openEvents(cookies.gestor)
    expect((await later.next()).data).toMatchObject({ ingesting: false })
    later.close()
  })

  test('state_updated repassa só type, now e lastSeq, com ou sem storeIds no NOTIFY', async () => {
    const live = await openEvents(cookies.gestor)
    expect((await live.next()).event).toBe('snapshot')
    const notify = (payload: string) => env.pool.query("SELECT pg_notify('celsius_events', $1)", [payload])
    await notify(
      JSON.stringify({ type: 'state_updated', now: expected.now, lastSeq: 7, storeIds: ['LOJA-T-PE'] }),
    )
    await notify('isto não é json')
    await notify(JSON.stringify({ type: 'state_updated', now: expected.now, lastSeq: 8 }))

    const events = [await live.next(), await live.next()]
    live.close()
    expect(events).toEqual([
      { event: 'state_updated', data: { type: 'state_updated', now: expected.now, lastSeq: 7 } },
      { event: 'state_updated', data: { type: 'state_updated', now: expected.now, lastSeq: 8 } },
    ])
  })
})

describe('login (P1 #28)', () => {
  test('o limitador libera a chave quando a janela vence e descarta as entradas velhas', () => {
    const limiter = new AttemptLimiter(2, 1000)
    limiter.hit('a', 0)
    expect(limiter.retryAfterMs('a', 10)).toBe(0)
    limiter.hit('a', 10)
    expect(limiter.retryAfterMs('a', 10)).toBe(990)
    expect(limiter.retryAfterMs('a', 1000)).toBe(0)
    limiter.hit('b', 500)
    limiter.hit('c', 1200)
    expect(limiter.size).toBe(2)
  })

  test('5 falhas no mesmo e-mail bloqueiam, mesmo trocando o IP e acertando a senha depois', async () => {
    for (let n = 1; n <= 5; n++) {
      expect((await login('gestor@teste.example', 'errada', `10.9.8.${n}`)).status).toBe(401)
    }
    const blocked = await login('gestor@teste.example', TEST_PASSWORD, '10.9.8.6')
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(200)
    expect(((await blocked.json()) as ProblemDetails).detail).toBe(
      'Muitas tentativas de entrada. Tente de novo em 5 min.',
    )
  })

  test('mais de 20 tentativas por minuto do mesmo IP dão 429; o valor que o cliente põe na frente não conta', async () => {
    for (let n = 1; n <= 20; n++) {
      const response = await login(`ninguem${n}@teste.example`, 'errada', `172.16.0.${n}, 203.0.113.7`)
      expect(response.status).toBe(401)
    }
    expect((await login('ninguem21@teste.example', 'errada', '172.16.9.9, 203.0.113.7')).status).toBe(429)
    expect((await login('ninguem22@teste.example', 'errada', '203.0.113.8')).status).toBe(401)
  })

  test('senha acima de 256 e e-mail acima de 254 caracteres dão 400', async () => {
    const longPassword = await login('admin@teste.example', 'x'.repeat(257), '198.51.100.9')
    expect(longPassword.status).toBe(400)
    expect(((await longPassword.json()) as ProblemDetails).errors).toEqual([
      { field: 'password', message: 'Informe a senha, com até 256 caracteres.' },
    ])
    const longEmail = await login(`${'a'.repeat(64)}@${'b'.repeat(186)}.com`, 'x', '198.51.100.9')
    expect(((await longEmail.json()) as ProblemDetails).errors?.[0]?.field).toBe('email')
  })

  test('o cookie é Secure quando a requisição chega por HTTPS', async () => {
    const https = await login('admin@teste.example', TEST_PASSWORD, '198.51.100.10', {
      'x-forwarded-proto': 'https',
    })
    expect(https.headers.get('set-cookie')).toContain('Secure')
    const http = await login('admin@teste.example', TEST_PASSWORD, '198.51.100.10')
    expect(http.headers.get('set-cookie')).not.toContain('Secure')
  })
})

describe('configuração (P0 #3 e #22)', () => {
  const required = { DEMO_MODE: 'false' }

  test('segredo curto ou ausente encerra com mensagem legível', () => {
    expect(() => loadConfig({ ...required, JWT_SECRET: 'curto' })).toThrow(
      'JWT_SECRET precisa ter ao menos 32 caracteres',
    )
    expect(() => loadConfig(required)).toThrow(
      'Configuração inválida:\n✖ defina JWT_SECRET (mínimo 32 caracteres) ou JWT_SECRET_FILE',
    )
    expect(() => loadConfig({ ...required, JWT_SECRET_FILE: '/nao/existe' })).toThrow(ConfigError)
  })

  test('o segredo vem do arquivo do volume; sem nenhum, só o DEMO_MODE gera um temporário', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'celsius-segredo-'))
    try {
      const file = join(dir, 'jwt-secret')
      await writeFile(file, `${'s'.repeat(48)}\n`)
      expect(loadConfig({ ...required, JWT_SECRET_FILE: file })).toMatchObject({
        JWT_SECRET: 's'.repeat(48),
        generatedSecret: false,
      })
      const demo = loadConfig({ DEMO_MODE: 'true' })
      expect(demo.generatedSecret).toBe(true)
      expect(demo.JWT_SECRET.length).toBeGreaterThanOrEqual(32)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('a API sai com código 1 e sem pilha quando a configuração é inválida', async () => {
    const child = Bun.spawn([process.execPath, 'run', resolve(import.meta.dir, '../src/main.ts')], {
      env: { ...process.env, JWT_SECRET: 'curto', JWT_SECRET_FILE: '', DEMO_MODE: 'false', PORT: '0' },
      stderr: 'pipe',
      stdout: 'pipe',
    })
    expect(await child.exited).toBe(1)
    const stderr = await new Response(child.stderr).text()
    expect(stderr).toContain('Configuração inválida:')
    expect(stderr).toContain('JWT_SECRET precisa ter ao menos 32 caracteres')
    expect(stderr).not.toContain('    at ')
  })
})

describe('relatório de qualidade', () => {
  test('devolve exatamente os campos do contrato', async () => {
    const { status, body } = await get<QualityReport>('/api/v1/quality', 'admin')
    expect(status).toBe(200)
    expect(Object.keys(body).sort()).toEqual(
      ['devices', 'gaps', 'generatedAt', 'packets', 'samples', 'source', 'stuckEpisodes'].sort(),
    )
    expect(body.packets.exactDuplicates).toBe(expected.exactDuplicates)
    expect(body.packets.futureTimestamp).toEqual({ packets: 0, toleranceMinutes: 10, devices: [] })
  })

  test('sem relatório, 404 em problem+json com o motivo', async () => {
    await env.pool.query('DELETE FROM state.quality_report')
    const { status, type, body } = await get<ProblemDetails>('/api/v1/quality', 'admin')
    expect(status).toBe(404)
    expect(type).toContain('application/problem+json')
    expect(body.detail).toStartWith('O relatório de qualidade ainda não foi gerado')
  })
})

describe('pool do Postgres (P0 #2)', () => {
  test('derrubar as conexões do pool não derruba a API: a próxima requisição responde 200', async () => {
    expect((await get('/api/v1/environments/AMB-T1/summary', 'admin')).status).toBe(200)
    const { rows } = await env.pool.query<{ terminated: boolean }>(
      `SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity
       WHERE datname = current_database() AND application_name = 'celsius-api'`,
    )
    expect(rows.length).toBeGreaterThan(0)
    await Bun.sleep(500)
    expect((await get('/api/v1/environments/AMB-T1/summary', 'admin')).status).toBe(200)
    expect((await get('/health/ready')).status).toBe(200)
  })
})
