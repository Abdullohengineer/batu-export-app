import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Self-cleaning e2e teardown — Node-side ONLY. Every table this suite
// writes to (kirim_orders/kirim_lines/storage_intake/moyka_sends/
// wash_cycles/finished_pallets/lab_results/chiqim_requests/chiqim_lines/
// gate_weighings) has ZERO delete policies for any authenticated role, by
// design — SPEC.md §2.15 "never delete, only void" is enforced at the RLS
// level for operational data, not just a convention. (dispatch_manifest is
// the one exception: `ombor_deletes`, scoped to pre-gate-stage-2 status —
// exactly what chiqim-undo-scan.spec.ts's own RLS-refusal assertion tests.)
// The one precedent for bulk test-data removal in this project's history
// (DECISIONS.md "Reporting engine cleanup", the 96-row TEST- CHIQIM
// deletion) was executed the same way this file does it: elevated,
// RLS-bypassing access, never the app's own browser-facing client.
//
// 🔒 SUPABASE_SERVICE_ROLE_KEY lives ONLY in this file's own Node-process
// scope (read via `.env.test`, loaded by playwright.config.ts's own
// `process.loadEnvFile`). It is NEVER passed into `page.evaluate()` (which
// executes in the browser and would expose it to the page/network tab) and
// NEVER imported anywhere under `src/`. This client talks to Supabase
// directly from the Playwright test process — it has no relationship to
// `window.supabase` (the app's own anon-key, RLS-constrained client every
// spec still uses for everything except teardown).
let cachedClient: SupabaseClient | null = null

function serviceClient(): SupabaseClient {
  if (cachedClient) return cachedClient
  const url = process.env.SUPABASE_URL ?? 'https://qohoqbapevrcjqxbstxi.supabase.co'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY — add it to .env.test (Supabase dashboard → Settings → API → service_role). ' +
        'Self-cleaning teardown cannot run without it; see tests/e2e/helpers/teardown.ts.',
    )
  }
  cachedClient = createClient(url, key, { auth: { persistSession: false } })
  return cachedClient
}

export interface TeardownScope {
  /** kirim_orders.plate values this test created (its whole KIRIM-side chain is resolved and deleted from these). */
  kirimPlates?: string[]
  /** chiqim_requests.plate values this test created (its whole CHIQIM-side chain is resolved and deleted from these). */
  chiqimPlates?: string[]
}

// Dependency order verified directly against pg's actual FK graph (queried
// live via information_schema — see DECISIONS.md "e2e suite consolidation
// verification"), NOT assumed from the task's own prose description, which
// turned out to place lab_results after wash_cycles: a real bug, since
// lab_results.wash_cycle_id -> wash_cycles.id means lab_results must be
// deleted FIRST or the wash_cycles delete fails its own FK check. Real order:
// chiqim_pallet_consumption -> dispatch_manifest -> chiqim_lines ->
// gate_weighings -> chiqim_requests -> lab_results -> finished_pallets ->
// wash_cycles -> moyka_sends -> storage_intake -> kirim_lines ->
// kirim_orders. gate_weighings carries BOTH a CHIQIM-side shape (request_id
// set) and a KIRIM-side shape (order_id set) — mutually exclusive by a DB
// check constraint (see DECISIONS.md "-2,200kg failure diagnosed") — both
// are cleared at this one step since each must precede its own parent
// (chiqim_requests / kirim_orders respectively). dispatch_manifest and
// chiqim_pallet_consumption both also FK to finished_pallets.barcode2, not
// just chiqim_requests.id/chiqim_lines.id — harmless here since both are
// deleted before finished_pallets is ever touched.
//
// §5.4 FIFO dispatch (2026-08-28, see DECISIONS.md "CHIQIM quantity-based
// dispatch: FIFO cascade, consumption table"): dispatch_manifest is no
// longer written to by the app (kept as a historical, permanently-empty-
// for-new-rows table, same "keep table, stop writing" precedent as
// wash_cycles/0086) — its own delete step below is now a defensive no-op,
// kept rather than removed since it's harmless and a stray direct insert
// would still need cleaning up. chiqim_pallet_consumption is the real
// FIFO-attribution table now and needs its own delete step, resolved via
// chiqim_lines.id (it FKs to chiqim_line_id, not request_id directly) —
// added FIRST, since it must precede both dispatch_manifest's FK to
// finished_pallets and chiqim_lines' own delete.
//
// `owners` is deliberately never touched here — every survivor spec
// references an EXISTING real owner (never "Test Client A", which no
// longer exists post-clean-room-reset) rather than creating one, so there
// is never an owner row for this function to delete. Master data is
// deactivate-only now (§3.3) and has no DELETE policy for any role either
// — "owners if created" in the task's own teardown order never applies
// here by construction, not by omission.
//
// 🔒 Every delete below checks `error` and throws on failure. The first
// version of this file didn't, which let a real FK-order bug (the
// lab_results/wash_cycles swap above) run silently across three full test
// runs: `.delete()` on a blocked/failed row returns `{ error }`, not a
// thrown exception, so an unchecked call looks exactly like success. Caught
// only by directly querying the DB afterward and finding orphaned rows —
// see DECISIONS.md. Throwing here surfaces the same failure immediately, in
// the test's own afterEach, instead of leaving debris to be found later.
async function del(db: SupabaseClient, table: string, column: string, values: string[], label: string): Promise<void> {
  if (values.length === 0) return
  const { error } = await db.from(table).delete().in(column, values)
  if (error) throw new Error(`teardown: ${table} delete failed (${label}): ${error.message}`)
}

export async function teardownFixtures(scope: TeardownScope): Promise<void> {
  const db = serviceClient()
  const kirimPlates = scope.kirimPlates ?? []
  const chiqimPlates = scope.chiqimPlates ?? []

  let orderIds: string[] = []
  let serials: string[] = []
  if (kirimPlates.length > 0) {
    const { data: orders, error: ordersErr } = await db.from('kirim_orders').select('order_id').in('plate', kirimPlates)
    if (ordersErr) throw new Error(`teardown: kirim_orders lookup failed: ${ordersErr.message}`)
    orderIds = (orders ?? []).map((o) => o.order_id as string)
    if (orderIds.length > 0) {
      const { data: lines, error: linesErr } = await db.from('kirim_lines').select('serial').in('order_id', orderIds)
      if (linesErr) throw new Error(`teardown: kirim_lines lookup failed: ${linesErr.message}`)
      serials = (lines ?? []).map((l) => l.serial as string)
    }
  }

  let requestIds: string[] = []
  let chiqimLineIds: string[] = []
  if (chiqimPlates.length > 0) {
    const { data: requests, error: requestsErr } = await db.from('chiqim_requests').select('id').in('plate', chiqimPlates)
    if (requestsErr) throw new Error(`teardown: chiqim_requests lookup failed: ${requestsErr.message}`)
    requestIds = (requests ?? []).map((r) => r.id as string)
    if (requestIds.length > 0) {
      const { data: lines, error: linesErr } = await db.from('chiqim_lines').select('id').in('request_id', requestIds)
      if (linesErr) throw new Error(`teardown: chiqim_lines lookup failed: ${linesErr.message}`)
      chiqimLineIds = (lines ?? []).map((l) => l.id as string)
    }
  }

  // 1. chiqim_pallet_consumption, 2. dispatch_manifest, 3. chiqim_lines —
  // consumption references chiqim_lines directly; dispatch_manifest and
  // chiqim_lines both reference chiqim_requests
  await del(db, 'chiqim_pallet_consumption', 'chiqim_line_id', chiqimLineIds, 'chiqim')
  await del(db, 'dispatch_manifest', 'request_id', requestIds, 'chiqim')
  await del(db, 'chiqim_lines', 'request_id', requestIds, 'chiqim')
  // 4. gate_weighings — CHIQIM-side (request_id) and KIRIM-side (order_id)
  await del(db, 'gate_weighings', 'request_id', requestIds, 'chiqim')
  await del(db, 'gate_weighings', 'order_id', orderIds, 'kirim')
  // 5. chiqim_requests
  await del(db, 'chiqim_requests', 'id', requestIds, 'chiqim')
  // 6. lab_results — MUST precede wash_cycles (lab_results.wash_cycle_id -> wash_cycles.id)
  await del(db, 'lab_results', 'parent_serial', serials, 'kirim')
  // 7. finished_pallets, 8. wash_cycles, 9. moyka_sends, 10. storage_intake, 11. kirim_lines
  await del(db, 'finished_pallets', 'serial', serials, 'kirim')
  await del(db, 'wash_cycles', 'serial', serials, 'kirim')
  await del(db, 'moyka_sends', 'serial', serials, 'kirim')
  await del(db, 'storage_intake', 'serial', serials, 'kirim')
  await del(db, 'kirim_lines', 'serial', serials, 'kirim')
  // 12. kirim_orders
  await del(db, 'kirim_orders', 'order_id', orderIds, 'kirim')
}

// Partiya raqami counter resync (see docs/DECISIONS.md "Partiya raqami" —
// the counter-drift incident found during this feature's own SQL-level
// verification): partiya_counter is a live, monotonic per-type sequence
// (supabase/migrations/0093_kirim_lines_partiya_no.sql) advanced by the
// INSERT trigger itself, not something teardownFixtures' plain row deletes
// above can roll back — a spec that creates N real kirim_lines rows for a
// type permanently advances that type's counter by N, deleted rows or not.
// Left uncorrected, the NEXT real arrival of that type would jump ahead by
// the fixture count instead of continuing 1-past the last real row. Call
// this AFTER teardownFixtures for any spec whose fixtures included
// kirim_lines rows, passing the type_ids it touched — it resyncs each to
// max(partiya_no) over what's actually left in kirim_lines post-cleanup,
// the same corrective query used to fix the drift found live earlier this
// feature's own development.
export async function resyncPartiyaCounter(typeIds: string[]): Promise<void> {
  if (typeIds.length === 0) return
  const db = serviceClient()
  for (const typeId of typeIds) {
    const { data: maxRow, error: maxErr } = await db
      .from('kirim_lines')
      .select('partiya_no')
      .eq('type_id', typeId)
      .not('partiya_no', 'is', null)
      .order('partiya_no', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (maxErr) throw new Error(`resyncPartiyaCounter: max lookup failed for type ${typeId}: ${maxErr.message}`)
    const realMax = (maxRow?.partiya_no as number | undefined) ?? 0
    const { error: updateErr } = await db.from('partiya_counter').update({ last_no: realMax }).eq('type_id', typeId)
    if (updateErr) throw new Error(`resyncPartiyaCounter: update failed for type ${typeId}: ${updateErr.message}`)
  }
}
