import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClickHouseClient } from '@clickhouse/client'
import type pg from 'pg'
import type { Logger } from './infra'

async function sqlFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort()
}

/** Aplica as migrações do Postgres em ordem, cada uma numa transação, e recusa arquivo alterado depois de aplicado. */
export async function migratePostgres(pool: pg.Pool, migrationsDir: string, logger: Logger): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.schema_migration (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const { rows } = await pool.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM public.schema_migration',
  )
  const applied = new Map(rows.map((row) => [row.name, row.checksum]))
  const dir = join(migrationsDir, 'postgres')

  for (const file of await sqlFiles(dir)) {
    const sql = await Bun.file(join(dir, file)).text()
    const checksum = createHash('sha256').update(sql).digest('hex')
    const previous = applied.get(file)
    if (previous) {
      if (previous !== checksum)
        throw new Error(`A migração ${file} mudou depois de aplicada; crie uma nova migração`)
      continue
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO public.schema_migration (name, checksum) VALUES ($1, $2)', [
        file,
        checksum,
      ])
      await client.query('COMMIT')
      logger.info({ file }, 'migração do Postgres aplicada')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

/** As DDLs do ClickHouse usam IF NOT EXISTS e podem ser reaplicadas a cada subida. */
export async function migrateClickHouse(clickhouse: ClickHouseClient, migrationsDir: string, logger: Logger) {
  const dir = join(migrationsDir, 'clickhouse')
  for (const file of await sqlFiles(dir)) {
    const statements = (await Bun.file(join(dir, file)).text())
      .split(/;\s*$/m)
      .map((statement) =>
        statement
          .split('\n')
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n')
          .trim(),
      )
      .filter(Boolean)
    for (const query of statements) await clickhouse.command({ query })
    logger.info({ file, statements: statements.length }, 'migração do ClickHouse aplicada')
  }
}
