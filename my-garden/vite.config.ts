import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // host: true binds the dev server to 0.0.0.0 (not just localhost) so a
  // phone on the same Wi-Fi can reach it at this Mac's LAN address — `npm
  // run dev` prints that address on startup.
  server: {
    host: true,
  },
  build: {
    // Without this, a production crash report (e.g. from Sentry, or an
    // ErrorBoundary email) only has minified names/positions — resolving
    // one back to real source means manually downloading the exact deployed
    // bundle and pattern-matching, the way the PlantForm.tsx crash had to be
    // traced. Safe to publish alongside the JS: nothing secret is ever
    // bundled client-side (VITE_-prefixed env vars like the Supabase anon
    // key are already public/RLS-protected, same as they are in the
    // minified JS itself), so this doesn't expose anything new — it just
    // makes the existing code easier to read.
    sourcemap: true,
  },
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
      // 'injectManifest' (a hand-written src/sw.ts) instead of the default
      // 'generateSW' (an auto-built one) — purely so push/notificationclick
      // handlers can be added for background notifications. src/sw.ts still
      // does the same precaching + SKIP_WAITING handling generateSW's own
      // template did, so the update-prompt behavior above is unchanged.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
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
      // Same key as before, just under injectManifest instead of workbox —
      // this still only controls what precacheAndRoute(self.__WB_MANIFEST)
      // in src/sw.ts sees. Plant/garden photos are served straight from
      // Supabase Storage — deliberately not precached or runtime-cached
      // here, so "offline" means the shell and static assets, not a stale
      // copy of every photo ever uploaded.
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
      // Lets `npm run dev` register a real service worker too — otherwise
      // only a production build does, and testing "Enable notifications"
      // would require a full deploy every time. Dev-mode note: with
      // strategies: 'injectManifest', Workbox serves src/sw.ts directly
      // (unbundled) in dev, so it needs a browser with real ES module
      // service worker support (current Chrome/Edge/Firefox all qualify).
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
})
