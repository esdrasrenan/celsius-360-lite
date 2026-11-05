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

/**
 * Tempo real falso: troca o EventSource antes do app carregar, abre com o snapshot de sempre e
 * devolve a função que dispara um state_updated, como a ingestão faria ao atualizar as projeções.
 */
export async function fakeLiveUpdates(page: Page): Promise<() => Promise<void>> {
  await page.addInitScript(() => {
    const now = '2026-03-04T03:00:00Z'
    let lastSeq = 1
    class LiveSource extends EventTarget {
      onerror = null
      constructor() {
        super()
        const data = JSON.stringify({ type: 'snapshot', now, lastSeq, ingesting: false })
        setTimeout(() => this.dispatchEvent(new MessageEvent('snapshot', { data })), 0)
        Object.assign(window, {
          liveUpdate: () => {
            const event = JSON.stringify({ type: 'state_updated', now, lastSeq: ++lastSeq })
            this.dispatchEvent(new MessageEvent('state_updated', { data: event }))
          },
        })
      }
      close() {}
    }
    window.EventSource = LiveSource as unknown as typeof EventSource
  })
  return () => page.evaluate(() => (window as unknown as { liveUpdate: () => void }).liveUpdate())
}

/** Resposta 500 da API, em problem+json. */
export const serverError = {
  status: 500,
  contentType: 'application/problem+json',
  body: JSON.stringify({ type: 'about:blank', title: 'Internal Server Error', status: 500, detail: '' }),
}

export const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
