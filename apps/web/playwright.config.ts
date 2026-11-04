import { defineConfig, devices } from '@playwright/test'

/**
 * E2E contra a stack completa (nginx + API + bancos) carregada com os dados sintéticos de test/fixtures.
 * Veja o README: `bun run e2e:stack` sobe essa stack em portas próprias.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:18080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
  projects: [
    // Entra uma vez com cada usuário da fixture e grava a sessão (e2e/support.ts)
    { name: 'sessoes', testMatch: /sessions\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
      dependencies: ['sessoes'],
    },
  ],
})
