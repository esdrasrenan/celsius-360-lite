import { readFile } from 'node:fs/promises'
import type { StoreList } from '@celsius/contracts'
import { expect, type Page, test } from '@playwright/test'
import { sessionFile } from './support'

/**
 * Visão da rede (seção 4.2, critérios 8.5, 8.6, 8.7 e 8.9) contra a stack de E2E (test/fixtures/e2e):
 * Loja Centro (LOJA-T-SP, Rede Teste, São Paulo/SP) com Salão (DEV-A) e Sala técnica (DEV-B, offline)
 * e Agência Recife (LOJA-T-PE, Outro Cliente, Recife/PE) com Atendimento (DEV-C).
 */

const STORES_API = /\/api\/v1\/stores\?/

test.use({ storageState: sessionFile('admin') })

async function home({ page }: { page: Page }) {
  await page.goto('/')
}

/** Lojas na tabela, pelo botão que abre cada uma ("Ambientes de Loja Centro"). */
const storeNames = (page: Page) =>
  page
    .getByRole('button', { name: /^Ambientes de / })
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')?.slice(13)))

const search = (page: Page) => page.getByRole('searchbox', { name: 'Buscar lojas' })
const kpis = (page: Page) => page.getByRole('region', { name: /^Indicadores da / })
const table = (page: Page) => page.getByRole('region', { name: 'Lojas' })

test.describe('visão da rede', () => {
  test.beforeEach(home)

  test('cabeçalho, indicadores e tabela com a abertura por exceção', async ({ page }) => {
    await expect(page).toHaveTitle('Visão da rede · Celsius 360')
    await expect(page.getByRole('heading', { level: 1, name: 'Visão da rede' })).toBeVisible()
    await expect(page.getByText('2 lojas · 3 ambientes · horário de Brasília')).toBeVisible()
    await expect(kpis(page).getByRole('heading', { level: 2 })).toHaveText('Indicadores da rede')
    for (const label of ['Conforto da rede', 'Fora da meta de 90%', 'Fora da faixa agora', 'Telemetria']) {
      await expect(kpis(page).getByRole('heading', { level: 3, name: label })).toBeVisible()
    }
    await expect(table(page).getByRole('status')).toHaveText('2 lojas · 3 ambientes')
    expect((await storeNames(page)).sort()).toEqual(['Agência Recife', 'Loja Centro'])

    // Com até 3 lojas na página, todas abrem; o estado aberto vai para ?abertas= e sobrevive à recarga
    const recife = page.getByRole('button', { name: 'Ambientes de Agência Recife' })
    await expect(recife).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('link', { name: 'Atendimento' })).toBeVisible()
    await recife.click()
    await expect(recife).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('link', { name: 'Atendimento' })).toBeHidden()
    await expect(page).toHaveURL(/abertas=LOJA-T-SP(&|$)/)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Ambientes de Agência Recife' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )

    // O link do ambiente leva a query da lista no state (o breadcrumb do detalhe volta com ela)
    await page.getByRole('link', { name: 'Salão' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Salão' })).toBeVisible()
  })

  test('filtros: pílula com push no histórico, título "da seleção" e Limpar filtros', async ({ page }) => {
    await page.goto('/?periodo=7d')
    const pills = page.getByRole('radiogroup', { name: 'Telemetria da loja' })
    await pills.getByText('Parcial').click()
    await expect(page).toHaveURL(/status=degraded/)
    await expect.poll(() => storeNames(page)).toEqual(['Loja Centro'])
    await expect(kpis(page).getByRole('heading', { level: 2 })).toHaveText(
      'Indicadores da seleção · 1 de 2 lojas',
    )
    await expect(kpis(page).getByRole('heading', { level: 3, name: 'Conforto da seleção' })).toBeVisible()

    // A digitação da busca usa replace: o voltar desfaz a pílula, não cada tecla
    await search(page).fill('centro')
    await expect(page).toHaveURL(/busca=centro/)
    await page.goBack()
    await expect(page).toHaveURL(/\/\?periodo=7d$/)
    await expect.poll(async () => (await storeNames(page)).length).toBe(2)

    await pills.getByText('Parcial').click()
    await page.getByRole('button', { name: 'Limpar filtros' }).click()
    await expect(page).toHaveURL(/\/\?periodo=7d$/)
    await expect(kpis(page).getByRole('heading', { level: 2 })).toHaveText('Indicadores da rede')

    // A pílula conta lojas e o KPI de mesmo tema conta ambientes: o rótulo diz a unidade
    await page.getByRole('button', { name: /^Lojas fora da meta/ }).click()
    await expect(page).toHaveURL(/abaixoDaMeta=1/)
  })

  test('"Baixar CSV" baixa a lista filtrada, uma linha por ambiente', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Baixar CSV', exact: true }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^celsius360-lojas-1d-\d{4}-\d{2}-\d{2}\.csv$/)
    const csv = await readFile(await download.path(), 'utf8')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const lines = csv.slice(1).trimEnd().split('\r\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain('Código da loja;Loja;Cliente')
    expect(lines.some((line) => line.startsWith('LOJA-T-PE;Agência Recife;Outro Cliente;Recife;PE;'))).toBe(
      true,
    )
  })
})

test.describe('teclado (8.5)', () => {
  test.beforeEach(home)

  test('Tab percorre o salto, a navegação, o período, a busca, cliente, ordenar e a primeira linha', async ({
    page,
  }) => {
    // Recarrega para o foco partir do topo do documento
    await page.goto('/')
    await expect(page.getByRole('button', { name: /^Ambientes de / }).first()).toBeVisible()
    const seen: string[] = []
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab')
      const current = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement
        if (element.matches('input[type=search]')) return 'busca'
        if (element.matches('fieldset input[type=radio]')) return 'periodo'
        return element.getAttribute('aria-label') ?? element.textContent?.trim() ?? ''
      })
      seen.push(current)
      if (current.startsWith('Ambientes de ')) break
    }
    const order = [
      seen.indexOf('Pular para o conteúdo'),
      seen.indexOf('Visão da rede'),
      seen.indexOf('periodo'),
      seen.indexOf('busca'),
      seen.findIndex((item) => item.startsWith('Cliente')),
      seen.findIndex((item) => /^Ordenar por\s*Gravidade/.test(item)),
      seen.findIndex((item) => item.startsWith('Ambientes de ')),
    ]
    expect(
      order.every((index) => index >= 0),
      seen.join(' > '),
    ).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  test('"/" foca a busca e Esc limpa', async ({ page }) => {
    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press('/')
    await expect(search(page)).toBeFocused()
    await page.keyboard.type('recife')
    await expect(page).toHaveURL(/busca=recife/)
    await page.keyboard.press('Escape')
    await expect(search(page)).toHaveValue('')
    await expect(page).not.toHaveURL(/busca=/)
  })

  test('Select: ↓ abre, Enter escolhe, Esc fecha e devolve o foco ao gatilho', async ({ page }) => {
    const sort = page.getByRole('combobox', { name: /^Ordenar por/ })
    await sort.focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('listbox')).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/ordem=comfort(&|$)/)
    await expect(sort).toHaveText(/Pior conforto/)
    await expect(sort).toBeFocused()

    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('listbox')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox')).toBeHidden()
    await expect(sort).toBeFocused()
    await expect(page).toHaveURL(/ordem=comfort(&|$)/)

    // O cabeçalho da coluna e o Select são a mesma ordenação
    await page.getByRole('button', { name: /^Ordenar por conforto no período/ }).click()
    await expect(page).toHaveURL(/ordem=comfort_desc/)
    await expect(sort).toHaveText(/Melhor conforto/)
  })
})

test.describe('busca (8.6)', () => {
  test.beforeEach(home)

  for (const [term, store] of [
    ['salão', 'Loja Centro'],
    ['paulo loja', 'Loja Centro'],
    ['sao paulo', 'Loja Centro'],
    ['DEV-C', 'Agência Recife'],
    ['Recife/PE', 'Agência Recife'],
    ['atendimento', 'Agência Recife'],
  ] as const) {
    test(`"${term}" encontra ${store}`, async ({ page }) => {
      await search(page).fill(term)
      await expect(page).toHaveURL(/busca=/)
      await expect.poll(() => storeNames(page)).toEqual([store])
      await expect(table(page).getByRole('status')).toHaveText(/^1 loja · /)
    })
  }

  test('o ambiente encontrado aparece destacado com <mark>', async ({ page }) => {
    await search(page).fill('atendimento')
    // A linha do celular repete o nome (oculta a partir de md): conta só o destaque visível
    await expect(page.locator('mark', { hasText: 'Atendimento' }).filter({ visible: true })).toHaveCount(1)
  })

  for (const term of ['%', '_']) {
    test(`"${term}" dá o estado vazio com Limpar busca`, async ({ page }) => {
      await search(page).fill(term)
      await expect(page.getByRole('heading', { name: `Nenhuma loja para "${term}"` })).toBeVisible()
      await expect(table(page).getByText('0 de 2 lojas.', { exact: false })).toBeVisible()
      // Seleção vazia: "—" nos indicadores, nunca "0 de 0" nem "Todos os ambientes abertos"
      await expect(kpis(page).getByText('Nenhuma loja na seleção')).toHaveCount(4)
      await expect(kpis(page).getByText('0 de 0')).toHaveCount(0)
      await table(page).getByRole('button', { name: 'Limpar busca' }).click()
      await expect(page).not.toHaveURL(/busca=/)
      await expect.poll(async () => (await storeNames(page)).length).toBe(2)
    })
  }

  test('clicar no logo limpa a busca, e ela não volta sozinha', async ({ page }) => {
    await search(page).fill('recife')
    await expect(page).toHaveURL(/busca=recife/)
    // A lista filtrada na tela: a busca já foi confirmada e renderizada antes do clique
    await expect.poll(() => storeNames(page)).toEqual(['Agência Recife'])
    await page.getByRole('link', { name: 'Celsius 360, início' }).click()
    await expect(page).not.toHaveURL(/busca=/)
    await expect(search(page)).toHaveValue('')
    // O bug antigo reaplicava ?busca depois do debounce
    await page.waitForTimeout(600)
    await expect(page).not.toHaveURL(/busca=/)
  })

  test('81 caracteres não passam do campo', async ({ page }) => {
    await search(page).pressSequentially('a'.repeat(81))
    await expect(search(page)).toHaveValue('a'.repeat(80))
  })
})

test.describe('estados (8.7)', () => {
  test.beforeEach(home)

  test('500: erro com Tentar de novo e indicadores com "—"', async ({ page }) => {
    await page.route(STORES_API, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ type: 'about:blank', title: 'Internal Server Error', status: 500 }),
      }),
    )
    await page.goto('/')
    // A consulta tenta de novo duas vezes (1 s e 2 s) antes de desistir
    await expect(page.getByRole('heading', { name: 'O servidor não respondeu' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(kpis(page).getByText('—', { exact: true })).toHaveCount(4)
    await expect(kpis(page).getByText('Indisponível')).toHaveCount(4)
    await expect(page.getByText(/Aguardando/)).toHaveCount(0)

    await page.unroute(STORES_API)
    await page.getByRole('button', { name: 'Tentar de novo' }).click()
    await expect.poll(async () => (await storeNames(page)).length).toBe(2)
  })

  test('400: "Limpar filtros" redefine a URL', async ({ page }) => {
    await page.route(STORES_API, (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          detail: 'Filtro inválido.',
        }),
      }),
    )
    await page.goto('/?status=offline&busca=centro')
    const clear = table(page).getByRole('button', { name: 'Limpar filtros' })
    await expect(clear).toBeVisible()
    await page.unroute(STORES_API)
    await clear.click()
    await expect(page).not.toHaveURL(/status=|busca=/)
    await expect.poll(async () => (await storeNames(page)).length).toBe(2)
  })

  test('atraso de 2 s: skeleton com a geometria do conteúdo (nada se desloca quando ele chega)', async ({
    page,
  }) => {
    await page.route(STORES_API, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await route.continue()
    })
    await page.goto('/')
    await expect(table(page).getByText('Carregando lojas…')).toBeVisible()
    await page.waitForTimeout(400)
    const before = {
      kpis: (await kpis(page).boundingBox())?.height,
      search: (await search(page).boundingBox())?.y,
      table: (await table(page).boundingBox())?.y,
    }
    await expect(page.getByRole('button', { name: /^Ambientes de / }).first()).toBeVisible()
    const after = {
      kpis: (await kpis(page).boundingBox())?.height,
      search: (await search(page).boundingBox())?.y,
      table: (await table(page).boundingBox())?.y,
    }
    expect(after).toEqual(before)
  })

  test('estado vazio em 1024: o cabeçalho vai até a borda da tabela', async ({ page }) => {
    // Em 1024 as colunas de xl estão ocultas; a mensagem com colSpan a mais encolhia o cabeçalho
    await page.setViewportSize({ width: 1024, height: 800 })
    await page.goto('/?busca=%25')
    await expect(page.getByRole('heading', { name: 'Nenhuma loja para "%"' })).toBeVisible()
    const gap = await table(page)
      .locator('table')
      .evaluate((element) => {
        const cells = [...element.querySelectorAll('thead tr > *')].filter(
          (cell) => getComputedStyle(cell).display !== 'none',
        )
        const right = Math.max(...cells.map((cell) => cell.getBoundingClientRect().right))
        return Math.round(element.getBoundingClientRect().right - right)
      })
    expect(gap).toBe(0)
  })

  test('?pagina=999 vira a última página, sem entrada nova no histórico', async ({ page }) => {
    await page.goto('/?periodo=7d')
    const entries = await page.evaluate(() => history.length)
    await page.goto('/?periodo=7d&pagina=999')
    await expect(page).toHaveURL(/\/\?periodo=7d$/)
    await expect.poll(async () => (await storeNames(page)).length).toBe(2)
    // A normalização usa replace: só a navegação acima entrou no histórico
    expect(await page.evaluate(() => history.length)).toBe(entries + 1)
  })

  test('parâmetros inválidos voltam ao padrão (ordem=toString, status=xyz)', async ({ page }) => {
    await page.goto('/?ordem=toString&status=xyz&porPagina=33')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('combobox', { name: /^Ordenar por/ })).toHaveText(/Gravidade/)
    await expect.poll(async () => (await storeNames(page)).length).toBe(2)
  })
})

test.describe('perfil gerente (8.9)', () => {
  test.use({ storageState: sessionFile('gerente') })

  test('gerente vê uma loja só, sem filtro de cliente, pílulas nem paginação', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: 'Agência Recife' })).toBeVisible()
    await expect(page.getByText('Outro Cliente · Recife/PE', { exact: true })).toBeVisible()
    await expect(kpis(page).getByRole('heading', { level: 2 })).toHaveText('Indicadores da loja')
    await expect.poll(() => storeNames(page)).toEqual(['Agência Recife'])
    await expect(page.getByRole('combobox', { name: /^Cliente/ })).toHaveCount(0)
    await expect(page.getByRole('radiogroup', { name: 'Telemetria da loja' })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Paginação' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Ambientes de Agência Recife' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  test('?cliente= de fora do acesso sai com aviso; o do próprio acesso mostra o nome', async ({ page }) => {
    await page.goto('/?cliente=CLI-T1')
    await expect(page.getByText(/^O cliente do link não existe ou não está no seu acesso/)).toBeVisible()
    await expect(page).not.toHaveURL(/cliente=/)
    await expect.poll(() => storeNames(page)).toEqual(['Agência Recife'])

    await page.goto('/?cliente=CLI-T2')
    await expect(page.getByRole('button', { name: 'Remover filtro Cliente: Outro Cliente' })).toBeVisible()
  })
})

test.describe('gaveta de filtros do celular', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('"Aplicar" volta à página 1 e à abertura padrão, como a pílula do desktop', async ({ page }) => {
    await page.goto('/?abertas=LOJA-T-SP')
    await page.getByRole('button', { name: /^Filtros/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Filtros' })
    await sheet.getByRole('radiogroup', { name: 'Telemetria da loja' }).getByText('Online').click()
    await sheet.getByRole('button', { name: 'Aplicar' }).click()
    await expect(page).toHaveURL(/\/\?status=online$/)
  })
})

test.describe('volume (100 lojas por página)', () => {
  /** As lojas da fixture clonadas até 100, como a página mais longa que a interface oferece. */
  test.beforeEach(async ({ page }) => {
    await page.route(STORES_API, async (route) => {
      const response = await route.fetch()
      const list = (await response.json()) as StoreList
      const items = Array.from({ length: 100 / list.items.length }, (_, n) =>
        list.items.map((store) => ({
          ...store,
          id: `${store.id}-${n}`,
          name: `${store.name} ${n}`,
          environments: store.environments.map((environment) => ({
            ...environment,
            id: `${environment.id}-${n}`,
          })),
        })),
      ).flat()
      await route.fulfill({ response, json: { ...list, items, total: items.length, pageSize: 100 } })
    })
  })

  test('só o layout da largura atual e só os ambientes das lojas abertas vão para o DOM', async ({
    page,
  }) => {
    await page.goto('/?porPagina=100&abertas=')
    const toggles = page.getByRole('button', { name: /^Ambientes de / })
    await expect(toggles).toHaveCount(100)
    const dom = () =>
      page.evaluate(() => ({
        nodes: document.querySelectorAll('*').length,
        environmentRows: document.querySelectorAll('tr[id^="ambiente-"]').length,
        hiddenCells: [...document.querySelectorAll('td')].filter(
          (cell) => getComputedStyle(cell).display === 'none',
        ).length,
        danglingControls: [...document.querySelectorAll('button[aria-label^="Ambientes de "][aria-controls]')]
          .flatMap((button) => button.getAttribute('aria-controls')?.split(' ') ?? [])
          .filter((id) => !document.getElementById(id)).length,
      }))

    // Recolhidas, as linhas dos ambientes não existem (antes ficavam no DOM com hidden)
    expect(await dom()).toMatchObject({ environmentRows: 0, hiddenCells: 0, danglingControls: 0 })
    await expect(toggles.first()).not.toHaveAttribute('aria-controls')

    await page.getByRole('button', { name: 'Expandir todas' }).click()
    await expect(page.locator('tr[id^="ambiente-"]')).toHaveCount(150)
    const expanded = await dom()
    expect(expanded).toMatchObject({ hiddenCells: 0, danglingControls: 0 })
    // Com tudo aberto dá uns 11.500 nós; com o layout do celular montado junto, uns 18.000
    expect(expanded.nodes).toBeLessThan(15_000)
  })
})

test.describe('perfil gestor (8.9)', () => {
  test.use({ storageState: sessionFile('gestor') })

  test('gestor do cliente vê só as lojas do cliente', async ({ page }) => {
    await page.goto('/')
    await expect.poll(() => storeNames(page)).toEqual(['Loja Centro'])
    await page.goto('/?busca=recife')
    await expect(page.getByRole('heading', { name: 'Nenhuma loja para "recife"' })).toBeVisible()
    // O título continua sendo a loja do escopo (antes, um skeleton que nunca saía)
    await expect(page.getByRole('heading', { level: 1, name: 'Loja Centro' })).toBeVisible()
    await expect(kpis(page).getByRole('heading', { level: 2 })).toHaveText(
      'Indicadores da seleção · 0 de 1 loja',
    )
  })
})
