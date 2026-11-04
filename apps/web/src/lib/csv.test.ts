import { describe, expect, test } from 'bun:test'
import { csvCell, toCsv } from './csv'

describe('célula do CSV', () => {
  test('número com vírgula decimal, sem milhar e sem apóstrofo no negativo', () => {
    expect([1234.5, -12.5, 22, 0.125].map(csvCell)).toEqual(['1234,5', '-12,5', '22', '0,13'])
  })

  test('texto que a planilha leria como fórmula ganha apóstrofo', () => {
    expect(['=1+1', '+SUM(1;1)', '-2', '@A1', '\tx'].map(csvCell)).toEqual([
      "'=1+1",
      `"'+SUM(1;1)"`,
      "'-2",
      "'@A1",
      "'\tx",
    ])
  })

  test('aspas só quando precisa, com as internas dobradas', () => {
    expect(csvCell('Salão; "vitrine"')).toBe('"Salão; ""vitrine"""')
    expect(csvCell('Provadores')).toBe('Provadores')
    expect(csvCell(null)).toBe('')
  })
})

test('BOM UTF-8, ";" entre as células e CRLF no fim de cada linha', () => {
  expect(
    toCsv([
      ['Ambiente', 'Conforto (%)'],
      ['Provadores', 93.2],
    ]),
  ).toBe('﻿Ambiente;Conforto (%)\r\nProvadores;93,2\r\n')
})
