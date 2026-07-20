import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'
import { uniqueTestId, uniqueRealLookingPlate } from './helpers/fixtures'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.png')

// Step 9: regression pass on the operational loop after the effective_qty
// change (SPEC.md v1.10 §2.16). The full single-product walkthrough
// requirement #2 asks for — KIRIM through the gate/intake/Moyka/Tayyor/Lab
// chain, an o'tdi verdict, confirmation the pallet is available, a CHIQIM
// request through Ombor's scan + Qorovul's two gate stages, and Menejer's
// finished view showing correct actor/timestamp data. Originally written
// because menejer-chiqim-finished-view.spec.ts couldn't run at all (voided
// fixture barcodes) — that spec was since repaired with self-generating
// fixtures (see DECISIONS.md "self-generating test fixtures"), but this one
// stays: it drives the KIRIM half through real Moyka/Tayyor/Lab too, ground
// no other single test covers end to end.
test('Single-product truck, full KIRIM->CHIQIM chain: o_tdi verdict, availability, dispatch, finished-view actor/timestamp data', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  const PLATE_IN = uniqueTestId('STEP9-CHAIN')
  // Deliberately NOT TEST-prefixed: useFinishedChiqimRequests.ts filters out
  // any TEST-prefixed plate by design (menejer-chiqim-finished-view.spec.ts's
  // own REAL_PLATE follows the same convention, for the same reason) — a
  // TEST- plate here would correctly, not incorrectly, never appear in the
  // finished view this test is checking.
  const PLATE_OUT = uniqueRealLookingPlate()

  // --- Menejer: KIRIM order, one line, 5000kg ---
  await loginAs(page, 'MENEJER')
  await expect(page.getByRole('heading', { name: 'Yangi KIRIM' })).toBeVisible()
  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(PLATE_IN)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  await page.locator('div:has(> label:text-is("Buyurtmachi")) select').selectOption({ label: 'Test Client A' })
  const row1 = page.locator('form div.space-y-1.rounded-md').nth(0)
  await row1.locator('select').selectOption({ label: 'Subxon' })
  await row1.getByPlaceholder('Miqdori (kg)').fill('5000')
  await page.getByRole('button', { name: 'Saqlash' }).click()

  const savedPanel = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: 'Subxon' })
  await expect(savedPanel.locator('span.font-mono').first()).toHaveText(/^\d{6}-\d{3}$/, { timeout: 20000 })
  const serial = await savedPanel.locator('span.font-mono').first().textContent()
  if (!serial) throw new Error('serial not captured')

  // --- Qorovul: KIRIM gate, both stages ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  {
    const faol = page.getByRole('heading', { name: 'Faol' }).locator('xpath=following-sibling::div[1]')
    const gateRow = faol.locator('.rounded-md', { hasText: PLATE_IN })
    await expect(gateRow).toBeVisible()
    await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await gateRow.locator('div:has(> label:text-is("Moshina raqami rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await gateRow.locator('div:has(> label:text-is("Yuk bilan vazn (Гружёный)")) input[type="number"]').fill('5500')
    await gateRow.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await expect(faol.locator('.rounded-md.border-red-300', { hasText: PLATE_IN })).toBeVisible()

    await gateRow.getByRole('button', { name: 'Yakunlash' }).click()
    await gateRow.locator('div:has(> label:text-is("Bo\'sh vazn (Пустой)")) input[type="number"]').fill('500')
    await gateRow.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await gateRow.getByRole('button', { name: 'Yakunlash' }).click()
    const yakunlangan = page.getByRole('heading', { name: 'Yakunlangan' }).locator('xpath=following-sibling::div[1]')
    await expect(yakunlangan.locator('.rounded-md', { hasText: PLATE_IN })).toContainText('5,000 kg', { timeout: 20000 })
  }

  // --- Ombor: accept (untouched), send to Moyka, receive, Tugallash ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  {
    const omborGroup = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: PLATE_IN })
    await expect(omborGroup).toBeVisible()
    const lineRow = omborGroup.locator('span', { hasText: serial }).locator('xpath=ancestor::div[contains(@class, "rounded-md")][1]')
    await lineRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await expect(page.locator(`#actual-${serial}`)).toHaveValue('5000')
    await lineRow.locator('div:has(> label:text-is("Uyum rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(lineRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await lineRow.getByRole('button', { name: 'Qabul qilish' }).click()
    // Wait for the accept to actually land before navigating away — every
    // other spec in this suite does this; skipping it races the insert
    // against Moyka's initial fetch (found live: the row was simply absent
    // from "Yuborish uchun" because the fetch ran before the insert
    // committed, not an app bug).
    const received = page.getByRole('heading', { name: 'Qabul qilingan mahsulotlar' }).locator('xpath=following-sibling::div[1]')
    await expect(received.locator('.rounded-md', { hasText: serial })).toBeVisible({ timeout: 20000 })
  }
  {
    await page.getByRole('link', { name: 'Moykaga Chiqarish' }).click()
    const yuborishUchun = page.getByRole('heading', { name: 'Yuborish uchun' }).locator('xpath=following-sibling::div[1]')
    const row = yuborishUchun.locator('.rounded-md', { hasText: serial })
    await expect(row).toBeVisible({ timeout: 20000 })
    // Gate stage 2 already ran, so the row should show the final gate net
    // (5,000kg — declared and gate net happen to match here), not "tarozi
    // kutilmoqda" — a quick confirm that provisional->final propagation
    // still works on this fresh chain, same as effective-qty.spec.ts.
    await expect(row).not.toContainText('tarozi kutilmoqda')
    await row.getByRole('button', { name: 'Moykaga yuborish' }).click()
    const qtyInput = row.locator('div:has(> label:text-is("Miqdori (kg)")) input[type="number"]')
    await qtyInput.fill('5000')
    await expect(qtyInput).toHaveValue('5000')
    await row.getByRole('button', { name: 'Moykaga yuborish' }).click()
    await expect(row.getByRole('button', { name: 'Moykaga yuborish' })).toHaveCount(0)
  }
  const barcode = `PLT-${serial}-06-1`
  {
    await page.getByRole('link', { name: 'Skladga KIRIM' }).click()
    await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
    await expect(page.getByRole('heading', { name: 'Moykada — chiqishi kutilmoqda' })).toBeVisible({ timeout: 20000 })
    const row = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: serial })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.locator('button', { hasText: '⋯' }).click()
    await row.getByRole('button', { name: /Qabul qilish|Yana qo'shish/ }).click()
    await row.locator('select').selectOption({ label: 'Kalibr 6' })
    const weightInput = row.locator('div:has(> label:text-is("Og\'irlik (kg)")) input[type="number"]')
    await weightInput.fill('4600')
    await weightInput.press('Tab')
    await expect(weightInput).toHaveValue('4600')
    await row.getByRole('button', { name: 'Qabul qilish' }).click()
    await expect(row.getByText(barcode).first()).toBeVisible({ timeout: 20000 })
  }
  {
    await page.getByRole('link', { name: 'Skladga KIRIM' }).click()
    await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
    await expect(page.getByRole('heading', { name: 'Moykada — chiqishi kutilmoqda' })).toBeVisible({ timeout: 20000 })
    const row = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: serial })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.locator('button', { hasText: '⋯' }).click()
    await row.getByRole('button', { name: 'Tugallash' }).click()
    await row.getByRole('button', { name: 'Ha, tugallash' }).click()
    const tugallangan = page.getByRole('heading', { name: 'Tugallangan' }).locator('xpath=following-sibling::div[1]')
    const finishedRow = tugallangan.locator('.rounded-md', { hasText: serial })
    await expect(finishedRow).toBeVisible({ timeout: 20000 })
    // (5000 - 4600) / 5000 = 8.0% — cycle-1 loss against effective_qty (gate
    // net, which equals the intake figure here since Ombor's actual_qty was
    // accepted untouched and gate net landed at the same 5000kg).
    await expect(finishedRow).toContainText('8.0%')
  }

  // --- Laborator KIRIM: descriptive check (no verdict) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'LABORATOR')
  {
    const w1 = page.getByRole('heading', { name: 'Tahlil kutilmoqda' }).locator('xpath=following-sibling::div[1]')
    const row = w1.locator('.rounded-md', { hasText: serial })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Tahlil' }).click()
    await row.locator('div:has(> label:text-is("Namligi %")) input').fill('8')
    await row.getByRole('button', { name: 'Saqlash' }).click()
    const w3 = page.getByRole('heading', { name: 'Yakunlangan' }).locator('xpath=following-sibling::div[1]')
    await expect(w3.locator('.rounded-md', { hasText: serial })).toBeVisible({ timeout: 20000 })
  }

  // --- Laborator CHIQIM: decisive check, verdict O'tdi ---
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  {
    const w1 = page.getByRole('heading', { name: 'Tahlil kutilmoqda' }).locator('xpath=following-sibling::div[1]')
    const w3 = page.getByRole('heading', { name: 'Yakunlangan' }).locator('xpath=following-sibling::div[1]')
    const row = w1.locator('.rounded-md', { hasText: serial })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Tahlil' }).click()
    await row.locator('select').selectOption({ index: 1 })
    await row.locator('div:has(> label:text-is("Namligi %")) input').fill('7')
    await row.getByRole('button', { name: "O'tdi", exact: true }).click()
    const finishedRow = w3.locator('.rounded-md', { hasText: serial })
    await expect(finishedRow).toBeVisible({ timeout: 20000 })
    await expect(finishedRow).toContainText("O'tdi")
  }

  // --- Confirm availability directly: useAvailableFinishedStock's own
  // derived truth, read via the dev-only window.supabase client, mirrors
  // exactly what Menejer's feasibility checker and Ombor's scan screen both
  // read (SPEC.md §8 "one derived truth, all consumers"). ---
  const availability = await page.evaluate(async (serialArg) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data: pallets } = await w.supabase
      .from('finished_pallets')
      .select('barcode2, status, weight_kg')
      .eq('serial', serialArg)
    const { data: cycles } = await w.supabase
      .from('wash_cycles')
      .select('cycle_no, status')
      .eq('serial', serialArg)
    const { data: lab } = await w.supabase.from('lab_results').select('verdict').eq('parent_serial', serialArg).eq('scope', 'chiqim')
    return { pallets, cycles, lab }
  }, serial)
  expect(availability.pallets).toHaveLength(1)
  expect(availability.pallets[0].status).toBe('in_stock')
  expect(availability.lab[0].verdict).toBe('o_tdi')

  // --- Menejer: create a CHIQIM request targeting this exact pallet ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'MENEJER')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  await expect(page.getByRole('heading', { name: 'Yangi CHIQIM' })).toBeVisible()
  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(PLATE_OUT)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  const chiqimSelects = page.locator('form:has-text("Yangi CHIQIM") select')
  await chiqimSelects.nth(0).selectOption({ label: 'Test Client A' })
  await chiqimSelects.nth(1).selectOption({ label: 'Subxon' })
  await chiqimSelects.nth(2).selectOption({ label: 'Kalibr 6' })
  await page.locator('input[placeholder="Miqdori (kg)"]').fill('4600')
  await page.getByRole('button', { name: 'Saqlash' }).click()
  await expect(page.getByText('Subxon · Kalibr 6')).toBeVisible()

  // --- Qorovul: CHIQIM gate stage 1 (empty truck arrives) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  {
    const faol = page.getByRole('heading', { name: 'Faol' }).locator('xpath=following-sibling::div[1]')
    const gateRow = faol.locator('.rounded-md', { hasText: PLATE_OUT })
    await expect(gateRow).toBeVisible()
    await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await gateRow.locator('div:has(> label:text-is("Moshina raqami rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await gateRow.locator('div:has(> label:text-is("Bo\'sh vazn (Пустой)")) input[type="number"]').fill('8000')
    await gateRow.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await expect(faol.locator('.rounded-md.border-red-300', { hasText: PLATE_OUT })).toBeVisible()
  }

  // --- Ombor: scan + finish loading ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  await page.getByRole('link', { name: 'Skladdan CHIQIM' }).click()
  {
    const omborW1 = page.getByRole('heading', { name: "Yuklash uchun so'rovlar" }).locator('xpath=following-sibling::div[1]')
    const omborRequest = omborW1.getByRole('button', { name: new RegExp(PLATE_OUT) })
    await expect(omborRequest).toBeVisible({ timeout: 20000 })
    await omborRequest.click()
    const barcodeInput = page.getByPlaceholder("Barcode #2 ni kiriting yoki skanerlang")
    await barcodeInput.fill(barcode)
    await page.getByRole('button', { name: 'Skanerlash' }).click()
    await expect(page.getByText('✓ Aniq mos keldi')).toBeVisible()
    await page.getByRole('button', { name: 'Yuklashni yakunlash' }).click()
    await page.getByRole('button', { name: 'Ha, yakunlash' }).click()
    await expect(omborRequest).not.toBeVisible()
  }

  // --- Qorovul: CHIQIM gate stage 2 (loaded truck leaves) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  {
    const faol2 = page.getByRole('heading', { name: 'Faol' }).locator('xpath=following-sibling::div[1]')
    const gateRow2 = faol2.locator('.rounded-md', { hasText: PLATE_OUT })
    await expect(gateRow2).toBeVisible()
    await gateRow2.getByRole('button', { name: 'Yakunlash' }).click()
    await gateRow2.locator('div:has(> label:text-is("Yuk bilan vazn (Гружёный)")) input[type="number"]').fill('12600')
    await gateRow2.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await gateRow2.locator('div:has(> label:text-is("Chiqish hujjati rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await gateRow2.getByRole('button', { name: 'Yakunlash' }).click()
    const yakunlangan = page.getByRole('heading', { name: 'Yakunlangan' }).locator('xpath=following-sibling::div[1]')
    await expect(yakunlangan.locator('.rounded-md', { hasText: PLATE_OUT })).toBeVisible({ timeout: 20000 })
  }

  // --- Menejer: confirm the finished view shows correct actor/timestamp
  // data (post-Step-7 accountability columns: stage1_created_by,
  // stage2_created_by, ombor_finished_by, each with their own timestamp). ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'MENEJER')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  {
    const finishedList = page.getByRole('heading', { name: "Yakunlangan so'rovlar" }).locator('xpath=following-sibling::div[1]')
    const card = finishedList.locator('.rounded-md', { hasText: PLATE_OUT })
    await expect(card).toBeVisible({ timeout: 20000 })
    await expect(card).toContainText('Olib ketildi')
    await card.getByRole('button').click()
    await expect(card.getByText('Menejer', { exact: true })).toBeVisible()
    await expect(card.getByText('Ombor', { exact: true })).toBeVisible()
    await expect(card.getByText("Qorovul — Bo'sh vazn (kirish)")).toBeVisible()
    await expect(card.getByText('Qorovul — Yuk bilan vazn (chiqish)')).toBeVisible()
    await expect(card.getByText('TEST Menejer', { exact: false })).toBeVisible()
    await expect(card.getByText('TEST Ombor', { exact: false })).toBeVisible()
    await expect(card.getByText('TEST Qorovul', { exact: false }).first()).toBeVisible()
    await expect(card.getByText(barcode)).toBeVisible()
  }

  // --- Direct DB check: the actor/timestamp columns actually hold values,
  // not just that the UI rendered something. ---
  const dbCheck = await page.evaluate(async (plate) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data: request } = await w.supabase.from('chiqim_requests').select('id, status, ombor_finished_by, ombor_finished_at').eq('plate', plate).single()
    const { data: weighing } = await w.supabase
      .from('gate_weighings')
      .select('stage1_created_by, stage1_completed_at, stage2_created_by, completed_at')
      .eq('request_id', request.id)
      .single()
    return { request, weighing }
  }, PLATE_OUT)
  expect(dbCheck.request.status).toBe('olib_ketildi')
  expect(dbCheck.request.ombor_finished_by).not.toBeNull()
  expect(dbCheck.request.ombor_finished_at).not.toBeNull()
  expect(dbCheck.weighing.stage1_created_by).not.toBeNull()
  expect(dbCheck.weighing.stage2_created_by).not.toBeNull()
  expect(dbCheck.weighing.completed_at).not.toBeNull()

  expect(consoleErrors, `Console errors during the flow: ${consoleErrors.join('\n')}`).toEqual([])
})
