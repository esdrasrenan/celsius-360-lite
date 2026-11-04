import { resolve } from 'node:path'
import type { Page } from '@playwright/test'

export const PASSWORD = process.env.E2E_PASSWORD ?? 'senha-de-teste-123'

/** Usuários da fixture de E2E (test/fixtures/e2e/cadastro.json). */
export const USERS = {
  /** Administrador da Diel: as duas lojas e a qualidade dos dados. */
  admin: 'admin@teste.example',
  /** Gestor da Rede Teste: só a Loja Centro. */
  gestor: 'gestor@teste.example',
  /** Gerente da Agência Recife: só essa loja. */
  gerente: 'gerente@teste.example',
} as const

export type User = keyof typeof USERS

/**
 * Sessão de cada usuário, gravada uma vez pelo projeto "sessoes" (sessions.setup.ts). A API aceita
 * 20 logins por minuto de um mesmo IP, e entrar pelo formulário em cada teste passaria disso.
 */
export const sessionFile = (user: User) => resolve(import.meta.dirname, '.sessoes', `${user}.json`)

/** Entra pelo formulário: só nos testes do próprio login, que contam no limite da API. */
export async function signIn(page: Page, email: string) {
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
}

export const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
