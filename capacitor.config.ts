import type { CapacitorConfig } from '@capacitor/cli'

// No `server.url` — the native build loads the bundled assets in `webDir`
// (Capacitor's default when `server` is unset), never the Netlify deploy, so
// the app opens and works with no signal. `webDir` points at `dist-native`
// (built via `npm run build:native`), the PWA-plugin-free build output — see
// vite.config.ts's `isNative` branch for why the two builds are kept apart.
const config: CapacitorConfig = {
  appId: 'com.batuexport.app',
  appName: 'BATU EXPORT',
  webDir: 'dist-native',
  plugins: {
    // Capgo hosted service (updateUrl/channelUrl/statsUrl left unset — that
    // IS the hosted-service config, they only need overriding to self-host).
    // 'atBackground': checks on every foreground (app start/resume), downloads
    // in the background, applies on the NEXT background/relaunch — never
    // mid-session, so Ombor is never yanked out of an active scan. Rollback
    // isn't a separate setting here: it's automatic whenever notifyAppReady()
    // (main.tsx) doesn't fire within appReadyTimeout (default 10s) — see
    // DECISIONS.md for the full release flow and how this was verified.
    CapacitorUpdater: {
      autoUpdate: 'atBackground',
    },
  },
}

export default config
