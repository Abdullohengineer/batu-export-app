import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'
import { uniqueTestId, seedDispatchablePallets } from './helpers/fixtures'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.png')

// Full CHIQIM chain, real merged main: Menejer creates a request -> Qorovul
// stage 1 (empty weigh + photos) -> Ombor scans + finishes (already built,
// prompt 2) -> Qorovul stage 2 (loaded weigh + 3 photos) -> confirm the
// complete_chiqim_stage2() trigger flips chiqim_requests.status.
// Fixture pallets (2x 2000kg Subxon/Kalibr 6) are seeded fresh every run
// via seedDispatchablePallets (Step 9: self-generating test fixtures — see
// DECISIONS.md) instead of a one-time hand-written SQL fixture.
test('Menejer -> Qorovul stage 1 -> Ombor scan -> Qorovul stage 2 -> status flips to olib_ketildi', async ({ page }) => {
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
  await barcodeInput.fill(pallets[0].barcode2)
  await page.getByRole('button', { name: 'Skanerlash' }).click()
  await barcodeInput.fill(pallets[1].barcode2)
  await page.getByRole('button', { name: 'Skanerlash' }).click()
  await expect(page.getByText('✓ Aniq mos keldi')).toBeVisible()
  await page.getByRole('button', { name: 'Yuklashni yakunlash' }).click()
  await page.getByRole('button', { name: 'Ha, yakunlash' }).click()
  // Our request specifically leaves W1 — not asserting the whole list is
  // empty, since the live DB carries decades of prior sessions' open
  // requests with no void mechanism for chiqim_requests (out of scope,
  // per CLAUDE.md/DECISIONS).
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
