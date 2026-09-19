import { test, expect, type Page, type Locator } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loginAs, type TestRole } from './helpers/login'
import { uniqueRealLookingPlate, E2E_OWNER_NAME } from './helpers/fixtures'
import { teardownFixtures, resyncPartiyaCounter } from './helpers/teardown'

// Path E cheat version — multi-cycle wash_cycles, admin-only, no UI to open
// a second cycle (see DECISIONS.md "Path E cheat: multi-cycle wash_cycles
// scoping"). This is the end-to-end residual-reprocess flow the whole
// investigation this session was scoped around: a serial's main processing
// closes via Yakunlash with a genuine raw remainder left unsent, and later
// an admin registers a SECOND real Moyka cycle against the same serial to
// reprocess that remainder — without disturbing cycle 1's already-booked,
// already-reported figures.
//
// Numbers, chosen so the arithmetic is checkable by hand:
//   declared/gate net 1000kg (single line, box mass 0) -> effective_qty 1000kg
//   cycle 1: sent 800kg, received 760kg (Kalibr 4) -> loss 40kg
//   raw remainder after cycle 1 closes: 1000 - 800 = 200kg (still in Ombor)
//   cycle 2 (admin-opened): sent 200kg (the remainder), received 190kg
//     (Kalibr 4, continuing cycle 1's barcode sequence) -> loss 10kg
//   final: total loss 40 + 10 = 50kg, moykaga_yuborilgan 1000kg (fully
//     consumed), omborda_qoldi 0kg

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

// Same Node-side, RLS-bypassing service client teardown.ts already
// establishes as this project's one precedent for elevated test access —
// reused here (not duplicated) because open_second_wash_cycle is
// deliberately gated on auth.role() = 'service_role', not my_role() =
// 'ombor' (see the migration's own header: "not an Ombor-triggered flow").
// No real app session, including a logged-in Ombor user, can ever call it
// — a service-role client is the ONLY way to exercise it at all, by design.
let serviceClient: SupabaseClient | null = null
function adminClient(): SupabaseClient {
  if (serviceClient) return serviceClient
  const url = process.env.SUPABASE_URL ?? 'https://qohoqbapevrcjqxbstxi.supabase.co'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY — see tests/e2e/helpers/teardown.ts for the same requirement.')
  serviceClient = createClient(url, key, { auth: { persistSession: false } })
  return serviceClient
}

let kirimPlates: string[] = []
let typeIds: string[] = []
// wash_cycles ids this suite creates via open_second_wash_cycle — the RPC's
// own audit_log insert isn't covered by teardownFixtures (that helper
// only knows about the operational tables every OTHER spec writes to), so
// this suite cleans its own audit_log rows directly.
let auditedWashCycleIds: string[] = []

test.afterEach(async () => {
  const db = adminClient()
  if (auditedWashCycleIds.length > 0) {
    const { error } = await db.from('audit_log').delete().eq('table_name', 'wash_cycles').in('row_id', auditedWashCycleIds)
    if (error) throw new Error(`teardown: audit_log delete failed: ${error.message}`)
    auditedWashCycleIds = []
  }
  await teardownFixtures({ kirimPlates })
  await resyncPartiyaCounter(typeIds)
  kirimPlates = []
  typeIds = []
})

// Seeds a serial through KIRIM -> gate -> intake directly (proven
// end-to-end elsewhere, e.g. full-chain.spec.ts and lab-relocation-loss-
// verification.spec.ts) — this test's own job starts at "ready to send to
// Moyka." Returns to a logged-out page so the caller starts its own real
// flow (matching seedDispatchablePallets' own convention).
async function seedRawSerial(page: Page, declaredQty: number): Promise<{ serial: string; orderId: string; typeId: string; ownerId: string }> {
  const plate = uniqueRealLookingPlate()
  kirimPlates.push(plate)

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
        .insert({ order_date: new Date().toISOString().slice(0, 10), plate, driver: 'TEST Driver', owner_id: owner.id, declared_total: 1000 })
        .select('order_id')
        .single()
      if (orderErr) throw new Error(`kirim_orders insert: ${orderErr.message}`)
      return { orderId: order.order_id as string, typeId: type.id as string, ownerId: owner.id as string }
    },
    { plate, ownerName: E2E_OWNER_NAME },
  )
  typeIds.push(typeId)

  const serial = await page.evaluate(
    async ({ orderId, typeId, declaredQty }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      // is_sulfured: false — one-step CHIQIM verdict, same reasoning as
      // lab-relocation-loss-verification.spec.ts.
      const { data: line, error } = await w.supabase
        .from('kirim_lines')
        .insert({ order_id: orderId, type_id: typeId, declared_qty: declaredQty, is_sulfured: false })
        .select('serial')
        .single()
      if (error) throw new Error(`kirim_lines insert: ${error.message}`)
      return line.serial as string
    },
    { orderId, typeId, declaredQty },
  )

  await switchRole(page, 'QOROVUL')
  await page.evaluate(
    async ({ orderId, declaredQty }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      const {
        data: { user },
      } = await w.supabase.auth.getUser()
      const now = new Date().toISOString()
      const { error } = await w.supabase.from('gate_weighings').insert({
        dir: 'kirim',
        order_id: orderId,
        gruzheny_kg: declaredQty + 100,
        pustoy_kg: 100,
        stage1_created_by: user.id,
        stage1_completed_at: now,
        stage2_created_by: user.id,
        completed_at: now,
      })
      if (error) throw new Error(`gate_weighings insert: ${error.message}`)
    },
    { orderId, declaredQty },
  )

  await switchRole(page, 'OMBOR')
  await page.evaluate(
    async ({ serial, declaredQty }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      const {
        data: { user },
      } = await w.supabase.auth.getUser()
      const { error } = await w.supabase.from('storage_intake').insert({ serial, actual_qty: declaredQty, box_mass_kg: 0, confirmed_by: user.id })
      if (error) throw new Error(`storage_intake insert: ${error.message}`)
    },
    { serial, declaredQty },
  )

  return { serial, orderId, typeId, ownerId }
}

// Real UI: §5.2's Yangi zaxira send picker. Exercises
// OmborMoykaTab.tsx's ensure_open_wash_cycle RPC call live — this is the
// exact call site that would have raised "no unique or exclusion
// constraint matching the ON CONFLICT specification" on EVERY ordinary
// send, for every serial, had the wash_cycles_upsert_fix migration not
// shipped alongside the schema change. This test would fail loudly on
// that regression if it ever reappeared.
async function sendToMoyka(page: Page, serial: string, qtyKg: number): Promise<void> {
  await page.getByRole('link', { name: 'Moykaga Chiqarish' }).click()
  const yangiTile = page.getByRole('button', { name: '+ Yangi zaxiradan moykaga yuborish' })
  if (await yangiTile.isVisible().catch(() => false)) await yangiTile.click()
  const chip = page.getByRole('button', { name: new RegExp(`^${serial}\\b`) })
  await expect(chip).toBeVisible({ timeout: 20_000 })
  await chip.click()
  await page.locator('#new-stock-weighed').fill(String(qtyKg))
  const [sendResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/moyka_sends') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Moykaga yuborish' }).click(),
  ])
  expect(sendResponse.ok(), `moyka_sends insert must succeed, got HTTP ${sendResponse.status()}: ${await sendResponse.text()}`).toBe(true)
}

// Real UI: Laborator CHIQIM tab, natural product one-step verdict.
async function passLabTest(page: Page, serial: string): Promise<void> {
  await switchRole(page, 'LABORATOR')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  const labCard = serialCard(page, serial)
  await expect(labCard).toBeVisible({ timeout: 20_000 })
  await labCard.getByRole('button', { name: 'Tahlil' }).click()
  await serialCard(page, serial).locator('input[type="number"]').fill('8')
  await serialCard(page, serial)
    .getByRole('button', { name: "O'tdi", exact: true })
    .click()
}

// Real UI: §5.3 single-tile receive picker.
async function receivePallet(page: Page, serial: string, calibreLabel: string, weightKg: number): Promise<void> {
  await switchRole(page, 'OMBOR')
  await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
  const tile = page.getByRole('button', { name: '+ Moykadan qabul qilish' })
  if (await tile.isVisible().catch(() => false)) await tile.click()
  const chip = page.getByRole('button', { name: new RegExp(`^${serial}\\b`) })
  await expect(chip).toBeVisible({ timeout: 20_000 })
  await chip.click()
  await page.locator('select').selectOption({ label: calibreLabel })
  await page.locator('input[type="number"]').fill(String(weightKg))
  await page.getByRole('button', { name: 'Saqlash va shtrix-kod chiqarish' }).click()
  await expect(page.getByText(/PLT-/)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Yopish' }).click()
}

test('Path E: reject open_second_wash_cycle when the parent cycle is still open', async ({ page }) => {
  test.setTimeout(120_000)
  const { serial } = await seedRawSerial(page, 500)
  await sendToMoyka(page, serial, 500)
  // Never closed — cycle 1 is still open when we try to open a second one.
  const { error } = await adminClient().rpc('open_second_wash_cycle', { p_serial: serial })
  expect(error?.message ?? '').toContain('yopilgan sikl topilmadi')
})

test('Path E: full residual-reprocess lifecycle — two cycles, correct scoping throughout', async ({ page }) => {
  test.setTimeout(300_000)

  const { serial } = await seedRawSerial(page, 1000)

  // --- Cycle 1: send 800/1000, receive 760, close (40kg loss) ---
  await sendToMoyka(page, serial, 800)
  await passLabTest(page, serial)
  await receivePallet(page, serial, 'Kalibr 4', 760)

  await switchRole(page, 'OMBOR')
  await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
  // Row not expanded yet — Yakunlash button sits on the collapsed row.
  await expect(page.getByRole('button', { name: 'Yakunlash', exact: true })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Yakunlash', exact: true }).click()
  const [closeResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/rpc/close_wash_cycle_serial')),
    page.getByRole('button', { name: 'Yakunlash', exact: true }).click(),
  ])
  expect(closeResponse.ok(), `close_wash_cycle_serial must succeed: ${await closeResponse.text()}`).toBe(true)

  const cycle1ClosedAt = await page.evaluate(
    async ({ serial }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      const { data, error } = await w.supabase.from('wash_cycles').select('id, closed_at').eq('serial', serial).eq('cycle_no', 1).single()
      if (error) throw new Error(`wash_cycles lookup: ${error.message}`)
      return data
    },
    { serial },
  )
  expect(cycle1ClosedAt.closed_at, 'cycle 1 must be closed before continuing').not.toBeNull()

  // --- Reject: close_wash_cycle_serial with no open cycle ---
  const noOpenCycle = await page.evaluate(
    async ({ serial }) => {
      const w = window as unknown as { supabase: { rpc: (fn: string, args: any) => any } }
      const { error } = await w.supabase.rpc('close_wash_cycle_serial', { p_serial: serial })
      return error?.message ?? null
    },
    { serial },
  )
  expect(noOpenCycle).toContain('topilmadi yoki ochiq sikl')

  // --- Admin: open cycle 2 (service-role RPC, no UI — Path E cheat version) ---
  const opened = await adminClient().rpc('open_second_wash_cycle', { p_serial: serial })
  expect(opened.error, `open_second_wash_cycle must succeed: ${opened.error?.message}`).toBeNull()
  expect(opened.data?.[0]?.cycle_no).toBe(2)
  expect(opened.data?.[0]?.closed_at).toBeNull()
  auditedWashCycleIds.push(opened.data[0].id)

  // --- Reject: already-open second cycle ---
  const alreadyOpen = await adminClient().rpc('open_second_wash_cycle', { p_serial: serial })
  expect(alreadyOpen.error?.message ?? '').toContain('allaqachon ochiq sikl')

  // --- Cycle 2: send the 200kg remainder via the SAME normal picker ---
  const remainder = await page.evaluate(
    async ({ serial }) => {
      const w = window as unknown as { supabase: { rpc: (fn: string, args: any) => any } }
      const { data, error } = await w.supabase.rpc('kirim_line_state', { p_serial: serial })
      if (error) throw new Error(`kirim_line_state: ${error.message}`)
      return data[0]
    },
    { serial },
  )
  expect(remainder.omborda_qoldi, 'raw remainder after cycle 1 close must be exactly 200kg').toBe(200)

  await switchRole(page, 'OMBOR')
  await sendToMoyka(page, serial, 200)

  // --- Laborator's awaiting queue: cycle 2's own sentKg (200), never the
  // lifetime total (1000) — this is the exact figure the investigation
  // found reading an unbounded whole-serial sum before this fix. Cycle 1's
  // own finished result is a separate wash_cycle_id already scored
  // 'complete' in an earlier prompt loop, so it does not re-enter this
  // awaiting queue at all — only cycle 2's fresh, untested send does. ---
  await switchRole(page, 'LABORATOR')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  const cycle2Card = serialCard(page, serial)
  await expect(cycle2Card).toBeVisible({ timeout: 20_000 })
  await expect(cycle2Card).toContainText('200')
  await expect(cycle2Card).not.toContainText('1 000')
  await expect(cycle2Card).not.toContainText('1000')

  await passLabTest(page, serial)
  await receivePallet(page, serial, 'Kalibr 4', 190)

  // --- useMoykaOutput: TWO rows for this serial in Ombor's own screens now
  // (Window 2 history), each with its own independent figures ---
  await switchRole(page, 'OMBOR')
  await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
  const historyRows = page.locator('div', { hasText: serial })
  expect(await historyRows.count(), 'two cycle-rows expected for this serial in Window 2').toBeGreaterThanOrEqual(2)

  // --- Barcode continuation: cycle 2's pallet continues cycle 1's per-
  // calibre sequence (-04-2), never colliding with -04-1 ---
  const barcodes = await page.evaluate(
    async ({ serial }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      const { data, error } = await w.supabase.from('finished_pallets').select('barcode2, weight_kg').eq('serial', serial).order('created_at')
      if (error) throw new Error(`finished_pallets select: ${error.message}`)
      return data as { barcode2: string; weight_kg: number }[]
    },
    { serial },
  )
  expect(barcodes.map((b) => b.barcode2)).toEqual([`PLT-${serial}-04-1`, `PLT-${serial}-04-2`])

  // --- Close cycle 2 ---
  await page.getByRole('button', { name: 'Yakunlash', exact: true }).click()
  const [close2Response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/rpc/close_wash_cycle_serial')),
    page.getByRole('button', { name: 'Yakunlash', exact: true }).click(),
  ])
  expect(close2Response.ok(), `cycle 2 close_wash_cycle_serial must succeed: ${await close2Response.text()}`).toBe(true)

  // --- Final verification, all four surfaces the investigation named ---
  const final = await page.evaluate(
    async ({ serial }) => {
      const w = window as unknown as { supabase: { rpc: (fn: string, args: any) => any } }
      const { data: loss, error: lossErr } = await w.supabase.rpc('client_serial_loss_kg', { p_serial: serial })
      if (lossErr) throw new Error(`client_serial_loss_kg: ${lossErr.message}`)
      const { data: state, error: stateErr } = await w.supabase.rpc('kirim_line_state', { p_serial: serial })
      if (stateErr) throw new Error(`kirim_line_state: ${stateErr.message}`)
      return { loss, state: state[0] }
    },
    { serial },
  )
  expect(final.loss, 'combined loss must be cycle1(40) + cycle2(10) = 50').toBe(50)
  expect(final.state.omborda_qoldi, 'raw remainder fully consumed').toBe(0)
  expect(final.state.moykaga_yuborilgan, 'lifetime sent = 800 + 200').toBe(1000)
  expect(final.state.moykada, 'both cycles closed -> nothing in-process').toBe(0)

  // --- Cycle 1's own closed_at must be byte-identical to before cycle 2
  // ever existed — proves cycle 2's close never touched cycle 1's row ---
  const cycle1After = await page.evaluate(
    async ({ serial }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      const { data, error } = await w.supabase.from('wash_cycles').select('closed_at').eq('serial', serial).eq('cycle_no', 1).single()
      if (error) throw new Error(`wash_cycles lookup: ${error.message}`)
      return data.closed_at as string
    },
    { serial },
  )
  expect(cycle1After).toBe(cycle1ClosedAt.closed_at)
})

// Defensive-only check: open_second_wash_cycle's own lab-verdict guard.
// This state can never arise through normal use — close_wash_cycle_serial
// itself already requires a passing verdict before it will close a cycle
// at all — so this test manipulates the row directly (service client,
// bypassing the RPC) purely to exercise the defense-in-depth branch, not
// to simulate a reachable business scenario.
test('Path E: reject open_second_wash_cycle when the parent lab verdict was not a pass', async ({ page }) => {
  test.setTimeout(120_000)
  const { serial } = await seedRawSerial(page, 300)
  await sendToMoyka(page, serial, 300)
  await passLabTest(page, serial)
  await receivePallet(page, serial, 'Kalibr 4', 280)

  await switchRole(page, 'OMBOR')
  await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
  await page.getByRole('button', { name: 'Yakunlash', exact: true }).click()
  await page.getByRole('button', { name: 'Yakunlash', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Yakunlash', exact: true })).toHaveCount(0, { timeout: 20_000 })

  // Directly downgrade the closed cycle's own lab verdict — unreachable
  // through the app, exercised here only to prove the guard exists.
  // Keyed by wash_cycle_id (the reliable FK for scope='chiqim' rows —
  // parent_serial is populated for scope='kirim' rows, not this one).
  const db = adminClient()
  const { data: cycle1, error: cycleErr } = await db.from('wash_cycles').select('id').eq('serial', serial).eq('cycle_no', 1).single()
  expect(cycleErr).toBeNull()
  const { error: updateErr } = await db.from('lab_results').update({ verdict: 'qayta_yuvish' }).eq('wash_cycle_id', cycle1!.id).eq('scope', 'chiqim')
  expect(updateErr).toBeNull()

  const { error } = await db.rpc('open_second_wash_cycle', { p_serial: serial })
  expect(error?.message ?? '').toContain("laborant tomonidan tasdiqlanmagan")
})
