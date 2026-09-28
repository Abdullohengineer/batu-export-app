import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './helpers/login'
import { serviceClient } from './helpers/teardown'

// Rezka Prompt 4 -- the reporting layer (migration 0146, docs/decisions/
// 0226-...). READ-ONLY: no fixtures, nothing to tear down.
//
// Why the Hisobot / dashboard / passport checks are database-level, not
// through the rendered table: every report source drops TEST- plates, and
// every Rezka serial in this project is TEST data (the "TEST Rezka E2E"
// owner that rezka-menejer / rezka-ombor create). A real-looking plate would
// leave fake Rezka kirim rows in Rahbar's Hisobot forever, so -- product-
// owner decision 2026-09-28 -- the figures are checked where the TEST
// exclusion does not apply (rezka_serial_state_set, the passport wrapper's
// Rezka keys, the snapshot keys), and re-derived here from the base tables
// (rezka_sends, rezka_cycles, finished_pallets, rezka_kn_draws), so the
// test never trusts the function it is checking. The report engine itself
// is checked for its group rule: Oddiy never returns a Rezka kind or a
// Rezka serial, Rezka returns only Rezka kinds on process='rezka' serials.
// The UI part checks what renders regardless of data: the Oddiy | Rezka
// selector with exactly the four Rezka directions, the fourth dashboard
// button and the Joriy | Eski | Rezka qoldiq switch.
//
// Run it after the two Rezka specs, so the TEST Rezka E2E data exists:
//   npx playwright test tests/e2e/rezka-menejer.spec.ts tests/e2e/rezka-ombor.spec.ts tests/e2e/rezka-hisobot.spec.ts tests/e2e/full-chain.spec.ts

const OWNER_NAME = 'TEST Rezka E2E'
const REZKA_KINDS = ['rezka_kirim', 'rezka_send', 'rezka_output', 'rezka_chiqim']
const FROM = '2026-07-01'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function reportParams(directions: string[] | null) {
  return {
    p_directions: directions,
    p_from: FROM,
    p_to: today(),
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
  }
}

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

function sum(rows: { qty_kg?: number | string; weight_kg?: number | string }[] | null, key: 'qty_kg' | 'weight_kg'): number {
  return (rows ?? []).reduce((s, r) => s + Number(r[key] ?? 0), 0)
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

test('1 · DB: Rezka serial state, passport Rezka block and snapshot keys match the base tables', async () => {
  const db = serviceClient()
  const owner = await must(db.from('owners').select('id').eq('name', OWNER_NAME).maybeSingle(), 'owner')
  test.skip(!owner, `No "${OWNER_NAME}" owner yet -- run rezka-menejer / rezka-ombor first.`)
  const orders = await must(db.from('kirim_orders').select('order_id, origin').eq('owner_id', owner!.id), 'orders')
  const originByOrder = new Map((orders ?? []).map((o: { order_id: string; origin: string }) => [o.order_id, o.origin]))
  const lines = (await must(
    db.from('kirim_lines').select('serial, order_id').eq('process', 'rezka').in('order_id', [...originByOrder.keys()]),
    'rezka lines',
  )) as { serial: string; order_id: string }[]
  test.skip(lines.length === 0, 'No TEST Rezka serials yet.')
  const serials = lines.map((l) => l.serial)

  const state = (await must(db.rpc('rezka_serial_state_set', { p_serials: serials }), 'rezka_serial_state_set')) as {
    serial: string
    manba: string
    parents: { barcode2: string; qtyKg: number }[]
    rezkaga_yuborilgan: number | string
    rezkada: number | string
  }[]
  expect(state.map((s) => s.serial).sort()).toEqual([...serials].sort())

  for (const line of lines) {
    const s = state.find((x) => x.serial === line.serial)!
    const origin = originByOrder.get(line.order_id)
    // Manba follows the order's origin.
    expect(s.manba, line.serial).toBe(origin === 'internal_reprocess' ? 'ichki' : 'tashqi')

    // Rezkaga yuborilgan = every rezka_sends row of the serial.
    const sends = (await must(db.from('rezka_sends').select('qty_kg, sent_date').eq('serial', line.serial), 'sends')) as {
      qty_kg: number | string
      sent_date: string
    }[]
    expect(Number(s.rezkaga_yuborilgan), line.serial).toBe(sum(sends, 'qty_kg'))

    // Rezkada = per OPEN cycle, sends since opened minus non-void pallets
    // since opened (close_rezka_cycle_serial's rule), signed.
    const cycles = (await must(db.from('rezka_cycles').select('opened_at, closed_at').eq('serial', line.serial), 'cycles')) as {
      opened_at: string
      closed_at: string | null
    }[]
    const pallets = (await must(
      db.from('finished_pallets').select('weight_kg, received_date, status').eq('serial', line.serial),
      'pallets',
    )) as { weight_kg: number | string; received_date: string; status: string }[]
    const live = pallets.filter((p) => p.status !== 'bekor_qilindi')
    let rezkada = 0
    for (const c of cycles.filter((c) => c.closed_at === null)) {
      const opened = c.opened_at.slice(0, 10)
      rezkada += sum(sends.filter((x) => x.sent_date >= opened), 'qty_kg') - sum(live.filter((p) => p.received_date >= opened), 'weight_kg')
    }
    expect(Number(s.rezkada), line.serial).toBeCloseTo(rezkada, 3)

    // Ichki: parents = its rezka_kn_draws rows.
    const draws = (await must(db.from('rezka_kn_draws').select('barcode2, qty_kg').eq('minted_serial', line.serial), 'draws')) as {
      barcode2: string
      qty_kg: number | string
    }[]
    expect(s.parents.map((p) => p.barcode2).sort(), line.serial).toEqual(draws.map((d) => d.barcode2).sort())

    // Passport wrapper: the Rezka block carries the same figures.
    const passport = (await must(db.rpc('get_serial_passport', { p_serial: line.serial }), 'passport')) as {
      rezka: { provenance: string; sentKg: number; receivedKg: number; rezkadaKg: number; cycles: unknown[] } | null
    }
    expect(passport.rezka, line.serial).not.toBeNull()
    expect(passport.rezka!.provenance).toBe(s.manba)
    expect(Number(passport.rezka!.sentKg)).toBe(sum(sends, 'qty_kg'))
    expect(Number(passport.rezka!.receivedKg)).toBe(sum(live, 'weight_kg'))
    expect(Number(passport.rezka!.rezkadaKg)).toBeCloseTo(rezkada, 3)
    expect(passport.rezka!.cycles.length).toBe(cycles.length)
  }

  // Parent KN serials: rezkaDrawsOut lists each mint drawn from them.
  const allDraws = (await must(
    db.from('rezka_kn_draws').select('barcode2, qty_kg, minted_serial').in('minted_serial', serials),
    'all draws',
  )) as { barcode2: string; qty_kg: number | string; minted_serial: string }[]
  if (allDraws.length > 0) {
    const parentPallets = (await must(
      db.from('finished_pallets').select('barcode2, serial').in('barcode2', allDraws.map((d) => d.barcode2)),
      'parent pallets',
    )) as { barcode2: string; serial: string }[]
    const parentSerial = parentPallets[0].serial
    const expected = allDraws.filter((d) => parentPallets.find((p) => p.barcode2 === d.barcode2)?.serial === parentSerial)
    const passport = (await must(db.rpc('get_serial_passport', { p_serial: parentSerial }), 'parent passport')) as {
      rezka: unknown
      rezkaDrawsOut: { mintedSerial: string; kg: number }[]
    }
    expect(passport.rezka).toBeNull()
    for (const minted of new Set(expected.map((d) => d.minted_serial))) {
      const line = passport.rezkaDrawsOut.find((d) => d.mintedSerial === minted)
      expect(line, minted).toBeTruthy()
      expect(Number(line!.kg)).toBe(sum(expected.filter((d) => d.minted_serial === minted), 'qty_kg'))
    }
  }

  // Snapshot: the three Rezka keys are present and numeric at every scope.
  for (const scope of ['yangi', 'eski', 'hammasi']) {
    const snap = (await must(db.rpc('rahbar_stock_snapshot', { p_scope: scope }), `snapshot ${scope}`)) as Record<string, unknown>
    for (const key of ['rezkaRawKg', 'rezkaKnKg', 'rezkadaKg']) {
      expect(Number.isFinite(Number(snap[key])), `${scope}.${key}`).toBe(true)
    }
  }
})

test('2 · DB: report group rule -- Oddiy never returns Rezka, Rezka returns only Rezka kinds on Rezka serials', async () => {
  const db = serviceClient()
  const rezkaSerials = new Set(
    ((await must(db.from('kirim_lines').select('serial').eq('process', 'rezka'), 'rezka serials')) as { serial: string }[]).map((r) => r.serial),
  )

  const oddiy = (await must(
    db.rpc('report_query_page_rows', { ...reportParams(null), p_limit: 1000, p_offset: 0 }),
    'oddiy rows',
  )) as { kind: string; serial: string | null }[]
  expect(oddiy.filter((r) => r.kind.startsWith('rezka_'))).toEqual([])
  expect(oddiy.filter((r) => r.serial && rezkaSerials.has(r.serial))).toEqual([])

  const rezka = (await must(
    db.rpc('report_query_page_rows', { ...reportParams(REZKA_KINDS), p_limit: 1000, p_offset: 0 }),
    'rezka rows',
  )) as { kind: string; serial: string | null }[]
  for (const r of rezka) {
    expect(REZKA_KINDS).toContain(r.kind)
    expect(rezkaSerials.has(r.serial ?? ''), `${r.kind} ${r.serial}`).toBe(true)
  }

  // report_totals carries the four Rezka columns; under Oddiy they are 0
  // (no Rezka row is in the Oddiy set).
  const [oddiyTotals] = (await must(db.rpc('report_totals', reportParams(null)), 'oddiy totals')) as Record<string, number | string>[]
  const [rezkaTotals] = (await must(db.rpc('report_totals', reportParams(REZKA_KINDS)), 'rezka totals')) as Record<string, number | string>[]
  for (const key of ['total_kg_to_rezka', 'total_kg_from_rezka', 'state_rezkaga_yuborilgan', 'state_rezkada']) {
    expect(key in oddiyTotals, key).toBe(true)
    expect(key in rezkaTotals, key).toBe(true)
  }
  expect(Number(oddiyTotals.total_kg_to_rezka)).toBe(0)
  expect(Number(oddiyTotals.total_kg_from_rezka)).toBe(0)
  expect(Number(rezkaTotals.total_count)).toBe(rezka.length)
})

test('3 · UI: Oddiy | Rezka selector with exactly four Rezka directions; dashboard and qoldiq Rezka toggles', async ({ page }) => {
  test.setTimeout(120_000)
  const consoleErrors = collectConsoleErrors(page)

  // Navigate by the sidebar links, never page.goto a deep route: a hard load
  // of a deep route currently bounces to the role's home (useProfile's
  // loading flag lags one render behind the session -- pre-existing app
  // race, see docs/decisions/0226 §10). Every other passing spec clicks nav.
  await loginAs(page, 'MENEJER')
  await page.getByRole('link', { name: 'Hisobot', exact: true }).click()
  await page.waitForURL('**/menejer/hisobot')
  const group = page.getByRole('group', { name: "Yo'nalish guruhi" })
  await expect(group.getByRole('button', { name: 'Oddiy' })).toHaveAttribute('aria-pressed', 'true')
  await group.getByRole('button', { name: 'Rezka' }).click()
  await expect(group.getByRole('button', { name: 'Rezka' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: /Yo'nalish/ }).click()
  for (const label of ['Rezka kirim', 'Rezkaga yuborildi', 'Rezkadan chiqdi', 'Rezka chiqim']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible()
  }
  for (const label of ['KIRIM', 'MOYKAGA', 'MOYKADAN', 'CHIQIM (tayyor)']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0)
  }
  await page.getByRole('button', { name: /Yo'nalish/ }).click()

  // Qoldiq: Joriy | Eski | Rezka.
  await page.getByRole('link', { name: "Ombor qoldig'i", exact: true }).click()
  await page.waitForURL('**/menejer/qoldiq')
  for (const label of ['Joriy zaxira', 'Eski zaxira', 'Rezka']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Rezka', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Rezka', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // Dashboard: Rezka is the fourth button, after Hammasi.
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'RAHBAR') // lands on /rahbar, the dashboard itself
  await page.getByRole('button', { name: 'Rezka', exact: true }).click()
  await expect(page.getByText('Rezka xom ashyo')).toBeVisible()
  await expect(page.getByText('Rezka tayyor mahsulot (Standard)')).toBeVisible()

  expect(consoleErrors).toEqual([])
})
