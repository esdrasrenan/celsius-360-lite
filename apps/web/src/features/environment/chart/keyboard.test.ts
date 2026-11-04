import { describe, expect, test } from 'bun:test'
import { keyCommand, keyContext } from './keyboard'
import { buildModel } from './model'
import { at, sampleSeries } from './testing'

const model = buildModel(sampleSeries())

describe('teclado do gráfico (seção 5.10)', () => {
  test('pontas e página da janela visível', () => {
    // Janela de 12 h começando no meio de um bucket: o primeiro inteiro é o seguinte
    const context = keyContext(model, [at(10) + 60_000, at(22)], null)
    expect(context).toEqual({ count: 48, current: 21, first: 11, last: 21, page: 2 })
    expect(keyContext(model, [at(0), at(48)], 5).current).toBe(5)
  })

  test('setas andam um bucket, PageUp e PageDown 1/6 da janela, Home e End às pontas', () => {
    const context = { count: 48, current: 20, first: 10, last: 30, page: 4 }
    expect(keyCommand('ArrowLeft', context)).toEqual({ kind: 'point', index: 19 })
    expect(keyCommand('ArrowRight', context)).toEqual({ kind: 'point', index: 21 })
    expect(keyCommand('PageUp', context)).toEqual({ kind: 'point', index: 16 })
    expect(keyCommand('PageDown', context)).toEqual({ kind: 'point', index: 24 })
    expect(keyCommand('Home', context)).toEqual({ kind: 'point', index: 10 })
    expect(keyCommand('End', context)).toEqual({ kind: 'point', index: 30 })
  })

  test('nunca sai da série', () => {
    expect(keyCommand('ArrowLeft', { count: 48, current: 0, first: 0, last: 47, page: 8 })).toEqual({
      kind: 'point',
      index: 0,
    })
    expect(keyCommand('PageDown', { count: 48, current: 45, first: 0, last: 47, page: 8 })).toEqual({
      kind: 'point',
      index: 47,
    })
  })

  test('+ e − dão zoom, 0 redefine, Esc esconde e o resto passa adiante', () => {
    const context = { count: 48, current: 20, first: 0, last: 47, page: 8 }
    expect(keyCommand('+', context)).toEqual({ kind: 'zoom', factor: 0.5 })
    expect(keyCommand('=', context)).toEqual({ kind: 'zoom', factor: 0.5 })
    expect(keyCommand('-', context)).toEqual({ kind: 'zoom', factor: 2 })
    expect(keyCommand('0', context)).toEqual({ kind: 'reset' })
    expect(keyCommand('Escape', context)).toEqual({ kind: 'hide' })
    expect(keyCommand('Tab', context)).toBeNull()
    expect(keyCommand('a', context)).toBeNull()
  })
})
