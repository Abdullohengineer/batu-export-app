import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'

// Chiqim regrain + departure-date basis + dispatch rollup (2026-09-14, see
// docs/decisions/0188-...-chiqim-regrain-departure-date-dispatch-rollup.md).
// Read-only against real business data — no fixtures seeded, nothing to
// tear down (same carve-out as moykada-yoqotish-invariant.spec.ts). All
// hardcoded figures below are real, live-reconciled numbers taken directly
// from Postgres at the time this test was written; an append-only
// correction to this data afterward could in principle change them — same
// fragility caveat as every other real-data regression spec in this
// directory.
//
// PLT-110826-002-04-2 is the real pallet used throughout: it was consumed
// across THREE separate chiqim_requests spanning TWO months (590kg on
// 2026-08-30 via d43103ff, 10kg on 2026-08-28 via 061ac7f8, 460kg on
// 2026-09-12 via 545883f6 — totalling 1,060kg, exactly its book weight),
// which is exactly the "one pallet split across several dispatches, some in
// different months" shape the regrain exists to report correctly. No
// synthetic fixture needed — this real pallet already is that shape.

test('CHIQIM regrain: per-event integrity — report_chiqim_rows_v2 reports each consumption event at its own qty_kg, never book weight', async ({
  page,
}) => {
  await loginAs(page, 'MENEJER')
  const rows = await page.evaluate(async () => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data, error } = await w.supabase
      .from('report_chiqim_rows_v2')
      .select('request_id, qty_kg, date_basis')
      .eq('barcode2', 'PLT-110826-002-04-2')
      .order('date_basis')
    if (error) throw new Error(`report_chiqim_rows_v2 select: ${error.message}`)
    return data as { request_id: string; qty_kg: number | string; date_basis: string }[]
  })

  // Three rows, one per consumption event — the old "latest touch wins"
  // grain would have collapsed this to ONE row (the 2026-09-12 touch) at
  // the full 1,060kg book weight, silently dropping the two August events.
  expect(rows, 'expected exactly 3 rows, one per consumption event').toHaveLength(3)

  const byRequest = new Map(rows.map((r) => [r.request_id, { qty: Number(r.qty_kg), dateBasis: r.date_basis }]))
  expect(byRequest.get('061ac7f8-e3f7-4fd0-a2ba-06dbc3723683')).toEqual({ qty: 10, dateBasis: '2026-08-28' })
  expect(byRequest.get('d43103ff-9b3e-43a1-b238-82d6b7595865')).toEqual({ qty: 590, dateBasis: '2026-08-30' })
  expect(byRequest.get('545883f6-370f-477f-841e-988b8b1f6236')).toEqual({ qty: 460, dateBasis: '2026-09-12' })

  // No single row ever equals the pallet's book weight (1,060kg) — each is
  // strictly its own chiqim_pallet_consumption.qty_kg.
  for (const r of rows) expect(Number(r.qty_kg)).not.toBe(1060)

  // But the three DO sum back to book weight — no weight lost or gained by
  // the regrain, only correctly attributed across time/requests.
  const total = rows.reduce((sum, r) => sum + Number(r.qty_kg), 0)
  expect(total).toBe(1060)
})

test('CHIQIM regrain: period immutability — this pallet\'s August total is unaffected by its September event', async ({
  page,
}) => {
  await loginAs(page, 'MENEJER')
  const [augRows, sepRows] = await Promise.all([
    page.evaluate(async () => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      const { data, error } = await w.supabase
        .from('report_chiqim_rows_v2')
        .select('qty_kg')
        .eq('barcode2', 'PLT-110826-002-04-2')
        .gte('date_basis', '2026-08-01')
        .lte('date_basis', '2026-08-31')
      if (error) throw new Error(error.message)
      return data as { qty_kg: number | string }[]
    }),
    page.evaluate(async () => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      const { data, error } = await w.supabase
        .from('report_chiqim_rows_v2')
        .select('qty_kg')
        .eq('barcode2', 'PLT-110826-002-04-2')
        .gte('date_basis', '2026-09-01')
        .lte('date_basis', '2026-09-30')
      if (error) throw new Error(error.message)
      return data as { qty_kg: number | string }[]
    }),
  ])

  const augTotal = augRows.reduce((s, r) => s + Number(r.qty_kg), 0)
  const sepTotal = sepRows.reduce((s, r) => s + Number(r.qty_kg), 0)
  // 590 + 10 (both August-departed, even though 061ac7f8 wasn't entered
  // until September — see the 2026-09-14 ombor_finished_at correction).
  expect(augTotal).toBe(600)
  expect(sepTotal).toBe(460)
  expect(augTotal + sepTotal).toBe(1060)
})

test('CHIQIM regrain: additivity — August + September equals the combined range, equals the full year', async ({ page }) => {
  await loginAs(page, 'MENEJER')
  async function dispatchTotal(from: string, to: string): Promise<number> {
    return page.evaluate(
      async ({ from, to }) => {
        const w = window as unknown as { supabase: { rpc: (fn: string, args: unknown) => any } }
        const { data, error } = await w.supabase.rpc('report_dispatch_rows_v2', {
          p_kinds: null,
          p_from: from,
          p_to: to,
          p_owner_id: null,
          p_type_id: null,
          p_calibre_id: null,
          p_serial: null,
          p_barcode2: null,
          p_plate: null,
          p_driver: null,
          p_wash_cycle: null,
          p_lab_verdict: null,
          p_status: null,
          p_partiya_no: null,
        })
        if (error) throw new Error(`report_dispatch_rows_v2: ${error.message}`)
        return (data as { qty_kg: number | string }[]).reduce((s, r) => s + Number(r.qty_kg), 0)
      },
      { from, to },
    )
  }

  const [aug, sep, combined, fullYear] = await Promise.all([
    dispatchTotal('2026-08-01', '2026-08-31'),
    dispatchTotal('2026-09-01', '2026-09-30'),
    dispatchTotal('2026-08-01', '2026-09-30'),
    dispatchTotal('2026-01-01', '2026-12-31'),
  ])

  expect(aug).toBe(69151)
  expect(sep).toBe(28970)
  expect(aug + sep).toBe(combined)
  expect(combined).toBe(fullYear) // all live dispatch activity falls in Aug-Sep
})

test('CHIQIM regrain: roll-up integrity — every dispatch line\'s qty_kg equals the sum of its matching components', async ({
  page,
}) => {
  await loginAs(page, 'MENEJER')
  const { dispatchByRequest, componentSumByRequest } = await page.evaluate(async () => {
    const w = window as unknown as { supabase: { from: (t: string) => any; rpc: (fn: string, args: unknown) => any } }
    const { data: dispatch, error: dErr } = await w.supabase.rpc('report_dispatch_rows_v2', {
      p_kinds: null,
      p_from: '2026-08-01',
      p_to: '2026-09-30',
      p_owner_id: null,
      p_type_id: null,
      p_calibre_id: null,
      p_serial: null,
      p_barcode2: null,
      p_plate: null,
      p_driver: null,
      p_wash_cycle: null,
      p_lab_verdict: null,
      p_status: null,
      p_partiya_no: null,
    })
    if (dErr) throw new Error(`report_dispatch_rows_v2: ${dErr.message}`)

    const [chiqim, raw, oldKn] = await Promise.all([
      w.supabase.from('report_chiqim_rows_v2').select('request_id, qty_kg').gte('date_basis', '2026-08-01').lte('date_basis', '2026-09-30'),
      w.supabase.from('report_raw_dispatch_rows_v2').select('request_id, qty_kg').gte('date_basis', '2026-08-01').lte('date_basis', '2026-09-30'),
      w.supabase.from('report_old_kn_rows_v2').select('request_id, qty_kg').gte('date_basis', '2026-08-01').lte('date_basis', '2026-09-30'),
    ])
    if (chiqim.error) throw new Error(chiqim.error.message)
    if (raw.error) throw new Error(raw.error.message)
    if (oldKn.error) throw new Error(oldKn.error.message)

    const componentSumByRequest: Record<string, number> = {}
    for (const row of [...chiqim.data, ...raw.data, ...oldKn.data] as { request_id: string; qty_kg: number | string }[]) {
      componentSumByRequest[row.request_id] = (componentSumByRequest[row.request_id] ?? 0) + Number(row.qty_kg)
    }
    const dispatchByRequest: Record<string, number> = {}
    for (const row of dispatch as { request_id: string; qty_kg: number | string }[]) {
      dispatchByRequest[row.request_id] = Number(row.qty_kg)
    }
    return { dispatchByRequest, componentSumByRequest }
  })

  const requestIds = Object.keys(dispatchByRequest)
  expect(requestIds.length, 'expected at least one dispatch line in Aug-Sep').toBeGreaterThan(0)
  for (const requestId of requestIds) {
    expect(
      dispatchByRequest[requestId],
      `request ${requestId}: dispatch line qty_kg should equal the sum of its own matching components`,
    ).toBe(componentSumByRequest[requestId])
  }
})
