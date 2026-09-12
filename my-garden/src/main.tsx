import * as Sentry from '@sentry/react'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './i18n'

// Error monitoring — no-ops entirely until VITE_SENTRY_DSN is set (free
// account at sentry.io, then add the DSN to .env.local/Netlify env vars).
// Without this, a production error is invisible unless the person hits it
// and happens to tell you. Tracing/replay are paid-tier-heavy extras this
// app doesn't need — just error capture.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({ dsn: sentryDsn, tracesSampleRate: 0 })
}

// Browsers (Safari and PWAs especially) restore the previous scroll
// position on reload/relaunch by default — this is a single-page app with
// one real "page," so that just looks like it opens scrolled to a random
// spot instead of the top.
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual'
}
window.scrollTo(0, 0)

function ErrorFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-50 to-blue-50 p-4">
      <div className="max-w-sm text-center">
        <p className="mb-2 text-4xl">🌱</p>
        <p className="mb-1 font-semibold text-gray-800">Something went wrong.</p>
        <p className="mb-4 text-sm text-gray-600">
          Your data is safe — reloading the page usually fixes this.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
        >
          Reload
        </button>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
)
