import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'
import { uniqueTestId, E2E_OWNER_NAME } from './helpers/fixtures'
import { teardownFixtures, resyncPartiyaCounter } from './helpers/teardown'

// Partiya raqami (per-type arrival batch number) — SPEC.md new subsection,
// see docs/DECISIONS.md "Partiya raqami" for the full feature writeup.
//
// Scenario is the task's own literal spec: three arrivals in sequence --
// Subxon-only, then a Subxon+Isfara mixed truck, then Isfara-only --
// proving each type gets its OWN sequential counter (a mixed truck splits
// its lines into separate per-type sequences, never a shared one).
//
// Numbers are asserted RELATIVE to a captured baseline, not literal 1/2:
// this project's live data already has real Subxon/Isfara arrivals, so a
// fresh TEST- run continues the real sequence rather than resetting it —
// literal 1/2 would only hold on an empty database, which this one isn't.
//
// 🔒 Counter drift (see docs/DECISIONS.md "Partiya raqami" — the same
// incident found live during this feature's own SQL-level verification):
// partiya_counter is a monotonic per-type sequence advanced by the INSERT
// trigger itself, not something teardownFixtures' row deletes roll back.
// resyncPartiyaCounter (helpers/teardown.ts) MUST run after every test here
// that creates kirim_lines, or the next real arrival of that type jumps
// ahead by however many fixture rows this suite created.

let kirimPlates: string[] = []
let touchedTypeIds: string[] = []

test.afterEach(async () => {
  await teardownFixtures({ kirimPlates })
  await resyncPartiyaCounter(touchedTypeIds)
  kirimPlates = []
  touchedTypeIds = []
})

test('Partiya raqami: per-type sequential numbering across three arrivals, badge visible in Laborator queue', async ({ page }) => {
  test.setTimeout(120_000)

  const PLATE_A = uniqueTestId('PARTIYA-A') // Subxon-only
  const PLATE_B = uniqueTestId('PARTIYA-B') // Subxon + Isfara, one truck
  const PLATE_C = uniqueTestId('PARTIYA-C') // Isfara-only
  kirimPlates.push(PLATE_A, PLATE_B, PLATE_C)

  await loginAs(page, 'MENEJER')

  // Resolve type_ids + capture each type's own baseline (max partiya_no
  // already assigned from real data) before creating anything — the
  // numbers this test asserts are baseline+1/baseline+2 per type, not 1/2.
  const baseline = await page.evaluate(async () => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data: types, error: typesErr } = await w.supabase
      .from('product_types')
      .select('id, name')
      .in('name', ['Subxon', 'Isfara'])
    if (typesErr) throw new Error(`type lookup: ${typesErr.message}`)
    const subxon = (types as { id: string; name: string }[]).find((t) => t.name === 'Subxon')!.id
    const isfara = (types as { id: string; name: string }[]).find((t) => t.name === 'Isfara')!.id
    async function maxPartiya(typeId: string): Promise<number> {
      const { data, error } = await w.supabase
        .from('kirim_lines')
        .select('partiya_no')
        .eq('type_id', typeId)
        .not('partiya_no', 'is', null)
        .order('partiya_no', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(`max partiya lookup: ${error.message}`)
      return (data?.partiya_no as number | undefined) ?? 0
    }
    return {
      subxonTypeId: subxon,
      isfaraTypeId: isfara,
      subxonBaseline: await maxPartiya(subxon),
      isfaraBaseline: await maxPartiya(isfara),
    }
  })
  touchedTypeIds = [baseline.subxonTypeId, baseline.isfaraTypeId]

  async function createOrder(plate: string, lines: { type: string; qty: string }[]): Promise<string[]> {
    await page.goto('/menejer')
    await expect(page.getByRole('heading', { name: 'Yangi KIRIM' })).toBeVisible()
    await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(plate)
    await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
    await page.locator('div:has(> label:text-is("Buyurtmachi")) select').selectOption({ label: E2E_OWNER_NAME })
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) await page.getByRole('button', { name: "+ Tur qo'shish" }).click()
      const row = page.locator('form div.space-y-1.rounded-md').nth(i)
      await row.locator('select').selectOption({ label: lines[i].type })
      await row.getByPlaceholder('Miqdori (kg)').fill(lines[i].qty)
    }
    await page.getByRole('button', { name: 'Saqlash' }).click()
    const savedPanel = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: lines[0].type })
    await expect(savedPanel.locator('span.font-mono')).toHaveCount(lines.length, { timeout: 10_000 })
    return savedPanel.locator('span.font-mono').allTextContents()
  }

  const [subxonA] = await createOrder(PLATE_A, [{ type: 'Subxon', qty: '1000' }])
  const [subxonB, isfaraB] = await createOrder(PLATE_B, [
    { type: 'Subxon', qty: '1000' },
    { type: 'Isfara', qty: '500' },
  ])
  const [isfaraC] = await createOrder(PLATE_C, [{ type: 'Isfara', qty: '500' }])

  const readback = await page.evaluate(async (serials: string[]) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data, error } = await w.supabase.from('kirim_lines').select('serial, partiya_no').in('serial', serials)
    if (error) throw new Error(`readback: ${error.message}`)
    return data as { serial: string; partiya_no: number | null }[]
  }, [subxonA, subxonB, isfaraB, isfaraC])
  const partiyaBySerial = new Map(readback.map((r) => [r.serial, r.partiya_no]))

  // Each type gets its own sequential numbers, in arrival order — a mixed
  // truck's two lines land in each type's OWN sequence, not a shared one
  // (Subxon B is #2 in Subxon's sequence even though it arrived on the
  // same truck as Isfara B, which is #1 in Isfara's own sequence).
  expect(partiyaBySerial.get(subxonA)).toBe(baseline.subxonBaseline + 1)
  expect(partiyaBySerial.get(subxonB)).toBe(baseline.subxonBaseline + 2)
  expect(partiyaBySerial.get(isfaraB)).toBe(baseline.isfaraBaseline + 1)
  expect(partiyaBySerial.get(isfaraC)).toBe(baseline.isfaraBaseline + 2)

  // UI check: Laborator's KIRIM awaiting queue renders the same numbers
  // next to each serial — proves the frontend wiring end-to-end, not just
  // the trigger/backfill logic already verified at the SQL layer.
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'LABORATOR')

  async function cardFor(serial: string) {
    return page.locator('div', { has: page.locator(`span.font-mono:text-is("${serial}")`) }).first()
  }
  await expect((await cardFor(subxonA)).getByText(`P${baseline.subxonBaseline + 1}`, { exact: true })).toBeVisible()
  await expect((await cardFor(subxonB)).getByText(`P${baseline.subxonBaseline + 2}`, { exact: true })).toBeVisible()
  await expect((await cardFor(isfaraB)).getByText(`P${baseline.isfaraBaseline + 1}`, { exact: true })).toBeVisible()
  await expect((await cardFor(isfaraC)).getByText(`P${baseline.isfaraBaseline + 2}`, { exact: true })).toBeVisible()
})

// Origin filtering (CLAUDE.md "Origin filtering"): opening_stock/
// internal_reprocess rows never get a number -- they didn't arrive on a
// truck. stock_on_hand_rows is the one place old stock is deliberately
// UNFILTERED ("Balance / stock views -> usually unfiltered; opening stock
// is real stock" -- CLAUDE.md), so it's the meaningful place to prove no
// badge renders: Hisobot's own KIRIM view can't be used for this same
// check, since report_rows_v2's kirim branch filters origin='delivery' and
// never shows opening stock there at all.
test('Partiya raqami: opening-stock rows carry null partiya_no and render no badge in Ombor qoldig\'i', async ({ page }) => {
  await loginAs(page, 'MENEJER')

  const dbCheck = await page.evaluate(async () => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data: orders, error: ordersErr } = await w.supabase
      .from('kirim_orders')
      .select('order_id')
      .eq('origin', 'opening_stock')
      .limit(10)
    if (ordersErr) throw new Error(`orders lookup: ${ordersErr.message}`)
    const orderIds = (orders ?? []).map((o: { order_id: string }) => o.order_id)
    if (orderIds.length === 0) return { count: 0, allNull: true }
    const { data: lines, error: linesErr } = await w.supabase.from('kirim_lines').select('partiya_no').in('order_id', orderIds)
    if (linesErr) throw new Error(`lines lookup: ${linesErr.message}`)
    return {
      count: (lines ?? []).length,
      allNull: (lines ?? []).every((l: { partiya_no: number | null }) => l.partiya_no === null),
    }
  })
  expect(dbCheck.count).toBeGreaterThan(0)
  expect(dbCheck.allNull).toBe(true)

  await page.goto('/menejer/qoldiq')
  await page.getByRole('button', { name: 'Eski zaxira' }).click()
  const rows = page.locator('table tbody tr')
  await expect(rows.first()).toBeVisible({ timeout: 10_000 })
  expect(await rows.count()).toBeGreaterThan(0)
  // The amber "P{n}" pill never appears anywhere on this old-stock-only
  // table -- every row here has a null partiya_no by construction.
  await expect(page.locator('table').getByText(/^P\d+$/)).toHaveCount(0)
})
