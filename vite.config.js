import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { repoKillrApi } from './server/api.mjs'

export default defineConfig({
  plugins: [react(), repoKillrApi()],
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 5180, strictPort: true },
})
