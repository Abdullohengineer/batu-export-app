import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'

// Full Menejer-request-to-Ombor-scan CHIQIM flow, run against real current
// main — no overlay (CLAUDE.md "Testing workflow"). Uses TEST-CHIQIM-01
// fixtures (2x 2000kg Subxon/Kalibr 6 pallets, exact-match target 4000kg),
// created directly via SQL for the upstream Steps 1-6 chain (see
// DECISIONS.md "CHIQIM end-to-end flow verification" for why: driving
// KIRIM->Moyka->Tayyor receipt through the UI just to produce pallets is a
// lot of unrelated setup for a CHIQIM-focused test).
test('Menejer creates a CHIQIM request, Ombor scans it to an exact match and finishes it', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  // --- Menejer: create the request ---
  await loginAs(page, 'MENEJER')
  // Click the tab (SPA client-side nav) rather than page.goto — a goto
  // right after the post-login redirect raced with it and landed back on
  // the KIRIM tab; both forms share field labels ("Moshina raqami" etc.)
  // so the mistake silently filled the wrong form instead of erroring.
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  await expect(page.getByRole('heading', { name: 'Yangi CHIQIM' })).toBeVisible()

  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill('TEST-CHIQIM-01')
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')

  const selects = page.locator('form:has-text("Yangi CHIQIM") select')
  await expect(page.getByRole('option', { name: 'Test Client A' })).toBeAttached()
  await selects.nth(0).selectOption({ label: 'Test Client A' }) // Buyurtmachi
  await selects.nth(1).selectOption({ label: 'Subxon' }) // Tur
  await selects.nth(2).selectOption({ label: 'Kalibr 6' }) // Kalibr
  await page.locator('input[placeholder="Miqdori (kg)"]').fill('4000')

  await page.getByRole('button', { name: 'Saqlash' }).click()
  await expect(page.getByText('Subxon · Kalibr 6')).toBeVisible()
  await expect(page.getByText('4,000 kg')).toBeVisible()

  // --- switch to Ombor in the same session ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  await page.getByRole('link', { name: 'Skladdan CHIQIM' }).click()
  await expect(page.getByRole('heading', { name: "Yuklash uchun so'rovlar" })).toBeVisible()

  // request appears in S4W1
  const requestRow = page.getByRole('button', { name: /TEST-CHIQIM-01/ })
  await expect(requestRow).toBeVisible()
  await requestRow.click()

  // scan both TEST- pallets
  const barcodeInput = page.getByPlaceholder("Barcode #2 ni kiriting yoki skanerlang")
  await barcodeInput.fill('PLT-TEST-CHIQIM-01-06-1')
  await page.getByRole('button', { name: 'Skanerlash' }).click()
  await barcodeInput.fill('PLT-TEST-CHIQIM-01-06-2')
  await page.getByRole('button', { name: 'Skanerlash' }).click()

  // running total hits target exactly
  await expect(page.getByText('4,000 / 4,000 kg')).toBeVisible()
  await expect(page.getByText('✓ Aniq mos keldi')).toBeVisible()

  // finish
  await page.getByRole('button', { name: 'Yuklashni yakunlash' }).click()
  await page.getByRole('button', { name: 'Ha, yakunlash' }).click()

  // moved to Ombor's W2 — W1 empty again, request now under Yuklandi
  await expect(page.getByText("Ochiq so'rov yo'q.")).toBeVisible()
  await expect(page.getByRole('button', { name: /TEST-CHIQIM-01/ })).toBeVisible()

  expect(consoleErrors, `Console errors during the flow: ${consoleErrors.join('\n')}`).toEqual([])
})
