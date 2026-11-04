import { describe, expect, test } from 'bun:test'
import { ApiError } from '../api/client'
import { comfortTone, gapState } from '../lib/states'
import { describeError } from './ErrorState'
import { pageList } from './Pagination'

describe('paginação truncada', () => {
  test('poucas páginas aparecem todas', () => {
    expect(pageList(1, 5)).toEqual([1, 2, 3, 4, 5])
  })

  test('reticências nas pontas e no meio', () => {
    expect(pageList(1, 16)).toEqual([1, 2, 3, '…', 16])
    expect(pageList(3, 16)).toEqual([1, 2, 3, 4, '…', 16])
    expect(pageList(8, 16)).toEqual([1, '…', 7, 8, 9, '…', 16])
    expect(pageList(16, 16)).toEqual([1, '…', 14, 15, 16])
    expect(pageList(1, 25)).toEqual([1, 2, 3, '…', 25])
  })

  test('uma página só escondida aparece no lugar da reticência', () => {
    expect(pageList(4, 16)).toEqual([1, 2, 3, 4, 5, '…', 16])
  })
})

describe('mensagens de erro por status (seção 3.13)', () => {
  test('rede, servidor, filtro, permissão e erro de renderização', () => {
    expect(describeError(new ApiError(0, 'x'))).toMatchObject({
      title: 'Sem conexão com a API',
      action: 'retry',
    })
    expect(describeError(new ApiError(502, 'x', null, 'req-1'))).toMatchObject({
      title: 'O servidor não respondeu',
      action: 'retry',
      status: 502,
      requestId: 'req-1',
    })
    const invalid = new ApiError(400, 'x', {
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'A busca aceita até 80 caracteres.',
      requestId: 'req-2',
    })
    expect(describeError(invalid)).toMatchObject({
      action: 'clear-filters',
      description: 'A busca aceita até 80 caracteres.',
      requestId: 'req-2',
    })
    expect(describeError(new ApiError(403, 'x'))).toMatchObject({ action: 'home' })
    expect(describeError(new TypeError('boom'))).toMatchObject({ title: 'Algo deu errado', status: null })
  })
})

describe('vocabulário de estados', () => {
  test('tom da meta de conforto: 90 e 70 são os limites', () => {
    expect(comfortTone(90)).toBe('neutro')
    expect(comfortTone(89.9)).toBe('alerta')
    expect(comfortTone(70)).toBe('alerta')
    expect(comfortTone(69.9)).toBe('falha')
    expect(comfortTone(null)).toBe('neutro')
  })

  test('lacuna sem dados e descarte com motivo', () => {
    expect(gapState({ kind: 'no_data', reason: null }).hatch).toBe('sem-dados')
    expect(gapState({ kind: 'discarded', reason: 'stuck' }).label).toBe('Sensor travado')
    expect(gapState({ kind: 'discarded', reason: null }).hatchClass).toBe('hachura-descartada')
  })
})
