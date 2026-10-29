import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/fila-digital-halloween/' : '/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
  },
})
