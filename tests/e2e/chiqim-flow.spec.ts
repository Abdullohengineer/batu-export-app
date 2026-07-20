import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'
import { uniqueTestId, seedDispatchablePallets } from './helpers/fixtures'

// Full Menejer-request-to-Ombor-scan CHIQIM flow, run against real current
// main — no overlay (CLAUDE.md "Testing workflow"). Fixture pallets (2x
// 2000kg Subxon/Kalibr 6, exact-match target 4000kg) are seeded fresh every
// run via seedDispatchablePallets (Step 9: self-generating test fixtures —
// see DECISIONS.md) instead of a one-time hand-written SQL fixture, so this
// spec never again goes stale/voided between sessions.
test('Menejer creates a CHIQIM request, Ombor scans it to an exact match and finishes it', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  const { pallets } = await seedDispatchablePallets(page, {
    count: 2,
    weightKgEach: 2000,
    typeLabel: 'Subxon',
    calibreLabel: 'Kalibr 6',
  })
  const PLATE = uniqueTestId('CHIQIM')

  // --- Menejer: create the request ---
  await loginAs(page, 'MENEJER')
  // Click the tab (SPA client-side nav) rather than page.goto — a goto
  // right after the post-login redirect raced with it and landed back on
  // the KIRIM tab; both forms share field labels ("Moshina raqami" etc.)
  // so the mistake silently filled the wrong form instead of erroring.
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  await expect(page.getByRole('heading', { name: 'Yangi CHIQIM' })).toBeVisible()

  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(PLATE)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')

  const selects = page.locator('form:has-text("Yangi CHIQIM") select')
  await expect(page.getByRole('option', { name: 'Test Client A' })).toBeAttached()
  await selects.nth(0).selectOption({ label: 'Test Client A' }) // Buyurtmachi
  await selects.nth(1).selectOption({ label: 'Subxon' }) // Tur
  await selects.nth(2).selectOption({ label: 'Kalibr 6' }) // Kalibr
  await page.locator('input[placeholder="Miqdori (kg)"]').fill('4000')

  await page.getByRole('button', { name: 'Saqlash' }).click()
  // Scoped to the just-saved confirmation row, not an unscoped page-wide
  // text match — the same "4,000 kg" phrase also legitimately appears in
  // Menejer's own finished-requests list once any other 4,000kg request
  // exists anywhere (a real, pre-existing test-locator fragility, exposed
  // now that fixtures no longer die before reaching this line — see
  // DECISIONS.md "self-generating test fixtures").
  const savedLine = page.locator('div.flex.items-center.justify-between', { hasText: 'Subxon · Kalibr 6' })
  await expect(savedLine).toBeVisible()
  await expect(savedLine).toContainText('4,000 kg')

  // --- switch to Ombor in the same session ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  await page.getByRole('link', { name: 'Skladdan CHIQIM' }).click()
  await expect(page.getByRole('heading', { name: "Yuklash uchun so'rovlar" })).toBeVisible()

  // request appears in S4W1. Scoped to W1 ("Yuklash uchun so'rovlar") —
  // W2 ("Yuklandi") renders a button with the IDENTICAL date/plate/driver
  // text shape, so an unscoped locator finds the same request again once
  // it moves there after finishing (a real, pre-existing bug, only now
  // exposed since fixtures no longer die before reaching this line — see
  // chiqim-full-chain.spec.ts, which already scopes this correctly).
  const omborW1 = page.getByRole('heading', { name: "Yuklash uchun so'rovlar" }).locator('xpath=following-sibling::div[1]')
  const requestRow = omborW1.getByRole('button', { name: new RegExp(PLATE) })
  await expect(requestRow).toBeVisible()
  await requestRow.click()

  // scan both fixture pallets
  const barcodeInput = page.getByPlaceholder("Barcode #2 ni kiriting yoki skanerlang")
  await barcodeInput.fill(pallets[0].barcode2)
  await page.getByRole('button', { name: 'Skanerlash' }).click()
  await barcodeInput.fill(pallets[1].barcode2)
  await page.getByRole('button', { name: 'Skanerlash' }).click()

  // running total hits target exactly
  await expect(page.getByText('4,000 / 4,000 kg')).toBeVisible()
  await expect(page.getByText('✓ Aniq mos keldi')).toBeVisible()

  // finish
  await page.getByRole('button', { name: 'Yuklashni yakunlash' }).click()
  await page.getByRole('button', { name: 'Ha, yakunlash' }).click()

  // moved to Ombor's W2 — OUR request specifically leaves W1. NOT asserting
  // the whole list is empty ("Ochiq so'rov yo'q.", the original assertion
  // here): the live DB carries 36 pre-existing open chiqim_requests from
  // long before this session (no void mechanism — explicitly out of scope,
  // see DECISIONS.md "self-generating test fixtures"), so a global-empty
  // check can never pass again regardless of fixture freshness. Confirmed
  // with the user before changing this one assertion.
  await expect(requestRow).not.toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(PLATE) })).toBeVisible()

  expect(consoleErrors, `Console errors during the flow: ${consoleErrors.join('\n')}`).toEqual([])
})
