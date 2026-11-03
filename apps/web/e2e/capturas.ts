/**
 * Gera as capturas do README a partir da stack rodando com os dados do desafio.
 *   CAPTURA_SENHA=... bun run apps/web/e2e/capturas.ts
 */
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const base = process.env.CAPTURA_URL ?? 'http://localhost:8080'
const out = resolve(import.meta.dir, '../../../docs/img')
const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1.5,
  locale: 'pt-BR',
})

await page.goto(`${base}/entrar`)
await page.screenshot({ path: `${out}/login.png` })
await page.getByLabel('E-mail').fill(process.env.CAPTURA_EMAIL ?? 'ana.ribeiro@diel.example')
await page.getByLabel('Senha').fill(process.env.CAPTURA_SENHA ?? '')
await page.getByRole('button', { name: 'Entrar' }).click()
await page.getByRole('heading', { name: 'Visão da rede' }).waitFor()
await page.waitForTimeout(800)
await page.screenshot({ path: `${out}/visao-da-rede.png`, fullPage: true })

for (const [id, period, name] of [
  ['AMB-003', '7d', 'detalhe-provadores-7d'],
  ['AMB-014', '30d', 'detalhe-vitrine-recife-30d'],
] as const) {
  await page.goto(`${base}/ambientes/${id}?periodo=${period}`)
  await page.getByRole('img', { name: 'Gráfico da temperatura do ambiente' }).waitFor()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true })
}
await browser.close()
console.info(`capturas em ${out}`)
