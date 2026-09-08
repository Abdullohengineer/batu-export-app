import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'

// Client portal smoke test (CLAUDE.md task follow-up, 2026-09-08) — proves
// the pipeline end to end for a real `client`-role session: real login,
// real navigation to all four screens (Панель + the three Отчёт sub-tabs),
// zero console errors. Not feature coverage — same scope as this app's own
// smoke-test template (CLAUDE.md "Testing workflow": "proves the pipeline
// ... not feature coverage. Feature-specific tests build on this pattern.").
//
// Read-only against whatever real data TEST CLIENT's owner has (or doesn't
// have) — every screen here must render its own empty/zero state cleanly
// if there's nothing to show, since this test asserts "renders without
// error," not specific numbers.
test('Client portal: login, visit all four tabs, no console errors', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  await loginAs(page, 'CLIENT')

  // Панель — the dashboard, index route.
  await expect(page.getByRole('link', { name: 'Панель' })).toBeVisible()
  await expect(page.getByText('Всего на складе')).toBeVisible()

  // Отчёт → Приход (index redirect target).
  await page.getByRole('link', { name: 'Отчёт' }).click()
  await page.waitForURL('**/client/otchet/prihod')
  await expect(page.getByRole('link', { name: 'Приход', exact: true })).toBeVisible()
  await expect(page.getByText('Приход нетто:')).toBeVisible()

  // Расход.
  await page.getByRole('link', { name: 'Расход', exact: true }).click()
  await page.waitForURL('**/client/otchet/rashod')
  await expect(page.getByText('Всего отгружено:')).toBeVisible()

  // Производство.
  await page.getByRole('link', { name: 'Производство' }).click()
  await page.waitForURL('**/client/otchet/proizvodstvo')
  await expect(page.getByText('Всего произведено:')).toBeVisible()

  expect(consoleErrors, `Console errors during the flow: ${consoleErrors.join('\n')}`).toEqual([])
})
