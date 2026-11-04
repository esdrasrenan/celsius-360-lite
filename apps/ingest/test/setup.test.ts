import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pino from 'pino'
import { loadConfig } from '../src/config'
import { ensureSessionSecret } from '../src/jobs/session-secret'
import {
  formatAccess,
  PASSWORD_RESET_HINT,
  type RegistryFile,
  registryFileSchema,
  seedRegistry,
} from '../src/registry'
import { createTestEnvironment, FIXTURES, TEST_PASSWORD, type TestEnvironment } from './support'

const MAIN = resolve(import.meta.dir, '../src/main.ts')

describe('configuração', () => {
  test('valor inválido vira uma mensagem legível, com a variável e o mínimo', () => {
    expect(() => loadConfig({ DEMO_PASSWORD: 'curta' })).toThrow(
      /^Configuração inválida:[\s\S]*8 caracteres[\s\S]*DEMO_PASSWORD/,
    )
    expect(() => loadConfig({ JWT_SECRET: 'segredo-curto' })).toThrow(/32 caracteres[\s\S]*JWT_SECRET/)
  })

  test('a CLI encerra com código 1 e sem stack', async () => {
    const child = Bun.spawn(['bun', 'run', MAIN, 'migrate'], {
      env: { ...process.env, DEMO_PASSWORD: 'curta' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stderr = await new Response(child.stderr).text()
    expect(await child.exited).toBe(1)
    expect(stderr).toStartWith('Configuração inválida:')
    expect(stderr).not.toContain('ZodError')
  })
})

describe('segredo da sessão', () => {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'celsius-secret-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  const logger = pino({ level: 'silent' })

  test('o setup gera 48 caracteres uma única vez e mantém o mesmo nas subidas seguintes', async () => {
    const config = loadConfig({ JWT_SECRET_FILE: join(dir, 'celsius-secrets', 'jwt-secret') })
    await ensureSessionSecret(config, logger)
    const first = await Bun.file(config.JWT_SECRET_FILE as string).text()
    expect(first).toMatch(/^[A-Za-z0-9_-]{48}$/)
    await ensureSessionSecret(config, logger)
    expect(await Bun.file(config.JWT_SECRET_FILE as string).text()).toBe(first)
  })

  test('JWT_SECRET no .env tem precedência e dispensa o arquivo', async () => {
    const config = loadConfig({
      JWT_SECRET: 'um-segredo-do-env-com-mais-de-32-caracteres',
      JWT_SECRET_FILE: join(dir, 'outro', 'jwt-secret'),
    })
    await ensureSessionSecret(config, logger)
    expect(await Bun.file(config.JWT_SECRET_FILE as string).exists()).toBe(false)
  })
})

describe('senha de demonstração', () => {
  let env: TestEnvironment
  let registry: RegistryFile
  const logs: Array<{ level: number; msg: string }> = []
  const logger = pino({ level: 'info' }, { write: (line: string) => logs.push(JSON.parse(line)) })
  const hashes = async () =>
    (
      await env.pool.query<{ email: string; password_hash: string }>(
        'SELECT email, password_hash FROM registry.app_user',
      )
    ).rows

  beforeAll(async () => {
    env = await createTestEnvironment()
    registry = registryFileSchema.parse(await Bun.file(resolve(FIXTURES, 'cadastro.json')).json())
  }, 60_000)
  afterAll(async () => {
    await env?.cleanup()
  })

  test('sem DEMO_PASSWORD, quem já tem senha a mantém e o setup explica como redefinir', async () => {
    logs.length = 0
    const access = await seedRegistry(env.pool, registry, undefined, logger)
    expect(access).toMatchObject({ passwordFromEnv: false, generatedPassword: null })
    expect(access.previousPasswords).toBe(registry.usuarios.length)
    expect(logs).toContainEqual(expect.objectContaining({ level: 40, msg: PASSWORD_RESET_HINT }))
    for (const row of await hashes())
      expect(await Bun.password.verify(TEST_PASSWORD, row.password_hash)).toBe(true)

    const block = formatAccess(access, 'http://127.0.0.1:8080')
    expect(block).toContain('http://127.0.0.1:8080')
    expect(block).toContain('admin@teste.example')
    expect(block).toContain(PASSWORD_RESET_HINT)
  })

  test('com DEMO_PASSWORD, todos passam a usá-la e o quadro não a mostra', async () => {
    const access = await seedRegistry(env.pool, registry, 'senha-redefinida-1', logger)
    for (const row of await hashes()) {
      expect(await Bun.password.verify('senha-redefinida-1', row.password_hash)).toBe(true)
    }
    const block = formatAccess(access, 'http://127.0.0.1:8080')
    expect(block).toContain('DEMO_PASSWORD do arquivo .env')
    expect(block).not.toContain('senha-redefinida-1')
  })

  test('usuário novo, sem senha, recebe uma gerada, mostrada uma vez no quadro', async () => {
    await env.pool.query(
      "UPDATE registry.app_user SET password_hash = NULL WHERE email = 'gerente@teste.example'",
    )
    const access = await seedRegistry(env.pool, registry, undefined, logger)
    expect(access.generatedPassword).toMatch(/^[A-Za-z0-9]{16}$/)
    expect(access.previousPasswords).toBe(registry.usuarios.length - 1)
    const manager = (await hashes()).find((row) => row.email === 'gerente@teste.example')
    expect(await Bun.password.verify(access.generatedPassword as string, manager?.password_hash ?? '')).toBe(
      true,
    )
    expect(formatAccess(access, 'http://127.0.0.1:8080')).toContain(access.generatedPassword as string)
    expect(JSON.stringify(logs)).not.toContain(access.generatedPassword as string)
  })
})
