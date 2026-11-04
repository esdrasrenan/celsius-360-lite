import { expect, type Page, test } from '@playwright/test'
import { sessionFile } from './support'

/**
 * Critério 8.4: em 320, 390 e 1440 px, e nos tablets de 768 e 820 px (onde o cabeçalho já mostra a
 * navegação), o login, a visão da rede, o detalhe de um ambiente e a qualidade dos dados não rolam
 * na horizontal, não têm texto visível abaixo de 12 px, caixa alta nem atributo title.
 */

const VIEWPORTS = [
  { width: 320, height: 820 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
]

const ROUTES: { path: string; ready: (page: Page) => Promise<void> }[] = [
  {
    path: '/entrar',
    ready: (page) => expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible(),
  },
  {
    path: '/',
    ready: (page) => expect(page.getByRole('button', { name: /^Ambientes de / }).first()).toBeVisible(),
  },
  {
    path: '/ambientes/AMB-T1?periodo=30d',
    ready: async (page) => {
      await expect(page.getByRole('heading', { level: 1, name: 'Salão' })).toBeVisible()
      await expect(page.locator('#grafico-temperatura canvas').first()).toBeVisible()
    },
  },
  {
    path: '/qualidade',
    ready: (page) => expect(page.getByRole('heading', { name: 'Anomalias encontradas' })).toBeVisible(),
  },
]

/** O que a página fere do critério; tudo vazio ou zero quando passa. */
function audit(page: Page) {
  return page.evaluate(() => {
    const shown = (element: Element) => {
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden'
    }
    const elements = [...document.body.querySelectorAll('*')]
    const withText = elements.filter(
      (element) =>
        shown(element) &&
        [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()),
    )
    const describe = (element: Element) =>
      `${element.tagName.toLowerCase()} "${element.textContent?.trim().slice(0, 40)}"`
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      smallText: withText
        .filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < 12)
        .map(describe),
      uppercase: elements
        .filter((element) => getComputedStyle(element).textTransform === 'uppercase')
        .map(describe),
      title: [...document.querySelectorAll('[title]')].map(describe),
    }
  })
}

for (const { path, ready } of ROUTES) {
  test.describe(path, () => {
    if (path !== '/entrar') test.use({ storageState: sessionFile('admin') })

    for (const viewport of VIEWPORTS) {
      test(`${viewport.width}×${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await page.goto(path)
        await ready(page)
        expect(await audit(page)).toEqual({ overflowX: 0, smallText: [], uppercase: [], title: [] })
      })
    }
  })
}
