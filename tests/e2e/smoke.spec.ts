import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'

// Template test — proves the pipeline works end to end (real login, real
// navigation, real console-error check against a real running instance),
// not feature coverage. See CLAUDE.md "Testing workflow": TEST_OMBOR_* is a
// dedicated test-only account, never a real user.
//
// S4W1 (§5.4 Skladdan CHIQIM) lives at /ombor/chiqim — built in Step 7
// prompts 1-2, still on unmerged feature branches as of this test. This
// test targets the real intended route and will pass once those branches
// merge to main; it is not expected to pass against main today (main
// currently redirects unknown /ombor/* paths back to /ombor's index tab —
// see App.tsx's catch-all route).
test('ombor can log in and load S4W1 (Skladdan CHIQIM) with zero console errors', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  await loginAs(page, 'OMBOR')

  await page.goto('/ombor/chiqim')
  await expect(page.getByRole('link', { name: 'Skladdan CHIQIM' })).toBeVisible()

  expect(consoleErrors, `Console errors on S4W1: ${consoleErrors.join('\n')}`).toEqual([])
})
