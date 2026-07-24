import type { Page } from '@playwright/test'
import { loginAs, type TestRole } from './login'

// Shared fixture-uniqueness + seeding helper (Step 9: self-generating test
// fixtures). Mirrors how src/lib/rewash.ts / activeCycles.ts centralise
// shared logic for the app itself — every spec in this suite imports from
// HERE instead of hand-rolling its own "-NN" suffix, which is what caused
// repeated fixture-collision incidents across multiple prior sessions (see
// DECISIONS.md "Weight authority & effective quantity", "Step 9 regression
// pass"). No test file should ever again contain a literal `TEST-...-05`.

// Unique per PROCESS (one `npx playwright test` invocation), combined with
// a per-call counter so uniqueness holds BOTH across runs (a fresh process
// gets a fresh token — re-running the suite back-to-back never collides
// with the previous run's leftover, un-cleaned rows) AND within one run
// (several fixtures created by one spec, or one spec calling this many
// times, never share a counter value — requirement 3).
const runToken = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()
let counter = 0

// TEST-prefixed unique identifier — the default for everything (plates,
// driver-adjacent labels, anything else a spec needs to be unique and
// filterable). `label` is a human-readable hint (shows up in the DB/UI for
// anyone debugging a failed run, e.g. "TEST-CHIQIM-K3F7A2-3") — it plays no
// role in uniqueness, the run token + counter do that.
export function uniqueTestId(label?: string): string {
  counter += 1
  return label ? `TEST-${label}-${runToken}-${counter}` : `TEST-${runToken}-${counter}`
}

// The deliberate exception to the TEST- prefix convention: some app code
// filters OUT any TEST-prefixed plate by design (useFinishedChiqimRequests.ts
// for Menejer's finished CHIQIM view; reportQuery.ts's isTestPlate() for the
// Hisobot reporting engine, added 2026-07-20), so a test that specifically
// exercises one of those filters needs a plate that does NOT start with
// "TEST-". Still unique per run/call via the same counter; "TEST Driver"
// (unchanged elsewhere) remains the traceability marker on these rows, same
// convention as every other fixture.
export function uniqueRealLookingPlate(): string {
  counter += 1
  // runToken = base36(Date.now()) + 4 random base36 chars. The random
  // SUFFIX is what actually varies between two runs started close together
  // in time — the timestamp PREFIX's leading characters barely move within
  // a session (found live: slice(0, 4) collided across two consecutive
  // runs of the same spec, since those leading digits encode roughly a
  // 27-minute window). slice(-5) always includes the full random tail.
  return `${runToken.slice(-5)}${String(counter).padStart(2, '0')}`
}

// The one real owner every e2e fixture references — never a dedicated
// fixture-only client. "Test Client A/B/C" (the prior fixture owners) were
// deleted outright by the clean-room reset (DECISIONS.md "Clean-room reset
// for client-report verification") along with every other operational row;
// the 5 owners that replaced them are real business names with no
// dedicated e2e-safe placeholder among them, and owners can no longer be
// created-and-deleted per-test either (§3.3's RLS tightening removed
// DELETE from `owners` entirely — deactivate-only, by design). Reusing an
// existing owner is safe: every CHILD row a test creates under it
// (kirim_orders, chiqim_requests, etc.) is deleted in that test's own
// teardown (helpers/teardown.ts), so this owner ends every run with zero
// residual rows attached — the owner itself is never renamed or modified.
// Picked "Boysun..." specifically because it carries no hand-computed
// reference numbers elsewhere in this project (unlike "Nukus Agro
// Eksport", which docs/DECISIONS.md's client-report fixture depends on
// exactly) — an e2e run's own fixtures can never perturb a number some
// other verification already locked in.
export const E2E_OWNER_NAME = 'Boysun Quritilgan Mevalar'

async function switchRole(page: Page, role: TestRole): Promise<void> {
  // 🔒 `.count()` is a synchronous DOM snapshot — it does not wait for
  // rendering to catch up. Called right after a PRIOR switchRole's own
  // `waitForURL` resolves, the URL has already changed but React hasn't
  // necessarily finished painting the newly-routed page yet, so a bare
  // `.count() > 0` check can genuinely see zero matches for a currently
  // logged-in session's own Chiqish button — skipping the actual logout
  // (and its signOut() call) entirely, leaving the OLD role's session
  // fully, validly active. Every later `/login` visit then correctly
  // bounces straight back to that role's dashboard (not a bug at that
  // point — the session really is still valid), and the test hangs
  // waiting for a login form that will never appear. Found live via trace
  // inspection (report-effective-qty-parity.spec.ts, DECISIONS.md) — a
  // bare .count() reliably raced when preceded by other specs' heavier
  // rendering load, reliably won when run in true isolation with nothing
  // else warmed up. `.waitFor()` (unlike `.count()`) actually waits for the
  // element to appear, bounded so a genuinely-fresh/blank page still
  // returns promptly instead of stalling on the full test timeout.
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

export interface SeededPallet {
  barcode2: string
  weightKg: number
}

export interface SeedDispatchableResult {
  serial: string
  pallets: SeededPallet[]
  /** kirim_orders.plate this fixture created — register with teardownFixtures({ kirimPlates: [...] }). */
  kirimPlate: string
}

// Seeds N real, immediately-dispatchable finished_pallets — in_stock,
// o'tdi-verdict lab-passed, no dispatch_manifest claim — for CHIQIM-focused
// tests that don't care about the raw-intake chain (chiqim-flow,
// chiqim-full-chain, chiqim-undo-scan, menejer-chiqim-finished-view all
// need exactly this shape). Writes directly via the dev-only
// window.supabase client, respecting RLS by logging in as whichever role
// actually owns each table (menejer: kirim_orders/kirim_lines; ombor:
// wash_cycles/finished_pallets; laborator: lab_results) — the same
// established pattern every existing test already uses for direct-DB
// confirmation (CLAUDE.md "Testing workflow"), extended here to direct-DB
// *creation* for the same reason these four tests originally gave for
// skipping a full UI-driven KIRIM->Moyka->Tayyor chain: that's a lot of
// unrelated setup for a CHIQIM-focused test. Leaves the page logged OUT
// when done (at /login) — the caller starts its own real flow with its own
// loginAs from a clean slate, exactly as if a human had seeded this data
// once via SQL, which is what these tests did before this change.
export async function seedDispatchablePallets(
  page: Page,
  opts: { count: number; weightKgEach: number; typeLabel: string; calibreLabel: string },
): Promise<SeedDispatchableResult> {
  const { count, weightKgEach, typeLabel, calibreLabel } = opts
  const seedPlate = uniqueTestId('SEED')

  await switchRole(page, 'MENEJER')
  const serial = await page.evaluate(
    async ({ typeLabel, plate, ownerName }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      const { data: owner, error: ownerErr } = await w.supabase.from('owners').select('id').eq('name', ownerName).single()
      if (ownerErr) throw new Error(`owner lookup: ${ownerErr.message}`)
      const { data: type, error: typeErr } = await w.supabase.from('product_types').select('id').eq('name', typeLabel).single()
      if (typeErr) throw new Error(`type lookup: ${typeErr.message}`)
      const { data: order, error: orderErr } = await w.supabase
        .from('kirim_orders')
        .insert({
          order_date: new Date().toISOString().slice(0, 10),
          plate,
          driver: 'TEST Driver',
          owner_id: owner.id,
          declared_total: 1,
        })
        .select('order_id')
        .single()
      if (orderErr) throw new Error(`kirim_orders insert: ${orderErr.message}`)
      const { data: line, error: lineErr } = await w.supabase
        .from('kirim_lines')
        .insert({ order_id: order.order_id, type_id: type.id, declared_qty: 1 })
        .select('serial')
        .single()
      if (lineErr) throw new Error(`kirim_lines insert: ${lineErr.message}`)
      return line.serial as string
    },
    { typeLabel, plate: seedPlate, ownerName: E2E_OWNER_NAME },
  )

  await switchRole(page, 'OMBOR')
  const { washCycleId, calibreCode } = await page.evaluate(
    async ({ serial, calibreLabel, count, weightKgEach }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      const { data: calibre, error: calErr } = await w.supabase.from('calibres').select('id, code').eq('label', calibreLabel).single()
      if (calErr) throw new Error(`calibre lookup: ${calErr.message}`)
      const { data: type, error: typeErr } = await w.supabase.from('kirim_lines').select('type_id').eq('serial', serial).single()
      if (typeErr) throw new Error(`type lookup for seeded line: ${typeErr.message}`)
      const { data: cycle, error: cycleErr } = await w.supabase
        .from('wash_cycles')
        .insert({ serial, cycle_no: 1, status: 'final', final_loss_pct: 0 })
        .select('id')
        .single()
      if (cycleErr) throw new Error(`wash_cycles insert: ${cycleErr.message}`)
      const receivedDate = new Date().toISOString().slice(0, 10)
      const rows = Array.from({ length: count }, (_, i) => ({
        barcode2: `PLT-${serial}-${calibre.code}-${i + 1}`,
        serial,
        wash_cycle: 1,
        type_id: type.type_id,
        calibre_id: calibre.id,
        weight_kg: weightKgEach,
        received_date: receivedDate,
      }))
      const { error: palletErr } = await w.supabase.from('finished_pallets').insert(rows)
      if (palletErr) throw new Error(`finished_pallets insert: ${palletErr.message}`)
      return { washCycleId: cycle.id as string, calibreCode: calibre.code as string }
    },
    { serial, calibreLabel, count, weightKgEach },
  )

  await switchRole(page, 'LABORATOR')
  await page.evaluate(
    async ({ serial, washCycleId }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any }; supabase_auth?: unknown }
      const {
        data: { user },
      } = await w.supabase.auth.getUser()
      const { error } = await w.supabase.from('lab_results').insert({
        scope: 'chiqim',
        parent_serial: serial,
        wash_cycle_id: washCycleId,
        sample_date: new Date().toISOString().slice(0, 10),
        moisture_pct: 8,
        verdict: 'o_tdi',
        status: 'complete',
        tested_by: user.id,
      })
      if (error) throw new Error(`lab_results insert: ${error.message}`)
    },
    { serial, washCycleId },
  )

  // Log out, leaving the page at /login — the caller starts its own real
  // flow with its own loginAs from a clean slate.
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')

  const pallets: SeededPallet[] = Array.from({ length: count }, (_, i) => ({
    barcode2: `PLT-${serial}-${calibreCode}-${i + 1}`,
    weightKg: weightKgEach,
  }))
  return { serial, pallets, kirimPlate: seedPlate }
}

// The negative-case fixture (originally written for menejer-chiqim-
// finished-view.spec.ts, now folded into full-chain.spec.ts): a
// chiqim_request that WOULD appear in the finished view (status
// 'olib_ketildi', so a naive query returns it) if the view's own
// TEST-prefix filter didn't specifically exclude it. Inserted directly as
// Menejer — chiqim_requests' own RLS `with check` only constrains the
// inserting role, not the status value, so a menejer can legitimately
// write a row already in its terminal state (no gate/Ombor chain needed
// purely to prove a display-layer filter). Page is left logged in as
// Menejer (matches what the caller needs next).
export async function seedFilteredFinishedRequest(page: Page): Promise<{ plate: string }> {
  const plate = uniqueTestId('FILTERED')
  await switchRole(page, 'MENEJER')
  await page.evaluate(async ({ plate, ownerName }) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data: owner, error: ownerErr } = await w.supabase.from('owners').select('id').eq('name', ownerName).single()
    if (ownerErr) throw new Error(`owner lookup: ${ownerErr.message}`)
    const { error } = await w.supabase.from('chiqim_requests').insert({
      request_date: new Date().toISOString().slice(0, 10),
      plate,
      driver: 'TEST Driver',
      owner_id: owner.id,
      status: 'olib_ketildi',
    })
    if (error) throw new Error(`chiqim_requests insert: ${error.message}`)
  }, { plate, ownerName: E2E_OWNER_NAME })
  return { plate }
}
