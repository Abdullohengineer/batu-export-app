import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'
import { uniqueRealLookingPlate, seedDispatchablePallets, seedFilteredFinishedRequest } from './helpers/fixtures'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.png')

test('Menejer finished view: real request shows full actor/timestamp/photo data, TEST- prefixed request is filtered out', async ({
  page,
}) => {
  // 3 (seedDispatchablePallets) + 1 (seedFilteredFinishedRequest, already
  // Menejer) + 6 role switches in the flow itself — same latency-budget
  // reason as every other long chain in this suite.
  test.setTimeout(120_000)
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
  const [BARCODE_1, BARCODE_2] = [pallets[0].barcode2, pallets[1].barcode2]
  // Not TEST-prefixed on purpose — this is the one plate in the whole test
  // suite that has to look like a real truck, since it's the positive case
  // for the TEST- filter itself (see below). driver stays 'TEST Driver',
  // the same secondary fixture marker used everywhere else in this app's
  // tests, so it's still traceable without defeating the thing under test.
  const REAL_PLATE = uniqueRealLookingPlate()
  // The negative case: a request that WOULD appear in the finished view
  // (status olib_ketildi) if its TEST- prefix didn't specifically exclude
  // it. Self-seeded fresh every run (Step 9: self-generating test fixtures
  // — see DECISIONS.md) rather than reused from another spec's leftover
  // row, which is what made this test self-defeating before: that reused
  // row was itself only ever completed ONCE, so on any later run this
  // spec's OWN real request (same REAL_PLATE, previously hardcoded) had
  // already permanently completed too, breaking the "not yet visible
  // before completion" assertion below for good. Fresh REAL_PLATE +
  // FILTERED_PLATE every run resolves both problems at once — confirmed
  // by running this spec twice back to back, not assumed (see DECISIONS.md).
  const { plate: FILTERED_PLATE } = await seedFilteredFinishedRequest(page)

  // --- Menejer: create the request (already logged in, from the seed
  // above) ---
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  await expect(page.getByRole('heading', { name: 'Yangi CHIQIM' })).toBeVisible()

  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(REAL_PLATE)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  const menejerSelects = page.locator('form:has-text("Yangi CHIQIM") select')
  await expect(page.getByRole('option', { name: 'Test Client A' })).toBeAttached()
  await menejerSelects.nth(0).selectOption({ label: 'Test Client A' })
  await menejerSelects.nth(1).selectOption({ label: 'Subxon' })
  await menejerSelects.nth(2).selectOption({ label: 'Kalibr 6' })
  await page.locator('input[placeholder="Miqdori (kg)"]').fill('4000')
  await page.getByRole('button', { name: 'Saqlash' }).click()
  await expect(page.getByText('Subxon · Kalibr 6')).toBeVisible()

  // Before the trip completes, neither the real request nor the TEST-
  // prefixed one should show up in the finished view yet.
  await expect(page.getByRole('heading', { name: "Yakunlangan so'rovlar" })).toBeVisible()
  await expect(page.getByText(REAL_PLATE)).not.toBeVisible()

  // --- Qorovul: stage 1 (empty truck arrives) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  await page.getByRole('link', { name: 'CHIQIM' }).click()

  const faol = page.getByRole('heading', { name: 'Faol' }).locator('xpath=following-sibling::div[1]')
  const qorovulRow = faol.locator('.rounded-md', { hasText: REAL_PLATE })
  await expect(qorovulRow).toBeVisible()
  await qorovulRow.getByRole('button', { name: 'Qabul qilish' }).click()
  await qorovulRow.locator('div:has(> label:text-is("Moshina raqami rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await qorovulRow.locator('div:has(> label:text-is("Bo\'sh vazn (Пустой)")) input[type="number"]').fill('8000')
  await qorovulRow.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await qorovulRow.getByRole('button', { name: 'Qabul qilish' }).click()
  await expect(faol.locator('.rounded-md.border-red-300', { hasText: REAL_PLATE })).toBeVisible()

  // --- Ombor: scan + finish ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  await page.getByRole('link', { name: 'Skladdan CHIQIM' }).click()

  const omborW1 = page.getByRole('heading', { name: "Yuklash uchun so'rovlar" }).locator('xpath=following-sibling::div[1]')
  const omborRequest = omborW1.getByRole('button', { name: new RegExp(REAL_PLATE) })
  await expect(omborRequest).toBeVisible()
  await omborRequest.click()

  const barcodeInput = page.getByPlaceholder("Barcode #2 ni kiriting yoki skanerlang")
  await barcodeInput.fill(BARCODE_1)
  await page.getByRole('button', { name: 'Skanerlash' }).click()
  await barcodeInput.fill(BARCODE_2)
  await page.getByRole('button', { name: 'Skanerlash' }).click()
  await expect(page.getByText('✓ Aniq mos keldi')).toBeVisible()
  await page.getByRole('button', { name: 'Yuklashni yakunlash' }).click()
  await page.getByRole('button', { name: 'Ha, yakunlash' }).click()
  await expect(omborRequest).not.toBeVisible()

  // --- Qorovul: stage 2 (loaded truck leaves) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  await page.getByRole('link', { name: 'CHIQIM' }).click()

  const faol2 = page.getByRole('heading', { name: 'Faol' }).locator('xpath=following-sibling::div[1]')
  const qorovulRow2 = faol2.locator('.rounded-md', { hasText: REAL_PLATE })
  await expect(qorovulRow2).toBeVisible()
  await qorovulRow2.getByRole('button', { name: 'Yakunlash' }).click()
  await qorovulRow2.locator('div:has(> label:text-is("Yuk bilan vazn (Гружёный)")) input[type="number"]').fill('12000')
  await qorovulRow2.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await qorovulRow2.locator('div:has(> label:text-is("Chiqish hujjati rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await qorovulRow2.getByRole('button', { name: 'Yakunlash' }).click()
  const yakunlangan = page.getByRole('heading', { name: 'Yakunlangan' }).locator('xpath=following-sibling::div[1]')
  await expect(yakunlangan.locator('.rounded-md', { hasText: REAL_PLATE })).toBeVisible()

  // --- Menejer: confirm it now appears, with full data, and the TEST-
  // prefixed request stays filtered out ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'MENEJER')
  await page.getByRole('link', { name: 'CHIQIM' }).click()

  const finishedList = page.getByRole('heading', { name: "Yakunlangan so'rovlar" }).locator('xpath=following-sibling::div[1]')
  const card = finishedList.locator('.rounded-md', { hasText: REAL_PLATE })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Olib ketildi')
  await expect(finishedList.getByText(FILTERED_PLATE)).not.toBeVisible()

  await card.getByRole('button').click()
  await expect(card.getByText('Menejer', { exact: true })).toBeVisible()
  await expect(card.getByText('Ombor', { exact: true })).toBeVisible()
  await expect(card.getByText("Qorovul — Bo'sh vazn (kirish)")).toBeVisible()
  await expect(card.getByText('Qorovul — Yuk bilan vazn (chiqish)')).toBeVisible()
  // Actor names resolved from profiles, not raw uuids — scoped to the card,
  // since the app's own header banner also shows "TEST Menejer" (the
  // logged-in user), which would otherwise multi-match unscoped.
  await expect(card.getByText('TEST Menejer', { exact: false })).toBeVisible()
  await expect(card.getByText('TEST Ombor', { exact: false })).toBeVisible()
  await expect(card.getByText('TEST Qorovul', { exact: false }).first()).toBeVisible()
  // Load contents (reused useDispatchManifestLines) show both scanned pallets.
  await expect(card.getByText(BARCODE_1)).toBeVisible()
  await expect(card.getByText(BARCODE_2)).toBeVisible()
  // 4 gate photos rendered (2 stage-1, 2 stage-2).
  await expect(card.getByAltText('Moshina raqami rasmi')).toBeVisible()
  await expect(card.getByAltText('Tarozi rasmi (kirish)')).toBeVisible()
  await expect(card.getByAltText('Tarozi rasmi (chiqish)')).toBeVisible()
  await expect(card.getByAltText('Chiqish hujjati rasmi')).toBeVisible()

  expect(consoleErrors, `Console errors during the flow: ${consoleErrors.join('\n')}`).toEqual([])
})
