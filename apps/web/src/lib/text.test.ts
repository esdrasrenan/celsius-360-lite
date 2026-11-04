import { describe, expect, test } from 'bun:test'
import { foldText, highlightRanges, matchesSearch, truncateMiddle } from './text'

describe('busca sem acento', () => {
  test('dobra acento e caixa', () => {
    expect(foldText('São Paulo')).toBe('sao paulo')
    expect(matchesSearch('Moda Carioca', 'carióca')).toBe(true)
    expect(matchesSearch('Loja Tijuca · Rio de Janeiro', 'rio tijuca')).toBe(true)
    expect(matchesSearch('Loja Tijuca', 'tijuka')).toBe(false)
  })

  test('destaca no texto original, mesmo com acento e com vários termos', () => {
    const text = 'Salão de vendas - São Paulo'
    const marked = (query: string) => highlightRanges(text, query).map(([a, b]) => text.slice(a, b))
    expect(marked('sao')).toEqual(['São'])
    expect(marked('salao paulo')).toEqual(['Salão', 'Paulo'])
    expect(marked('a')).toHaveLength(5)
    expect(marked('')).toEqual([])
    // Trechos sobrepostos viram um só
    expect(marked('sal salao')).toEqual(['Salão'])
  })

  test('trunca e-mail no meio', () => {
    expect(truncateMiddle('ana.ribeiro@diel.example', 16)).toBe('ana.ribe…example')
    expect(truncateMiddle('curto@x.io', 16)).toBe('curto@x.io')
  })
})
