import { test, expect, type Page } from '@playwright/test'
import { loginAs, type TestRole } from './helpers/login'
import { uniqueRealLookingPlate, E2E_OWNER_NAME } from './helpers/fixtures'
import { teardownFixtures } from './helpers/teardown'
import { deriveEffectiveQty } from '../../src/lib/weightAuthority'

// Survivor 4/4: `effective_qty` parity — the drift guard. effective_qty now
// has TWO independent implementations — weightAuthority.ts (TypeScript,
// read by Ombor/Moyka's live screens, which can't practically query
// Postgres for a derived value on every keystroke) and report_kirim_rows
// (SQL, the reporting engine — moved server-side so filtering/pagination/
// totals don't require re-fetching and re-deriving every row client-side,
// see DECISIONS.md "Reporting engine: server-side query"). Two
// implementations of the same "one derived truth" invariant is a real drift
// risk — CLAUDE.md's "derive, don't store" assumes exactly one place
// computes a given derived value. This test is what keeps the two honest:
// it seeds the same raw inputs directly (bypassing the UI on purpose — the
// UI-wiring risk this deliberately skips is covered by unit tests on the
// derivation logic itself, weightAuthority.test.ts, kept in the 79) and
// asserts weightAuthority.ts's pure function and report_kirim_rows agree on
// every branch. If either side changes without the other, this fails loudly
// instead of the two silently disagreeing in production.
//
// Not TEST--prefixed on purpose: report_kirim_rows excludes any TEST- plate
// (isTestPlate, ported from reportQuery.ts into the view's own WHERE
// clause) — uniqueRealLookingPlate() is the established exception for
// exactly this case.
//
// §2.16 box mass (2026-07-28, KIRIM only): box_mass_kg is now mandatory on
// storage_intake, so every accepted line in every scenario below seeds one.
// Scenario F is new — the one branch that didn't exist before box mass: a
// multi-line truck where gate stage 2 completes before every line has been
// accepted, so an already-accepted line must show provisional/pending on
// box mass specifically, not on gate. `pendingOn` itself (which of the two
// inputs is missing) isn't asserted here — report_kirim_rows doesn't expose
// that granularity, only `qty_kg`/`provisional`, so there's nothing on the
// SQL side for it to drift against; the pendingOn combinations are unit
// tested directly in weightAuthority.test.ts instead.

async function switchRole(page: Page, role: TestRole): Promise<void> {
  // 🔒 See the identical fix + full explanation in helpers/fixtures.ts's
  // own switchRole — a bare `.count()` right after a prior switchRole's
  // `waitForURL` resolves can race React's own post-navigation render,
  // silently skipping the logout and leaving the OLD role's session fully
  // valid. `.waitFor()` actually waits, bounded so a genuinely-fresh page
  // still returns promptly. Root-caused via trace inspection, DECISIONS.md.
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

interface KirimLineFixture {
  serial?: string
  declaredQty: number
  intakeActualQty: number | null
  // §2.16 box mass: only inserted when intakeActualQty !== null (mandatory
  // at accept time, so a not-yet-accepted line has none to seed either).
  boxMassKg?: number
}

interface OrderFixture {
  plate: string
  lines: KirimLineFixture[]
  gate: { gruzhenyKg: number; pustoyKg: number; completed: boolean } | null
}

async function seedOrder(page: Page, fixture: OrderFixture): Promise<string[]> {
  await switchRole(page, 'MENEJER')
  const { orderId } = await page.evaluate(
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
          declared_total: 1,
        })
        .select('order_id')
        .single()
      if (orderErr) throw new Error(`kirim_orders insert: ${orderErr.message}`)
      return { orderId: order.order_id as string, ownerId: owner.id as string, typeId: type.id as string }
    },
    { plate: fixture.plate, ownerName: E2E_OWNER_NAME },
  )

  const serials: string[] = []
  for (const line of fixture.lines) {
    const serial = await page.evaluate(
      async ({ orderId, declaredQty }) => {
        const w = window as unknown as { supabase: { from: (t: string) => any } }
        const { data: type } = await w.supabase.from('product_types').select('id').eq('name', 'Subxon').single()
        const { data: row, error } = await w.supabase
          .from('kirim_lines')
          .insert({ order_id: orderId, type_id: type.id, declared_qty: declaredQty })
          .select('serial')
          .single()
        if (error) throw new Error(`kirim_lines insert: ${error.message}`)
        return row.serial as string
      },
      { orderId, declaredQty: line.declaredQty },
    )
    serials.push(serial)
  }

  await switchRole(page, 'OMBOR')
  for (let i = 0; i < fixture.lines.length; i++) {
    const intake = fixture.lines[i].intakeActualQty
    if (intake === null) continue
    const boxMass = fixture.lines[i].boxMassKg ?? 0
    await page.evaluate(
      async ({ serial, intake, boxMass }) => {
        const w = window as unknown as { supabase: { from: (t: string) => any } }
        const {
          data: { user },
        } = await w.supabase.auth.getUser()
        const { error } = await w.supabase
          .from('storage_intake')
          .insert({ serial, actual_qty: intake, box_mass_kg: boxMass, confirmed_by: user.id })
        if (error) throw new Error(`storage_intake insert: ${error.message}`)
      },
      { serial: serials[i], intake, boxMass },
    )
  }

  if (fixture.gate) {
    await switchRole(page, 'QOROVUL')
    await page.evaluate(
      async ({ orderId, gruzhenyKg, pustoyKg, completed }) => {
        const w = window as unknown as { supabase: { from: (t: string) => any } }
        const {
          data: { user },
        } = await w.supabase.auth.getUser()
        const now = new Date().toISOString()
        const { error } = await w.supabase.from('gate_weighings').insert({
          dir: 'kirim',
          order_id: orderId,
          gruzheny_kg: gruzhenyKg,
          pustoy_kg: pustoyKg,
          stage1_created_by: user.id,
          stage1_completed_at: now,
          ...(completed ? { stage2_created_by: user.id, completed_at: now } : {}),
        })
        if (error) throw new Error(`gate_weighings insert: ${error.message}`)
      },
      { orderId, gruzhenyKg: fixture.gate.gruzhenyKg, pustoyKg: fixture.gate.pustoyKg, completed: fixture.gate.completed },
    )
  }

  return serials
}

let kirimPlates: string[] = []

test.afterEach(async () => {
  await teardownFixtures({ kirimPlates })
  kirimPlates = []
})

test('report_kirim_rows agrees with deriveEffectiveQty on every branch', async ({ page }) => {
  test.setTimeout(150_000)

  // --- Scenario A: declared_pre_intake — no storage_intake row at all ---
  const plateA = uniqueRealLookingPlate()
  kirimPlates.push(plateA)
  const [serialA] = await seedOrder(page, {
    plate: plateA,
    lines: [{ declaredQty: 1000, intakeActualQty: null }],
    gate: null,
  })

  // --- Scenario B: intake_provisional, single-line, pending on gate only —
  // intake (+ its now-mandatory box mass) exists, gate stage 2 not done
  // (stage1 only). Single-line: box mass is always known the instant intake
  // exists (same accept-time form), so this line can never be "pending on
  // box mass" — only "pending on gate" is reachable here. ---
  const plateB = uniqueRealLookingPlate()
  kirimPlates.push(plateB)
  const [serialB] = await seedOrder(page, {
    plate: plateB,
    lines: [{ declaredQty: 2000, intakeActualQty: 1900, boxMassKg: 50 }],
    gate: { gruzhenyKg: 2900, pustoyKg: 900, completed: false },
  })

  // --- Scenario C: intake_provisional, multi-line, pending on gate only —
  // BOTH lines accepted (so the order's total box mass IS fully known),
  // only gate stage 2 is still missing. ---
  const plateC = uniqueRealLookingPlate()
  kirimPlates.push(plateC)
  const [serialC1, serialC2] = await seedOrder(page, {
    plate: plateC,
    lines: [
      { declaredQty: 500, intakeActualQty: 480, boxMassKg: 15 },
      { declaredQty: 500, intakeActualQty: 510, boxMassKg: 10 },
    ],
    gate: { gruzhenyKg: 2000, pustoyKg: 990, completed: false },
  })

  // --- Scenario D: intake_multi_line_final — gate stage 2 AND box mass
  // (both lines accepted) are both known, but a multi-line truck's
  // effective_qty stays each line's OWN intake, never true net (§2.16.1's
  // own headline rule) — proves box mass doesn't leak into per-line values
  // even once it's fully known. ---
  const plateD = uniqueRealLookingPlate()
  kirimPlates.push(plateD)
  const [serialD1, serialD2] = await seedOrder(page, {
    plate: plateD,
    lines: [
      { declaredQty: 700, intakeActualQty: 690, boxMassKg: 30 },
      { declaredQty: 700, intakeActualQty: 705, boxMassKg: 20 },
    ],
    gate: { gruzhenyKg: 2450, pustoyKg: 1000, completed: true }, // net_kg = 1450
  })

  // --- Scenario E: gate_net_final — single-line, gate stage 2 + box mass
  // both known, true net (gate net − box mass) becomes the effective_qty.
  // Box mass is nonzero specifically so this test would fail if the
  // subtraction were ever dropped (a zero box mass couldn't catch that). ---
  const plateE = uniqueRealLookingPlate()
  kirimPlates.push(plateE)
  const [serialE] = await seedOrder(page, {
    plate: plateE,
    lines: [{ declaredQty: 3000, intakeActualQty: 2900, boxMassKg: 50 }],
    gate: { gruzhenyKg: 4100, pustoyKg: 1000, completed: true }, // net_kg = 3100, true net = 3050
  })

  // --- Scenario F: intake_provisional, multi-line, pending on box mass
  // only — gate stage 2 is DONE (arrived first, the atypical ordering §2.16
  // calls out explicitly), but only ONE of two lines has been accepted, so
  // the order's total box mass isn't complete yet. F1 (accepted) must show
  // provisional/pending-on-box-mass even though ITS OWN box mass is known —
  // the truck-level sum is what's incomplete. F2 (never accepted) stays
  // declared_pre_intake regardless of gate/box-mass state, unaffected. ---
  const plateF = uniqueRealLookingPlate()
  kirimPlates.push(plateF)
  const [serialF1, serialF2] = await seedOrder(page, {
    plate: plateF,
    lines: [
      { declaredQty: 800, intakeActualQty: 780, boxMassKg: 25 },
      { declaredQty: 800, intakeActualQty: null },
    ],
    gate: { gruzhenyKg: 3000, pustoyKg: 1000, completed: true }, // net_kg = 2000
  })

  // --- Read back report_kirim_rows for every seeded serial (Menejer/Rahbar
  // are the only roles that read this view in production) ---
  await switchRole(page, 'MENEJER')
  const allSerials = [serialA, serialB, serialC1, serialC2, serialD1, serialD2, serialE, serialF1, serialF2]
  const dbRows = await page.evaluate(async (serials) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data, error } = await w.supabase.from('report_kirim_rows').select('serial, qty_kg, provisional').in('serial', serials)
    if (error) throw new Error(`report_kirim_rows select: ${error.message}`)
    return data as { serial: string; qty_kg: number | string; provisional: boolean }[]
  }, allSerials)
  const dbBySerial = new Map(dbRows.map((r) => [r.serial, { qty: Number(r.qty_kg), provisional: r.provisional }]))

  function expectAgreement(serial: string, ts: { value: number; provisional: boolean }, label: string) {
    const db = dbBySerial.get(serial)
    expect(db, `${label}: report_kirim_rows returned no row for serial ${serial}`).toBeTruthy()
    expect(db?.qty, `${label}: qty_kg mismatch (SQL ${db?.qty} vs TS ${ts.value})`).toBe(ts.value)
    expect(db?.provisional, `${label}: provisional mismatch (SQL ${db?.provisional} vs TS ${ts.provisional})`).toBe(ts.provisional)
  }

  expectAgreement(
    serialA,
    deriveEffectiveQty({
      declaredQty: 1000,
      intakeActualQty: null,
      isMultiLine: false,
      gateNet: null,
      gateStage2Done: false,
      totalBoxMassKg: null,
    }),
    'A declared_pre_intake',
  )
  expectAgreement(
    serialB,
    deriveEffectiveQty({
      declaredQty: 2000,
      intakeActualQty: 1900,
      isMultiLine: false,
      gateNet: null,
      gateStage2Done: false,
      totalBoxMassKg: 50,
    }),
    'B intake_provisional (single-line, pending on gate)',
  )
  expectAgreement(
    serialC1,
    deriveEffectiveQty({
      declaredQty: 500,
      intakeActualQty: 480,
      isMultiLine: true,
      gateNet: null,
      gateStage2Done: false,
      totalBoxMassKg: 25,
    }),
    'C1 intake_provisional (multi-line, pending on gate)',
  )
  expectAgreement(
    serialC2,
    deriveEffectiveQty({
      declaredQty: 500,
      intakeActualQty: 510,
      isMultiLine: true,
      gateNet: null,
      gateStage2Done: false,
      totalBoxMassKg: 25,
    }),
    'C2 intake_provisional (multi-line, pending on gate)',
  )
  expectAgreement(
    serialD1,
    deriveEffectiveQty({
      declaredQty: 700,
      intakeActualQty: 690,
      isMultiLine: true,
      gateNet: 1450,
      gateStage2Done: true,
      totalBoxMassKg: 50,
    }),
    'D1 intake_multi_line_final',
  )
  expectAgreement(
    serialD2,
    deriveEffectiveQty({
      declaredQty: 700,
      intakeActualQty: 705,
      isMultiLine: true,
      gateNet: 1450,
      gateStage2Done: true,
      totalBoxMassKg: 50,
    }),
    'D2 intake_multi_line_final',
  )
  expectAgreement(
    serialE,
    deriveEffectiveQty({
      declaredQty: 3000,
      intakeActualQty: 2900,
      isMultiLine: false,
      gateNet: 3100,
      gateStage2Done: true,
      totalBoxMassKg: 50,
    }),
    'E gate_net_final (true net = gate net minus box mass)',
  )
  expectAgreement(
    serialF1,
    deriveEffectiveQty({
      declaredQty: 800,
      intakeActualQty: 780,
      isMultiLine: true,
      gateNet: 2000,
      gateStage2Done: true,
      totalBoxMassKg: null, // sibling line F2 not accepted -> order total incomplete
    }),
    'F1 intake_provisional (multi-line, pending on box mass — gate arrived first)',
  )
  expectAgreement(
    serialF2,
    deriveEffectiveQty({
      declaredQty: 800,
      intakeActualQty: null,
      isMultiLine: true,
      gateNet: 2000,
      gateStage2Done: true,
      totalBoxMassKg: null,
    }),
    'F2 declared_pre_intake (unaffected by sibling/gate/box-mass state)',
  )
})
