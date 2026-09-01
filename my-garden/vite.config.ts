import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The browser calls /plantnet-api/... and Vite forwards it to Pl@ntNet
      // server-side. Pl@ntNet rejects requests made directly from a web page,
      // so we also strip the browser's origin/referer headers on the way out —
      // making it look like the plain server-to-server call that curl makes.
      '/plantnet-api': {
        target: 'https://my-api.plantnet.org',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/plantnet-api/, '/v2'),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin')
            proxyReq.removeHeader('referer')
            proxyReq.removeHeader('sec-fetch-site')
            proxyReq.removeHeader('sec-fetch-mode')
            proxyReq.removeHeader('sec-fetch-dest')
          })
        },
      },
    },
  },
})
