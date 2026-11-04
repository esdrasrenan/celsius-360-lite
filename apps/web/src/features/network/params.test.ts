import { describe, expect, test } from 'bun:test'
import type { StoreListItem } from '@celsius/contracts'
import { defaultOpen, environmentMatches, filterCount, nextView, parseView, serializeView } from './params'

const parse = (query: string) => parseView(new URLSearchParams(query))
const canonical = (query: string) => serializeView(parse(query)).toString()

describe('parseView', () => {
  test('sem parâmetros, os padrões', () => {
    expect(parse('')).toEqual({
      period: '1d',
      search: '',
      clientId: null,
      storeId: null,
      status: 'todas',
      belowTarget: false,
      outOfRange: false,
      sort: 'status',
      page: 1,
      pageSize: 20,
      open: null,
    })
  })

  test('propriedade herdada não passa por valor válido (o caso ordem=toString)', () => {
    const view = parse('ordem=toString&status=constructor&periodo=__proto__')
    expect(view.sort).toBe('status')
    expect(view.status).toBe('todas')
    expect(view.period).toBe('1d')
  })

  test('valores inválidos voltam ao padrão', () => {
    const view = parse('status=xyz&pagina=0&porPagina=33&abaixoDaMeta=sim&foraDaFaixa=true')
    expect(view).toMatchObject({
      status: 'todas',
      page: 1,
      pageSize: 20,
      belowTarget: false,
      outOfRange: false,
    })
    expect(parse('pagina=-2').page).toBe(1)
    expect(parse('pagina=2.5').page).toBe(1)
    expect(parse('pagina=abc').page).toBe(1)
  })

  test('valores válidos', () => {
    expect(
      parse(
        'periodo=30d&busca=tijuca&cliente=CLI-001&status=atencao&abaixoDaMeta=1&ordem=comfort&pagina=3&porPagina=50',
      ),
    ).toMatchObject({
      period: '30d',
      search: 'tijuca',
      clientId: 'CLI-001',
      status: 'atencao',
      belowTarget: true,
      sort: 'comfort',
      page: 3,
      pageSize: 50,
    })
  })

  test('a busca é limitada a 80 caracteres e guarda o espaço de quem ainda digita', () => {
    expect(parse(`busca=${'a'.repeat(85)}`).search).toHaveLength(80)
    expect(parse('busca=rio%20').search).toBe('rio ')
    expect(filterCount(parse('busca=%20%20'))).toBe(0)
  })

  test('abertas: ausente segue o padrão; vazio é "todas recolhidas"', () => {
    expect(parse('').open).toBeNull()
    expect(parse('abertas=').open).toEqual([])
    expect(parse('abertas=LOJA-RJ-001,,LOJA-PE-001').open).toEqual(['LOJA-RJ-001', 'LOJA-PE-001'])
  })
})

describe('serializeView', () => {
  test('a URL canônica omite os padrões e o que era inválido', () => {
    expect(canonical('periodo=1d&ordem=toString&pagina=1&porPagina=20&status=todas')).toBe('')
    expect(canonical('pagina=2&periodo=7d')).toBe('periodo=7d&pagina=2')
  })

  test('mantém abertas vazio', () => {
    expect(canonical('abertas=')).toBe('abertas=')
  })

  test('ida e volta', () => {
    const query =
      'periodo=30d&busca=rio+tijuca&cliente=CLI-001&status=offline&abaixoDaMeta=1&ordem=name&pagina=2&porPagina=100&abertas=A%2CB'
    expect(canonical(query)).toBe(query)
  })
})

describe('nextView', () => {
  const base = parse('periodo=7d&pagina=3&abertas=LOJA-A')

  test('filtro, ordem ou tamanho da página voltam à página 1 e à abertura padrão', () => {
    expect(nextView(base, { status: 'online' })).toMatchObject({ page: 1, open: null, status: 'online' })
    expect(nextView(base, { sort: 'name' })).toMatchObject({ page: 1, open: null })
    expect(nextView(base, { pageSize: 50 })).toMatchObject({ page: 1, open: null, pageSize: 50 })
  })

  test('o período volta à página 1, mas mantém as lojas abertas', () => {
    expect(nextView(base, { period: '30d' })).toMatchObject({ page: 1, open: ['LOJA-A'] })
  })

  test('página e abertura não mexem no resto', () => {
    expect(nextView(base, { page: 4 })).toMatchObject({ page: 4, open: ['LOJA-A'] })
    expect(nextView(base, { open: [] })).toMatchObject({ page: 3, open: [] })
  })
})

test('filterCount ignora período, ordem e página', () => {
  expect(filterCount(parse('periodo=30d&ordem=name&pagina=2'))).toBe(0)
  expect(filterCount(parse('busca=x&cliente=CLI-1&status=online&abaixoDaMeta=1&foraDaFaixa=1&loja=L'))).toBe(
    6,
  )
})

const store = (id: string, patch: Partial<StoreListItem['environmentCounts']> = {}, status = 'online') =>
  ({
    id,
    status,
    environmentCounts: { belowTarget: 0, outOfRange: 0, ...patch },
    environments: [{ id: `${id}-AMB`, name: 'Provadores', deviceId: 'IOT003' }],
  }) as unknown as StoreListItem

describe('defaultOpen', () => {
  test('com até 3 lojas, todas abrem', () => {
    expect(defaultOpen([store('A'), store('B'), store('C')], '')).toEqual(['A', 'B', 'C'])
  })

  test('acima disso, só as com exceção ou com ambiente encontrado pela busca', () => {
    const items = [
      store('A'),
      store('B', { belowTarget: 1 }),
      store('C', { outOfRange: 2 }),
      store('D', {}, 'offline'),
    ]
    expect(defaultOpen(items, '')).toEqual(['B', 'C', 'D'])
    expect(defaultOpen([...items, store('E')], 'provador')).toEqual(['A', 'B', 'C', 'D', 'E'])
  })
})

test('environmentMatches compara sem acento e por nome, código ou dispositivo', () => {
  const environment = { id: 'AMB-014', name: 'Salão de vendas - Vitrine', deviceId: 'IOT014' }
  expect(environmentMatches(environment, 'salao')).toBe(true)
  expect(environmentMatches(environment, 'iot014')).toBe(true)
  expect(environmentMatches(environment, 'recife vitrine')).toBe(true)
  expect(environmentMatches(environment, 'recife')).toBe(false)
  expect(environmentMatches(environment, '')).toBe(false)
})
