import { describe, expect, test } from 'bun:test'
import { loginPath, safeRedirect } from './redirect'

describe('destino seguro do login (P0 #5)', () => {
  test('aceita caminho interno com busca', () => {
    expect(safeRedirect('/')).toBe('/')
    expect(safeRedirect('/ambientes/AMB-014?periodo=30d')).toBe('/ambientes/AMB-014?periodo=30d')
    expect(safeRedirect('/?busca=sao+paulo&ordem=comfort')).toBe('/?busca=sao+paulo&ordem=comfort')
  })

  test('recusa outro site, que derrubava a tela com "External navigation is not allowed"', () => {
    for (const value of [
      '//127.0.0.1:9/phish',
      '/\\evil.example',
      '\\\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      'ambientes/AMB-001',
      '/\t/evil.example',
      '/\n/evil.example',
    ]) {
      expect(safeRedirect(value)).toBe('/')
    }
  })

  test('sem destino, vai para a visão da rede', () => {
    expect(safeRedirect(null)).toBe('/')
    expect(safeRedirect(undefined)).toBe('/')
    expect(safeRedirect('')).toBe('/')
  })
})

describe('caminho do login', () => {
  test('guarda o caminho de volta e o motivo', () => {
    expect(loginPath('/ambientes/AMB-001?periodo=7d', true)).toBe(
      '/entrar?voltar=%2Fambientes%2FAMB-001%3Fperiodo%3D7d&motivo=expirada',
    )
    expect(loginPath('/qualidade', false)).toBe('/entrar?voltar=%2Fqualidade')
  })

  test('da raiz não leva "voltar"', () => {
    expect(loginPath('/', false)).toBe('/entrar')
    expect(loginPath('/', true)).toBe('/entrar?motivo=expirada')
  })
})
