import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.png')
const PLATE = 'TEST-LAB-CHIQIM-01'

// Step 8 prompt 2, split 2c: Laborator CHIQIM screens (SPEC.md v1.9 §5.5.3)
// + the hard gate (part D). Full real chain, two lines on one KIRIM order so
// each gets an independent wash-cycle verdict: Subxon (fails -> qayta
// yuvish) and Isfara (passes -> o'tdi). Confirms both directions of the
// gate, not just the new-and-scary one: a failed-verdict pallet must be
// invisible to Menejer's feasibility checker AND refused at Ombor's CHIQIM
// scan; a passed-verdict pallet must be visible/scannable exactly as before
// this prompt existed.
test('Laborator CHIQIM verdict hard-gates dispatch availability, both directions', async ({ page }) => {
  // Step 9 regression pass: same latency-budget fix as rewash-full-cycle.spec.ts
  // (see its comment) — effective_qty's extra per-refresh queries pushed this
  // already-tight two-line test past the 30s default. See DECISIONS.md
  // "Step 9 regression pass".
  test.setTimeout(90_000)
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  // --- Menejer: KIRIM order, two lines, no client targets needed here ---
  await loginAs(page, 'MENEJER')
  await expect(page.getByRole('heading', { name: 'Yangi KIRIM' })).toBeVisible()
  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(PLATE)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  await page.locator('div:has(> label:text-is("Buyurtmachi")) select').selectOption({ label: 'Test Client A' })

  const row1 = page.locator('form div.space-y-1.rounded-md').nth(0)
  await row1.locator('select').selectOption({ label: 'Subxon' })
  await row1.getByPlaceholder('Miqdori (kg)').fill('1000')

  await page.getByRole('button', { name: "+ Tur qo'shish" }).click()
  const row2 = page.locator('form div.space-y-1.rounded-md').nth(1)
  await row2.locator('select').selectOption({ label: 'Isfara' })
  await row2.getByPlaceholder('Miqdori (kg)').fill('1000')

  await page.getByRole('button', { name: 'Saqlash' }).click()
  const savedPanel = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: 'Subxon' })
  await expect(savedPanel.locator('span.font-mono')).toHaveCount(2, { timeout: 10000 })
  await expect(savedPanel.locator('span.font-mono').nth(0)).toHaveText(/^\d{6}-\d{3}$/, { timeout: 10000 })
  await expect(savedPanel.locator('span.font-mono').nth(1)).toHaveText(/^\d{6}-\d{3}$/, { timeout: 10000 })
  const serials = await savedPanel.locator('span.font-mono').allTextContents()
  const failSerial = serials[0] // Subxon — will be verdicted qayta_yuvish
  const passSerial = serials[1] // Isfara — will be verdicted o_tdi

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
  await gateRow.locator('div:has(> label:text-is("Yuk bilan vazn (Гружёный)")) input[type="number"]').fill('2000')
  await gateRow.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
  await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
  await expect(faol.locator('.rounded-md.border-red-300', { hasText: PLATE })).toBeVisible()

  // --- Ombor: accept both lines into storage ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')

  async function acceptLine(serial: string, qty: string) {
    const omborGroup = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: PLATE })
    await expect(omborGroup).toBeVisible()
    const lineRow = omborGroup.locator('span', { hasText: serial }).locator('xpath=ancestor::div[contains(@class, "rounded-md")][1]')
    await lineRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await page.locator(`#actual-${serial}`).fill(qty)
    await lineRow.locator('div:has(> label:text-is("Uyum rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(lineRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await lineRow.getByRole('button', { name: 'Qabul qilish' }).click()
    const received = page.getByRole('heading', { name: 'Qabul qilingan mahsulotlar' }).locator('xpath=following-sibling::div[1]')
    await expect(received.locator('.rounded-md', { hasText: serial })).toBeVisible()
  }
  await acceptLine(failSerial, '1000')
  await acceptLine(passSerial, '1000')

  // --- Ombor: send both to Moyka ---
  // Re-navigating client-side per send (away and back via the real nav
  // links), not page.reload() — this dev environment doesn't correctly
  // re-serve a nested client-side route on a hard reload (a reload while on
  // /ombor/moyka lands back on /ombor's default tab instead), and a hard
  // reload isn't actually necessary: a fresh mount is achieved just as well
  // by unmounting/remounting OmborMoykaTab via routing away and back.
  async function sendToMoyka(serial: string) {
    await page.getByRole('link', { name: 'Skladga KIRIM' }).click()
    await page.getByRole('link', { name: 'Moykaga Chiqarish' }).click()
    await expect(page.getByRole('heading', { name: 'Yuborish uchun' })).toBeVisible({ timeout: 20000 })
    const row = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: serial })
    await expect(row).toBeVisible({ timeout: 10000 })
    await row.getByRole('button', { name: 'Moykaga yuborish' }).click()
    const qtyInput = row.locator('div:has(> label:text-is("Miqdori (kg)")) input[type="number"]')
    await qtyInput.fill('1000')
    await expect(qtyInput).toHaveValue('1000')
    await row.getByRole('button', { name: 'Moykaga yuborish' }).click()
    await expect(row.getByRole('button', { name: 'Moykaga yuborish' })).toHaveCount(0)
  }
  await sendToMoyka(failSerial)
  await sendToMoyka(passSerial)

  // --- Ombor: receive one finished pallet each, then Tugallash (locks
  // cycle 1 -> this is the real trigger for Lab CHIQIM W1) ---
  async function produceAndFinish(serial: string, barcode: string) {
    // Same client-side away-and-back re-navigation as sendToMoyka, not
    // page.reload() (see that function's comment) — a fresh mount per
    // serial rather than reusing the page across two back-to-back
    // multi-step interactions.
    await page.getByRole('link', { name: 'Skladga KIRIM' }).click()
    await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
    await expect(page.getByRole('heading', { name: 'Moykada — chiqishi kutilmoqda' })).toBeVisible({ timeout: 20000 })
    const row = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: serial })
    await expect(row).toBeVisible({ timeout: 10000 })
    // The toggle button only wraps the header line (serial · type · owner ·
    // ⋯), not the totals line below it — row.click() lands on the card's
    // bounding-box center, which can miss the button entirely once the
    // totals line pushes the card taller. Target the button specifically.
    await row.locator('button', { hasText: '⋯' }).click()
    await row.getByRole('button', { name: '+ Qabul qilish' }).click()
    await row.locator('select').selectOption({ label: 'Kalibr 6' })
    await row.locator('div:has(> label:text-is("Og\'irlik (kg)")) input[type="number"]').fill('1000')
    await row.getByRole('button', { name: 'Qabul qilish' }).click()
    await expect(row.getByText(barcode).first()).toBeVisible()
    await row.getByRole('button', { name: 'Tugallash' }).click()
    await row.getByRole('button', { name: 'Ha, tugallash' }).click()
    // Positive confirmation Tugallash actually locked the cycle — the row
    // moves out of the active "Moykada — chiqishi kutilmoqda" list into
    // "Tugallangan" once wash_cycles.status='final'.
    const tugallangan = page.getByRole('heading', { name: 'Tugallangan' }).locator('xpath=following-sibling::div[1]')
    await expect(tugallangan.locator('.rounded-md', { hasText: serial })).toBeVisible({ timeout: 10000 })
  }
  // Barcode format: PLT-<serial>-<calibre code>-<seq>; Kalibr 6's code —
  // reused from every prior test in this suite that scans a "-06-" pallet.
  await produceAndFinish(failSerial, `PLT-${failSerial}-06-1`)
  await produceAndFinish(passSerial, `PLT-${passSerial}-06-1`)

  // --- Laborator CHIQIM: both batches awaiting Tahlil ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'LABORATOR')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  await expect(page.getByRole('heading', { name: 'Tahlil kutilmoqda' })).toBeVisible()

  const w1 = page.getByRole('heading', { name: 'Tahlil kutilmoqda' }).locator('xpath=following-sibling::div[1]')
  const w3 = page.getByRole('heading', { name: 'Yakunlangan' }).locator('xpath=following-sibling::div[1]')

  async function testBatch(serial: string, verdictLabel: 'O\'tdi' | 'Qayta yuvish') {
    const row = w1.locator('.rounded-md', { hasText: serial })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Tahlil' }).click()
    // Exactly one pallet was produced per cycle in this test — select it by
    // index (index 0 is the disabled "Tanlang…" placeholder).
    await row.locator('select').selectOption({ index: 1 })
    await row.locator('div:has(> label:text-is("Namligi %")) input').fill('7')
    await row.getByRole('button', { name: verdictLabel, exact: true }).click()
    const finishedRow = w3.locator('.rounded-md', { hasText: serial })
    await expect(finishedRow).toBeVisible()
    await expect(finishedRow).toContainText(verdictLabel)
  }
  await testBatch(failSerial, 'Qayta yuvish')
  await testBatch(passSerial, "O'tdi")

  // --- Hard gate, direction 1: Menejer's feasibility checker ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'MENEJER')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  await expect(page.getByRole('heading', { name: 'Yangi CHIQIM' })).toBeVisible()

  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(PLATE)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  const chiqimSelects = page.locator('form:has-text("Yangi CHIQIM") select')
  await chiqimSelects.nth(0).selectOption({ label: 'Test Client A' })
  // Isfara (passed) — requesting exactly its 1000kg pallet should show no
  // shortage hint, same as any ordinary CHIQIM request pre-dating this task.
  await chiqimSelects.nth(1).selectOption({ label: 'Isfara' })
  await chiqimSelects.nth(2).selectOption({ label: 'Kalibr 6' })
  await page.locator('input[placeholder="Miqdori (kg)"]').fill('1000')
  await expect(page.getByRole('status')).toHaveCount(0)

  // Subxon (failed verdict) — the SAME 1000kg physically exists in
  // finished_pallets as in_stock, but the hard gate must exclude it from
  // useAvailableFinishedStock, leaving checkFeasibility with an empty
  // weights array for this type+calibre. checkFeasibility's "empty stock"
  // case reports nearestBelow=0 (not null), so the app's actual message is
  // "eng ko'p: 0 kg", not the separate "no pallet at all" fallback — that
  // fallback is unreachable given how checkFeasibility behaves on empty
  // input, confirmed by inspection, not a bug introduced by this task.
  await chiqimSelects.nth(1).selectOption({ label: 'Subxon' })
  await chiqimSelects.nth(2).selectOption({ label: 'Kalibr 6' })
  await expect(page.getByRole('status')).toContainText("eng ko'p: 0 kg")

  // --- Hard gate, direction 2: Ombor's CHIQIM scan screen ---
  // Create a real CHIQIM request so there's a scan target for Isfara (the
  // one that should actually work) — switch the row back to Isfara first;
  // it was left on Subxon from the feasibility check just above.
  await chiqimSelects.nth(1).selectOption({ label: 'Isfara' })
  await chiqimSelects.nth(2).selectOption({ label: 'Kalibr 6' })
  await page.locator('input[placeholder="Miqdori (kg)"]').fill('1000')
  await page.getByRole('button', { name: 'Saqlash' }).click()
  await expect(page.getByText('Isfara · Kalibr 6')).toBeVisible()

  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  await page.getByRole('link', { name: 'Skladdan CHIQIM' }).click()
  const omborW1 = page.getByRole('heading', { name: "Yuklash uchun so'rovlar" }).locator('xpath=following-sibling::div[1]')
  const omborRequest = omborW1.getByRole('button', { name: new RegExp(PLATE) })
  await expect(omborRequest).toBeVisible()
  await omborRequest.click()

  const barcodeInput = page.getByPlaceholder("Barcode #2 ni kiriting yoki skanerlang")
  // Refused: passed the client-target soft-warning stage but never passed
  // the lab — not_lab_passed, not accepted onto the manifest.
  await barcodeInput.fill(`PLT-${failSerial}-06-1`)
  await page.getByRole('button', { name: 'Skanerlash' }).click()
  await expect(page.getByText("laboratoriya tekshiruvidan o'tmagan")).toBeVisible()

  // Accepted: passed verdict, real gate opens for it.
  await barcodeInput.fill(`PLT-${passSerial}-06-1`)
  await page.getByRole('button', { name: 'Skanerlash' }).click()
  await expect(page.getByText('✓ Aniq mos keldi')).toBeVisible()

  // --- Direct DB check, same session (dev-only window.supabase) ---
  const result = await page.evaluate(async ({ fail, pass }) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data } = await w.supabase
      .from('lab_results')
      .select('parent_serial, verdict, status')
      .in('parent_serial', [fail, pass])
    return data
  }, { fail: failSerial, pass: passSerial })

  const rows = result as { parent_serial: string; verdict: string; status: string }[]
  const failRow = rows.find((r) => r.parent_serial === failSerial)!
  const passRow = rows.find((r) => r.parent_serial === passSerial)!
  expect(failRow.verdict).toBe('qayta_yuvish')
  expect(failRow.status).toBe('complete')
  expect(passRow.verdict).toBe('o_tdi')
  expect(passRow.status).toBe('complete')

  expect(consoleErrors, `Console errors during the flow: ${consoleErrors.join('\n')}`).toEqual([])
})
