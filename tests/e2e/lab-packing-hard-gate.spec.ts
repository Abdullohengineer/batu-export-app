import { test, expect, type Page, type Locator } from '@playwright/test'
import { loginAs, type TestRole } from './helpers/login'
import { uniqueRealLookingPlate, E2E_OWNER_NAME } from './helpers/fixtures'
import { teardownFixtures } from './helpers/teardown'

// Replaces the retired rewash-hard-gate.spec.ts (2026-07-28, Laborator v2 —
// see DECISIONS.md "Lab moves inside Moyka, wash-cycle concept removed").
// That test's whole premise — cycle 2 reopening dispatch via Ombor's own
// void+resend action — no longer exists. This is its successor: the single
// most safety-critical path in the new model. An untested or rejected
// serial must never be able to reach Barcode #2 — proved at BOTH the UI
// level (button absent, note shown) and the database level (a direct
// finished_pallets insert as Ombor is refused by RLS, not just hidden by
// the UI), matching "hiding buttons is not security" (SPEC.md §2.15).

async function switchRole(page: Page, role: TestRole): Promise<void> {
  // 🔒 See fixtures.ts's own switchRole for the full explanation — a bare
  // `.count()` right after a prior switchRole's `waitForURL` resolves can
  // race React's post-navigation render and silently skip the logout.
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

// The serial's OWN card, found via its SerialChip and walked up to the
// nearest rounded-md ancestor — NOT a plain `div.rounded-md:has-text()`
// match, which several of this screen's own inline forms would also
// satisfy once open (MoykaSendForm/ChiqimTahlilForm/FinishedReceiptForm all
// render the serial's own text inside their own rounded-md wrapper,
// nested one level inside the row's card). Re-queried fresh on every call
// (a Playwright locator is lazy), so it stays correct across the DOM
// changing shape as each form opens/closes — same pattern this suite's own
// retired rewash-hard-gate.spec.ts already established for this exact
// problem.
function serialCard(page: Page, serial: string): Locator {
  return page.locator('span', { hasText: serial }).locator('xpath=ancestor::div[contains(@class, "rounded-md")][1]')
}

// Seeds a serial through KIRIM -> gate (both stages) -> intake, directly via
// the dev-only window.supabase client — the same established shortcut
// report-effective-qty-parity.spec.ts's own seedOrder already uses. That
// chain is already proven end-to-end elsewhere (full-chain.spec.ts); this
// test's own job starts at "sent to Moyka", the new trigger point.
async function seedReadyForMoyka(page: Page, plate: string): Promise<string> {
  await switchRole(page, 'MENEJER')
  const { orderId, typeId } = await page.evaluate(
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
      return { orderId: order.order_id as string, typeId: type.id as string }
    },
    { plate, ownerName: E2E_OWNER_NAME },
  )

  const serial = await page.evaluate(
    async ({ orderId, typeId }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      // No target_so2_mg_kg -- a natural product, so its eventual CHIQIM
      // verdict happens in one step (no Sera kiritish detour needed here).
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

  return serial
}

async function sendToMoyka(page: Page, serial: string) {
  const card = serialCard(page, serial)
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: '+ Moykaga yuborish' }).click()
  await serialCard(page, serial).locator('input[type="number"]').fill('1000')
  // '+ Moykaga yuborish' vanishes on the click above (it's the toggle that
  // opens the form, not the submit) -- the old toHaveCount(0) check here
  // asserted something already true before the submit click even happened
  // and gave zero synchronization on the actual moyka_sends write. Same
  // defect already found and fixed in lab-relocation-loss-verification.spec.ts
  // (DECISIONS.md "Lab moves inside Moyka, wash-cycle concept removed",
  // 2026-07-28) and confirmed live via trace on full-chain.spec.ts's
  // identical send action -- just never ported to this spec. Wait on the
  // actual response instead.
  const [sendResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/moyka_sends') && r.request().method() === 'POST'),
    serialCard(page, serial).getByRole('button', { name: 'Moykaga yuborish' }).click(),
  ])
  expect(sendResponse.ok(), `moyka_sends insert must succeed, got HTTP ${sendResponse.status()}: ${await sendResponse.text()}`).toBe(true)
}

let kirimPlates: string[] = []

test.afterEach(async () => {
  await teardownFixtures({ kirimPlates })
  kirimPlates = []
})

test('untested and rejected serials cannot reach Barcode #2; a passing verdict unlocks it', async ({ page }) => {
  test.setTimeout(180_000)

  const platePass = uniqueRealLookingPlate()
  kirimPlates.push(platePass)
  const serialPass = await seedReadyForMoyka(page, platePass)

  const plateReject = uniqueRealLookingPlate()
  kirimPlates.push(plateReject)
  const serialReject = await seedReadyForMoyka(page, plateReject)

  // --- Ombor: send both serials to Moyka (this mints each wash_cycles row
  // -- CHIQIM lab testing becomes enterable from this instant) ---
  await switchRole(page, 'OMBOR')
  await page.getByRole('link', { name: 'Moykaga Chiqarish' }).click()
  await sendToMoyka(page, serialPass)
  await sendToMoyka(page, serialReject)

  // --- Part 1: prove the gate BEFORE any verdict exists ---
  await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
  await expect(serialCard(page, serialPass)).toBeVisible()
  // The pack action must not exist at all -- not disabled, absent.
  await expect(serialCard(page, serialPass).getByRole('button', { name: '+ Qabul qilish' })).toHaveCount(0)
  await expect(serialCard(page, serialPass).getByText('Tahlil kutilmoqda')).toBeVisible()

  // Database-level proof, not just UI absence: a direct finished_pallets
  // insert as Ombor for the untested serial must be REFUSED by RLS. This is
  // the actual enforcement (0035_lab_relocation_core.sql's ombor_writes
  // policy); the UI gate above is convenience on top of it, not the gate
  // itself (SPEC.md §2.15 "hiding buttons is not security").
  const directInsertOutcome = await page.evaluate(async ({ serial }) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data: type } = await w.supabase.from('kirim_lines').select('type_id').eq('serial', serial).single()
    const { data: calibre } = await w.supabase.from('calibres').select('id').eq('code', '06').single()
    const { error } = await w.supabase.from('finished_pallets').insert({
      barcode2: `PLT-${serial}-06-HARDGATE`,
      serial,
      type_id: type.type_id,
      calibre_id: calibre.id,
      weight_kg: 100,
      received_date: new Date().toISOString().slice(0, 10),
    })
    return { blocked: !!error, message: error?.message ?? null }
  }, { serial: serialPass })
  expect(directInsertOutcome.blocked, 'a direct finished_pallets insert for an untested serial must be rejected by RLS').toBe(true)
  expect(directInsertOutcome.message ?? '').toMatch(/row-level security|policy/i)

  // --- Laborator: pass serialPass, reject serialReject ---
  await switchRole(page, 'LABORATOR')
  await page.getByRole('link', { name: 'CHIQIM' }).click()

  async function testSerial(serial: string, verdict: "O'tdi" | 'Qayta yuvish') {
    const card = serialCard(page, serial)
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Tahlil' }).click()
    await serialCard(page, serial).locator('input[type="number"]').fill('8')
    await serialCard(page, serial)
      .getByRole('button', { name: verdict, exact: true })
      .click()
    // The Tahlil form renders its own "Seriya <serial>" summary inside a
    // nested rounded-md wrapper (same class as ChiqimTahlilForm's peers
    // elsewhere in this suite -- see serialCard's own comment), so
    // serialCard(serial) is genuinely ambiguous (outer card + open form)
    // for as long as the form is mounted. The verdict click resolves before
    // handleTahlil's async insert+setActiveTahlil(null)+refresh() commits --
    // wait for serialCard(serial) itself to settle back down to exactly one
    // match (the form having fully unmounted) before any caller relies on
    // it resolving unambiguously. toHaveCount, unlike toBeVisible, doesn't
    // require single-match to begin polling, so it's safe to use on an
    // already-ambiguous locator.
    await expect(serialCard(page, serial)).toHaveCount(1)
  }

  await testSerial(serialPass, "O'tdi")
  await testSerial(serialReject, 'Qayta yuvish')

  // --- Part 2: the reject touches no pallets, marks the serial failed, and
  // reappears in Laborator's own CHIQIM Window 1 immediately, highlighted,
  // awaiting re-test -- no Ombor action in between. ---
  await expect(serialCard(page, serialReject)).toBeVisible()
  await expect(serialCard(page, serialReject).getByText('Rad etildi')).toBeVisible()
  const rejectedPalletCount = await page.evaluate(async ({ serial }) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data } = await w.supabase.from('finished_pallets').select('barcode2').eq('serial', serial)
    return (data ?? []).length
  }, { serial: serialReject })
  expect(rejectedPalletCount, 'a rejected serial must have zero pallets -- none exist yet at test time').toBe(0)

  // --- Part 3: passing serialPass unlocks packing ---
  await switchRole(page, 'OMBOR')
  await page.getByRole('link', { name: 'Tayyor Mahsulot' }).click()
  await expect(serialCard(page, serialPass)).toBeVisible()
  await expect(serialCard(page, serialPass).getByText('Tahlil kutilmoqda')).toHaveCount(0)
  await serialCard(page, serialPass).getByRole('button', { name: '+ Qabul qilish' }).click()
  await serialCard(page, serialPass).locator('select').selectOption({ label: 'Kalibr 6' })
  await serialCard(page, serialPass).locator('input[type="number"]').fill('500')
  await serialCard(page, serialPass).getByRole('button', { name: 'Saqlash va shtrix-kod chiqarish' }).click()
  await expect(serialCard(page, serialPass).getByText(/PLT-/)).toBeVisible({ timeout: 20_000 })

  // --- Part 4: the rejected serial STILL cannot pack, even after its
  // sibling passed -- the gate is per-serial, not per-batch/session. ---
  await expect(serialCard(page, serialReject)).toBeVisible()
  await expect(serialCard(page, serialReject).getByRole('button', { name: '+ Qabul qilish' })).toHaveCount(0)
})
