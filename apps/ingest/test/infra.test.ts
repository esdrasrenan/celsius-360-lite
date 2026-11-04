import { describe, expect, test } from 'bun:test'
import pg from 'pg'
import { createLogger, createPool, isConnectionError, retryOnConnectionError } from '../src/infra'

const databaseUrl = process.env.TEST_DATABASE_URL ?? 'postgres://celsius@127.0.0.1:55432/celsius'
const logger = createLogger('silent', 'test')

/** Derruba, como um reinício do banco, as conexões com este application_name. */
async function terminate(applicationName: string) {
  const admin = new pg.Client({ connectionString: databaseUrl })
  await admin.connect()
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1', [
    applicationName,
  ])
  await admin.end()
}

describe('queda do Postgres', () => {
  test('o pool sobrevive ao fim das conexões ociosas e a consulta seguinte funciona', async () => {
    const name = `celsius-test-pool-${process.pid}`
    const pool = createPool(databaseUrl, logger, name)
    try {
      await pool.query('SELECT 1')
      expect(pool.idleCount).toBe(1)
      await terminate(name)
      // O pool descarta a conexão que caiu; sem o ouvinte de 'error' do createPool, o evento derrubaria o processo
      for (let wait = 0; pool.totalCount > 0 && wait < 50; wait++) await Bun.sleep(100)
      expect(pool.totalCount).toBe(0)
      const { rows } = await pool.query<{ ok: number }>('SELECT 1 AS ok')
      expect(rows[0]?.ok).toBe(1)
    } finally {
      await pool.end()
    }
  })

  test('a conexão que cai no meio de uma transação falha na consulta seguinte, sem derrubar o processo', async () => {
    const name = `celsius-test-tx-${process.pid}`
    const pool = createPool(databaseUrl, logger, name)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await terminate(name)
      await Bun.sleep(300)
      const failed = await client.query('SELECT 1').catch((error: Error) => error)
      expect(isConnectionError(failed)).toBe(true)
    } finally {
      client.release()
    }
    try {
      const { rows } = await pool.query<{ ok: number }>('SELECT 1 AS ok')
      expect(rows[0]?.ok).toBe(1)
    } finally {
      await pool.end()
    }
  })

  test('erro de conexão é repetido; erro de SQL, não', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })
    const terminated = Object.assign(new Error('terminating connection due to administrator command'), {
      code: '57P01',
    })
    const syntax = Object.assign(new Error('syntax error at or near "SELEC"'), { code: '42601' })
    expect(isConnectionError(refused)).toBe(true)
    expect(isConnectionError(terminated)).toBe(true)
    expect(isConnectionError(new Error('Connection terminated unexpectedly'))).toBe(true)
    expect(isConnectionError(syntax)).toBe(false)

    let calls = 0
    const result = await retryOnConnectionError(
      async () => {
        calls++
        if (calls < 3) throw terminated
        return 'retomou do checkpoint'
      },
      logger,
      { delayMs: 1 },
    )
    expect(result).toBe('retomou do checkpoint')
    expect(calls).toBe(3)
    await expect(retryOnConnectionError(() => Promise.reject(syntax), logger, { delayMs: 1 })).rejects.toBe(
      syntax,
    )
  })
})
