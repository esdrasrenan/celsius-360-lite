import { expect, type Page, test } from '@playwright/test'

const PASSWORD = process.env.E2E_PASSWORD ?? 'senha-de-teste-123'

/** Opção de um grupo de escolha (rádio nativo escondido atrás do rótulo). */
const option = (page: Page, group: string, name: string) =>
  page
    .getByRole('group', { name: group })
    .locator('label')
    .filter({ hasText: new RegExp(`^${name}$`) })

async function login(page: Page, email: string) {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Visão da rede' })).toBeVisible()
}

test('login lista os usuários de demonstração e recusa senha errada', async ({ page }) => {
  await page.goto('/entrar')
  await expect(page.getByText('Usuários de demonstração')).toBeVisible()
  await page.getByRole('button', { name: /Admin Teste/ }).click()
  await expect(page.getByLabel('E-mail')).toHaveValue('admin@teste.example')
  await page.getByLabel('Senha').fill('senha-errada')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('alert')).toContainText('E-mail ou senha incorretos')
})

test('visão da rede: indicadores, filtro por status e busca refletidos na URL', async ({ page }) => {
  await login(page, 'admin@teste.example')
  const stores = page.getByRole('article')
  await expect(stores).toHaveCount(2)
  await expect(page.getByText('Ambientes online')).toBeVisible()

  await option(page, 'Status da loja', 'Parcial').click()
  await expect(page).toHaveURL(/status=degraded/)
  await expect(stores).toHaveCount(1)
  await expect(stores.first()).toContainText('Loja Centro')
  await expect(stores.first()).toContainText('Offline')

  await option(page, 'Status da loja', 'Todas').click()
  await page.getByPlaceholder('Buscar loja, cidade ou cliente').fill('recife')
  await expect(page).toHaveURL(/busca=recife/)
  await expect(stores).toHaveCount(1)
  await expect(stores.first()).toContainText('Agência Recife')
})

test('detalhe do ambiente: gráfico, período e indisponibilidades', async ({ page }) => {
  await login(page, 'admin@teste.example')
  await page.getByRole('link', { name: /Salão/ }).click()
  await expect(page.getByRole('heading', { name: 'Salão' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Gráfico da temperatura do ambiente' })).toBeVisible()

  await option(page, 'Período', 'Última semana').click()
  await expect(page).toHaveURL(/periodo=7d/)
  await expect(page.getByText('agregação: 15m')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Lacunas e indisponibilidades' })).toContainText(
    'Sensor travado',
  )
})

test('multi-tenant: gestor vê só o próprio cliente e não abre ambiente de outro', async ({ page }) => {
  await login(page, 'gestor@teste.example')
  await expect(page.getByRole('article')).toHaveCount(1)
  await expect(page.getByRole('article').first()).toContainText('Loja Centro')
  await page.goto('/ambientes/AMB-T3')
  await expect(page.getByText('Ambiente não encontrado')).toBeVisible()
})

test('sair encerra a sessão', async ({ page }) => {
  await login(page, 'gerente@teste.example')
  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page).toHaveURL(/\/entrar/)
  await page.goto('/')
  await expect(page).toHaveURL(/\/entrar/)
})
