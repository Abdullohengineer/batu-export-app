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
  // `fullyParallel: false` only serializes tests WITHIN one file; Playwright
  // still defaults to multiple WORKER PROCESSES across different files,
  // which can log the same shared test account in from two sessions at
  // once. Found live (Step 9 regression pass, see DECISIONS.md): a 2-worker
  // full-suite run produced session-collision symptoms (a stray 403, a
  // stuck login, elements racing into/out of view) that a single-worker run
  // of the identical suite did not — this line is the actual enforcement
  // the comment above always intended.
  workers: 1,
  retries: 0,
  reporter: 'list',
  // Default per-assertion timeout (Playwright's own default is 5000ms).
  // Found live (Step 9: self-generating test fixtures — see DECISIONS.md):
  // three unrelated specs (smoke, rewash-full-cycle, step9-single-product-
  // full-chain) each failed exactly once, on an ordinary un-overridden
  // assertion, only when running deep into a full-suite sweep — every one
  // passed cleanly standalone. The live DB has grown by hundreds of rows
  // across many tables over the course of this project's testing history;
  // several hooks in this app do unfiltered full-table scans by design
  // (CLAUDE.md "derive, don't store" — events, not running balances), so
  // per-screen load time grows with total row count, not with anything a
  // single test controls. 15s covers the slowdown observed without masking
  // a genuine hang (still far below this app's explicit long-chain
  // overrides of 90-120s).
  expect: { timeout: 15_000 },
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
