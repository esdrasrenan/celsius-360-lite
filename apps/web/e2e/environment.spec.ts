import { readFile } from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'
import { horizontalOverflow, sessionFile } from './support'

/**
 * Detalhe do ambiente (seção 4.3) contra a stack de E2E (test/fixtures/e2e): "Salão" (AMB-T1) da
 * Loja Centro, em São Paulo, com dois dias de telemetria e um trecho de sensor travado.
 */

test.use({ storageState: sessionFile('admin') })

/**
 * Escolhe o período como o usuário, pelo rótulo do segmento. O rádio é controlado e só fica marcado
 * quando a navegação termina, então `check()` (que confere o estado logo após o clique) não serve.
 */
async function choosePeriod(page: Page, label: string) {
  const group = page.getByRole('group', { name: 'Período' })
  await group.locator('label', { hasText: label }).click()
  await expect(group.getByRole('radio', { name: new RegExp(label) })).toBeChecked()
}

test.describe('detalhe do ambiente', () => {
  test('cabeçalho, KPIs do período e título da aba', async ({ page }) => {
    await page.goto('/ambientes/AMB-T1?periodo=7d')
    await expect(page.getByRole('heading', { level: 1, name: 'Salão' })).toBeVisible()
    await expect(page).toHaveTitle('Salão · Loja Centro · Celsius 360')
    await expect(page.getByText('Última leitura válida')).toBeVisible()
    await expect(page.getByText('DEV-A')).toBeVisible()
    for (const label of [
      'Conforto no horário',
      'Temperatura no horário',
      'Cobertura de dados',
      'Indisponibilidade no horário',
    ]) {
      await expect(page.getByRole('heading', { level: 3, name: label })).toBeVisible()
    }
    // Cada KPI explica o cálculo num popover acessível por toque
    await page.getByRole('button', { name: 'Como é calculado: Cobertura de dados' }).click()
    await expect(page.getByText('Tempo de funcionamento com leitura válida')).toBeVisible()
  })

  test('troca de período faz push e o voltar do navegador desfaz', async ({ page }) => {
    await page.goto('/ambientes/AMB-T1?periodo=1d')
    await choosePeriod(page, '7 dias')
    await expect(page).toHaveURL(/periodo=7d/)
    await expect(page.getByRole('heading', { name: 'Perfil semanal' })).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/periodo=1d/)
    // Perfil semanal e conforto por dia só existem em 7 e 30 dias
    await expect(page.getByRole('heading', { name: 'Perfil semanal' })).toHaveCount(0)
  })

  test('breadcrumb volta à lista com os filtros de origem e à loja pelo id', async ({ page }) => {
    await page.goto('/?ordem=name&periodo=1d')
    await page.getByRole('link', { name: /Salão/ }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: 'Salão' })).toBeVisible()
    await choosePeriod(page, '30 dias')

    const trail = page.getByRole('navigation', { name: 'Trilha de navegação' })
    await expect(trail.getByRole('link', { name: 'Loja Centro' })).toHaveAttribute(
      'href',
      '/?loja=LOJA-T-SP&periodo=30d',
    )
    await trail.getByRole('link', { name: 'Visão da rede' }).click()
    await expect(page).toHaveURL(/ordem=name/)
    await expect(page).toHaveURL(/periodo=30d/)
  })

  test('lacunas e descartes: motivo, parte no horário e "Ver no gráfico"', async ({ page }) => {
    await page.goto('/ambientes/AMB-T1?periodo=7d')
    const gaps = page.getByRole('region', { name: 'Lacunas e descartes' })
    await expect(gaps).toContainText('Sensor travado')
    await expect(gaps).toContainText('Leituras descartadas')
    await gaps
      .getByRole('button', { name: /^Ver no gráfico: Sensor travado/ })
      .first()
      .click()
    await expect(page.locator('#grafico-temperatura')).toBeInViewport()
  })

  test('exportar: CSV da série e das lacunas no formato do Excel em pt-BR', async ({ page }) => {
    await page.goto('/ambientes/AMB-T1?periodo=7d')
    const exportButton = page.getByRole('button', { name: 'Exportar' })
    await exportButton.click()
    await expect(page.getByRole('menuitem', { name: 'Baixar CSV das lacunas' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Imprimir ou salvar PDF' })).toBeVisible()

    const download = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Baixar CSV da série' }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^AMB-T1_7d_\d{4}-\d{2}-\d{2}\.csv$/)
    const text = await readFile(await file.path(), 'utf8')
    // BOM UTF-8, ";" como separador, vírgula decimal e data no fuso da loja
    expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(text).toContain('Data e hora · horário de São Paulo (UTC−3);Média (°C);Mín. (°C)')
    expect(text).toMatch(/\r\n\d{2}\/\d{2}\/2026 \d{2}:\d{2};\d+,\d/)

    await exportButton.click()
    const gapsDownload = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Baixar CSV das lacunas' }).click()
    const gaps = await gapsDownload
    expect(gaps.suggestedFilename()).toMatch(/^AMB-T1_7d_lacunas_\d{4}-\d{2}-\d{2}\.csv$/)
    expect(await readFile(await gaps.path(), 'utf8')).toContain('Sensor travado')
  })

  test('série com erro: tabela e CSV indisponíveis, sem afirmar que não há lacunas', async ({ page }) => {
    await page.route('**/api/v1/environments/AMB-T1/series**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Internal Server Error',
          status: 500,
          detail: '',
        }),
      }),
    )
    await page.goto('/ambientes/AMB-T1?periodo=7d')
    // O 5xx é repetido duas vezes (1 s e 2 s) antes de virar erro no cartão do gráfico
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Ver tabela' })).toHaveAttribute('aria-disabled', 'true')
    await page.getByRole('button', { name: 'Exportar' }).click()
    const series = page.getByRole('menuitem', { name: /Baixar CSV da série/ })
    const gaps = page.getByRole('menuitem', { name: /Baixar CSV das lacunas/ })
    await expect(series).toHaveAttribute('aria-disabled', 'true')
    await expect(series).toContainText('Indisponível')
    await expect(gaps).toContainText('Indisponível')
    await expect(gaps).not.toContainText('Nenhuma')
  })

  test('comparar: sem base em 30 dias, desabilitado com a dica', async ({ page }) => {
    await page.goto('/ambientes/AMB-T1?periodo=30d')
    const compare = page.getByRole('button', { name: 'Comparar com 30 dias anteriores' })
    await expect(compare).toHaveAttribute('aria-disabled', 'true')
    await compare.hover()
    await expect(page.getByText('Sem base de comparação: os dados começam em 02/03')).toBeVisible()
  })

  test('comparar 24 horas: chips de variação e a série do período anterior', async ({ page }) => {
    // 03/03 contra 02/03: o dia anterior tem leitura no horário inteiro
    await page.goto('/ambientes/AMB-T1?periodo=1d')
    const compare = page.getByRole('button', { name: 'Comparar com 24 horas anteriores' })
    await expect(compare).not.toHaveAttribute('aria-disabled', 'true')
    await compare.click()
    await expect(compare).toHaveAttribute('aria-pressed', 'true')
    // Um chip por indicador, com a base no nome acessível
    await expect(page.getByText(/vs 24 horas anteriores/)).toHaveCount(4)
    await expect(page.getByText(/Período anterior/).first()).toBeVisible()
    await compare.click()
    await expect(page.getByText(/vs 24 horas anteriores/)).toHaveCount(0)
  })

  test('tabela de dados paginada de 50 em 50', async ({ page }) => {
    await page.goto('/ambientes/AMB-T1?periodo=7d')
    await page.getByRole('button', { name: 'Ver tabela' }).click()
    const table = page.locator('#tabela-dados')
    await expect(table).toHaveAttribute('open', '')
    await expect(table.getByRole('columnheader', { name: 'Situação' })).toBeVisible()
    await expect(table.locator('tbody tr')).toHaveCount(50)
    await expect(table).toContainText(/1–50 de [\d.]+ linhas/)
  })

  test('perfil semanal: 168 células, ausência sem cor de 0% e navegação por setas', async ({ page }) => {
    await page.goto('/ambientes/AMB-T1?periodo=7d')
    const grid = page.getByRole('table', { name: 'Perfil semanal' })
    const cells = grid.locator('tbody td')
    await expect(cells).toHaveCount(168)
    await cells.first().focus()
    await page.keyboard.press('ArrowRight')
    await expect(cells.nth(1)).toBeFocused()
    await expect(cells.nth(1)).toHaveAttribute('aria-label', /^Segunda, 1h–2h/)
    // Domingo a loja não abre: hora fechada, nunca "0% fora"
    await page.keyboard.press('Control+End')
    await expect(cells.nth(167)).toBeFocused()
    await expect(cells.nth(167)).toHaveAttribute('aria-label', /^Domingo, 23h–24h: Loja fechada/)
  })

  test('conforto por dia: uma coluna por dia, um só ponto de Tab e setas', async ({ page }) => {
    await page.goto('/ambientes/AMB-T1?periodo=7d')
    const days = page.getByRole('table', { name: 'Conforto por dia' }).locator('tbody td')
    await expect(days).toHaveCount(7)
    await expect(days.first()).toHaveAttribute('tabindex', '0')
    await expect(days.nth(1)).toHaveAttribute('tabindex', '-1')
    await days.first().focus()
    await page.keyboard.press('End')
    await expect(days.nth(6)).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(days.nth(5)).toBeFocused()
  })

  test('impressão esconde as ações e mantém título, KPIs e lacunas', async ({ page }) => {
    await page.goto('/ambientes/AMB-T1?periodo=7d')
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByRole('button', { name: 'Exportar' })).toBeHidden()
    await expect(page.getByRole('heading', { level: 1, name: 'Salão' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Lacunas e descartes' })).toBeVisible()
  })

  test('ambiente inexistente: 404 com h1 e caminho de volta', async ({ page }) => {
    await page.goto('/ambientes/AMB-NAO-EXISTE')
    await expect(page.getByRole('heading', { level: 1, name: 'Ambiente não encontrado' })).toBeVisible()
    await expect(page).toHaveTitle('Ambiente não encontrado · Celsius 360')
    await page.getByRole('link', { name: 'Ir para a visão da rede' }).click()
    await expect(page).toHaveURL(/\/(\?|$)/)
  })

  test('erro da API: mensagem em pt-BR e "Tentar de novo"', async ({ page }) => {
    await page.route('**/api/v1/environments/AMB-T1/summary**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Internal Server Error',
          status: 500,
          detail: '',
        }),
      }),
    )
    await page.goto('/ambientes/AMB-T1?periodo=7d')
    // O 5xx é repetido duas vezes (1 s e 2 s) antes de virar erro na tela
    await expect(page.getByRole('heading', { level: 1, name: 'O servidor não respondeu' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible()
  })
})

test.describe('gestor do cliente', () => {
  test.use({ storageState: sessionFile('gestor') })

  test('não abre ambiente de outro cliente', async ({ page }) => {
    await page.goto('/ambientes/AMB-T3')
    await expect(page.getByRole('heading', { level: 1, name: 'Ambiente não encontrado' })).toBeVisible()
  })
})

test.describe('celular', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('breadcrumb compacto e sem rolagem horizontal', async ({ page }) => {
    await page.goto('/ambientes/AMB-T1?periodo=30d')
    const trail = page.getByRole('navigation', { name: 'Trilha de navegação' })
    await expect(trail.getByRole('link', { name: 'Loja Centro' })).toBeVisible()
    await expect(trail.getByRole('link', { name: 'Visão da rede' })).toBeHidden()
    expect(await horizontalOverflow(page)).toBe(0)
  })
})
