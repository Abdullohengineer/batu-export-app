import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'
import { uniqueTestId } from './helpers/fixtures'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.png')

// Step 9 prompt 1: effective_qty derivation + provisional-weight display
// (SPEC.md v1.10 §2.16). Single-product truck: Ombor accepts the pre-filled
// declared quantity untouched (5000kg) -> gate stage 1 only -> confirms the
// quantity reads "tarozi kutilmoqda" (provisional) on both Ombor's and
// Menejer's screens -> gate stage 2 completes with a REAL net different
// from the intake figure (5200kg, not 5000kg) -> confirms the quantity
// updates automatically to the gate net, WITHOUT any accept/confirm action
// -> confirms Moyka's "available to send" (Qoladi) reflects the gate net,
// not the declared/intake figure -> sends the full 5200kg, receives 4800kg
// -> confirms cycle-1 loss is computed against 5200kg (7.7%), not what it
// would have been against the old 5000kg intake figure (4.0%) — this is
// the money-path assertion the task explicitly asked to verify with real
// numbers.
test('Single-product truck: provisional until gate stage 2, then gate net drives available-to-send and cycle-1 loss', async ({ page }) => {
  // Many more role switches than the default 30s budget comfortably covers
  // (checks the quantity display at two points in time, before and after
  // gate stage 2, on top of the usual full-chain steps).
  test.setTimeout(90_000)
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  const PLATE = uniqueTestId('EFFQTY')

  // --- Menejer: KIRIM order, one line, declared 5000kg ---
  await loginAs(page, 'MENEJER')
  await expect(page.getByRole('heading', { name: 'Yangi KIRIM' })).toBeVisible()
  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(PLATE)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  await page.locator('div:has(> label:text-is("Buyurtmachi")) select').selectOption({ label: 'Test Client A' })
  const row1 = page.locator('form div.space-y-1.rounded-md').nth(0)
  await row1.locator('select').selectOption({ label: 'Subxon' })
  await row1.getByPlaceholder('Miqdori (kg)').fill('5000')
  await page.getByRole('button', { name: 'Saqlash' }).click()

  const savedPanel = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: 'Subxon' })
  await expect(savedPanel.locator('span.font-mono').first()).toHaveText(/^\d{6}-\d{3}$/, { timeout: 10000 })
  const serial = await savedPanel.locator('span.font-mono').first().textContent()
  if (!serial) throw new Error('serial not captured')

  // --- Qorovul: gate stage 1 only (loaded 6200kg) — stage 2 deliberately
  // not run yet, so effective_qty must still be provisional ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  {
    const faol = page.getByRole('heading', { name: 'Faol' }).locator('xpath=following-sibling::div[1]')
    const gateRow = faol.locator('.rounded-md', { hasText: PLATE })
    await expect(gateRow).toBeVisible()
    await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await gateRow.locator('div:has(> label:text-is("Moshina raqami rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await gateRow.locator('div:has(> label:text-is("Yuk bilan vazn (Гружёный)")) input[type="number"]').fill('6200')
    await gateRow.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await expect(faol.locator('.rounded-md.border-red-300', { hasText: PLATE })).toBeVisible()
  }

  // --- Ombor: accept the pre-filled declared quantity UNTOUCHED (5000kg) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  {
    const omborGroup = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: PLATE })
    await expect(omborGroup).toBeVisible()
    const lineRow = omborGroup
      .locator('span', { hasText: serial })
      .locator('xpath=ancestor::div[contains(@class, "rounded-md")][1]')
    await lineRow.getByRole('button', { name: 'Qabul qilish' }).click()
    // Pre-filled with declared_qty (5000) — do not change it, per §2.15/§2.16:
    // "usually accepted untouched."
    await expect(page.locator(`#actual-${serial}`)).toHaveValue('5000')
    await lineRow.locator('div:has(> label:text-is("Uyum rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(lineRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await lineRow.getByRole('button', { name: 'Qabul qilish' }).click()
    const received = page.getByRole('heading', { name: 'Qabul qilingan mahsulotlar' }).locator('xpath=following-sibling::div[1]')
    await expect(received.locator('.rounded-md', { hasText: serial })).toBeVisible()
  }

  // --- Provisional check #1: Ombor's own §5.1 Window 2, before gate stage 2 ---
  {
    const received = page.getByRole('heading', { name: 'Qabul qilingan mahsulotlar' }).locator('xpath=following-sibling::div[1]')
    const row = received.locator('.rounded-md', { hasText: serial })
    // "Qoldiq: 5,000 kg" legitimately appears (remaining = the still-
    // provisional 5000 minus zero sent so far) — the assertion is on the
    // quantity label specifically, not "5,000 kg" anywhere in the row.
    await expect(row).toContainText('tarozi kutilmoqda')
    await expect(row).not.toContainText('Subxon · 5,000 kg')
  }

  // --- Provisional check #2: Menejer's KIRIM list, same serial, before gate stage 2 ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'MENEJER')
  {
    const orderRow = page.locator('div.rounded-md.border.border-slate-200', { hasText: PLATE })
    await orderRow.getByRole('button').first().click() // expand the order
    const lineRow = orderRow.locator('div.text-sm', { hasText: serial })
    await expect(lineRow).toContainText('tarozi kutilmoqda')
  }

  // --- Provisional check #3: Moyka "Qoladi" reads the still-provisional
  // intake figure (5000), not yet the gate net ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  {
    await page.getByRole('link', { name: 'Moykaga Chiqarish' }).click()
    const yuborishUchun = page.getByRole('heading', { name: 'Yuborish uchun' }).locator('xpath=following-sibling::div[1]')
    const row = yuborishUchun.locator('.rounded-md', { hasText: serial })
    await expect(row).toBeVisible({ timeout: 20000 })
    await expect(row).toContainText('tarozi kutilmoqda')
  }

  // --- Qorovul: gate stage 2 (empty 1000kg -> net 5200kg, NOT 5000kg) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  {
    const faol = page.getByRole('heading', { name: 'Faol' }).locator('xpath=following-sibling::div[1]')
    const gateRow = faol.locator('.rounded-md', { hasText: PLATE })
    await expect(gateRow).toBeVisible()
    await gateRow.getByRole('button', { name: 'Yakunlash' }).click()
    await gateRow.locator('div:has(> label:text-is("Bo\'sh vazn (Пустой)")) input[type="number"]').fill('1000')
    await gateRow.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await gateRow.getByRole('button', { name: 'Yakunlash' }).click()
    const yakunlangan = page.getByRole('heading', { name: 'Yakunlangan' }).locator('xpath=following-sibling::div[1]')
    await expect(yakunlangan.locator('.rounded-md', { hasText: PLATE })).toBeVisible({ timeout: 10000 })
    await expect(yakunlangan.locator('.rounded-md', { hasText: PLATE })).toContainText('5,200 kg')
  }

  // --- Final check #1: Ombor's §5.1 Window 2 now shows the GATE NET
  // (5,200 kg), a derived recomputation, no accept/confirm action taken ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  {
    const received = page.getByRole('heading', { name: 'Qabul qilingan mahsulotlar' }).locator('xpath=following-sibling::div[1]')
    const row = received.locator('.rounded-md', { hasText: serial })
    await expect(row).toBeVisible({ timeout: 10000 })
    await expect(row).not.toContainText('tarozi kutilmoqda')
    await expect(row).toContainText('5,200 kg')
    // §5.1 amend: gate-vs-declared variance, always shown once known.
    await expect(row).toContainText('+200')
  }

  // --- Final check #2: Menejer's KIRIM list also shows the gate net ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'MENEJER')
  {
    const orderRow = page.locator('div.rounded-md.border.border-slate-200', { hasText: PLATE })
    await orderRow.getByRole('button').first().click() // expand the order
    const lineRow = orderRow.locator('div.text-sm', { hasText: serial })
    await expect(lineRow).toContainText('5,200 kg')
    await expect(lineRow).not.toContainText('tarozi kutilmoqda')
  }

  // --- Final check #3: Moyka "Qoladi" now reflects the gate net (5,200kg),
  // NOT the old intake figure (5,000kg) — the actual money-path change ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  {
    await page.getByRole('link', { name: 'Moykaga Chiqarish' }).click()
    const yuborishUchun = page.getByRole('heading', { name: 'Yuborish uchun' }).locator('xpath=following-sibling::div[1]')
    const row = yuborishUchun.locator('.rounded-md', { hasText: serial })
    await expect(row).toBeVisible({ timeout: 20000 })
    await expect(row).not.toContainText('tarozi kutilmoqda')
    await expect(row).toContainText('5,200 kg')

    // Send the full gate-net amount to Moyka.
    await row.getByRole('button', { name: 'Moykaga yuborish' }).click()
    const qtyInput = row.locator('div:has(> label:text-is("Miqdori (kg)")) input[type="number"]')
    await qtyInput.fill('5200')
    await expect(qtyInput).toHaveValue('5200')
    await row.getByRole('button', { name: 'Moykaga yuborish' }).click()
    await expect(row.getByRole('button', { name: 'Moykaga yuborish' })).toHaveCount(0)
  }

  // --- Receive one pallet (4800kg), Tugallash — cycle-1 loss must be
  // against 5200kg (7.7%), not the old 5000kg-basis figure (4.0%) ---
  await page.getByRole('link', { name: 'Skladga KIRIM' }).click()
  await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
  await expect(page.getByRole('heading', { name: 'Moykada — chiqishi kutilmoqda' })).toBeVisible({ timeout: 20000 })
  {
    const row = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: serial })
    await expect(row).toBeVisible({ timeout: 10000 })
    await row.locator('button', { hasText: '⋯' }).click()
    await row.getByRole('button', { name: /Qabul qilish|Yana qo'shish/ }).click()
    await row.locator('select').selectOption({ label: 'Kalibr 6' })
    const weightInput = row.locator('div:has(> label:text-is("Og\'irlik (kg)")) input[type="number"]')
    await weightInput.fill('4800')
    await weightInput.press('Tab')
    await expect(weightInput).toHaveValue('4800')
    await row.getByRole('button', { name: 'Qabul qilish' }).click()
    await expect(row.getByText(`PLT-${serial}-`).first()).toBeVisible({ timeout: 10000 })
  }
  await page.getByRole('link', { name: 'Skladga KIRIM' }).click()
  await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
  await expect(page.getByRole('heading', { name: 'Moykada — chiqishi kutilmoqda' })).toBeVisible({ timeout: 20000 })
  {
    const row = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: serial })
    await expect(row).toBeVisible({ timeout: 10000 })
    await row.locator('button', { hasText: '⋯' }).click()
    await row.getByRole('button', { name: 'Tugallash' }).click()
    await row.getByRole('button', { name: 'Ha, tugallash' }).click()
    const tugallangan = page.getByRole('heading', { name: 'Tugallangan' }).locator('xpath=following-sibling::div[1]')
    const finishedRow = tugallangan.locator('.rounded-md', { hasText: serial })
    await expect(finishedRow).toBeVisible({ timeout: 10000 })
    // (5200 - 4800) / 5200 = 7.7% — NOT 4.0%, which is what
    // (5000 - 4800) / 5000 would have read under the old actual_qty basis.
    await expect(finishedRow).toContainText('7.7%')
    await expect(finishedRow).not.toContainText('4.0%')
  }

  // --- Direct DB check: locked final_loss_pct matches the gate-net basis ---
  const result = await page.evaluate(async (serialArg) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data } = await w.supabase.from('wash_cycles').select('final_loss_pct').eq('serial', serialArg).eq('cycle_no', 1).single()
    return data
  }, serial)
  expect(result?.final_loss_pct).toBe(7.7)

  expect(consoleErrors, `Console errors during the flow: ${consoleErrors.join('\n')}`).toEqual([])
})

// Multi-product truck: two lines on one order, one gate weighing for the
// whole truck. Confirms each line's effective_qty stays its OWN intake
// figure (never adopts gate net, even once gate stage 2 completes) and the
// truck-level gate-vs-declared variance shows on both lines.
test('Multi-product truck: per-line intake figures used, truck-total variance shown, gate net never adopted per-line', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  const PLATE = uniqueTestId('EFFQTY')

  // --- Menejer: KIRIM order, two lines, declared 1000kg each (2000 total) ---
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
  await expect(savedPanel.getByText(/^\d{6}-\d{3}$/)).toHaveCount(2, { timeout: 10000 })
  const serials = await savedPanel.locator('span.font-mono').allTextContents()
  expect(serials).toHaveLength(2)
  const [serialA, serialB] = serials

  // --- Qorovul: full trip, one weighing for the whole truck: loaded 3200,
  // empty 1000 -> net 2200 (declared total was 2000 -> +200kg/+10% variance) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  {
    const faol = page.getByRole('heading', { name: 'Faol' }).locator('xpath=following-sibling::div[1]')
    const gateRow = faol.locator('.rounded-md', { hasText: PLATE })
    await expect(gateRow).toBeVisible()
    await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await gateRow.locator('div:has(> label:text-is("Moshina raqami rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await gateRow.locator('div:has(> label:text-is("Yuk bilan vazn (Гружёный)")) input[type="number"]').fill('3200')
    await gateRow.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await expect(faol.locator('.rounded-md.border-red-300', { hasText: PLATE })).toBeVisible()

    await gateRow.getByRole('button', { name: 'Yakunlash' }).click()
    await gateRow.locator('div:has(> label:text-is("Bo\'sh vazn (Пустой)")) input[type="number"]').fill('1000')
    await gateRow.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await gateRow.getByRole('button', { name: 'Yakunlash' }).click()
    const yakunlangan = page.getByRole('heading', { name: 'Yakunlangan' }).locator('xpath=following-sibling::div[1]')
    await expect(yakunlangan.locator('.rounded-md', { hasText: PLATE })).toContainText('2,200 kg', { timeout: 10000 })
  }

  // --- Ombor: accept both lines, pre-filled and untouched (1000kg each) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  for (const serial of [serialA, serialB]) {
    const omborGroup = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: PLATE })
    await expect(omborGroup).toBeVisible()
    const lineRow = omborGroup
      .locator('span', { hasText: serial })
      .locator('xpath=ancestor::div[contains(@class, "rounded-md")][1]')
    await lineRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await expect(page.locator(`#actual-${serial}`)).toHaveValue('1000')
    await lineRow.locator('div:has(> label:text-is("Uyum rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(lineRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await lineRow.getByRole('button', { name: 'Qabul qilish' }).click()
  }

  // --- Both lines: still their OWN intake figure (1,000kg each), NOT the
  // gate net (2,200kg) — gate stage 2 already completed, so this is the
  // "final, but still per-line" case (§2.16.1), not provisional ---
  {
    const received = page.getByRole('heading', { name: 'Qabul qilingan mahsulotlar' }).locator('xpath=following-sibling::div[1]')
    for (const serial of [serialA, serialB]) {
      const row = received.locator('.rounded-md', { hasText: serial })
      await expect(row).toBeVisible({ timeout: 10000 })
      await expect(row).not.toContainText('tarozi kutilmoqda')
      await expect(row).toContainText('1,000 kg')
      await expect(row).not.toContainText('2,200 kg')
      // Truck-total variance: gate net 2200 vs declared total 2000 -> +200/+10%.
      await expect(row).toContainText('+200')
      // Multi-line reconciliation: sum of lines (2000) vs gate net (2200) -> -200.
      await expect(row).toContainText('-200')
    }
  }

  expect(consoleErrors, `Console errors during the flow: ${consoleErrors.join('\n')}`).toEqual([])
})
