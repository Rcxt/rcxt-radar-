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
            <h1>Something crashed on this device.</h1>
            <p>{String(this.state.error?.message || 'Unknown browser error')}</p>
            <button onClick={() => window.location.reload()}>Reload RCXT Radar</button>
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
