import { describe, expect, test } from 'bun:test'
import { buildPath } from '../api/client'
import { formatAgo, formatDateTime, formatDuration, formatPercent, formatTemperature } from './format'

describe('formatação em pt-BR', () => {
  test('temperatura e percentual com vírgula decimal', () => {
    expect(formatTemperature(22.75)).toBe('22,8 °C')
    expect(formatTemperature(null)).toBe('—')
    expect(formatPercent(87.64)).toBe('87,6%')
    expect(formatPercent(100)).toBe('100%')
    expect(formatPercent(0)).toBe('0%')
  })

  test('duração legível', () => {
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(345)).toBe('5 h 45 min')
    expect(formatDuration(120)).toBe('2 h')
    expect(formatDuration(3 * 1440)).toBe('3,0 dias')
  })

  test('datas no fuso da loja e "há" em relação ao agora da ingestão', () => {
    expect(formatDateTime('2026-02-11T02:59:56Z', 'America/Sao_Paulo')).toBe('10/02, 23:59')
    expect(formatAgo('2026-02-11T02:54:21Z', '2026-02-11T02:59:56Z')).toBe('há 6 min')
  })
})

describe('buildPath', () => {
  test('ignora vazios e junta listas por vírgula', () => {
    expect(buildPath('/stores', { period: '7d', search: '', status: ['online', 'degraded'], page: 2 })).toBe(
      '/api/v1/stores?period=7d&status=online%2Cdegraded&page=2',
    )
  })
})
