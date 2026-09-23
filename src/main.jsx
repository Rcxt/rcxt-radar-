import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('RCXT Radar render error', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="fatalScreen">
          <div className="fatalCard">
            <span>RCXT RADAR</span>
            <h1>RCXT hit bad screen data.</h1>
            <p>The app caught the error instead of silently freezing. Reload to recover; your saved watchlist and notes stay intact.</p>
            <button onClick={() => window.location.reload()}>Reload RCXT Radar</button>
            <details className="fatalDetails">
              <summary>Technical details</summary>
              <code>{String(this.state.error?.message || 'Unknown browser error')}</code>
            </details>
          </div>
        </main>
      )
    }

    return this.props.children
  }
}

const root = document.getElementById('root')

if (!root) {
  document.body.innerHTML = '<div style="padding:24px;color:white;background:#06080b;min-height:100vh">RCXT Radar failed to mount: root element missing.</div>'
} else {
  createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  )
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('RCXT service worker registration failed', error)
    })
  })
}
