import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'NetWatch ERP',
        short_name: 'NetWatch',
        description: 'Infrastructure monitoring & incident management ERP — Airport IT Operations',
        lang: 'id',
        dir: 'ltr',
        // Samakan dengan --color-bg tema gelap (index.css) supaya bilah status &
        // layar splash tidak berbeda warna dengan aplikasinya sendiri.
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        // Turun ke minimal-ui bila standalone tak didukung; browser lama
        // mengabaikan field ini dan langsung memakai `display` di atas.
        // Orientasi sengaja TIDAK dikunci: tabel perangkat, peta, SSH terminal,
        // dan wallboard jauh lebih terbaca dalam mode lanskap.
        display_override: ['standalone', 'minimal-ui'],
        start_url: '/',
        scope: '/',
        categories: ['business', 'productivity', 'utilities'],
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Pintasan tekan-lama pada ikon aplikasi. Manifest bersifat statis (tidak
        // sadar peran), jadi hanya rute yang aman untuk semua peran yang dipakai:
        // "/" mengarahkan sendiri ke dashboard sesuai peran.
        shortcuts: [
          { name: 'Dashboard', short_name: 'Dashboard', url: '/', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
          { name: 'Insiden Saya', short_name: 'Insiden', url: '/my-incidents', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
          { name: 'Notifikasi', short_name: 'Notifikasi', url: '/notifikasi', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // Jangan cache API/uploads/socket.io — data harus selalu live, bukan stale dari cache.
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//, /^\/socket\.io\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^\/uploads\//,
            handler: 'NetworkFirst',
            options: { cacheName: 'nw-uploads', expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
})
