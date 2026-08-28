import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'
import { uniqueTestId, seedDispatchablePallets, E2E_OWNER_NAME } from './helpers/fixtures'
import { teardownFixtures } from './helpers/teardown'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.png')

// Survivor 3/4: RLS refusal — load-bearing, cannot be folded into any other
// survivor (see docs/DECISIONS.md "e2e suite consolidation"). Ombor's undo
// is a real DELETE on chiqim_pallet_consumption, available from request
// creation up to Qorovul's gate stage-2 completion, enforced by the
// ombor_deletes RLS policy, not just UI hiding. This is the ONE test in the
// whole suite whose entire point is proving a DELETE is genuinely refused at
// the database level, not merely absent from the UI — caught a real
// silent-delete bug historically and stays exactly as strict.
//
// §5.4 FIFO dispatch (2026-08-28, see DECISIONS.md "CHIQIM quantity-based
// dispatch: FIFO cascade, consumption table"): rewritten off Option B's
// picker+scan flow (the whole reason this file used to be named "undo-
// scan" — kept as-is for minimal diff; "undo" is still the exact right
// word, just for a loaded-kg entry + FIFO attribution now, not a scan).
// Requesting the FULL 4000kg (both fixture pallets) makes the FIFO cascade
// deterministically consume BOTH pallets fully, regardless of which one its
// own creation-order tie-break picks first — the test discovers which
// barcode2 each of the two resulting chiqim_pallet_consumption rows landed
// on rather than assuming one specific barcode goes first.
let kirimPlates: string[] = []
let chiqimPlates: string[] = []

test.afterEach(async () => {
  await teardownFixtures({ kirimPlates, chiqimPlates })
  kirimPlates = []
  chiqimPlates = []
})

test('Ombor undoes a post-finish FIFO attribution, pallet becomes available again, then a post-stage-2 undo is blocked by RLS', async ({ page }) => {
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

  // --- Menejer: create the request for the FULL 4000kg (declared net +
  // declared tare) — no picker any more (§5.4 FIFO dispatch): calibre + net
  // kg + tara kg only. ---
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
  await page.getByPlaceholder('Sof miqdor (kg)').fill('4000')
  await page.getByPlaceholder('Tara (kg)').fill('50')
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

  const faol = page.getByRole('heading', { name: '1 · Faol yuklar' }).locator('xpath=following-sibling::div[1]')
  const qorovulRow = faol.locator('.rounded-md', { hasText: PLATE })
  await expect(qorovulRow).toBeVisible()
  await qorovulRow.getByRole('button', { name: 'Qabul qilish' }).click()
  await qorovulRow.locator('div:has(> label:text-is("Moshina rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await qorovulRow.locator('div:has(> label:text-is("Bo\'sh vazn (Пустой)")) input[type="number"]').fill('8000')
  await qorovulRow.locator('div:has(> label:text-is("Bo\'sh vazn rasmi (tarozi)")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await qorovulRow.getByRole('button', { name: 'Saqlash' }).click()
  await expect(faol.locator('.rounded-md.border-red-300', { hasText: PLATE })).toBeVisible()

  // --- Ombor: enter the loaded weight, finish loading — FIFO attributes
  // 4000kg across both fixture pallets. ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  await page.getByRole('link', { name: 'Skladdan CHIQIM' }).click()

  const omborW1 = page.getByRole('heading', { name: '1 · Yuklashga tayyor — moshina keldi' }).locator('xpath=following-sibling::div[1]')
  const omborRequest = omborW1.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: PLATE })
  await expect(omborRequest).toBeVisible()
  await omborRequest.getByRole('button', { name: 'Yuklashni boshlash' }).click()

  await page.getByPlaceholder("Yuklangan og'irlik (kg)").fill('4000')
  await expect(page.getByText('Yetarli emas')).not.toBeVisible()
  await page.getByRole('button', { name: 'Yuklashni yakunlash' }).click()
  await page.getByRole('button', { name: 'Ha, yakunlash' }).click()
  await expect(omborRequest).not.toBeVisible()

  // --- Confirm both fixture pallets were actually consumed (one
  // chiqim_pallet_consumption row per barcode2, 2000kg each) before working
  // out which one to undo — the FIFO cascade's own tie-break order between
  // two same-instant-created pallets is unspecified, so this discovers it
  // rather than assuming BARCODE_1 goes first. ---
  const consumptionRows = await page.evaluate(async (barcodes) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data, error } = await w.supabase.from('chiqim_pallet_consumption').select('id, barcode2, qty_kg').in('barcode2', barcodes)
    if (error) throw new Error(`chiqim_pallet_consumption select: ${error.message}`)
    return data as { id: string; barcode2: string; qty_kg: number }[]
  }, [BARCODE_1, BARCODE_2])
  expect(consumptionRows).toHaveLength(2)
  expect(consumptionRows.every((r) => r.qty_kg === 2000)).toBe(true)
  const undoneBarcode = consumptionRows[0].barcode2
  const keptBarcode = consumptionRows[1].barcode2

  // --- Undo one attributed pallet from W2 (real DELETE, pre-stage-2) ---
  const omborW2 = page.getByRole('heading', { name: '2 · Yuklandi · qorovulga topshirildi' }).locator('xpath=following-sibling::div[1]')
  const finishedRow = omborW2.getByRole('button', { name: new RegExp(PLATE) })
  await expect(finishedRow).toBeVisible()
  await finishedRow.click()

  const manifestItem1 = page.locator('li', { hasText: undoneBarcode })
  await expect(manifestItem1).toBeVisible()
  await manifestItem1.getByRole('button', { name: 'Bekor qilish' }).click()
  await expect(manifestItem1).not.toBeVisible()
  // The other attributed pallet is untouched.
  await expect(page.locator('li', { hasText: keptBarcode })).toBeVisible()

  // --- Confirm the undone pallet is available again — via a real remount,
  // since useFinishedCalibreAvailability has no refetch (agreed out of
  // scope, matches the old picker hook's own precedent). Menejer
  // re-requesting the exact same 2000kg Subxon/Kalibr6 amount that ONE
  // freed pallet alone satisfies should show no shortage hint. ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'MENEJER')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  await expect(page.getByRole('heading', { name: 'Yangi CHIQIM' })).toBeVisible()

  const menejerSelects2 = page.locator('form:has-text("Yangi CHIQIM") select')
  await menejerSelects2.nth(0).selectOption({ label: E2E_OWNER_NAME })
  await menejerSelects2.nth(1).selectOption({ label: 'Subxon' })
  await menejerSelects2.nth(2).selectOption({ label: 'Kalibr 6' })
  await page.getByPlaceholder('Sof miqdor (kg)').fill('2000')
  await page.getByPlaceholder('Tara (kg)').fill('25')
  await expect(page.getByRole('status')).toHaveCount(0)

  // --- Drive the trip to completion: Qorovul stage 2 ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  await page.getByRole('link', { name: 'CHIQIM' }).click()

  const faol2 = page.getByRole('heading', { name: '1 · Faol yuklar' }).locator('xpath=following-sibling::div[1]')
  const qorovulRow2 = faol2.locator('.rounded-md', { hasText: PLATE })
  await expect(qorovulRow2).toBeVisible()
  await qorovulRow2.getByRole('button', { name: 'Yakunlash' }).click()
  await qorovulRow2.locator('div:has(> label:text-is("Yuk bilan vazn (Гружёный)")) input[type="number"]').fill('10000')
  await qorovulRow2.locator('div:has(> label:text-is("Yuk bilan vazn rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await qorovulRow2.locator('div:has(> label:text-is("Chiqish hujjati rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await qorovulRow2.getByRole('button', { name: 'Yakunlash' }).click()

  const yakunlangan = page.getByRole('heading', { name: '2 · Yakunlangan' }).locator('xpath=following-sibling::div[1]')
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
  const manifestItem2 = page.locator('li', { hasText: keptBarcode })
  await expect(manifestItem2).toBeVisible()
  await manifestItem2.getByRole('button', { name: 'Bekor qilish' }).click()
  await expect(page.getByText('Bu so\'rov allaqachon qorovul tomonidan yakunlangan')).toBeVisible()
  // Still there — the delete was refused, not silently applied.
  await expect(manifestItem2).toBeVisible()

  // A DELETE blocked by an RLS USING clause doesn't raise a Postgres error
  // (that's an INSERT/WITH-CHECK thing) — the row is just excluded from the
  // deletable set, so PostgREST reports success with zero rows affected.
  // `.select()` is what surfaces that distinction: an empty array here,
  // for a barcode we independently confirmed exists in
  // chiqim_pallet_consumption, can only mean RLS filtered it out, not
  // "already gone."
  const directDeleteResult = await page.evaluate(async (barcode) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data, error } = await w.supabase.from('chiqim_pallet_consumption').delete().eq('barcode2', barcode).select('id')
    return { rowsDeleted: data?.length ?? null, error: error?.message ?? null }
  }, keptBarcode)
  expect(directDeleteResult.error).toBeNull()
  expect(directDeleteResult.rowsDeleted).toBe(0)

  expect(consoleErrors, `Console errors during the flow: ${consoleErrors.join('\n')}`).toEqual([])
})
