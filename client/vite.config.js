import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/shards': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/apps': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Assets requested by shards (Magic Redirection targets)
      '/assets': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/vite.svg': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/registerSW.js': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/manifest.webmanifest': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  }
})
