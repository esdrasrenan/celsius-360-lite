/**
 * Mede a visão da rede com centenas de lojas: grava N lojas sintéticas (cliente "Rede Sintética"),
 * com ambientes, estado e indicadores, e cronometra a listagem paginada da API em várias combinações
 * de filtro e ordenação. Use na stack de E2E (portas próprias) para não misturar com os dados reais.
 *
 *   bun run scripts/rede-sintetica.ts --lojas 500
 *   bun run scripts/rede-sintetica.ts --limpar
 */
import { parseArgs } from 'node:util'
import pg from 'pg'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    lojas: { type: 'string', default: '500' },
    banco: { type: 'string', default: 'postgres://celsius@localhost:15432/celsius' },
    api: { type: 'string', default: 'http://localhost:13000' },
    email: { type: 'string', default: 'admin@teste.example' },
    senha: { type: 'string', default: process.env.E2E_PASSWORD ?? 'senha-de-teste-123' },
    limpar: { type: 'boolean', default: false },
  },
})

const pool = new pg.Pool({ connectionString: values.banco })
const CLIENT = 'CLI-SINT'

async function clean() {
  await pool.query(`DELETE FROM state.store_snapshot WHERE store_id LIKE 'LOJA-SINT-%'`)
  await pool.query(`DELETE FROM state.environment_indicator WHERE environment_id LIKE 'AMB-SINT-%'`)
  await pool.query(`DELETE FROM state.environment_snapshot WHERE environment_id LIKE 'AMB-SINT-%'`)
  await pool.query(`DELETE FROM registry.environment WHERE id LIKE 'AMB-SINT-%'`)
  await pool.query(`DELETE FROM registry.store WHERE id LIKE 'LOJA-SINT-%'`)
  await pool.query(`DELETE FROM registry.client WHERE id = $1`, [CLIENT])
}

await clean()
if (values.limpar) {
  console.info('lojas sintéticas removidas')
  await pool.end()
  process.exit(0)
}

const total = Number(values.lojas)
const cities = [
  ['São Paulo', 'SP'],
  ['Campinas', 'SP'],
  ['Rio de Janeiro', 'RJ'],
  ['Belo Horizonte', 'MG'],
  ['Curitiba', 'PR'],
  ['Porto Alegre', 'RS'],
  ['Salvador', 'BA'],
  ['Recife', 'PE'],
  ['Fortaleza', 'CE'],
  ['Goiânia', 'GO'],
] as const
const hours = JSON.stringify(
  Object.fromEntries(
    ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'].map((day) => [day, ['10:00', '22:00']]),
  ),
)
const statuses = [
  'online',
  'online',
  'online',
  'online',
  'online',
  'online',
  'sensor_fault',
  'offline',
] as const
const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)] as T

await pool.query(`INSERT INTO registry.client (id, name, segment) VALUES ($1, 'Rede Sintética', 'varejo')`, [
  CLIENT,
])
const started = performance.now()
for (let index = 1; index <= total; index++) {
  const id = `LOJA-SINT-${String(index).padStart(4, '0')}`
  const [city, uf] = pick(cities)
  await pool.query(
    `INSERT INTO registry.store (id, client_id, name, kind, city, state_code, latitude, longitude, timezone, opening_hours)
     VALUES ($1, $2, $3, 'loja de shopping', $4, $5, -23.5, -46.6, 'America/Sao_Paulo', $6)`,
    [id, CLIENT, `Loja ${city} ${index}`, city, uf, hours],
  )
  const environments = Array.from({ length: 6 }, (_, position) => {
    const status = pick(statuses)
    const comfort = Math.round((60 + Math.random() * 40) * 100) / 100
    return {
      id: `AMB-SINT-${index}-${position}`,
      status,
      comfort,
      out: status === 'online' && Math.random() < 0.1,
    }
  })
  for (const environment of environments) {
    await pool.query(
      `INSERT INTO registry.environment (id, store_id, name, comfort_min, comfort_max, opening_hours)
       VALUES ($1, $2, $3, 21, 25, $4)`,
      [environment.id, id, `Ambiente ${environment.id.slice(-1)}`, hours],
    )
    await pool.query(
      `INSERT INTO state.environment_snapshot (environment_id, status, situation, last_value)
       VALUES ($1, $2, $3, 23.4)`,
      [environment.id, environment.status, environment.out ? 'above' : 'within'],
    )
    for (const period of ['1d', '7d', '30d']) {
      await pool.query(
        `INSERT INTO state.environment_indicator (environment_id, period, from_ts, to_ts, samples_in_hours,
           samples_within, samples_above, samples_below, samples_expected, samples_discarded, comfort_pct, coverage_pct)
         VALUES ($1, $2, now() - interval '1 day', now(), 1000, $3, 0, 0, 1000, 0, $4, 99)`,
        [environment.id, period, Math.round(environment.comfort * 10), environment.comfort],
      )
    }
  }
  const offline = environments.filter((environment) => environment.status === 'offline').length
  const fault = environments.filter((environment) => environment.status === 'sensor_fault').length
  const status = offline === environments.length ? 'offline' : offline + fault > 0 ? 'degraded' : 'online'
  const comfort =
    environments.reduce((sum, environment) => sum + environment.comfort, 0) / environments.length
  for (const period of ['1d', '7d', '30d']) {
    await pool.query(
      `INSERT INTO state.store_snapshot (store_id, period, status, status_rank, environments, env_online,
         env_sensor_fault, env_offline, env_no_data, env_out_of_range, env_below_target, samples_in_hours,
         samples_within, comfort_pct, coverage_pct)
       VALUES ($1, $2, $3, $4, 6, $5, $6, $7, 0, $8, $9, 6000, $10, $11, 99)`,
      [
        id,
        period,
        status,
        status === 'offline' ? 3 : status === 'degraded' ? 2 : 0,
        6 - offline - fault,
        fault,
        offline,
        environments.filter((environment) => environment.out).length,
        environments.filter((environment) => environment.comfort < 90).length,
        Math.round(comfort * 60),
        Math.round(comfort * 100) / 100,
      ],
    )
  }
}
console.info(
  `${total} lojas e ${total * 6} ambientes gravados em ${Math.round(performance.now() - started)} ms`,
)
await pool.end()

const login = await fetch(`${values.api}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: values.email, password: values.senha }),
})
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
const scenarios = [
  'period=7d&sort=status',
  'period=30d&sort=comfort',
  'period=1d&sort=out_of_range&status=degraded,offline',
  'period=7d&search=campinas',
  'period=30d&sort=name&page=20',
]
const timings: number[] = []
for (let round = 0; round < 20; round++) {
  for (const scenario of scenarios) {
    const start = performance.now()
    const response = await fetch(`${values.api}/api/v1/stores?${scenario}`, { headers: { cookie } })
    await response.json()
    timings.push(performance.now() - start)
  }
}
timings.sort((a, b) => a - b)
const p = (q: number) => timings[Math.floor(q * (timings.length - 1))]?.toFixed(1)
console.info(
  `visão da rede com ${total + 2} lojas, ${timings.length} requisições: p50 ${p(0.5)} ms · p95 ${p(0.95)} ms`,
)
