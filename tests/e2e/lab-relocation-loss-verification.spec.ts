import { test, expect, type Page, type Locator } from '@playwright/test'
import { loginAs, type TestRole } from './helpers/login'
import { uniqueRealLookingPlate, E2E_OWNER_NAME } from './helpers/fixtures'
import { teardownFixtures } from './helpers/teardown'

// Laborator v2 (2026-07-28 — see DECISIONS.md "Lab moves inside Moyka,
// wash-cycle concept removed") Test 2: loss = (raw for serial − received
// finished), computed at Ombor's receipt (Tugallash), with no cycle
// involved — and that SAME number must flow into both get_client_report
// and yield_rows, the two rewritten reporting functions this change
// touched. This is deliberately the highest-scrutiny test in this whole
// change: the reporting layer was flagged as the riskiest part of the
// migration (this codebase has already shipped one real loss-calculation
// bug in this exact area — see 0029's own header comment).
//
// Known numbers, chosen so the arithmetic is checkable by hand:
//   gate loaded 1100kg − gate empty 100kg − box mass 0kg = raw 1000kg
//   packed: one pallet, 850kg (Kalibr 6)
//   expected loss = 1000 − 850 = 150kg (15.0%)

async function switchRole(page: Page, role: TestRole): Promise<void> {
  const isLoggedIn = await page
    .getByRole('button', { name: 'Chiqish' })
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false)
  if (isLoggedIn) {
    await page.getByRole('button', { name: 'Chiqish' }).click()
    await page.waitForURL('**/login')
  }
  await loginAs(page, role)
}

function serialCard(page: Page, serial: string): Locator {
  return page.locator('span', { hasText: serial }).locator('xpath=ancestor::div[contains(@class, "rounded-md")][1]')
}

let kirimPlates: string[] = []

test.afterEach(async () => {
  await teardownFixtures({ kirimPlates })
  kirimPlates = []
})

test('loss computed at receipt matches get_client_report and yield_rows exactly', async ({ page }) => {
  test.setTimeout(180_000)

  const plate = uniqueRealLookingPlate()
  kirimPlates.push(plate)

  // --- Seed KIRIM -> gate -> intake directly (already proven end-to-end in
  // full-chain.spec.ts; this test's own job starts at "sent to Moyka"). ---
  await switchRole(page, 'MENEJER')
  const { orderId, typeId, ownerId } = await page.evaluate(
    async ({ plate, ownerName }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      const { data: owner, error: ownerErr } = await w.supabase.from('owners').select('id').eq('name', ownerName).single()
      if (ownerErr) throw new Error(`owner lookup: ${ownerErr.message}`)
      const { data: type, error: typeErr } = await w.supabase.from('product_types').select('id').eq('name', 'Subxon').single()
      if (typeErr) throw new Error(`type lookup: ${typeErr.message}`)
      const { data: order, error: orderErr } = await w.supabase
        .from('kirim_orders')
        .insert({
          order_date: new Date().toISOString().slice(0, 10),
          plate,
          driver: 'TEST Driver',
          owner_id: owner.id,
          declared_total: 1000,
        })
        .select('order_id')
        .single()
      if (orderErr) throw new Error(`kirim_orders insert: ${orderErr.message}`)
      return { orderId: order.order_id as string, typeId: type.id as string, ownerId: owner.id as string }
    },
    { plate, ownerName: E2E_OWNER_NAME },
  )

  const serial = await page.evaluate(
    async ({ orderId, typeId }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      const { data: line, error } = await w.supabase
        .from('kirim_lines')
        .insert({ order_id: orderId, type_id: typeId, declared_qty: 1000 })
        .select('serial')
        .single()
      if (error) throw new Error(`kirim_lines insert: ${error.message}`)
      return line.serial as string
    },
    { orderId, typeId },
  )

  await switchRole(page, 'QOROVUL')
  await page.evaluate(
    async ({ orderId }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      const {
        data: { user },
      } = await w.supabase.auth.getUser()
      const now = new Date().toISOString()
      // 1100 loaded - 100 empty = 1000kg gate net -> effective_qty = 1000kg
      // (single-line, gate stage 2 complete, box mass 0).
      const { error } = await w.supabase.from('gate_weighings').insert({
        dir: 'kirim',
        order_id: orderId,
        gruzheny_kg: 1100,
        pustoy_kg: 100,
        stage1_created_by: user.id,
        stage1_completed_at: now,
        stage2_created_by: user.id,
        completed_at: now,
      })
      if (error) throw new Error(`gate_weighings insert: ${error.message}`)
    },
    { orderId },
  )

  await switchRole(page, 'OMBOR')
  await page.evaluate(
    async ({ serial }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      const {
        data: { user },
      } = await w.supabase.auth.getUser()
      const { error } = await w.supabase
        .from('storage_intake')
        .insert({ serial, actual_qty: 1000, box_mass_kg: 0, confirmed_by: user.id })
      if (error) throw new Error(`storage_intake insert: ${error.message}`)
    },
    { serial },
  )

  // --- Send the full 1000kg to Moyka (real UI -- mints wash_cycles) ---
  await page.getByRole('link', { name: 'Moykaga Chiqarish' }).click()
  const sendCard = serialCard(page, serial)
  await expect(sendCard).toBeVisible()
  await sendCard.getByRole('button', { name: '+ Moykaga yuborish' }).click()
  await serialCard(page, serial).locator('input[type="number"]').fill('1000')
  // The "+ Moykaga yuborish" button is hidden the instant the form OPENS
  // (isActive flips before any network call fires), so its absence proves
  // nothing about whether the mutation itself succeeded -- wait for the
  // actual moyka_sends insert's response instead.
  const [sendResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/moyka_sends') && r.request().method() === 'POST'),
    serialCard(page, serial).getByRole('button', { name: 'Moykaga yuborish' }).click(),
  ])
  expect(sendResponse.ok(), `moyka_sends insert must succeed, got HTTP ${sendResponse.status()}: ${await sendResponse.text()}`).toBe(true)

  // --- Laborator: pass it (natural product, one-step verdict) ---
  await switchRole(page, 'LABORATOR')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  const labCard = serialCard(page, serial)
  await expect(labCard).toBeVisible()
  await labCard.getByRole('button', { name: 'Tahlil' }).click()
  await serialCard(page, serial).locator('input[type="number"]').fill('8')
  await serialCard(page, serial)
    .getByRole('button', { name: "O'tdi", exact: true })
    .click()

  // --- Ombor: pack exactly ONE pallet, 850kg, then Tugallash ---
  await switchRole(page, 'OMBOR')
  await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
  const packCard = serialCard(page, serial)
  await expect(packCard).toBeVisible()
  await packCard.getByRole('button', { name: '+ Qabul qilish' }).click()
  await serialCard(page, serial).locator('select').selectOption({ label: 'Kalibr 6' })
  await serialCard(page, serial).locator('input[type="number"]').fill('850')
  await serialCard(page, serial).getByRole('button', { name: 'Saqlash va shtrix-kod chiqarish' }).click()
  await expect(serialCard(page, serial).getByText(/PLT-/)).toBeVisible({ timeout: 20_000 })

  await serialCard(page, serial).getByRole('button', { name: 'Tugallash' }).click()
  // The confirm dialog's own "Yakuniy yo'qotish" line is the number Ombor's
  // receipt itself produces -- check it directly before confirming, this is
  // the "computed at receipt" half of the claim. Matched as the exact
  // combined "150 kg · 15.0%" stat span, not a bare '15.0%' substring --
  // this scenario's deliberately-round 15% loss also trips the app's real
  // >10% Tugallash sanity-check warning banner ("Yo'qotish 15.0% — 10% dan
  // yuqori..."), which contains the same substring and would otherwise
  // make the locator ambiguous (a second, correct, unrelated feature).
  const confirmDialog = serialCard(page, serial)
  await expect(confirmDialog.getByText('150 kg · 15.0%')).toBeVisible()
  await confirmDialog.getByRole('button', { name: 'Ha, tugallash' }).click()
  await expect(page.getByText('Tugallangan serial yo\'q.')).toHaveCount(0)

  // --- Trace the SAME number into get_client_report and yield_rows ---
  const today = new Date().toISOString().slice(0, 10)
  const traced = await page.evaluate(
    async ({ ownerId, today, serial }) => {
      const w = window as unknown as { supabase: { rpc: (fn: string, args: any) => any; from: (t: string) => any } }
      const { data: report, error: reportErr } = await w.supabase.rpc('get_client_report', {
        p_owner_id: ownerId,
        p_from: today,
        p_to: today,
      })
      if (reportErr) throw new Error(`get_client_report: ${reportErr.message}`)
      const { data: yieldRows, error: yieldErr } = await w.supabase.from('yield_rows').select('*').eq('serial', serial)
      if (yieldErr) throw new Error(`yield_rows select: ${yieldErr.message}`)
      return { reportLossKg: report.raw.processedBreakdown.lossKg, reportLossPct: report.raw.processedBreakdown.lossPct, yieldRow: yieldRows[0] ?? null }
    },
    { ownerId, today, serial },
  )

  expect(traced.yieldRow, `yield_rows must contain a row for ${serial}`).toBeTruthy()
  expect(traced.yieldRow.loss_kg, 'yield_rows.loss_kg must match the 150kg computed at receipt').toBe(150)
  expect(traced.yieldRow.loss_pct, 'yield_rows.loss_pct must match the 15.0% computed at receipt').toBe(15.0)
  expect(traced.yieldRow.output_kg, 'yield_rows.output_kg must be the 850kg packed, exactly').toBe(850)
  expect(traced.yieldRow.rewashed, 'a serial that was never rejected must not read as rewashed').toBe(false)
  expect(traced.reportLossKg, 'get_client_report processedBreakdown.lossKg must match the same 150kg').toBe(150)
  expect(traced.reportLossPct, 'get_client_report processedBreakdown.lossPct must match the same 15.0%').toBe(15)
})
