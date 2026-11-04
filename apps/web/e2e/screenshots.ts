/**
 * Gera as capturas do README (docs/img) a partir da stack principal no ar, com os dados do desafio:
 *
 *   bun run apps/web/e2e/capturas.ts
 *
 * A senha vem do DEMO_PASSWORD do .env da raiz (ou da variável CAPTURA_SENHA) e nunca é impressa.
 * CAPTURA_URL troca o endereço (padrão http://127.0.0.1:8080).
 */
import { resolve } from 'node:path'
import { chromium, type Page } from '@playwright/test'

const base = process.env.CAPTURA_URL ?? 'http://127.0.0.1:8080'
const out = resolve(import.meta.dir, '../../../docs/img')

async function demoPassword(): Promise<string> {
  if (process.env.CAPTURA_SENHA) return process.env.CAPTURA_SENHA
  const env = Bun.file(resolve(import.meta.dir, '../../../.env'))
  const value = (await env.exists()) ? /^DEMO_PASSWORD=(.*)$/m.exec(await env.text())?.[1]?.trim() : undefined
  if (!value) throw new Error('Defina DEMO_PASSWORD no .env ou CAPTURA_SENHA.')
  return value
}

/** Espera as fontes e tira o ponteiro de cima da tela: nenhuma dica aberta na captura. */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
  await page.waitForTimeout(800)
}

const password = await demoPassword()
const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
})

await page.goto(`${base}/entrar`)
await page.getByRole('heading', { level: 1, name: 'Entrar' }).waitFor()
await settle(page)
await page.screenshot({ path: `${out}/login.png` })

await page.getByLabel('E-mail').fill(process.env.CAPTURA_EMAIL ?? 'ana.ribeiro@diel.example')
await page.getByLabel('Senha').fill(password)
await page.getByRole('button', { name: 'Entrar', exact: true }).click()
await page.getByRole('heading', { level: 1, name: 'Visão da rede' }).waitFor()

// Rede em 30 dias, ordenada por pior conforto: a primeira tela do README
await page.goto(`${base}/?periodo=30d&ordem=comfort`)
await page
  .getByRole('button', { name: /^Ambientes de / })
  .first()
  .waitFor()
await settle(page)
await page.screenshot({ path: `${out}/visao-da-rede.png` })

// Vitrine da Loja Boa Viagem: lacuna sem dados, sensor travado e loja fechada no mesmo período
await page.goto(`${base}/ambientes/AMB-014?periodo=30d`)
await page.locator('#grafico-temperatura canvas').first().waitFor()
await page.getByRole('heading', { name: 'Conforto por dia' }).waitFor()
await settle(page)
await page.screenshot({ path: `${out}/detalhe-vitrine-recife-30d.png`, fullPage: true })

await browser.close()
console.info(`capturas em ${out}`)
