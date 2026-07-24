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
}

export default config
