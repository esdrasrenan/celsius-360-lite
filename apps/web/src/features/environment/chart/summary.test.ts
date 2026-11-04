import { describe, expect, test } from 'bun:test'
import { NBSP } from '../../../lib/format'
import { buildModel } from './model'
import { type ChartIndicators, describeChart } from './summary'
import { sampleSeries, TZ } from './testing'

const model = buildModel(sampleSeries())
// Os espaços inquebráveis de "21–25 °C" e "26,9 °C" viram espaço comum para a leitura do teste
const spoken = (indicators?: ChartIndicators | null) =>
  describeChart(model, TZ, indicators).replaceAll(NBSP, ' ')
const HEAD = 'Médias de 1 h de 09/02 00:00 a 11/02 00:00, horário de Recife.'
const TAIL = 'máxima de 26,9 °C em 09/02 às 15:00; 1 lacuna somando 2 h.'

describe('resumo do gráfico para leitor de tela (seção 5.10)', () => {
  test('com os indicadores do período, repete os números dos KPIs (minutos, não buckets)', () => {
    expect(spoken({ comfortPct: 82.46, minutesAbove: 3480, minutesBelow: 95 })).toBe(
      `${HEAD} 82,4% do horário na faixa de 21–25 °C; 58 h acima; 1 h 35 min abaixo; ${TAIL}`,
    )
    expect(spoken({ comfortPct: 100, minutesAbove: 0, minutesBelow: 0 })).toBe(
      `${HEAD} 100% do horário na faixa de 21–25 °C; ${TAIL}`,
    )
  })

  test('sem indicadores, ou sem conforto no período, conta as médias com a loja aberta e diz isso', () => {
    const counted = `${HEAD} Com a loja aberta, 90,9% das médias na faixa de 21–25 °C; 1 h acima; 1 h abaixo; ${TAIL}`
    expect(spoken()).toBe(counted)
    expect(spoken({ comfortPct: null, minutesAbove: 0, minutesBelow: 0 })).toBe(counted)
  })
})
