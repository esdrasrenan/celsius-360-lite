import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { StoreList, StoreListItem } from '@celsius/contracts'
import { COMFORT_TARGET_PCT } from '@celsius/domain'
import { createTestEnvironment, expected, type TestEnvironment } from '../../ingest/test/support'
import { STORE_SORTS } from '../src/stores/stores.dto'
import { startApi, type TestApi } from './support'

let env: TestEnvironment
let api: TestApi

const DUPLICATES = 23
const week = (window: [string, string]) =>
  JSON.stringify(
    Object.fromEntries(['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'].map((day) => [day, window])),
  )
const HOURS = week(['10:00', '22:00'])
const ALL_DAY = week(['00:00', '24:00'])

/**
 * Além do fixture (Loja Centro em São Paulo e Agência Recife), uma loja com provadores, outra com o
 * dispositivo IOT014 (vitrine 24 h, quente agora) e 23 lojas de mesmo nome e mesmos indicadores,
 * para a paginação ter empates.
 */
async function seedNetwork() {
  await env.pool.query(`
    INSERT INTO registry.client (id, name, segment) VALUES
      ('CLI-T3', 'Moda Carioca', 'varejo'), ('CLI-T4', 'Rede Iguatemi', 'varejo');
    INSERT INTO registry.device (id) VALUES ('IOT003'), ('IOT014');
    INSERT INTO registry.store (id, client_id, name, kind, city, state_code, latitude, longitude, timezone, opening_hours)
    VALUES
      ('LOJA-RJ-001', 'CLI-T3', 'Loja Tijuca', 'loja de rua', 'Rio de Janeiro', 'RJ', -22.9, -43.2, 'America/Sao_Paulo', '${HOURS}'),
      ('LOJA-PE-001', 'CLI-T3', 'Loja Boa Viagem', 'loja de shopping', 'Recife', 'PE', -8.1, -34.9, 'America/Recife', '${HOURS}');
    INSERT INTO registry.environment (id, store_id, name, comfort_min, comfort_max, opening_hours, device_id) VALUES
      ('AMB-RJ-1', 'LOJA-RJ-001', 'Salão de vendas', 21, 25, '${HOURS}', NULL),
      ('AMB-RJ-3', 'LOJA-RJ-001', 'Provadores', 21, 25, '${HOURS}', 'IOT003'),
      ('AMB-PE-1', 'LOJA-PE-001', 'Vitrine', 21, 25, '${ALL_DAY}', 'IOT014');
    INSERT INTO state.device (device_id, last_contact_at, last_sample_at, last_valid_at, last_valid_value)
    VALUES ('IOT014', '${expected.now}', '${expected.now}', '${expected.now}', 30);
    INSERT INTO registry.store (id, client_id, name, kind, city, state_code, latitude, longitude, timezone, opening_hours)
    SELECT format('LOJA-IG-%s', lpad(n::text, 3, '0')), 'CLI-T4', 'Loja Shopping Iguatemi', 'loja de shopping',
      'Campinas', 'SP', -22.9, -47.1, 'America/Sao_Paulo', '${HOURS}'
    FROM generate_series(1, ${DUPLICATES}) AS n;
    INSERT INTO registry.environment (id, store_id, name, comfort_min, comfort_max, opening_hours)
    SELECT format('AMB-IG-%s', lpad(n::text, 3, '0')), format('LOJA-IG-%s', lpad(n::text, 3, '0')), 'Salão', 21, 25, '${HOURS}'
    FROM generate_series(1, ${DUPLICATES}) AS n;
  `)
}

const list = async (query: string, as: 'admin' | 'gestor' = 'admin') => {
  const response = await api.get<StoreList>(`/api/v1/stores?${query}`, as)
  expect(response.status).toBe(200)
  return response.body
}
const ids = (body: StoreList) => body.items.map((store) => store.id)

beforeAll(async () => {
  env = await createTestEnvironment()
  await env.replay()
  await seedNetwork()
  // Lojas novas no cadastro: a ingestão, ao subir sem pacote novo, projeta todas
  await env.replay()
  api = await startApi(env)
}, 180_000)

afterAll(async () => {
  await api?.close()
  await env?.cleanup()
})

describe('busca (P0 #6)', () => {
  test.each([
    ['provadores', ['LOJA-RJ-001']],
    ['rio tijuca', ['LOJA-RJ-001']],
    ['tijuca rio', ['LOJA-RJ-001']],
    ['provadores tijuca', ['LOJA-RJ-001']],
    ['IOT014', ['LOJA-PE-001']],
    ['Recife/PE', ['LOJA-PE-001', 'LOJA-T-PE']],
    ['LOJA-RJ-001', ['LOJA-RJ-001']],
    ['loja  tijuca', ['LOJA-RJ-001']],
    ['  LOJA   tijuca  ', ['LOJA-RJ-001']],
    ['sao paulo', ['LOJA-T-SP']],
    ['SÃO PAULO', ['LOJA-T-SP']],
    ['agencia', ['LOJA-T-PE']],
    ['moda carioca', ['LOJA-PE-001', 'LOJA-RJ-001']],
    ['sala tecnica', ['LOJA-T-SP']],
    ['dev-c', ['LOJA-T-PE']],
  ])('"%s" encontra as lojas certas', async (search, expected) => {
    const body = await list(`search=${encodeURIComponent(search)}&sort=name&pageSize=100`)
    expect(ids(body).sort()).toEqual(expected)
    expect(body.total).toBe(expected.length)
  })

  test.each(['%', '_', '__', '50%', 'a_b', '\\'])(
    '"%s" é texto, não curinga: nenhuma loja',
    async (search) => {
      const body = await list(`search=${encodeURIComponent(search)}`)
      expect(body.total).toBe(0)
      expect(body.items).toEqual([])
    },
  )

  test('caractere nulo dá 400, nunca 500', async () => {
    const response = await api.get<{ status: number }>('/api/v1/stores?search=%00', 'admin')
    expect(response.status).toBe(400)
    const mixed = await api.get('/api/v1/stores?search=loja%00tijuca', 'admin')
    expect(mixed.status).toBe(400)
  })

  test('até cinco termos: o sexto em diante é ignorado', async () => {
    const body = await list(`search=${encodeURIComponent('loja tijuca rio janeiro rj termo-que-nao-existe')}`)
    expect(ids(body)).toEqual(['LOJA-RJ-001'])
  })

  test('a busca respeita o escopo do usuário', async () => {
    expect((await list('search=tijuca', 'gestor')).total).toBe(0)
    expect(ids(await list('search=centro', 'gestor'))).toEqual(['LOJA-T-SP'])
  })
})

describe('paginação (P0 #23 e P1 #26)', () => {
  test.each(STORE_SORTS)(
    'ordenação "%s" percorre todas as páginas sem repetir nem pular loja',
    async (sort) => {
      const first = await list(`sort=${sort}&pageSize=5`)
      const pages = Math.ceil(first.total / 5)
      expect(first.total).toBe(4 + DUPLICATES)
      const seen: string[] = []
      for (let page = 1; page <= pages; page++) {
        seen.push(...ids(await list(`sort=${sort}&pageSize=5&page=${page}`)))
      }
      expect(seen).toHaveLength(first.total)
      expect(new Set(seen).size).toBe(first.total)
    },
  )

  test('página além do fim devolve a última, com total coerente', async () => {
    const last = await list('sort=name&pageSize=5&page=999')
    expect(last.page).toBe(Math.ceil(last.total / 5))
    expect(last.items.length).toBe(last.total - (last.page - 1) * 5)
    const empty = await list('search=nada-encontrado&page=3')
    expect(empty).toMatchObject({ page: 1, total: 0, items: [] })
  })
})

describe('filtros, pílulas e totais (P1 #24)', () => {
  const everything = () => list('pageSize=100')
  const environmentsOf = (stores: StoreListItem[]) => stores.flatMap((store) => store.environments)

  test('loja pelo id exato', async () => {
    expect(ids(await list('storeId=LOJA-RJ-001'))).toEqual(['LOJA-RJ-001'])
    expect((await list('storeId=LOJA-RJ')).total).toBe(0)
  })

  test('abaixo da meta e fora da faixa filtram pelas lojas com algum ambiente nessa condição', async () => {
    const all = await everything()
    const belowTarget = all.items.filter((store) =>
      store.environments.some((item) => item.comfortPct !== null && item.comfortPct < COMFORT_TARGET_PCT),
    )
    expect(belowTarget.map((store) => store.id)).toContain('LOJA-T-PE')
    expect(ids(await list('belowTarget=true&pageSize=100')).sort()).toEqual(
      ids({ ...all, items: belowTarget }).sort(),
    )
    // Só a vitrine 24 h de Boa Viagem está aberta e fora da faixa (30 °C) à meia-noite
    expect(ids(await list('outOfRange=true'))).toEqual(['LOJA-PE-001'])
    expect(all.totals).toMatchObject({ outOfRange: 1, above: 1, below: 0 })
    expect(all.facets.outOfRange).toBe(1)
    expect((await api.get('/api/v1/stores?belowTarget=sim', 'admin')).status).toBe(400)
  })

  test('as pílulas contam com a busca aplicada e ignoram o próprio filtro de status', async () => {
    const all = await everything()
    const byStatus = (status: string) => all.items.filter((store) => store.status === status).length
    const degraded = await list('status=degraded')
    expect(degraded.total).toBe(byStatus('degraded'))
    expect(degraded.facets.status).toEqual({
      online: byStatus('online'),
      degraded: byStatus('degraded'),
      offline: byStatus('offline'),
      no_data: byStatus('no_data'),
    })
    expect(degraded.facets.belowTarget).toBe(all.facets.belowTarget)

    const searched = await list('search=recife&status=online')
    expect(Object.values(searched.facets.status).reduce((sum, count) => sum + count, 0)).toBe(2)
  })

  test('totais ponderados pelo tempo e pior ambiente do recorte', async () => {
    const all = await everything()
    const { totals } = all
    expect(totals.stores).toBe(all.total)
    expect(totals.environments).toBe(environmentsOf(all.items).length)
    expect(totals.above + totals.below).toBe(totals.outOfRange)
    expect((totals.comfortPct ?? 0) + (totals.abovePct ?? 0) + (totals.belowPct ?? 0)).toBeCloseTo(100, 1)
    expect(totals.coveragePct).toBeGreaterThan(0)

    const rated = environmentsOf(all.items).filter((item) => item.comfortPct !== null)
    const worst = rated.reduce((min, item) =>
      (item.comfortPct as number) < (min.comfortPct as number) ? item : min,
    )
    expect(totals.worstEnvironment).toMatchObject({ id: worst.id, comfortPct: worst.comfortPct })
    const store = all.items.find((item) => item.id === totals.worstEnvironment?.storeId)
    expect(store?.worstEnvironment).toEqual(totals.worstEnvironment)
    expect(totals.worstEnvironment?.storeName).toBe(store?.name as string)
  })

  test('pior ambiente primeiro (worst_env): lojas sem conforto vão para o fim', async () => {
    const body = await list('sort=worst_env&pageSize=100')
    const comforts = body.items.map((store) => store.worstEnvironment?.comfortPct ?? null)
    const rated = comforts.filter((value) => value !== null) as number[]
    expect(rated).toEqual([...rated].sort((a, b) => a - b))
    expect(comforts.slice(rated.length).every((value) => value === null)).toBe(true)
  })
})
