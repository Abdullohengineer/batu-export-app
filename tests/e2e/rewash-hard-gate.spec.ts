import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'
import { uniqueTestId, E2E_OWNER_NAME } from './helpers/fixtures'
import { teardownFixtures } from './helpers/teardown'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.png')

// Survivor 2/4: Re-wash + hard gate. Backbone is the full void/re-send/pass
// cycle (fail lab -> void calibre pallets, Konditirskiy untouched -> re-wash
// input is exact -> cycle 2 loss is against the re-wash input, not the
// original intake -> o_tdi reopens availability), with the hard gate's two
// directions (Menejer's feasibility checker, Ombor's CHIQIM scan) inserted
// right after the cycle-1 "Qayta yuvish" verdict, applied to THIS serial
// rather than a second parallel one — and a real dispatch attempt after
// cycle 2 passes, proving the gate actually reopens rather than just
// checking lab_results/finished_pallets columns directly. Subsumes
// rewash-full-cycle.spec.ts and laborator-chiqim-hard-gate.spec.ts; see
// docs/DECISIONS.md "e2e suite consolidation" for the merge reasoning.
let kirimPlates: string[] = []
let chiqimPlates: string[] = []

test.afterEach(async () => {
  await teardownFixtures({ kirimPlates, chiqimPlates })
  kirimPlates = []
  chiqimPlates = []
})

test('Qayta_yuvish hard-gates availability (both directions), void preserves Konditirskiy, cycle 2 reopens dispatch', async ({ page }) => {
  // Step 9 regression pass: effective_qty added extra per-refresh queries to
  // useMoykaSerials/useMoykaOutput — this test's own two full wash cycles
  // plus the inserted hard-gate checks are comfortably over the 30s default
  // (see DECISIONS.md "Step 9 regression pass").
  test.setTimeout(150_000)
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  const PLATE = uniqueTestId('REWASH')
  kirimPlates.push(PLATE)

  // --- Menejer: KIRIM order, one line ---
  await loginAs(page, 'MENEJER')
  await expect(page.getByRole('heading', { name: 'Yangi KIRIM' })).toBeVisible()
  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(PLATE)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  await page.locator('div:has(> label:text-is("Buyurtmachi")) select').selectOption({ label: E2E_OWNER_NAME })
  const row1 = page.locator('form div.space-y-1.rounded-md').nth(0)
  await row1.locator('select').selectOption({ label: 'Subxon' })
  await row1.getByPlaceholder('Miqdori (kg)').fill('5000')
  await page.getByRole('button', { name: 'Saqlash' }).click()

  const savedPanel = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: 'Subxon' })
  await expect(savedPanel.locator('span.font-mono').first()).toHaveText(/^\d{6}-\d{3}$/, { timeout: 20000 })
  const serialText = await savedPanel.locator('span.font-mono').first().textContent()
  if (!serialText) throw new Error('serial not captured')
  const serial: string = serialText

  // --- Qorovul: gate stage 1 ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  const faol = page.getByRole('heading', { name: 'Faol' }).locator('xpath=following-sibling::div[1]')
  const gateRow = faol.locator('.rounded-md', { hasText: PLATE })
  await expect(gateRow).toBeVisible()
  await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
  await gateRow.locator('div:has(> label:text-is("Moshina raqami rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
  await gateRow.locator('div:has(> label:text-is("Yuk bilan vazn (Гружёный)")) input[type="number"]').fill('6000')
  await gateRow.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
  await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
  await expect(faol.locator('.rounded-md.border-red-300', { hasText: PLATE })).toBeVisible()

  // --- Ombor: accept into storage ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  {
    const omborGroup = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: PLATE })
    await expect(omborGroup).toBeVisible()
    const lineRow = omborGroup.locator('span', { hasText: serial }).locator('xpath=ancestor::div[contains(@class, "rounded-md")][1]')
    await lineRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await page.locator(`#actual-${serial}`).fill('5000')
    await lineRow.locator('div:has(> label:text-is("Uyum rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(lineRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await lineRow.getByRole('button', { name: 'Qabul qilish' }).click()
    const received = page.getByRole('heading', { name: 'Qabul qilingan mahsulotlar' }).locator('xpath=following-sibling::div[1]')
    await expect(received.locator('.rounded-md', { hasText: serial })).toBeVisible()
  }

  // --- Ombor: send cycle 1 (5000kg) to Moyka ---
  async function sendToMoyka(qty: string) {
    await page.getByRole('link', { name: 'Skladga KIRIM' }).click()
    await page.getByRole('link', { name: 'Moykaga Chiqarish' }).click()
    const yuborishUchun = page.getByRole('heading', { name: 'Yuborish uchun' }).locator('xpath=following-sibling::div[1]')
    await expect(yuborishUchun).toBeVisible({ timeout: 20000 })
    const row = yuborishUchun.locator('.rounded-md', { hasText: serial })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Moykaga yuborish' }).click()
    const qtyInput = row.locator('div:has(> label:text-is("Miqdori (kg)")) input[type="number"]')
    await qtyInput.fill(qty)
    await expect(qtyInput).toHaveValue(qty)
    await row.getByRole('button', { name: 'Moykaga yuborish' }).click()
    await expect(row.getByRole('button', { name: 'Moykaga yuborish' })).toHaveCount(0)
  }
  await sendToMoyka('5000')

  // --- Ombor: receive cycle 1 pallets (Kalibr 6 4500kg + Konditirskiy
  // 500kg), then Tugallash. Fresh navigation before EACH pallet receipt —
  // forces a fresh mount per action (see DECISIONS.md "self-generating
  // test fixtures" for the underlying React-controlled-input race). ---
  async function receivePallet(calibreLabel: string, weight: string) {
    await page.getByRole('link', { name: 'Skladga KIRIM' }).click()
    await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
    await expect(page.getByRole('heading', { name: 'Moykada — chiqishi kutilmoqda' })).toBeVisible({ timeout: 20000 })
    const row = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: serial })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.locator('button', { hasText: '⋯' }).click()
    const openButton = row.getByRole('button', { name: /Qabul qilish|Yana qo'shish/ })
    await openButton.click()
    await row.locator('select').selectOption({ label: calibreLabel })
    const weightInput = row.locator('div:has(> label:text-is("Og\'irlik (kg)")) input[type="number"]')
    await weightInput.fill(weight)
    await weightInput.press('Tab')
    await expect(weightInput).toHaveValue(weight)
    await row.getByRole('button', { name: 'Qabul qilish' }).click()
    await expect(row.getByText(`PLT-${serial}-`).first()).toBeVisible({ timeout: 20000 })
  }
  async function produceAndFinish(pallets: { calibre: string; weight: string }[]) {
    for (const p of pallets) {
      await receivePallet(p.calibre, p.weight)
    }
    await page.getByRole('link', { name: 'Skladga KIRIM' }).click()
    await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
    await expect(page.getByRole('heading', { name: 'Moykada — chiqishi kutilmoqda' })).toBeVisible({ timeout: 20000 })
    const row = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: serial })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.locator('button', { hasText: '⋯' }).click()
    await row.getByRole('button', { name: 'Tugallash' }).click()
    await row.getByRole('button', { name: 'Ha, tugallash' }).click()
    const tugallangan = page.getByRole('heading', { name: 'Tugallangan' }).locator('xpath=following-sibling::div[1]')
    await expect(tugallangan.locator('.rounded-md', { hasText: serial })).toBeVisible({ timeout: 20000 })
  }
  await produceAndFinish([
    { calibre: 'Kalibr 6', weight: '4500' },
    { calibre: 'Konditirskiy', weight: '500' },
  ])

  // --- Laborator CHIQIM: test the cycle-1 batch, verdict Qayta yuvish ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'LABORATOR')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  {
    const w1 = page.getByRole('heading', { name: 'Tahlil kutilmoqda' }).locator('xpath=following-sibling::div[1]')
    const w3 = page.getByRole('heading', { name: 'Yakunlangan' }).locator('xpath=following-sibling::div[1]')
    const row = w1.locator('.rounded-md', { hasText: serial })
    await expect(row).toBeVisible()
    await expect(row).toContainText('2 ta pallet')
    await expect(row).toContainText('5,000 kg')
    await row.getByRole('button', { name: 'Tahlil' }).click()
    await row.locator('select').selectOption({ index: 1 })
    await row.locator('div:has(> label:text-is("Namligi %")) input').fill('8')
    await row.getByRole('button', { name: 'Qayta yuvish', exact: true }).click()
    const finishedRow = w3.locator('.rounded-md', { hasText: serial })
    await expect(finishedRow).toBeVisible()
    await expect(finishedRow).toContainText('Qayta yuvish')
  }

  // --- Hard gate, BOTH directions, on THIS still-failed serial (before
  // Ombor voids it) — laborator-chiqim-hard-gate.spec.ts's own risk, merged
  // in here rather than proven on a second, separate serial. ---
  const CHIQIM_PLATE = uniqueTestId('REWASH-OUT')
  chiqimPlates.push(CHIQIM_PLATE)
  {
    // Direction 1: Menejer's feasibility checker. The 4,500kg physically
    // sits in finished_pallets as in_stock, but the hard gate excludes it
    // from useAvailableFinishedStock, so checkFeasibility's nearestBelow is
    // always 0 for this gated stock (see laborator-chiqim-hard-gate.spec.ts's
    // own comment on why the exact "above" figure isn't asserted — it floats
    // with whatever unrelated stock exists elsewhere at the moment this runs).
    await page.getByRole('button', { name: 'Chiqish' }).click()
    await page.waitForURL('**/login')
    await loginAs(page, 'MENEJER')
    await page.getByRole('link', { name: 'CHIQIM' }).click()
    await expect(page.getByRole('heading', { name: 'Yangi CHIQIM' })).toBeVisible()
    await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(CHIQIM_PLATE)
    await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
    const chiqimSelects = page.locator('form:has-text("Yangi CHIQIM") select')
    await chiqimSelects.nth(0).selectOption({ label: E2E_OWNER_NAME })
    await chiqimSelects.nth(1).selectOption({ label: 'Subxon' })
    await chiqimSelects.nth(2).selectOption({ label: 'Kalibr 6' })
    await page.locator('input[placeholder="Miqdori (kg)"]').fill('4000')
    await expect(page.getByRole('status')).toContainText(/(eng ko'p|eng yaqin): 0 kg/)

    // Save anyway (the soft-warning never blocks save, §3.1) — this becomes
    // the one open request direction 2 uses below, and again once cycle 2
    // passes, rather than a second throwaway request.
    await page.getByRole('button', { name: 'Saqlash' }).click()
    await expect(page.getByText('Subxon · Kalibr 6')).toBeVisible()

    // Direction 2: Ombor's CHIQIM scan. Passed the client-target soft
    // warning stage but never passed the lab — not_lab_passed, refused,
    // never accepted onto the manifest.
    await page.getByRole('button', { name: 'Chiqish' }).click()
    await page.waitForURL('**/login')
    await loginAs(page, 'OMBOR')
    await page.getByRole('link', { name: 'Skladdan CHIQIM' }).click()
    const omborW1 = page.getByRole('heading', { name: "Yuklash uchun so'rovlar" }).locator('xpath=following-sibling::div[1]')
    const omborRequest = omborW1.getByRole('button', { name: new RegExp(CHIQIM_PLATE) })
    await expect(omborRequest).toBeVisible()
    await omborRequest.click()
    const barcodeInput = page.getByPlaceholder("Barcode #2 ni kiriting yoki skanerlang")
    await barcodeInput.fill(`PLT-${serial}-06-1`)
    await page.getByRole('button', { name: 'Skanerlash' }).click()
    await expect(page.getByText("laboratoriya tekshiruvidan o'tmagan")).toBeVisible()
  }

  // --- Ombor: red flag visible, void cycle 1's calibre pallets ---
  await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
  {
    const tugallangan = page.getByRole('heading', { name: 'Tugallangan' }).locator('xpath=following-sibling::div[1]')
    const row = tugallangan.locator('.rounded-md', { hasText: serial })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Qayta yuvish kerak')
    await row.locator('button', { hasText: '⋯' }).click()
    await row.getByRole('button', { name: 'Qayta yuvishga yuborish' }).click()
    await row.getByRole('button', { name: 'Ha, qayta yuvishga yuborish' }).click()
    await expect(row.getByText('Qayta yuvish kerak')).toHaveCount(0, { timeout: 20000 })
  }

  // --- Confirm the serial reappears in §5.2 W1 with EXACTLY the voided
  // 4500kg, not the original 5000kg, and Konditirskiy stayed untouched ---
  await page.getByRole('link', { name: 'Skladga KIRIM' }).click()
  await page.getByRole('link', { name: 'Moykaga Chiqarish' }).click()
  await expect(page.getByRole('heading', { name: 'Yuborish uchun' })).toBeVisible({ timeout: 20000 })
  {
    const yuborishUchun = page.getByRole('heading', { name: 'Yuborish uchun' }).locator('xpath=following-sibling::div[1]')
    const row = yuborishUchun.locator('.rounded-md', { hasText: serial })
    await expect(row).toBeVisible({ timeout: 20000 })
    await expect(row).toContainText('Qayta yuvish · sikl 2')
    await expect(row).toContainText('4,500 kg')
  }

  // --- Cycle 2: send, receive (Kalibr 6 4000kg + a SECOND, separate
  // Konditirskiy pallet 300kg), Tugallash ---
  await sendToMoyka('4500')
  await produceAndFinish([
    { calibre: 'Kalibr 6', weight: '4000' },
    { calibre: 'Konditirskiy', weight: '300' },
  ])
  {
    const tugallangan = page.getByRole('heading', { name: 'Tugallangan' }).locator('xpath=following-sibling::div[1]')
    const row = tugallangan.locator('.rounded-md', { hasText: serial })
    await expect(row).toBeVisible()
    // Loss against the RE-WASH input (4500kg): (4500-4300)/4500 = 4.4%, not
    // against the original 5000kg intake ((5000-4300)/5000 = 14%).
    await expect(row).toContainText('sikl 2')
    await expect(row).toContainText('4.4%')
  }

  // --- Laborator: test cycle 2, verdict O'tdi ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'LABORATOR')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  {
    const w1 = page.getByRole('heading', { name: 'Tahlil kutilmoqda' }).locator('xpath=following-sibling::div[1]')
    const w3 = page.getByRole('heading', { name: 'Yakunlangan' }).locator('xpath=following-sibling::div[1]')
    const row = w1.locator('.rounded-md', { hasText: serial })
    await expect(row).toBeVisible()
    await expect(row).toContainText('yuvish sikli 2')
    await row.getByRole('button', { name: 'Tahlil' }).click()
    await row.locator('select').selectOption({ index: 1 })
    await row.locator('div:has(> label:text-is("Namligi %")) input').fill('7')
    await row.getByRole('button', { name: "O'tdi", exact: true }).click()
    // Both cycles' lab_results rows are legitimately in Yakunlangan now
    // (cycle 1's qayta_yuvish record is real history, never removed) — the
    // serial alone no longer uniquely identifies a row, cycle number does.
    const finishedRow = w3.locator('.rounded-md', { hasText: serial }).filter({ hasText: 'sikl 2' })
    await expect(finishedRow).toBeVisible()
    await expect(finishedRow).toContainText("O'tdi")
  }

  // --- Confirm dispatchable, for real: scan cycle 2's own new barcode
  // into the SAME still-open request the gate check above created —
  // succeeds now, closing the loop rewash-full-cycle.spec.ts never fully
  // closed (it only ever checked lab_results/finished_pallets columns
  // directly, never actually tried to dispatch the fixed pallet). ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  await page.getByRole('link', { name: 'Skladdan CHIQIM' }).click()
  {
    const omborW1 = page.getByRole('heading', { name: "Yuklash uchun so'rovlar" }).locator('xpath=following-sibling::div[1]')
    const omborRequest = omborW1.getByRole('button', { name: new RegExp(CHIQIM_PLATE) })
    await expect(omborRequest).toBeVisible({ timeout: 20000 })
    await omborRequest.click()
    const barcodeInput = page.getByPlaceholder("Barcode #2 ni kiriting yoki skanerlang")
    await barcodeInput.fill(`PLT-${serial}-06-2`)
    await page.getByRole('button', { name: 'Skanerlash' }).click()
    await expect(page.getByText('✓ Aniq mos keldi')).toBeVisible()
    await page.getByRole('button', { name: 'Yuklashni yakunlash' }).click()
    await page.getByRole('button', { name: 'Ha, yakunlash' }).click()
    await expect(omborRequest).not.toBeVisible()
  }

  // --- Direct DB check ---
  const result = await page.evaluate(async (serialArg) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data: labResults } = await w.supabase
      .from('lab_results')
      .select('verdict, status')
      .eq('parent_serial', serialArg)
      .order('created_at', { ascending: true })
    const { data: pallets } = await w.supabase
      .from('finished_pallets')
      .select('barcode2, wash_cycle, calibre_id, weight_kg, status, calibres(is_numberless)')
      .eq('serial', serialArg)
    return { labResults, pallets }
  }, serial)

  const labResults = result.labResults as { verdict: string; status: string }[]
  expect(labResults).toHaveLength(2)
  expect(labResults[0].verdict).toBe('qayta_yuvish')
  expect(labResults[1].verdict).toBe('o_tdi')

  const pallets = result.pallets as {
    barcode2: string
    wash_cycle: number
    weight_kg: number
    status: string
    calibres: { is_numberless: boolean }
  }[]
  expect(pallets).toHaveLength(4)

  const cycle1Calibre = pallets.find((p) => p.wash_cycle === 1 && !p.calibres.is_numberless)!
  expect(cycle1Calibre.status).toBe('bekor_qilindi') // voided
  expect(cycle1Calibre.weight_kg).toBe(4500)

  const cycle1Kn = pallets.find((p) => p.wash_cycle === 1 && p.calibres.is_numberless)!
  expect(cycle1Kn.status).toBe('in_stock') // untouched by the void
  expect(cycle1Kn.weight_kg).toBe(500)

  const cycle2Calibre = pallets.find((p) => p.wash_cycle === 2 && !p.calibres.is_numberless)!
  expect(cycle2Calibre.status).toBe('in_stock') // claimed onto a manifest, but status is derived elsewhere — never flips on dispatch
  expect(cycle2Calibre.weight_kg).toBe(4000)

  const cycle2Kn = pallets.find((p) => p.wash_cycle === 2 && p.calibres.is_numberless)!
  expect(cycle2Kn.status).toBe('in_stock')
  expect(cycle2Kn.weight_kg).toBe(300)
  // Cycle 2's Konditirskiy has its own barcode, separate from cycle 1's.
  expect(cycle2Kn.barcode2).not.toBe(cycle1Kn.barcode2)

  expect(consoleErrors, `Console errors during the flow: ${consoleErrors.join('\n')}`).toEqual([])
})
