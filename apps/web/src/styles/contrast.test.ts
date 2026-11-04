import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

/**
 * Critério 8.2: lê styles.css, resolve os tokens e confere os pares da seção 1.2 com a fórmula do
 * WCAG 2 (a mesma de paleta-final.ts). Texto pede 4,5:1; objeto gráfico e borda de controle, 3:1.
 */

const css = await Bun.file(resolve(import.meta.dir, '../styles.css')).text()

// Remove comentários antes de ler as declarações "--nome: valor;"
const declarations = new Map(
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)].map((match) => [
    match[1] as string,
    (match[2] as string).trim(),
  ]),
)

function hexOf(token: string, seen = new Set<string>()): string {
  const value = declarations.get(token)
  if (!value) throw new Error(`Token ausente em styles.css: ${token}`)
  const reference = /^var\((--[\w-]+)\)$/.exec(value)
  if (reference) {
    if (seen.has(token)) throw new Error(`Referência circular: ${token}`)
    return hexOf(reference[1] as string, seen.add(token))
  }
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${token} não é uma cor sólida: ${value}`)
  return value
}

const channel = (value: number) => {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

function contrast(a: string, b: string) {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const TEXT = 4.5
const GRAPHIC = 3
const c = (name: string) => `--color-${name}`
const g = (name: string) => `--grafico-${name}`

// [frente, fundo, mínimo, uso]
const PAIRS: Array<[string, string, number, string]> = [
  [c('texto'), c('superficie'), TEXT, 'texto principal'],
  [c('texto'), c('fundo'), TEXT, 'texto principal sobre gelo'],
  [c('texto-2'), c('superficie'), TEXT, 'corpo'],
  [c('texto-3'), c('superficie'), TEXT, 'rótulo e metadado'],
  [c('texto-3'), c('fundo'), TEXT, 'rótulo sobre gelo'],
  [c('texto-3'), c('superficie-3'), TEXT, 'rótulo sobre gelo-2'],
  [c('texto-3'), c('superficie-2'), TEXT, 'cabeçalho de tabela'],
  [c('borda-controle'), c('superficie'), GRAPHIC, 'input, select, segmentado'],
  [c('borda-controle'), c('fundo'), GRAPHIC, 'controle sobre gelo'],
  [c('acento'), c('superficie'), TEXT, 'link'],
  [c('acento'), c('acento-fundo'), TEXT, 'página atual, selo'],
  [c('texto-inverso'), c('inverso'), TEXT, 'botão primário, dica'],
  [c('texto-inverso-2'), c('inverso'), TEXT, 'texto da dica'],
  [c('ok-texto'), c('ok-fundo'), TEXT, 'badge ok'],
  [c('ok-texto'), c('superficie'), TEXT, 'texto ok'],
  [c('alerta-texto'), c('alerta-fundo'), TEXT, 'badge alerta'],
  [c('alerta-texto'), c('superficie'), TEXT, 'número fora da meta'],
  [c('falha-texto'), c('falha-fundo'), TEXT, 'badge falha'],
  [c('falha-texto'), c('superficie'), TEXT, 'erro'],
  [c('quente-texto'), c('quente-fundo'), TEXT, 'badge acima'],
  [c('frio-texto'), c('frio-fundo'), TEXT, 'badge abaixo'],
  [c('neutro-texto'), c('neutro-fundo'), TEXT, 'badge neutro'],
  [c('ok'), c('superficie'), GRAPHIC, 'ponto ok'],
  [c('alerta'), c('superficie'), GRAPHIC, 'ponto alerta'],
  [c('falha'), c('superficie'), GRAPHIC, 'ponto falha'],
  [c('neutro'), c('superficie'), GRAPHIC, 'ponto neutro'],
  [c('quente'), c('superficie'), GRAPHIC, 'linha acima'],
  [c('frio'), c('superficie'), GRAPHIC, 'linha abaixo'],
  [c('na-faixa'), c('superficie-3'), GRAPHIC, 'segmento na faixa sobre o trilho'],
  [c('frio'), c('superficie-3'), GRAPHIC, 'segmento abaixo sobre o trilho'],
  [c('quente'), c('superficie-3'), GRAPHIC, 'segmento acima sobre o trilho'],
  [c('texto'), c('superficie-3'), GRAPHIC, 'marca da meta sobre o trilho'],
  [c('faixa-borda'), c('superficie'), GRAPHIC, 'limites da faixa'],
  [c('faixa-texto'), c('superficie'), TEXT, 'rótulos da faixa'],
  [c('marca-ciano-claro'), c('marca-noite'), TEXT, 'manchete do login'],
  [c('texto-inverso-3'), c('marca-noite'), TEXT, 'parágrafo do login'],
  [g('externa'), g('superficie'), GRAPHIC, 'linha externa'],
  [g('eixo'), g('superficie'), TEXT, 'rótulos dos eixos'],
  [g('faixa-borda'), g('superficie'), GRAPHIC, 'limites da faixa no gráfico'],
  [g('faixa-texto'), g('superficie'), TEXT, 'rótulos da faixa no gráfico'],
  [g('acima'), g('superficie'), GRAPHIC, 'temperatura acima'],
  [g('abaixo'), g('superficie'), GRAPHIC, 'temperatura abaixo'],
  [g('temperatura'), g('superficie'), GRAPHIC, 'temperatura na faixa'],
  [g('fora-horario'), g('superficie'), GRAPHIC, 'temperatura com a loja fechada'],
  [g('comparacao'), g('superficie'), GRAPHIC, 'período anterior'],
]

describe('contraste dos tokens (seção 1.2)', () => {
  test.each(PAIRS)('%s sobre %s ≥ %s:1 (%s)', (front, back, minimum) => {
    expect(contrast(hexOf(front), hexOf(back))).toBeGreaterThanOrEqual(minimum)
  })

  test('a fórmula bate com os números da especificação', () => {
    expect(contrast('#0b0c59', '#ffffff')).toBeCloseTo(17.34, 2)
    expect(contrast('#5f6490', '#ffffff')).toBeCloseTo(5.66, 2)
    expect(contrast('#8489ab', '#ffffff')).toBeCloseTo(3.42, 2)
  })
})
