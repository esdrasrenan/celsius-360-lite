import { describe, expect, test } from 'bun:test'
import type { LayerVisibility } from './layers'
import { buildModel } from './model'
import { describeChart } from './summary'
import { at, HOUR, iso, sampleSeries, TZ } from './testing'
import { announcement, CLOSED_NOTE, previousLabel, stripText, tooltipContent } from './tooltip'

const model = buildModel(sampleSeries())
const visible: LayerVisibility = {
  temperature: true,
  spread: true,
  outdoor: true,
  comfort: true,
  closed: true,
  previous: false,
}

describe('tooltip (seção 5.3, achado 52)', () => {
  test('intervalo do bucket, dia da semana, valores e situação com o desvio', () => {
    const content = tooltipContent(model, 15, visible, TZ)
    expect(content?.header).toBe('seg, 09/02 · 15:00–16:00')
    expect(content?.subheader).toBe('Média de 1 h · horário de Recife')
    expect(content?.rows).toEqual([
      { swatch: 'temperature-above', label: 'Temperatura', value: '26,4 °C' },
      { swatch: 'spread', label: 'Variação no intervalo', value: '25,9–26,9 °C' },
      { swatch: 'outdoor', label: 'Externa', value: '31,0 °C' },
    ])
    expect(content?.status).toEqual({ kind: 'situation', state: 'above', deviation: '+1,4 °C' })
    expect(content?.notes).toEqual([])
  })

  test('na faixa, sem desvio', () => {
    expect(tooltipContent(model, 12, visible, TZ)?.status).toEqual({
      kind: 'situation',
      state: 'within',
      deviation: null,
    })
  })

  test('loja fechada substitui a situação', () => {
    const content = tooltipContent(model, 3, visible, TZ)
    expect(content?.status).toBeNull()
    expect(content?.notes).toEqual([{ kind: 'closed', text: CLOSED_NOTE }])
    expect(content?.rows[0]?.swatch).toBe('temperature-closed')
  })

  test('lacuna: sem leitura válida, com o motivo e o intervalo', () => {
    const content = tooltipContent(model, 37, visible, TZ)
    expect(content?.rows[0]).toEqual({
      swatch: 'temperature-closed',
      label: 'Temperatura',
      value: 'Sem leitura válida',
    })
    expect(content?.notes).toEqual([
      { kind: 'discarded', text: 'Sensor travado · 10/02 13:00 – 10/02 15:00 (2 h)' },
    ])
    expect(content?.status).toBeNull()
  })

  test('séries desligadas não entram', () => {
    const content = tooltipContent(model, 15, { ...visible, spread: false, outdoor: false }, TZ)
    expect(content?.rows.map((row) => row.label)).toEqual(['Temperatura'])
    const noTemperature = tooltipContent(model, 15, { ...visible, temperature: false }, TZ)
    expect(noTemperature?.rows.map((row) => row.label)).toEqual(['Variação no intervalo', 'Externa'])
    // A situação continua: é o que o ponto significa, com ou sem a linha
    expect(noTemperature?.status).toMatchObject({ state: 'above' })
  })

  test('período anterior com a data real e a diferença', () => {
    const before = sampleSeries({ from: iso(at(-48)), to: iso(at(0)) })
    before.points = before.points.map((point, index) => ({ ...point, t: iso(at(index - 48)), avg: 25 }))
    const compared = buildModel(sampleSeries(), before)
    const row = tooltipContent(compared, 15, { ...visible, previous: true }, TZ)?.rows.at(-1)
    expect(row).toEqual({ swatch: 'previous', label: '2 dias antes (sáb 07/02)', value: '25,0 °C (−1,4)' })
    expect(previousLabel(7 * 24 * HOUR)).toBe('7 dias antes')
    expect(previousLabel(24 * HOUR)).toBe('24 horas antes')
  })
})

test('tira de situação: estado, intervalo e duração', () => {
  const above = model.strip.find((segment) => segment.state === 'above')
  expect(above && stripText(above, TZ)).toBe('Acima da faixa · 09/02 15:00–16:00 (1 h)')
  const closed = model.strip.find((segment) => segment.state === 'closed' && segment.from === at(22))
  expect(closed && stripText(closed, TZ)).toBe('Loja fechada · 09/02 22:00–10/02 10:00 (12 h)')
})

test('anúncio do teclado', () => {
  expect(announcement(model, 15, TZ)).toBe('seg 09/02 15:00, 26,4 °C, acima da faixa')
  expect(announcement(model, 3, TZ)).toBe('seg 09/02 03:00, 23,0 °C, loja fechada')
  expect(announcement(model, 37, TZ)).toBe('ter 10/02 13:00, sem leitura válida, sensor travado')
})

test('resumo para leitor de tela, gerado dos dados', () => {
  const text = describeChart(model, TZ)
  expect(
    text.startsWith('Médias de 1 h de 09/02 00:00 a 11/02 00:00, horário de Recife. Com a loja aberta,'),
  ).toBe(true)
  expect(text).toContain('1 h acima')
  expect(text).toContain('1 h abaixo')
  expect(text).toContain('máxima de 26,9 °C em 09/02 às 15:00')
  expect(text).toContain('1 lacuna somando 2 h')
})
