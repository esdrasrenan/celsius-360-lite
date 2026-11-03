import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const api = process.env.API_URL ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  server: {
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
