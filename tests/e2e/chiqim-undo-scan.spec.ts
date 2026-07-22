import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'
import { uniqueTestId, seedDispatchablePallets, E2E_OWNER_NAME } from './helpers/fixtures'
import { teardownFixtures } from './helpers/teardown'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.png')

// Survivor 3/4: RLS refusal — load-bearing, cannot be folded into any other
// survivor (see docs/DECISIONS.md "e2e suite consolidation"). Ombor "undo
// scan" is a real DELETE on dispatch_manifest, available from request
// creation up to Qorovul's gate stage-2 completion, enforced by the
// ombor_deletes RLS policy, not just UI hiding. This is the ONE test in the
// whole suite whose entire point is proving a DELETE is genuinely refused at
// the database level, not merely absent from the UI — caught a real
// silent-delete bug historically and stays exactly as strict.
let kirimPlates: string[] = []
let chiqimPlates: string[] = []

test.afterEach(async () => {
  await teardownFixtures({ kirimPlates, chiqimPlates })
  kirimPlates = []
  chiqimPlates = []
})

test('Ombor undoes a post-finish scan, pallet becomes available again, then a post-stage-2 undo is blocked by RLS', async ({ page }) => {
  // 9 total role switches (3 for seedDispatchablePallets + 6 for the flow
  // itself) — comfortably over the 30s default, same latency-budget reason
  // as every other long chain in this suite (see DECISIONS.md "Step 9
  // regression pass").
  test.setTimeout(120_000)
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  const { pallets, kirimPlate } = await seedDispatchablePallets(page, {
    count: 2,
    weightKgEach: 2000,
    typeLabel: 'Subxon',
    calibreLabel: 'Kalibr 6',
  })
  kirimPlates.push(kirimPlate)
  const [BARCODE_1, BARCODE_2] = [pallets[0].barcode2, pallets[1].barcode2]
  const PLATE = uniqueTestId('CHIQIM')
  chiqimPlates.push(PLATE)

  // --- Menejer: create the request, confirm the pallets are NOT yet flagged
  // unavailable (feasibility hint should be silent — exact match). ---
  await loginAs(page, 'MENEJER')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  await expect(page.getByRole('heading', { name: 'Yangi CHIQIM' })).toBeVisible()

  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(PLATE)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  const menejerSelects = page.locator('form:has-text("Yangi CHIQIM") select')
  await expect(page.getByRole('option', { name: E2E_OWNER_NAME })).toBeAttached()
  await menejerSelects.nth(0).selectOption({ label: E2E_OWNER_NAME })
  await menejerSelects.nth(1).selectOption({ label: 'Subxon' })
  await menejerSelects.nth(2).selectOption({ label: 'Kalibr 6' })
  await page.locator('input[placeholder="Miqdori (kg)"]').fill('4000')
  // Exact match against the two 2000kg fixture pallets — no soft-warning
  // hint should render.
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.getByRole('button', { name: 'Saqlash' }).click()
  await expect(page.getByText('Subxon · Kalibr 6')).toBeVisible()

  // --- Qorovul: stage 1 (empty truck arrives) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  await page.getByRole('link', { name: 'CHIQIM' }).click()

  const faol = page.getByRole('heading', { name: 'Faol' }).locator('xpath=following-sibling::div[1]')
  const qorovulRow = faol.locator('.rounded-md', { hasText: PLATE })
  await expect(qorovulRow).toBeVisible()
  await qorovulRow.getByRole('button', { name: 'Qabul qilish' }).click()
  await qorovulRow.locator('div:has(> label:text-is("Moshina raqami rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await qorovulRow.locator('div:has(> label:text-is("Bo\'sh vazn (Пустой)")) input[type="number"]').fill('8000')
  await qorovulRow.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await qorovulRow.getByRole('button', { name: 'Qabul qilish' }).click()
  await expect(faol.locator('.rounded-md.border-red-300', { hasText: PLATE })).toBeVisible()

  // --- Ombor: scan both pallets, finish loading ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  await page.getByRole('link', { name: 'Skladdan CHIQIM' }).click()

  const omborW1 = page.getByRole('heading', { name: "Yuklash uchun so'rovlar" }).locator('xpath=following-sibling::div[1]')
  const omborRequest = omborW1.getByRole('button', { name: new RegExp(PLATE) })
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

  // --- Undo one scanned pallet from W2 (real DELETE, pre-stage-2) ---
  const omborW2 = page.getByRole('heading', { name: 'Yuklandi' }).locator('xpath=following-sibling::div[1]')
  const finishedRow = omborW2.getByRole('button', { name: new RegExp(PLATE) })
  await expect(finishedRow).toBeVisible()
  await finishedRow.click()

  const manifestItem1 = page.locator('li', { hasText: BARCODE_1 })
  await expect(manifestItem1).toBeVisible()
  await manifestItem1.getByRole('button', { name: 'Skanerlashni bekor qilish' }).click()
  await expect(manifestItem1).not.toBeVisible()
  // The other scanned pallet is untouched.
  await expect(page.locator('li', { hasText: BARCODE_2 })).toBeVisible()

  // --- Confirm BARCODE_1 is available again — via a real remount, since
  // useAvailableFinishedStock has no refetch (agreed out of scope). Menejer
  // re-requesting the exact same 2000kg Subxon/Kalibr6 amount that BARCODE_1
  // alone satisfies should show no shortage hint. ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'MENEJER')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  await expect(page.getByRole('heading', { name: 'Yangi CHIQIM' })).toBeVisible()

  const menejerSelects2 = page.locator('form:has-text("Yangi CHIQIM") select')
  await menejerSelects2.nth(1).selectOption({ label: 'Subxon' })
  await menejerSelects2.nth(2).selectOption({ label: 'Kalibr 6' })
  await page.locator('input[placeholder="Miqdori (kg)"]').fill('2000')
  await expect(page.getByRole('status')).toHaveCount(0)

  // --- Drive the trip to completion: Qorovul stage 2 ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  await page.getByRole('link', { name: 'CHIQIM' }).click()

  const faol2 = page.getByRole('heading', { name: 'Faol' }).locator('xpath=following-sibling::div[1]')
  const qorovulRow2 = faol2.locator('.rounded-md', { hasText: PLATE })
  await expect(qorovulRow2).toBeVisible()
  await qorovulRow2.getByRole('button', { name: 'Yakunlash' }).click()
  await qorovulRow2.locator('div:has(> label:text-is("Yuk bilan vazn (Гружёный)")) input[type="number"]').fill('10000')
  await qorovulRow2.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await qorovulRow2.locator('div:has(> label:text-is("Chiqish hujjati rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await qorovulRow2.getByRole('button', { name: 'Yakunlash' }).click()

  const yakunlangan = page.getByRole('heading', { name: 'Yakunlangan' }).locator('xpath=following-sibling::div[1]')
  await expect(yakunlangan.locator('.rounded-md', { hasText: PLATE })).toBeVisible()

  // --- Post-stage-2: undo attempt must be refused at the RLS level, not
  // just hidden in the UI — call the same delete the UI would issue,
  // directly via the dev-only window.supabase client while still signed in
  // as ombor, bypassing whatever the button itself does. ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  await page.getByRole('link', { name: 'Skladdan CHIQIM' }).click()

  const finishedRow2 = omborW2.getByRole('button', { name: new RegExp(PLATE) })
  await expect(finishedRow2).toBeVisible()
  await finishedRow2.click()
  const manifestItem2 = page.locator('li', { hasText: BARCODE_2 })
  await expect(manifestItem2).toBeVisible()
  await manifestItem2.getByRole('button', { name: 'Skanerlashni bekor qilish' }).click()
  await expect(page.getByText('Bu so\'rov allaqachon qorovul tomonidan yakunlangan')).toBeVisible()
  // Still there — the delete was refused, not silently applied.
  await expect(manifestItem2).toBeVisible()

  // A DELETE blocked by an RLS USING clause doesn't raise a Postgres error
  // (that's an INSERT/WITH-CHECK thing) — the row is just excluded from the
  // deletable set, so PostgREST reports success with zero rows affected.
  // `.select()` is what surfaces that distinction: an empty array here,
  // for a barcode we independently confirmed exists in dispatch_manifest,
  // can only mean RLS filtered it out, not "already gone."
  const directDeleteResult = await page.evaluate(async (barcode) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data, error } = await w.supabase.from('dispatch_manifest').delete().eq('barcode2', barcode).select('id')
    return { rowsDeleted: data?.length ?? null, error: error?.message ?? null }
  }, BARCODE_2)
  expect(directDeleteResult.error).toBeNull()
  expect(directDeleteResult.rowsDeleted).toBe(0)

  expect(consoleErrors, `Console errors during the flow: ${consoleErrors.join('\n')}`).toEqual([])
})
