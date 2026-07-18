import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.png')
const PLATE = 'TEST-CHIQIM-04'

// Full CHIQIM chain, real merged main: Menejer creates a request -> Qorovul
// stage 1 (empty weigh + photos) -> Ombor scans + finishes (already built,
// prompt 2) -> Qorovul stage 2 (loaded weigh + 3 photos) -> confirm the
// complete_chiqim_stage2() trigger flips chiqim_requests.status.
// TEST-CHIQIM-03 fixtures (2x 2000kg Subxon/Kalibr 6 pallets) — a fresh
// name distinct from TEST-CHIQIM-01/02, which are earlier attempts left in
// place per CLAUDE.md's void-not-delete rule (chiqim_requests/chiqim_lines/
// dispatch_manifest have no void mechanism — see prior prompt's DECISIONS
// entry) and would otherwise collide with these locators, since Ombor's W2
// and Qorovul's Yakunlangan both render the identical "date · plate ·
// driver" text shape as W1/Faol.
test('Menejer -> Qorovul stage 1 -> Ombor scan -> Qorovul stage 2 -> status flips to olib_ketildi', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  // --- Menejer: create the request ---
  await loginAs(page, 'MENEJER')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  await expect(page.getByRole('heading', { name: 'Yangi CHIQIM' })).toBeVisible()

  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(PLATE)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  const menejerSelects = page.locator('form:has-text("Yangi CHIQIM") select')
  await expect(page.getByRole('option', { name: 'Test Client A' })).toBeAttached()
  await menejerSelects.nth(0).selectOption({ label: 'Test Client A' })
  await menejerSelects.nth(1).selectOption({ label: 'Subxon' })
  await menejerSelects.nth(2).selectOption({ label: 'Kalibr 6' })
  await page.locator('input[placeholder="Miqdori (kg)"]').fill('4000')
  await page.getByRole('button', { name: 'Saqlash' }).click()
  await expect(page.getByText('Subxon · Kalibr 6')).toBeVisible()

  // --- Qorovul: stage 1 (empty truck arrives) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  await page.getByRole('link', { name: 'CHIQIM' }).click()

  // Scoped to the "Faol" heading's row container — "Yakunlangan" renders
  // the same .rounded-md card shape, and by design a trip can only be in
  // one of the two at a time, but scoping explicitly avoids relying on
  // that DOM-order coincidence.
  const faol = page.getByRole('heading', { name: 'Faol' }).locator('xpath=following-sibling::div[1]')
  const qorovulRow = faol.locator('.rounded-md', { hasText: PLATE })
  await expect(qorovulRow).toBeVisible()
  await qorovulRow.getByRole('button', { name: 'Qabul qilish' }).click()

  await qorovulRow.locator('div:has(> label:text-is("Moshina raqami rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await qorovulRow.locator('div:has(> label:text-is("Bo\'sh vazn (Пустой)")) input[type="number"]').fill('8000')
  await qorovulRow.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await qorovulRow.getByRole('button', { name: 'Qabul qilish' }).click()

  // row is now red/in-progress, waiting for stage 2
  await expect(faol.locator('.rounded-md.border-red-300', { hasText: PLATE })).toBeVisible()

  // --- Ombor: scan + finish (already-built flow, prompt 2) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  await page.getByRole('link', { name: 'Skladdan CHIQIM' }).click()

  // Scoped to W1 ("Yuklash uchun so'rovlar") — W2 ("Yuklandi") renders a
  // toggle button with the identical date/plate/driver text shape.
  const omborW1 = page.getByRole('heading', { name: "Yuklash uchun so'rovlar" }).locator('xpath=following-sibling::div[1]')
  const omborRequest = omborW1.getByRole('button', { name: new RegExp(PLATE) })
  await expect(omborRequest).toBeVisible()
  await omborRequest.click()

  const barcodeInput = page.getByPlaceholder("Barcode #2 ni kiriting yoki skanerlang")
  await barcodeInput.fill(`PLT-${PLATE}-06-1`)
  await page.getByRole('button', { name: 'Skanerlash' }).click()
  await barcodeInput.fill(`PLT-${PLATE}-06-2`)
  await page.getByRole('button', { name: 'Skanerlash' }).click()
  await expect(page.getByText('✓ Aniq mos keldi')).toBeVisible()
  await page.getByRole('button', { name: 'Yuklashni yakunlash' }).click()
  await page.getByRole('button', { name: 'Ha, yakunlash' }).click()
  // Our request specifically leaves W1 — not asserting the whole list is
  // empty, since earlier TEST-CHIQIM-01/02 attempts left other rows open
  // (no void mechanism for chiqim_requests, per CLAUDE.md/DECISIONS).
  await expect(omborRequest).not.toBeVisible()

  // --- Qorovul: stage 2 (loaded truck leaves) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  await page.getByRole('link', { name: 'CHIQIM' }).click()

  const faol2 = page.getByRole('heading', { name: 'Faol' }).locator('xpath=following-sibling::div[1]')
  const qorovulRow2 = faol2.locator('.rounded-md', { hasText: PLATE })
  await expect(qorovulRow2).toBeVisible()
  await qorovulRow2.getByRole('button', { name: 'Yakunlash' }).click()

  await qorovulRow2.locator('div:has(> label:text-is("Yuk bilan vazn (Гружёный)")) input[type="number"]').fill('12000')
  await qorovulRow2.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await qorovulRow2.locator('div:has(> label:text-is("Chiqish hujjati rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await qorovulRow2.getByRole('button', { name: 'Yakunlash' }).click()

  // moved to Yakunlangan, net_kg = 12000 - 8000 = 4000 — scoped to the
  // "Yakunlangan" heading's container specifically.
  const yakunlangan = page.getByRole('heading', { name: 'Yakunlangan' }).locator('xpath=following-sibling::div[1]')
  const yakunlanganRow = yakunlangan.locator('.rounded-md', { hasText: PLATE })
  await expect(yakunlanganRow).toBeVisible()
  await expect(yakunlanganRow).toContainText('4,000 kg')

  expect(consoleErrors, `Console errors during the flow: ${consoleErrors.join('\n')}`).toEqual([])
})
