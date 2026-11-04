import { expect, test } from 'bun:test'
import type { EnvironmentListItem, StoreListItem } from '@celsius/contracts'
import { csvFileName, storesCsv } from './csv'

const environment = (patch: Partial<EnvironmentListItem>): EnvironmentListItem => ({
  id: 'AMB-003',
  name: 'Provadores',
  deviceId: 'IOT003',
  status: 'online',
  situation: 'closed',
  lastValue: 22.7,
  lastValidAt: '2026-02-11T02:57:21.000Z',
  lastContactAt: '2026-02-11T02:57:21.000Z',
  comfortRange: { min: 22, max: 25 },
  comfortPct: 0.29,
  abovePct: 0,
  belowPct: 99.71,
  coveragePct: 99.83,
  openNow: false,
  nextOpenAt: null,
  ...patch,
})

const store = {
  id: 'LOJA-RJ-001',
  name: 'Loja Tijuca',
  kind: 'loja de rua',
  city: 'Rio de Janeiro',
  state: 'RJ',
  client: { id: 'CLI-001', name: 'Moda Carioca' },
  status: 'online',
  environments: [
    environment({}),
    environment({
      id: 'AMB-002',
      name: 'Salão; "vitrine"',
      lastValue: null,
      lastValidAt: null,
      comfortPct: null,
    }),
    environment({ id: 'AMB-009', name: '=HYPERLINK("x")', status: 'offline', situation: 'unknown' }),
  ],
} as unknown as StoreListItem

const lines = (csv: string) => csv.slice(1).trimEnd().split('\r\n')

test('BOM UTF-8, separador ";" e uma linha por ambiente', () => {
  const csv = storesCsv([store])
  expect(csv.charCodeAt(0)).toBe(0xfeff)
  expect(lines(csv)).toHaveLength(4)
  expect(lines(csv)[0]?.split(';')).toHaveLength(20)
})

test('vírgula decimal, data no horário de Brasília e rótulos do vocabulário', () => {
  const [, first] = lines(storesCsv([store]))
  expect(first).toBe(
    'LOJA-RJ-001;Loja Tijuca;Moda Carioca;Rio de Janeiro;RJ;loja de rua;Online;AMB-003;Provadores;IOT003;Online;Fechado;22,7;10/02/2026 23:57;22;25;0,29;99,71;0;99,83',
  )
})

test('ausência fica vazia, e texto com ";" ou aspas vai entre aspas', () => {
  const [, , second] = lines(storesCsv([store]))
  expect(second?.split(';').slice(8, 9)).toEqual(['"Salão'])
  expect(second).toContain('"Salão; ""vitrine"""')
  expect(second).toContain(';Fechado;;;22;25;;')
})

test('texto que viraria fórmula ganha apóstrofo', () => {
  const [, , , third] = lines(storesCsv([store]))
  expect(third).toContain(`;"'=HYPERLINK(""x"")";`)
  expect(third).toContain(';Offline;Sem leitura;')
})

test('nome do arquivo com o período e o dia do "agora"', () => {
  expect(csvFileName('30d', '2026-02-11T02:59:56.000Z')).toBe('celsius360-lojas-30d-2026-02-10.csv')
  expect(csvFileName('1d', null)).toBe('celsius360-lojas-1d-sem-dados.csv')
})
