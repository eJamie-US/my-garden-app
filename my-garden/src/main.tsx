import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// Browsers (Safari and PWAs especially) restore the previous scroll
// position on reload/relaunch by default — this is a single-page app with
// one real "page," so that just looks like it opens scrolled to a random
// spot instead of the top.
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual'
}
window.scrollTo(0, 0)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
