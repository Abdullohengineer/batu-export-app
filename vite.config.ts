import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The Capacitor (native Android) build reuses this same config but skips
  // the PWA plugin entirely: assets are already bundled into the app by
  // Capacitor, so a Workbox service worker on top would just cache-shadow
  // them and risk stale-content bugs after an update. The web/Netlify build
  // (any other mode) is unchanged — it still needs the SW for offline PWA
  // use. Built into its own outDir so `npm run build`'s `dist/` (deployed to
  // Netlify) is never accidentally the no-SW variant or vice versa.
  const isNative = mode === 'capacitor'

  return {
    server: {
      port: Number(process.env.PORT) || 5173,
    },
    build: {
      outDir: isNative ? 'dist-native' : 'dist',
    },
    plugins: [
      react(),
      tailwindcss(),
      !isNative &&
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['favicon.svg'],
          manifest: {
            name: 'BATU EXPORT',
            short_name: 'BATU EXPORT',
            description: 'BATU EXPORT — Ombor & Logistika App',
            theme_color: '#0f172a',
            background_color: '#0f172a',
            display: 'standalone',
            start_url: '/',
            icons: [
              {
                src: 'favicon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
              },
            ],
          },
          workbox: {
            // wasm: the barcode-detector ponyfill's ZXing decoder — without
            // it in the precache, the fallback scan path would silently
            // require a network round-trip on first use, breaking "works
            // offline once cached" (PHASE0.md Part E) for any browser that
            // lacks a native BarcodeDetector (iOS Safari, Firefox, desktop).
            globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm}'],
            maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          },
        }),
    ].filter(Boolean),
  }
})
