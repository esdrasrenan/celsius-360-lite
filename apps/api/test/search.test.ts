import { describe, expect, test } from 'bun:test'
import { searchPatterns } from '../src/stores/search'

describe('searchPatterns', () => {
  test('tira acento, passa para minúsculas e quebra em termos, ignorando espaços repetidos', () => {
    expect(searchPatterns('  São   PAULO ')).toEqual(['%sao%', '%paulo%'])
    expect(searchPatterns('Agência\tBancária')).toEqual(['%agencia%', '%bancaria%'])
  })

  test('escapa os curingas do LIKE e a própria barra', () => {
    expect(searchPatterns('50% a_b c\\d')).toEqual(['%50\\%%', '%a\\_b%', '%c\\\\d%'])
  })

  test('caracteres de controle separam termos; busca vazia não filtra', () => {
    expect(searchPatterns('loja\u0000tijuca')).toEqual(['%loja%', '%tijuca%'])
    expect(searchPatterns('   ')).toEqual([])
    expect(searchPatterns(undefined)).toEqual([])
  })

  test('no máximo cinco termos', () => {
    expect(searchPatterns('a b c d e f g')).toHaveLength(5)
  })
})
