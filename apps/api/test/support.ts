import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { TEST_PASSWORD, type TestEnvironment } from '../../ingest/test/support'

export type Profile = 'admin' | 'gestor' | 'gerente'

const EMAILS: Record<Profile, string> = {
  admin: 'admin@teste.example',
  gestor: 'gestor@teste.example',
  gerente: 'gerente@teste.example',
}

export interface TestApi {
  base: string
  login(email: string, password?: string): Promise<Response>
  get<T>(path: string, as?: Profile): Promise<{ status: number; body: T }>
  cookie(as: Profile): string
  close(): Promise<void>
}

/** Sobe a API sobre o banco de teste, numa porta livre, e entra com os três perfis do fixture. */
export async function startApi(env: TestEnvironment): Promise<TestApi> {
  Object.assign(process.env, {
    DATABASE_URL: env.databaseUrl,
    JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
    JWT_SECRET_FILE: '',
    COOKIE_SECURE: 'false',
    DEMO_MODE: 'true',
    LOG_LEVEL: 'silent',
  })
  const { AppModule } = await import('../src/app.module')
  const { configureApp, NEST_OPTIONS } = await import('../src/setup')
  const app: INestApplication = await NestFactory.create(AppModule, { logger: false, ...NEST_OPTIONS })
  configureApp(app)
  await app.listen(0, '127.0.0.1')
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`

  const login = (email: string, password = TEST_PASSWORD) =>
    fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  const cookies = {} as Record<Profile, string>
  for (const [profile, email] of Object.entries(EMAILS) as Array<[Profile, string]>) {
    const response = await login(email)
    cookies[profile] = (response.headers.get('set-cookie') ?? '').split(';')[0] as string
  }

  return {
    base,
    login,
    cookie: (as) => cookies[as],
    async get<T>(path: string, as?: Profile) {
      const response = await fetch(`${base}${path}`, { headers: as ? { cookie: cookies[as] } : {} })
      return { status: response.status, body: (await response.json().catch(() => null)) as T }
    },
    close: () => app.close(),
  }
}
