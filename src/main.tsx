import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Must fire before any network request, not after auth/data loads — the
// native plugin auto-rolls-back to the last known-good bundle if this
// doesn't arrive within appReadyTimeout (10s default, capacitor.config.ts).
// Safe to call unconditionally: @capgo/capacitor-updater ships a web no-op
// implementation, so this is inert on the Netlify build.
CapacitorUpdater.notifyAppReady()
