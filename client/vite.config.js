import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['satellite-icon.svg', 'pwa_icon_small.png', 'pwa_icon_large.png'],
      workbox: {
        // CRITICAL: Ne pas intercepter les requêtes vers les shards et l'API
        // Sans ça, le Service Worker sert index.html au lieu du contenu des shards
        navigateFallbackDenylist: [/^\/shards/, /^\/api/, /^\/apps/]
      },
      manifest: {
        name: 'Stardust Uplink',
        short_name: 'Stardust',
        description: 'Military Grade Cloud Orchestration Interface',
        theme_color: '#0a0f18',
        background_color: '#0a0f18',
        display: 'standalone',
        icons: [
          {
            src: 'pwa_icon_small.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa_icon_large.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa_icon_large.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
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
