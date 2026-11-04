import { expect, type Page, test } from '@playwright/test'
import { sessionFile, signIn, USERS } from './support'

/**
 * Sessão e perfis (P0 #4, #5 e #9 e critérios 8.7 e 8.9) contra a stack de E2E (test/fixtures/e2e):
 * sessão expirada, destino seguro do login, sair e entrar com outro perfil e a página que é só do
 * administrador da Diel. Aqui o login é pelo formulário, que é o que está sendo testado.
 */

const ADMIN = USERS.admin
/** Gerente de loja da Agência Recife: não vê a Loja Centro (AMB-T1) nem a qualidade dos dados. */
const MANAGER = USERS.gerente

async function signOut(page: Page) {
  await page.getByRole('button', { name: /menu da conta/ }).click()
  await page.getByRole('menuitem', { name: 'Sair' }).click()
  // Sair é escolha do usuário: /entrar sem "voltar" e sem o aviso de sessão expirada
  await expect(page).toHaveURL(/\/entrar$/)
}

/** Na visão da rede deste servidor, e não em outro host. */
const atNetworkHome = (url: URL) => url.port !== '9' && url.pathname === '/' && url.search === ''

test('demonstração preenche o e-mail e foca a senha; senha errada vira alerta', async ({ page }) => {
  await page.goto('/entrar')
  await expect(page).toHaveTitle('Entrar · Celsius 360')
  await page.getByRole('button', { name: /Gerente Teste/ }).click()
  await expect(page.getByLabel('E-mail')).toHaveValue(MANAGER)
  await expect(page.getByLabel('Senha')).toBeFocused()

  await page.getByLabel('Senha').fill('senha-errada')
  await page.getByRole('button', { name: 'Mostrar senha' }).click()
  await expect(page.getByLabel('Senha')).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('E-mail ou senha incorretos')
  await expect(page).toHaveURL(/\/entrar$/)
})

test('sessão expirada leva ao login com o aviso e devolve à tela de origem', async ({ page, context }) => {
  await page.goto('/entrar')
  await signIn(page, ADMIN)
  await expect(page).toHaveURL(atNetworkHome)
  // A lista termina de carregar antes: uma consulta ainda em voo levaria o 401 antes do clique
  await expect(page.getByText('Loja Centro').first()).toBeVisible()
  await page.waitForLoadState('networkidle')

  // O cookie some (reinício com outro segredo, expiração): a próxima consulta, a da qualidade, que
  // ainda não está em cache, recebe 401
  await context.clearCookies()
  await page.getByRole('link', { name: 'Qualidade dos dados', exact: true }).click()

  await expect(page).toHaveURL(/\/entrar\?voltar=%2Fqualidade&motivo=expirada$/)
  await expect(page.getByText('Sua sessão expirou. Entre de novo.')).toBeVisible()
  await expect(page.getByRole('button', { name: /menu da conta/ })).toHaveCount(0)

  await signIn(page, ADMIN)
  await expect(page).toHaveURL(/\/qualidade$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Qualidade dos dados' })).toBeVisible()
})

test('"voltar" que aponta para outro site cai na visão da rede', async ({ page }) => {
  // No envio do formulário
  await page.goto('/entrar?voltar=//127.0.0.1:9/x')
  await signIn(page, ADMIN)
  await expect(page).toHaveURL(atNetworkHome)

  // E no redirecionamento de quem já está logado (antes, a tela crua "External navigation is not allowed")
  for (const target of ['//127.0.0.1:9/x', '/\\127.0.0.1:9/x', 'https://127.0.0.1:9/x']) {
    await page.goto(`/entrar?voltar=${encodeURIComponent(target)}`)
    await expect(page).toHaveURL(atNetworkHome)
  }
  await expect(page.getByText('Algo deu errado')).toHaveCount(0)
})

test('sair de um detalhe e entrar com outro perfil leva à visão da rede', async ({ page }) => {
  await page.goto('/entrar')
  await signIn(page, ADMIN)
  await expect(page).toHaveURL(atNetworkHome)
  await page.goto('/ambientes/AMB-T1?periodo=7d')
  await expect(page.getByRole('heading', { level: 1, name: 'Salão' })).toBeVisible()

  await signOut(page)
  await expect(page.getByText('Sua sessão expirou')).toHaveCount(0)

  // Antes, o gerente herdava o "voltar" do admin e caía em "Ambiente não encontrado"
  await signIn(page, MANAGER)
  await expect(page).toHaveURL(atNetworkHome)
  await expect(page.getByText('Agência Recife').first()).toBeVisible()
  await expect(page.getByText('Ambiente não encontrado')).toHaveCount(0)

  // O escopo é o do novo perfil: o ambiente do admin não abre nem pelo endereço
  await page.goto('/ambientes/AMB-T1?periodo=7d')
  await expect(page.getByText('Ambiente não encontrado')).toBeVisible()
})

test('qualidade dos dados só para o administrador da Diel', async ({ page }) => {
  await page.goto('/entrar')
  await signIn(page, ADMIN)
  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  await nav.getByRole('link', { name: 'Qualidade dos dados' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Qualidade dos dados' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Qualidade dos dados' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: 'Anomalias encontradas' })).toBeVisible()
  await expect(page).toHaveTitle('Qualidade dos dados · Celsius 360')

  await signOut(page)
  await signIn(page, MANAGER)
  await expect(page).toHaveURL(atNetworkHome)
  // Sem o link no cabeçalho, e o endereço direto mostra o 403 explicado, sem o relatório
  await expect(nav.getByRole('link')).toHaveCount(1)
  await page.goto('/qualidade')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Você não tem acesso a esta página' }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ir para a visão da rede' })).toBeVisible()
  await expect(page.getByText('Anomalias encontradas')).toHaveCount(0)
})

/** Código do detalhe: o chunk do build ("EnvironmentPage-hash.js") ou o módulo do dev server. */
const ENVIRONMENT_CHUNK = /\/EnvironmentPage[^/]*\.(?:js|tsx)(?:\?|$)/

test.describe('casca', () => {
  test.use({ storageState: sessionFile('admin') })

  test('chip ao vivo: "Ao vivo" com a ingestão rodando', async ({ page }) => {
    // SSE falso que fica aberto e manda o snapshot de uma ingestão em andamento
    await page.addInitScript(() => {
      class LiveSource extends EventTarget {
        onerror = null
        constructor() {
          super()
          const data = JSON.stringify({ now: '2026-02-11T02:59:56Z', lastSeq: 1, ingesting: true })
          setTimeout(() => this.dispatchEvent(new MessageEvent('snapshot', { data })), 0)
        }
        close() {}
      }
      window.EventSource = LiveSource as unknown as typeof EventSource
    })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Ao vivo · 10/02 23:59' })).toBeVisible()
  })

  test('SSE recusado: o chip conta a espera de cada nova tentativa, a primeira de 1 s', async ({ page }) => {
    await page.route('**/api/v1/events', (route) => route.fulfill({ status: 503 }))
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Reconectando em 1 s' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reconectando em 2 s' })).toBeVisible()
  })

  test('tela sob demanda: a casca aparece e avisa a espera enquanto o código desce', async ({ page }) => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(ENVIRONMENT_CHUNK, async (route) => {
      await gate
      await route.continue()
    })

    // Acesso direto: cabeçalho e navegação já na tela, só o conteúdo espera
    await page.goto('/ambientes/AMB-T1?periodo=7d')
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible()
    await expect(page.locator('#conteudo [aria-busy="true"]')).toBeVisible()
    release()
    await expect(page.getByRole('heading', { level: 1, name: 'Salão' })).toBeVisible()
  })

  test('clique numa tela sob demanda mostra a barra de carga no cabeçalho', async ({ page }) => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(ENVIRONMENT_CHUNK, async (route) => {
      await gate
      await route.continue()
    })

    await page.goto('/?ordem=name&periodo=1d')
    await page.getByRole('link', { name: /Salão/ }).first().click()
    await expect(page.getByRole('progressbar', { name: 'Carregando a página' })).toBeVisible()
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true')
    release()
    await expect(page.getByRole('heading', { level: 1, name: 'Salão' })).toBeVisible()
    await expect(page.locator('main')).not.toHaveAttribute('aria-busy', 'true')
  })
})
