import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate' silently force-reloads the page the moment it notices
      // a new deploy — including mid-interaction, wiping out anything
      // unsaved (e.g. a yard obstacle being drawn). 'prompt' + the
      // UpdatePrompt component instead lets the person choose when to
      // reload, via useRegisterSW's onNeedRefresh.
      registerType: 'prompt',
      // Registration is now done manually via useRegisterSW (UpdatePrompt.tsx)
      // instead of the plugin's own auto-injected script, so onNeedRefresh
      // can actually drive UI.
      injectRegister: null,
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'My Garden',
        short_name: 'My Garden',
        description: 'Track and care for your plants, plot by plot.',
        start_url: '/',
        display: 'standalone',
        background_color: '#f0fdf4',
        theme_color: '#059669',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Plant/garden photos are served straight from Supabase Storage —
        // deliberately not precached or runtime-cached here, so "offline"
        // means the shell and static assets, not a stale copy of every
        // photo ever uploaded.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
    }),
  ],
})
