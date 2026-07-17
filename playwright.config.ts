import { defineConfig } from '@playwright/test'

// Loads .env.test (test-role credentials) using Node's built-in env-file
// loader — no dotenv dependency needed (Node 20.6+). See CLAUDE.md "Testing
// workflow" for what lives in .env.test and why.
try {
  process.loadEnvFile('.env.test')
} catch {
  // Missing in CI or a fresh clone — surfaced by the tests themselves
  // failing to find TEST_*_PHONE/PASSWORD, not silently skipped here.
}

// baseURL: local dev server, not the deployed Netlify URL. Reasons:
// 1. No Netlify URL is known/confirmed in this environment — guessing one
//    would violate "never guess URLs for the user."
// 2. This project has no staging/CI environment yet, only local dev + a
//    manually-reviewed PR workflow (CLAUDE.md) — local dev is the only
//    environment this session can actually stand up and tear down.
// 3. `npm run dev` is already the project's own standard way to run the app
//    for manual verification (see every DECISIONS.md entry's "Verification"
//    section) — this just automates the same thing.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // shared test accounts — avoid concurrent sessions colliding
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
