/**
 * Sobe uma stack separada (projeto celsius-e2e, portas próprias) com os dados sintéticos de
 * test/fixtures/e2e e espera a ingestão terminar. Usa o shell do Bun, então roda igual no PowerShell,
 * no cmd e no bash, sem precisar de sh no PATH.
 *
 *   bun run scripts/e2e-stack.ts        sobe e espera a ingestão
 *   bun run scripts/e2e-stack.ts down   derruba e apaga os volumes da stack de E2E
 */
import { resolve } from 'node:path'
import { $ } from 'bun'

$.cwd(resolve(import.meta.dir, '..'))
$.env({
  ...process.env,
  COMPOSE_PROJECT_NAME: 'celsius-e2e',
  DATA_PATH: './test/fixtures/e2e',
  DEMO_PASSWORD: process.env.E2E_PASSWORD ?? 'senha-de-teste-123',
  INGEST_RATE: '0',
  WEB_PORT: '18080',
  API_PORT: '13000',
  POSTGRES_PORT: '15432',
  CLICKHOUSE_PORT: '18123',
  INGEST_METRICS_PORT: '19464',
})

if (process.argv[2] === 'down') {
  const { exitCode } = await $`docker compose down -v`.nothrow()
  process.exit(exitCode)
}

const up = await $`docker compose up -d --build`.nothrow()
if (up.exitCode !== 0) process.exit(up.exitCode)

// A ingestão roda uma vez e termina; espera o código de saída dela
const ingest = (await $`docker compose ps -a -q ingest`.text()).trim()
const status = (await $`docker wait ${ingest}`.text()).trim()
await $`docker compose logs --tail 3 ingest`.nothrow()
if (status !== '0') {
  console.error(`ingestão falhou (código ${status})`)
  process.exit(1)
}
console.info('stack de E2E pronta em http://127.0.0.1:18080')
