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
    await page.evaluate(
      async ({ serial, intake }) => {
        const w = window as unknown as { supabase: { from: (t: string) => any } }
        const {
          data: { user },
        } = await w.supabase.auth.getUser()
        const { error } = await w.supabase.from('storage_intake').insert({ serial, actual_qty: intake, confirmed_by: user.id })
        if (error) throw new Error(`storage_intake insert: ${error.message}`)
      },
      { serial: serials[i], intake },
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

  // --- Scenario B: intake_provisional, single-line — intake exists, gate
  // stage 2 not done (stage1 only) ---
  const plateB = uniqueRealLookingPlate()
  kirimPlates.push(plateB)
  const [serialB] = await seedOrder(page, {
    plate: plateB,
    lines: [{ declaredQty: 2000, intakeActualQty: 1900 }],
    gate: { gruzhenyKg: 2900, pustoyKg: 900, completed: false },
  })

  // --- Scenario C: intake_provisional, multi-line — same "not yet gate
  // stage 2" branch applies before the single/multi split is even reached ---
  const plateC = uniqueRealLookingPlate()
  kirimPlates.push(plateC)
  const [serialC1, serialC2] = await seedOrder(page, {
    plate: plateC,
    lines: [
      { declaredQty: 500, intakeActualQty: 480 },
      { declaredQty: 500, intakeActualQty: 510 },
    ],
    gate: { gruzhenyKg: 2000, pustoyKg: 990, completed: false },
  })

  // --- Scenario D: intake_multi_line_final — gate stage 2 done, but a
  // multi-line truck's effective_qty stays each line's OWN intake, never
  // the gate net (§2.16.1's own headline rule) ---
  const plateD = uniqueRealLookingPlate()
  kirimPlates.push(plateD)
  const [serialD1, serialD2] = await seedOrder(page, {
    plate: plateD,
    lines: [
      { declaredQty: 700, intakeActualQty: 690 },
      { declaredQty: 700, intakeActualQty: 705 },
    ],
    gate: { gruzhenyKg: 2450, pustoyKg: 1000, completed: true }, // net_kg = 1450
  })

  // --- Scenario E: gate_net_final — single-line, gate stage 2 done, the
  // gate net becomes the effective_qty ---
  const plateE = uniqueRealLookingPlate()
  kirimPlates.push(plateE)
  const [serialE] = await seedOrder(page, {
    plate: plateE,
    lines: [{ declaredQty: 3000, intakeActualQty: 2900 }],
    gate: { gruzhenyKg: 4100, pustoyKg: 1000, completed: true }, // net_kg = 3100
  })

  // --- Read back report_kirim_rows for every seeded serial (Menejer/Rahbar
  // are the only roles that read this view in production) ---
  await switchRole(page, 'MENEJER')
  const allSerials = [serialA, serialB, serialC1, serialC2, serialD1, serialD2, serialE]
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
    deriveEffectiveQty({ declaredQty: 1000, intakeActualQty: null, isMultiLine: false, gateNet: null, gateStage2Done: false }),
    'A declared_pre_intake',
  )
  expectAgreement(
    serialB,
    deriveEffectiveQty({ declaredQty: 2000, intakeActualQty: 1900, isMultiLine: false, gateNet: null, gateStage2Done: false }),
    'B intake_provisional (single-line)',
  )
  expectAgreement(
    serialC1,
    deriveEffectiveQty({ declaredQty: 500, intakeActualQty: 480, isMultiLine: true, gateNet: null, gateStage2Done: false }),
    'C1 intake_provisional (multi-line)',
  )
  expectAgreement(
    serialC2,
    deriveEffectiveQty({ declaredQty: 500, intakeActualQty: 510, isMultiLine: true, gateNet: null, gateStage2Done: false }),
    'C2 intake_provisional (multi-line)',
  )
  expectAgreement(
    serialD1,
    deriveEffectiveQty({ declaredQty: 700, intakeActualQty: 690, isMultiLine: true, gateNet: 1450, gateStage2Done: true }),
    'D1 intake_multi_line_final',
  )
  expectAgreement(
    serialD2,
    deriveEffectiveQty({ declaredQty: 700, intakeActualQty: 705, isMultiLine: true, gateNet: 1450, gateStage2Done: true }),
    'D2 intake_multi_line_final',
  )
  expectAgreement(
    serialE,
    deriveEffectiveQty({ declaredQty: 3000, intakeActualQty: 2900, isMultiLine: false, gateNet: 3100, gateStage2Done: true }),
    'E gate_net_final',
  )
})
