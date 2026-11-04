import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const api = process.env.API_URL ?? 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  server: {
    // Explícito: no Windows o Vite pode escutar só em [::1], e 127.0.0.1 fica inacessível
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: api, changeOrigin: false } },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // ECharts num chunk próprio: a visão da rede carrega sem ele
        manualChunks: (id: string) =>
          id.includes('node_modules/echarts') || id.includes('zrender') ? 'echarts' : undefined,
      },
    },
  },
})
