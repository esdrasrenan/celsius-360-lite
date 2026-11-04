import { createHash } from 'node:crypto'
import { type Browser, expect, type Page, test } from '@playwright/test'
import { horizontalOverflow, sessionFile } from './support'

/**
 * Gráfico de temperatura (critério 8.8 da especificação) contra a stack de E2E (test/fixtures/e2e):
 * "Salão" (AMB-T1) da Loja Centro, em São Paulo, com dois dias de telemetria e um trecho de
 * sensor travado. O canvas não tem DOM, então as camadas são conferidas pelos pixels nas cores dos
 * tokens --grafico-*, e os rótulos do eixo pela imagem inteira do canvas.
 */

const ROUTE = '/ambientes/AMB-T1?periodo=7d'
/** Margens do plot em option.ts: 56 px à esquerda, 64 à direita, 16 no topo e 92 embaixo. */
const PLOT = { left: 56, right: 64, top: 16, bottom: 92 }

test.use({ storageState: sessionFile('admin') })

const chart = (page: Page) => page.locator('#grafico-temperatura [role="application"]')
const canvas = (page: Page) => chart(page).locator('canvas').first()
const tooltip = (page: Page) => page.locator('[data-chart-tooltip]')
const legendButton = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Camadas do gráfico' }).getByRole('button', { name, exact: true })

async function openChart(page: Page, route = ROUTE) {
  await page.goto(route)
  await chart(page).scrollIntoViewIfNeeded()
  await expect(canvas(page)).toBeVisible()
  await stableCanvas(page)
}

/** Imagem do canvas quando ela para de mudar (as fontes e a primeira pintura já aconteceram). */
async function stableCanvas(page: Page): Promise<string> {
  let last = ''
  for (let attempt = 0; attempt < 20; attempt++) {
    const image = await canvas(page).evaluate((node) => (node as HTMLCanvasElement).toDataURL())
    const hash = createHash('sha256').update(image).digest('hex')
    if (hash === last) return hash
    last = hash
    await page.waitForTimeout(150)
  }
  throw new Error('o canvas não estabilizou')
}

/** Centro do plot, em coordenadas da página. */
async function plotCenter(page: Page) {
  const box = await canvas(page).boundingBox()
  if (!box) throw new Error('canvas sem caixa')
  return {
    x: box.x + PLOT.left + (box.width - PLOT.left - PLOT.right) / 2,
    y: box.y + PLOT.top + 60,
  }
}

/**
 * Pixels do plot (sem eixos, tira e brush) perto das cores da linha de temperatura, dos limites
 * da faixa e da hachura de leitura descartada.
 */
function countLayerPixels(page: Page) {
  return canvas(page).evaluate((node, plot) => {
    const element = node as HTMLCanvasElement
    const context = element.getContext('2d')
    if (!context) throw new Error('canvas sem contexto 2d')
    const ratio = element.width / element.clientWidth
    const css = getComputedStyle(document.documentElement)
    const rgb = (name: string) => {
      const hex = css.getPropertyValue(name).trim().slice(1)
      return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16))
    }
    const groups = {
      // Sem o cinza de fora do horário: a borda suavizada da Externa passa por ele
      line: ['--grafico-temperatura', '--grafico-acima', '--grafico-abaixo'].map(rgb),
      comfort: [rgb('--grafico-faixa-borda')],
      discarded: [rgb('--grafico-descartada')],
    }
    const x = Math.round(plot.left * ratio)
    const y = Math.round(plot.top * ratio)
    const width = element.width - x - Math.round(plot.right * ratio)
    const height = element.height - y - Math.round(plot.bottom * ratio)
    const { data } = context.getImageData(x, y, width, height)
    const counts = { line: 0, comfort: 0, discarded: 0 }
    for (let i = 0; i < data.length; i += 4) {
      // O canvas é transparente: compõe sobre o branco do cartão antes de comparar
      const alpha = (data[i + 3] ?? 0) / 255
      const pixel = [0, 1, 2].map((channel) => (data[i + channel] ?? 0) * alpha + 255 * (1 - alpha))
      for (const group of ['line', 'comfort', 'discarded'] as const) {
        const near = groups[group].some(
          (color) =>
            pixel.reduce((sum, value, channel) => sum + Math.abs(value - (color[channel] ?? 0)), 0) < 30,
        )
        if (near) counts[group]++
      }
    }
    return counts
  }, PLOT)
}

test.describe('gráfico de temperatura', () => {
  test('desligar "Temperatura" mantém a faixa e as lacunas visíveis', async ({ page }) => {
    await openChart(page)
    const before = await countLayerPixels(page)
    expect(before.line).toBeGreaterThan(200)
    expect(before.comfort).toBeGreaterThan(50)
    expect(before.discarded).toBeGreaterThan(20)

    await legendButton(page, 'Temperatura').click()
    await expect(legendButton(page, 'Temperatura')).toHaveAttribute('aria-pressed', 'false')
    // Tira o ponteiro da legenda: o hover destaca uma série e esmaece as outras
    await page.mouse.move(0, 0)
    await stableCanvas(page)
    const after = await countLayerPixels(page)
    expect(after.line).toBeLessThan(before.line * 0.1)
    expect(after.comfort).toBeGreaterThanOrEqual(before.comfort * 0.9)
    expect(after.discarded).toBeGreaterThanOrEqual(before.discarded * 0.9)
    await expect(legendButton(page, `Faixa de conforto 21–25 °C`)).toHaveAttribute('aria-pressed', 'true')
  })

  test('rolar sobre o gráfico sem Ctrl rola a página; com Ctrl, amplia', async ({ page }) => {
    await openChart(page)
    const center = await plotCenter(page)
    await page.mouse.move(center.x, center.y)
    const start = await page.evaluate(() => window.scrollY)
    await page.mouse.wheel(0, 300)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(start)

    const { x, y } = await plotCenter(page)
    await page.mouse.move(x, y)
    const scrolled = await page.evaluate(() => window.scrollY)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -400)
    await page.keyboard.up('Control')
    await expect(page.getByRole('button', { name: 'Redefinir zoom' })).toBeVisible()
    await expect(page.getByText(/^Exibindo /)).toBeVisible()
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
  })

  test('o tooltip numa lacuna mostra o motivo e o intervalo', async ({ page }) => {
    await openChart(page)
    // "Ver no gráfico" amplia na lacuna (±2 h): ela fica no centro do plot
    await page
      .getByRole('region', { name: 'Lacunas e descartes' })
      .getByRole('button', { name: /^Ver no gráfico: Sensor travado/ })
      .first()
      .click()
    await expect(page.getByRole('button', { name: 'Redefinir zoom' })).toBeVisible()
    await stableCanvas(page)
    const center = await plotCenter(page)
    await page.mouse.move(center.x, center.y)
    await expect(tooltip(page)).toContainText('Sem leitura válida')
    await expect(tooltip(page)).toContainText(
      /Sensor travado · \d{2}\/\d{2} \d{2}:\d{2} – \d{2}\/\d{2} \d{2}:\d{2} \(\d+ (h|min)/,
    )
  })

  test('responde às setas e anuncia a leitura', async ({ page }) => {
    await openChart(page)
    await chart(page).focus()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowLeft')
    await expect(tooltip(page)).toContainText(/^\w{3}, \d{2}\/\d{2} · \d{2}:\d{2}–\d{2}:\d{2}/)
    await expect(page.locator('[aria-live="polite"]').filter({ hasText: /°C|sem leitura/ })).toHaveText(
      /^\w{3} \d{2}\/\d{2} \d{2}:\d{2}, /,
    )
    await page.keyboard.press('Escape')
    await expect(tooltip(page)).toBeHidden()
  })
})

/** Abre o gráfico num navegador com outro fuso e devolve a imagem do canvas e o tooltip do fim. */
async function renderIn(browser: Browser, timeZone: string) {
  const baseURL = test.info().project.use.baseURL
  const context = await browser.newContext({
    baseURL,
    timezoneId: timeZone,
    locale: 'pt-BR',
    storageState: sessionFile('admin'),
  })
  const page = await context.newPage()
  await page.setViewportSize({ width: 1366, height: 900 })
  await openChart(page)
  const image = await stableCanvas(page)
  await chart(page).focus()
  await page.keyboard.press('End')
  const header = await tooltip(page).locator('p').first().textContent()
  const summary = await chart(page).getAttribute('aria-describedby')
  const description = summary ? await page.locator(`[id="${summary}"]`).textContent() : null
  await context.close()
  return { image, header, description }
}

test('com o navegador em UTC e em Tóquio, eixo e tooltip seguem o fuso da loja', async ({ browser }) => {
  const reference = await renderIn(browser, 'America/Sao_Paulo')
  expect(reference.header).toMatch(/^\w{3}, \d{2}\/\d{2} · \d{2}:\d{2}–\d{2}:\d{2}$/)
  expect(reference.description).toContain('horário de São Paulo')
  for (const timeZone of ['UTC', 'Asia/Tokyo']) {
    const other = await renderIn(browser, timeZone)
    // A mesma imagem: marcas, rótulos e linhas da meia-noite caem nos mesmos pixels
    expect(other.image, `canvas em ${timeZone}`).toBe(reference.image)
    expect(other.header).toBe(reference.header)
    expect(other.description).toBe(reference.description)
  }
})

test.describe('celular', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('um tooltip tocado a 390 px fica dentro do cartão', async ({ page }) => {
    await openChart(page)
    const center = await plotCenter(page)
    await page.touchscreen.tap(center.x, center.y)
    await expect(tooltip(page)).toBeVisible()
    const tip = await tooltip(page).boundingBox()
    const card = await page.locator('#grafico-temperatura').boundingBox()
    if (!tip || !card) throw new Error('sem caixa do tooltip ou do cartão')
    expect(tip.x).toBeGreaterThanOrEqual(card.x)
    expect(tip.x + tip.width).toBeLessThanOrEqual(card.x + card.width)
    expect(tip.y).toBeGreaterThanOrEqual(card.y)
    expect(tip.y + tip.height).toBeLessThanOrEqual(card.y + card.height)
    expect(await horizontalOverflow(page)).toBe(0)
  })

  test('imprimir a partir do celular dá ao canvas a largura do cartão no desktop', async ({ page }) => {
    await openChart(page)
    const width = () => canvas(page).evaluate((node) => node.getBoundingClientRect().width)
    const onScreen = await width()
    expect(onScreen).toBeLessThan(400)
    // page.pdf não dispara os eventos de impressão; o diálogo do navegador dispara
    await page.evaluate(() => dispatchEvent(new Event('beforeprint')))
    expect(await width()).toBe(1176)
    await page.evaluate(() => dispatchEvent(new Event('afterprint')))
    expect(await width()).toBe(onScreen)
  })
})
