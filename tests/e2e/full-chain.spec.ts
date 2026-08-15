import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'
import { uniqueRealLookingPlate, seedFilteredFinishedRequest, E2E_OWNER_NAME } from './helpers/fixtures'
import { teardownFixtures } from './helpers/teardown'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.png')

// Survivor 1/4: Full chain — KIRIM -> gate -> intake -> Moyka -> lab ->
// CHIQIM -> gate, asserting actor/timestamp data on the finished view. One
// KIRIM order carries two lines (Subxon, sulfured; Isfara, natural) rather
// than literally one product, deliberately: this is what lets one chain
// subsume laborator-kirim.spec.ts's sulfured/natural lab-flow split (a
// natural line must skip Sera kutilmoqda entirely, a sulfured one must not)
// and kirim-client-targets.spec.ts's blank-SO2-persists-as-real-null check,
// both otherwise unreachable from a single-line truck — and, as a free
// byproduct of already needing two lines, effective_qty's multi-line rule
// (§2.16.1: per-line intake, gate net never adopted, both variance figures
// shown) that used to live in effective-qty.spec.ts's second test. Only
// Subxon continues past the lab into Moyka/Tayyor/CHIQIM — Isfara's role
// ends at the KIRIM lab check, which is all its own risk needs.
// Also subsumes chiqim-flow, chiqim-full-chain, step9-single-product-full-
// chain, and menejer-chiqim-finished-view (including its TEST- filter
// negative case, folded in below). See docs/DECISIONS.md "e2e suite
// consolidation" for the full reasoning on what each deleted spec's risk
// maps to here.
let kirimPlates: string[] = []
let chiqimPlates: string[] = []

test.afterEach(async () => {
  await teardownFixtures({ kirimPlates, chiqimPlates })
  kirimPlates = []
  chiqimPlates = []
})

test('KIRIM (sulfured + natural lines) -> gate -> intake -> Moyka -> lab -> CHIQIM -> gate: o_tdi verdict, dispatch, finished-view actor/timestamp data', async ({
  page,
}) => {
  test.setTimeout(150_000)
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  // §5.4 Option B (2026-07-27): NOT uniqueTestId — stock_on_hand_rows (the
  // CHIQIM picker's own data source) excludes any pallet whose parent
  // kirim_orders.plate starts with "TEST-", a THIRD filter in the same
  // family as useFinishedChiqimRequests.ts/reportQuery.ts's isTestPlate().
  // Needed so this chain's own finished Subxon pallet is picker-selectable
  // when the CHIQIM section below reserves it.
  const PLATE_IN = uniqueRealLookingPlate()
  kirimPlates.push(PLATE_IN)
  // Deliberately NOT TEST-prefixed: useFinishedChiqimRequests.ts filters out
  // any TEST-prefixed plate by design — a TEST- plate here would correctly,
  // not incorrectly, never appear in the finished view this test checks.
  const PLATE_OUT = uniqueRealLookingPlate()
  chiqimPlates.push(PLATE_OUT)

  // --- Menejer: KIRIM order, two lines — Subxon (sulfured, both targets)
  // continues the whole chain; Isfara (natural, SO2 blank) stops at the lab. ---
  await loginAs(page, 'MENEJER')
  await expect(page.getByRole('heading', { name: 'Yangi KIRIM' })).toBeVisible()
  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(PLATE_IN)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  await page.locator('div:has(> label:text-is("Buyurtmachi")) select').selectOption({ label: E2E_OWNER_NAME })

  // Explicit natural/sulphured classification (2026-08-14), replacing the
  // old numeric target inputs -- see DECISIONS.md "Client quality targets
  // removed from Menejer/Laborator; explicit natural/sulphured flag". Each
  // row now carries two selects in DOM order: [0] Tur, [1] Naturel/
  // Sulfatlangan (`is_sulfured`) -- no ppm/percent field exists any more.
  const row1 = page.locator('form div.space-y-1.rounded-md').nth(0)
  await row1.locator('select').nth(0).selectOption({ label: 'Subxon' })
  await row1.getByPlaceholder('Miqdori (kg)').fill('5000')
  await row1.locator('select').nth(1).selectOption({ label: 'Sulfatlangan' })

  await page.getByRole('button', { name: "+ Tur qo'shish" }).click()
  const row2 = page.locator('form div.space-y-1.rounded-md').nth(1)
  await row2.locator('select').nth(0).selectOption({ label: 'Isfara' })
  await row2.getByPlaceholder('Miqdori (kg)').fill('500')
  await row2.locator('select').nth(1).selectOption({ label: 'Naturel' })

  await page.getByRole('button', { name: 'Saqlash' }).click()

  const savedPanel = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: 'Subxon' })
  await expect(savedPanel.locator('span.font-mono')).toHaveCount(2, { timeout: 10000 })
  await expect(savedPanel.locator('span.font-mono').nth(0)).toHaveText(/^\d{6}-\d{3}$/, { timeout: 10000 })
  await expect(savedPanel.locator('span.font-mono').nth(1)).toHaveText(/^\d{6}-\d{3}$/, { timeout: 10000 })
  const [subxonSerial, isfaraSerial] = await savedPanel.locator('span.font-mono').allTextContents()

  // --- Explicit natural/sulphured flag persists correctly (2026-08-14):
  // Subxon (Sulfatlangan) -> is_sulfured=true, Isfara (Naturel) ->
  // is_sulfured=false. Also confirms Menejer's form no longer writes the
  // numeric target columns at all (both null on both lines) -- see
  // DECISIONS.md "Client quality targets removed from Menejer/Laborator;
  // explicit natural/sulphured flag". Supersedes the old kirim-client-
  // targets.spec.ts assertion (targets were the natural/sulphured signal
  // then; the flag is now, and targets are simply unwritten). ---
  {
    const result = await page.evaluate(async ({ subxon, isfara }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      const { data, error } = await w.supabase
        .from('kirim_lines')
        .select('serial, target_moisture_pct, target_so2_mg_kg, is_sulfured')
        .in('serial', [subxon, isfara])
      return { data, error: error?.message ?? null }
    }, { subxon: subxonSerial, isfara: isfaraSerial })
    expect(result.error).toBeNull()
    const rows = result.data as {
      serial: string
      target_moisture_pct: number | null
      target_so2_mg_kg: number | null
      is_sulfured: boolean | null
    }[]
    const subxonLine = rows.find((r) => r.serial === subxonSerial)!
    const isfaraLine = rows.find((r) => r.serial === isfaraSerial)!
    expect(subxonLine.is_sulfured).toBe(true)
    expect(isfaraLine.is_sulfured).toBe(false)
    expect(subxonLine.target_moisture_pct).toBeNull()
    expect(subxonLine.target_so2_mg_kg).toBeNull()
    expect(isfaraLine.target_moisture_pct).toBeNull()
    expect(isfaraLine.target_so2_mg_kg).toBeNull()
  }

  // --- Qorovul: KIRIM gate, both stages, one truck-wide weighing covering
  // both lines (loaded 6200 / empty 500 -> net 5700, +200 over the 5500
  // combined declared) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  {
    const faol = page.getByRole('heading', { name: '1 · Faol yuklar' }).locator('xpath=following-sibling::div[1]')
    const gateRow = faol.locator('.rounded-md', { hasText: PLATE_IN })
    await expect(gateRow).toBeVisible()
    await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await gateRow.locator('div:has(> label:text-is("Moshina rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await gateRow.locator('div:has(> label:text-is("Yuk bilan vazn (Гружёный)")) input[type="number"]').fill('6200')
    await gateRow.locator('div:has(> label:text-is("Yuk bilan vazn rasmi (tarozi)")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await gateRow.getByRole('button', { name: 'Saqlash' }).click()
    await expect(faol.locator('.rounded-md.border-red-300', { hasText: PLATE_IN })).toBeVisible()

    await gateRow.getByRole('button', { name: 'Yakunlash' }).click()
    await gateRow.locator('div:has(> label:text-is("Bo\'sh vazn (Пустой)")) input[type="number"]').fill('500')
    await gateRow.locator('div:has(> label:text-is("Bo\'sh vazn rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await gateRow.getByRole('button', { name: 'Yakunlash' }).click()
    const yakunlangan = page.getByRole('heading', { name: '2 · Yakunlangan' }).locator('xpath=following-sibling::div[1]')
    await expect(yakunlangan.locator('.rounded-md', { hasText: PLATE_IN })).toContainText('5,700 kg', { timeout: 20000 })
  }

  // --- Ombor: accept both lines, pre-filled and untouched. Multi-line ->
  // each line stays its OWN intake figure (never the 5,700kg gate net),
  // and both show the truck-level (+200) and reconciliation (-200)
  // variance figures — effective_qty's multi-line rule (§2.16.1), folded
  // in here from effective-qty.spec.ts's second test. ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  // Flattened S1 (one Card per kirim_lines row, no more per-order grouping —
  // nav/visual-redesign pass, mockup "BATU-Storage-S1-S2-mockup.html") means
  // each line is found directly by its own unique serial now, not by the
  // shared PLATE (a two-product truck's lines share a plate, so PLATE alone
  // would match both cards).
  async function acceptLine(serial: string, qty: string) {
    const lineRow = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: serial })
    await expect(lineRow).toBeVisible()
    await lineRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await expect(page.locator(`#actual-${serial}`)).toHaveValue(qty)
    // §2.16 box mass: now mandatory. 0 is a deliberate, real no-op value —
    // this test's whole point is exercising effective_qty end-to-end with
    // exact figures (5000/500 etc.), and a nonzero box mass would shift
    // every downstream true-net/variance figure it doesn't itself assert
    // on. Dedicated nonzero-box-mass coverage lives in
    // report-effective-qty-parity.spec.ts instead.
    await lineRow.locator('div:has(> label:text-is("Quti massasi (kg)")) input[type="number"]').fill('0')
    await lineRow.locator('div:has(> label:text-is("Uyum rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(lineRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await lineRow.getByRole('button', { name: 'Qabul qilish va shtrix-kod chiqarish' }).click()
    const received = page.getByRole('heading', { name: '2 · Qabul qilingan' }).locator('xpath=following-sibling::div[1]')
    // div.rounded-md, not bare .rounded-md: SerialChip (a <span>) also
    // carries rounded-md, so a bare class selector matches both the Card
    // and its own nested serial chip — the `div` type selector excludes
    // the span (nav/visual-redesign pass, real strict-mode violation found
    // via e2e, not assumed safe from inspection alone).
    await expect(received.locator('div.rounded-md', { hasText: serial })).toBeVisible({ timeout: 20000 })
  }
  await acceptLine(subxonSerial, '5000')
  await acceptLine(isfaraSerial, '500')
  {
    const received = page.getByRole('heading', { name: '2 · Qabul qilingan' }).locator('xpath=following-sibling::div[1]')
    for (const serial of [subxonSerial, isfaraSerial]) {
      const row = received.locator('div.rounded-md', { hasText: serial })
      await expect(row).not.toContainText('tarozi kutilmoqda')
      await expect(row).toContainText('+200')
      await expect(row).toContainText('-200')
    }
    await expect(received.locator('div.rounded-md', { hasText: subxonSerial })).toContainText('5,000 kg')
    await expect(received.locator('div.rounded-md', { hasText: isfaraSerial })).toContainText('500 kg')
    await expect(received.locator('div.rounded-md', { hasText: subxonSerial })).not.toContainText('5,700 kg')
  }

  // --- Laborator KIRIM: sulfured line goes through Sera kutilmoqda,
  // natural line skips it entirely (laborator-kirim.spec.ts's own risk) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'LABORATOR')
  {
    const w1 = page.getByRole('heading', { name: 'Tahlil kutilmoqda' }).locator('xpath=following-sibling::div[1]')
    const w2 = page.getByRole('heading', { name: '2 · Sera natijasi kutilmoqda (1 kun)' }).locator('xpath=following-sibling::div[1]')
    const w3 = page.getByRole('heading', { name: 'Yakunlangan' }).locator('xpath=following-sibling::div[1]')

    // div.rounded-md, not bare .rounded-md: SerialChip (a <span>) also
    // carries rounded-md, so a bare class selector matches both the Card
    // and its own nested serial chip -- the `div` type selector excludes
    // the span (nav/visual-redesign pass, real strict-mode violation found
    // via e2e, not assumed safe from inspection alone).
    const subxonW1 = w1.locator('div.rounded-md', { hasText: subxonSerial })
    await expect(subxonW1).toBeVisible()
    await subxonW1.getByRole('button', { name: 'Tahlil' }).click()
    await subxonW1.locator('div:has(> label:text-is("Namligi %")) input').fill('7.5')
    await subxonW1.getByRole('button', { name: 'Saqlash' }).click()
    const subxonW2 = w2.locator('div.rounded-md', { hasText: subxonSerial })
    await expect(subxonW2).toBeVisible()
    await expect(w3.locator('div.rounded-md', { hasText: subxonSerial })).toHaveCount(0)
    // No client target text anywhere on this active-input card any more
    // (2026-08-14) -- see DECISIONS.md "Client quality targets removed
    // from Menejer/Laborator; explicit natural/sulphured flag".
    await expect(subxonW2).not.toContainText('Talab')

    const isfaraW1 = w1.locator('div.rounded-md', { hasText: isfaraSerial })
    await expect(isfaraW1).toBeVisible()
    await isfaraW1.getByRole('button', { name: 'Tahlil' }).click()
    await isfaraW1.locator('div:has(> label:text-is("Namligi %")) input').fill('9.5')
    await isfaraW1.getByRole('button', { name: 'Saqlash' }).click()
    // Natural line: skips W2 entirely, lands straight in W3.
    await expect(w2.locator('div.rounded-md', { hasText: isfaraSerial })).toHaveCount(0)
    const isfaraW3 = w3.locator('div.rounded-md', { hasText: isfaraSerial })
    await expect(isfaraW3).toBeVisible()
    await expect(isfaraW3).toContainText("Yo'q · naturel")

    await subxonW2.locator('input[type="number"]').fill('45')
    await subxonW2.getByRole('button', { name: 'Sera kiritish' }).click()
    await expect(w2.locator('div.rounded-md', { hasText: subxonSerial })).toHaveCount(0)
    const subxonW3 = w3.locator('div.rounded-md', { hasText: subxonSerial })
    await expect(subxonW3).toBeVisible()
    await expect(subxonW3).toContainText('45')

    const labResult = await page.evaluate(async ({ subxon, isfara }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      const { data } = await w.supabase
        .from('lab_results')
        .select('parent_serial, moisture_pct, so2_mg_kg, status')
        .in('parent_serial', [subxon, isfara])
        .eq('scope', 'kirim')
      return data as { parent_serial: string; moisture_pct: number; so2_mg_kg: number | null; status: string }[]
    }, { subxon: subxonSerial, isfara: isfaraSerial })
    const subxonLab = labResult.find((r) => r.parent_serial === subxonSerial)!
    const isfaraLab = labResult.find((r) => r.parent_serial === isfaraSerial)!
    expect(subxonLab.status).toBe('complete')
    expect(subxonLab.so2_mg_kg).toBe(45)
    expect(isfaraLab.status).toBe('complete')
    expect(isfaraLab.so2_mg_kg).toBeNull()
  }

  // --- Only Subxon continues: Moyka send (effective_qty stays 5,000kg —
  // its own intake figure, unaffected by the truck's 5,700kg gate net) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  {
    await page.getByRole('link', { name: 'Moykaga Chiqarish' }).click()
    const yuborishUchun = page.getByRole('heading', { name: '1 · Yuborishga tayyor' }).locator('xpath=following-sibling::div[1]')
    const row = yuborishUchun.locator('div.rounded-md', { hasText: subxonSerial })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Moykaga yuborish' }).click()
    const qtyInput = row.locator('div:has(> label:text-is("Og\'irlik")) input[type="number"]')
    await qtyInput.fill('5000')
    await expect(qtyInput).toHaveValue('5000')
    // The button relabels to "Yuborilmoqda…" the instant React sets
    // submitting=true, synchronously and before the moyka_sends insert has
    // reached the network -- toHaveCount(0) on the OLD label was satisfied
    // immediately and proved nothing about the write. Confirmed via a
    // captured trace: the very next step (Chiqish/logout) is a real browser
    // navigation, and it aborted this exact POST -- net::ERR_ABORTED,
    // recorded at the same monotonic instant as the navigation completing.
    // useMoykaOutput was reading the database correctly the whole time; the
    // row was genuinely never written. Same defect already found and fixed
    // this same way in lab-relocation-loss-verification.spec.ts (DECISIONS.md
    // "Lab moves inside Moyka, wash-cycle concept removed", 2026-07-28) --
    // just never ported to this spec. Wait on the actual response instead.
    const [sendResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/moyka_sends') && r.request().method() === 'POST'),
      row.getByRole('button', { name: 'Moykaga yuborish' }).click(),
    ])
    expect(sendResponse.ok(), `moyka_sends insert must succeed, got HTTP ${sendResponse.status()}: ${await sendResponse.text()}`).toBe(true)
  }

  // --- Laborator CHIQIM: decisive check. Laborator v2 (2026-07-28 -- see
  // DECISIONS.md "Lab moves inside Moyka, wash-cycle concept removed"): the
  // hard gate on Barcode #2 assignment moved to packing, so this verdict
  // must now happen BEFORE Ombor can pack -- it used to run after packing
  // and Tugallash, back when CHIQIM lab testing was scoped to a completed
  // wash cycle. Subxon is sulfured (is_sulfured=true, set on Menejer's form
  // above), so ChiqimTahlilForm's requireVerdict is false (item.is_sulfured
  // === false) -- Tahlil only records moisture
  // (Saqlash, no verdict yet), the cycle moves to Sera kutilmoqda, and the
  // verdict happens at Sera kiritish alongside SO2 -- the same two-step
  // shape as the KIRIM check above. No more pallet <select> in this form
  // (Laborator v2 dropped it -- a pallet doesn't exist yet at this point in
  // the flow anymore); the sample-source field is now optional free text.
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'LABORATOR')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  {
    const w1 = page.getByRole('heading', { name: 'Tahlil kutilmoqda' }).locator('xpath=following-sibling::div[1]')
    const w2 = page.getByRole('heading', { name: '2 · Sera natijasi kutilmoqda (1 kun)' }).locator('xpath=following-sibling::div[1]')
    const w3 = page.getByRole('heading', { name: 'Yakunlangan' }).locator('xpath=following-sibling::div[1]')

    const row = w1.locator('div.rounded-md', { hasText: subxonSerial })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Tahlil' }).click()
    await row.locator('div:has(> label:text-is("Namligi %")) input').fill('7')
    await row.getByRole('button', { name: 'Saqlash' }).click()

    const w2row = w2.locator('div.rounded-md', { hasText: subxonSerial })
    await expect(w2row).toBeVisible({ timeout: 20000 })
    await expect(w3.locator('div.rounded-md', { hasText: subxonSerial })).toHaveCount(0)

    await w2row.locator('input[type="number"]').fill('40')
    await w2row.getByRole('button', { name: "O'tdi", exact: true }).click()

    const finishedRow = w3.locator('div.rounded-md', { hasText: subxonSerial })
    await expect(finishedRow).toBeVisible({ timeout: 20000 })
    await expect(finishedRow).toContainText("O'tdi")
  }

  const barcode = `PLT-${subxonSerial}-06-1`
  {
    await page.getByRole('button', { name: 'Chiqish' }).click()
    await page.waitForURL('**/login')
    await loginAs(page, 'OMBOR')
    await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
    await expect(page.getByRole('heading', { name: 'Moykada — chiqishi kutilmoqda' })).toBeVisible({ timeout: 20000 })
    const row = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: subxonSerial })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: /Qabul qilish|Yana qo'shish/ }).click()
    await row.locator('select').selectOption({ label: 'Kalibr 6' })
    const weightInput = row.locator('div:has(> label:text-is("Og\'irlik")) input[type="number"]')
    await weightInput.fill('4600')
    await weightInput.press('Tab')
    await expect(weightInput).toHaveValue('4600')
    await row.getByRole('button', { name: 'Saqlash va shtrix-kod chiqarish' }).click()
    await expect(row.getByText(barcode).first()).toBeVisible({ timeout: 20000 })
  }
  {
    await page.getByRole('link', { name: 'Skladga KIRIM' }).click()
    await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
    await expect(page.getByRole('heading', { name: 'Moykada — chiqishi kutilmoqda' })).toBeVisible({ timeout: 20000 })
    const row = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: subxonSerial })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByRole('button', { name: 'Tugallash' }).click()
    await row.getByRole('button', { name: 'Ha, tugallash' }).click()
    const tugallangan = page.getByRole('heading', { name: 'Tugallangan' }).locator('xpath=following-sibling::div[1]')
    const finishedRow = tugallangan.locator('div.rounded-md', { hasText: subxonSerial })
    await expect(finishedRow).toBeVisible({ timeout: 20000 })
    // (5000 - 4600) / 5000 = 8.0% — against Subxon's own 5,000kg intake
    // figure, never the truck's 5,700kg gate net (multi-line, §2.16.1).
    await expect(finishedRow).toContainText('8.0%')
  }

  // --- Confirm availability directly (SPEC.md §8 "one derived truth, all consumers") ---
  const availability = await page.evaluate(async (serialArg) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data: pallets } = await w.supabase.from('finished_pallets').select('barcode2, status, weight_kg').eq('serial', serialArg)
    const { data: lab } = await w.supabase.from('lab_results').select('verdict').eq('parent_serial', serialArg).eq('scope', 'chiqim')
    return { pallets, lab }
  }, subxonSerial)
  expect(availability.pallets).toHaveLength(1)
  expect(availability.pallets[0].status).toBe('in_stock')
  expect(availability.lab[0].verdict).toBe('o_tdi')

  // --- Menejer: create the real CHIQIM request, plus the negative-case
  // TEST--prefixed request menejer-chiqim-finished-view.spec.ts used to
  // seed separately — neither should appear in the finished view yet.
  // seedFilteredFinishedRequest's own switchRole() already handles the
  // LABORATOR->MENEJER transition (logs out if needed, then logs in) --
  // logging in here first and letting it log out+in AGAIN right after was a
  // redundant double navigation that raced under load (found live: hung on
  // Playwright's own re-fill of the login form during the second of two
  // back-to-back full-suite runs, see docs/DECISIONS.md). ---
  const { plate: FILTERED_PLATE } = await seedFilteredFinishedRequest(page)
  chiqimPlates.push(FILTERED_PLATE)
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  await expect(page.getByRole('heading', { name: 'Yangi CHIQIM' })).toBeVisible()
  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(PLATE_OUT)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  const chiqimSelects = page.locator('form:has-text("Yangi CHIQIM") select')
  await chiqimSelects.nth(0).selectOption({ label: E2E_OWNER_NAME })
  await chiqimSelects.nth(1).selectOption({ label: 'Subxon' })
  await chiqimSelects.nth(2).selectOption({ label: 'Kalibr 6' })
  // §5.4 Option B (2026-07-26/27): qty is derived from picker selection,
  // not typed. Click the exact, already-known barcode (`barcode`, captured
  // when this pallet was produced above) rather than a generic "any PLT-"
  // match — this shared e2e database can carry OTHER, unrelated
  // Subxon/Kalibr-6 stock for the same owner at any given moment (found
  // live: a generic match clicked one of those instead, silently reaching
  // the wrong target further down this test).
  await page.getByRole('button', { name: new RegExp(barcode) }).click()
  await page.getByRole('button', { name: 'Saqlash' }).click()
  await expect(page.getByText('Subxon · Kalibr 6')).toBeVisible()

  // Second window widened 2026-07-25: a freshly saved request now appears
  // immediately (same page, no navigation), status 'kutilmoqda' — this IS
  // the positive case the finished-only filter used to block.
  await expect(page.getByRole('heading', { name: "Yuborilgan CHIQIM so'rovlari" })).toBeVisible()
  const freshCard = page.locator('.rounded-md', { hasText: PLATE_OUT })
  await expect(freshCard).toBeVisible()
  await expect(freshCard).toContainText('Kutilmoqda')

  // --- Qorovul: CHIQIM gate stage 1 ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  {
    const faol = page.getByRole('heading', { name: '1 · Faol yuklar' }).locator('xpath=following-sibling::div[1]')
    const gateRow = faol.locator('.rounded-md', { hasText: PLATE_OUT })
    await expect(gateRow).toBeVisible()
    await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await gateRow.locator('div:has(> label:text-is("Moshina rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await gateRow.locator('div:has(> label:text-is("Bo\'sh vazn (Пустой)")) input[type="number"]').fill('8000')
    await gateRow.locator('div:has(> label:text-is("Bo\'sh vazn rasmi (tarozi)")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await gateRow.getByRole('button', { name: 'Saqlash' }).click()
    await expect(faol.locator('.rounded-md.border-red-300', { hasText: PLATE_OUT })).toBeVisible()
  }

  // --- Ombor: scan + finish loading ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  await page.getByRole('link', { name: 'Skladdan CHIQIM' }).click()
  {
    const omborW1 = page.getByRole('heading', { name: '1 · Yuklashga tayyor — moshina keldi' }).locator('xpath=following-sibling::div[1]')
    const omborRequest = omborW1.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: PLATE_OUT })
    await expect(omborRequest).toBeVisible({ timeout: 20000 })
    await omborRequest.getByRole('button', { name: 'Yuklashni boshlash' }).click()
    const barcodeInput = page.getByPlaceholder("Barcode #2 ni kiriting yoki skanerlang")
    await barcodeInput.fill(barcode)
    await page.getByRole('button', { name: 'Skanerlash' }).click()
    await expect(page.getByText('Yetarli emas')).not.toBeVisible()
    await page.getByRole('button', { name: 'Yuklashni yakunlash' }).click()
    await page.getByRole('button', { name: 'Ha, yakunlash' }).click()
    await expect(omborRequest).not.toBeVisible()
  }

  // --- Qorovul: CHIQIM gate stage 2 ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  {
    const faol2 = page.getByRole('heading', { name: '1 · Faol yuklar' }).locator('xpath=following-sibling::div[1]')
    const gateRow2 = faol2.locator('.rounded-md', { hasText: PLATE_OUT })
    await expect(gateRow2).toBeVisible()
    await gateRow2.getByRole('button', { name: 'Yakunlash' }).click()
    await gateRow2.locator('div:has(> label:text-is("Yuk bilan vazn (Гружёный)")) input[type="number"]').fill('12600')
    await gateRow2.locator('div:has(> label:text-is("Yuk bilan vazn rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await gateRow2.locator('div:has(> label:text-is("Chiqish hujjati rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await gateRow2.getByRole('button', { name: 'Yakunlash' }).click()
    const yakunlangan = page.getByRole('heading', { name: '2 · Yakunlangan' }).locator('xpath=following-sibling::div[1]')
    await expect(yakunlangan.locator('.rounded-md', { hasText: PLATE_OUT })).toBeVisible({ timeout: 20000 })
  }

  // --- Menejer: second window shows the real request, now completed, with
  // full actor/timestamp/photo data; the TEST--prefixed one stays filtered
  // out regardless of status (menejer-chiqim-finished-view.spec.ts's own
  // negative case, still proving the TEST- filter, not the status filter) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'MENEJER')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  {
    const finishedList = page.getByRole('heading', { name: "Yuborilgan CHIQIM so'rovlari" }).locator('xpath=following-sibling::div[1]')
    const card = finishedList.locator('.rounded-md', { hasText: PLATE_OUT })
    await expect(card).toBeVisible({ timeout: 20000 })
    await expect(card).toContainText('Olib ketildi')
    await expect(finishedList.getByText(FILTERED_PLATE)).not.toBeVisible()
    await card.getByRole('button').click()
    await expect(card.getByText('Menejer', { exact: true })).toBeVisible()
    await expect(card.getByText('Ombor', { exact: true })).toBeVisible()
    await expect(card.getByText("Qorovul — Bo'sh vazn (kirish)")).toBeVisible()
    await expect(card.getByText('Qorovul — Yuk bilan vazn (chiqish)')).toBeVisible()
    await expect(card.getByText('TEST Menejer', { exact: false })).toBeVisible()
    await expect(card.getByText('TEST Ombor', { exact: false })).toBeVisible()
    await expect(card.getByText('TEST Qorovul', { exact: false }).first()).toBeVisible()
    await expect(card.getByText(barcode)).toBeVisible()
    await expect(card.getByAltText('Moshina raqami rasmi')).toBeVisible()
    await expect(card.getByAltText('Tarozi rasmi (kirish)')).toBeVisible()
    await expect(card.getByAltText('Tarozi rasmi (chiqish)')).toBeVisible()
    await expect(card.getByAltText('Chiqish hujjati rasmi')).toBeVisible()
  }

  // --- Direct DB check: the actor/timestamp columns actually hold values ---
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
