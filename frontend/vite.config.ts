import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isVercel = !!process.env.VERCEL

export default defineConfig({
  plugins: [react()],
  base: isVercel ? '/' : (process.env.BASE_URL || '/tcg_read/'),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/tcg_read/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tcg_read/, ''),
      },
    },
  },
})

