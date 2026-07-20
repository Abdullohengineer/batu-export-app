import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { loginAs } from './helpers/login'
import { uniqueTestId } from './helpers/fixtures'

// Step 10 prompt 1: reporting query engine, results table, totals strip,
// filter bar (SPEC.md §3.2.1-3.2.4). Reduced testing per the task's own
// instruction — this is a read-only layer, one smoke test, no multi-role
// walkthrough. Seeding uses the same lightweight direct-write pattern
// helpers/fixtures.ts already established (seedDispatchablePallets) — brief
// role switches purely to write known rows via window.supabase, not a
// narrative walkthrough of each role's own screens. Only Menejer's Hisobot
// screen is actually exercised through the UI.
async function switchRole(page: Page, role: 'MENEJER' | 'OMBOR' | 'QOROVUL'): Promise<void> {
  const logoutButton = page.getByRole('button', { name: 'Chiqish' })
  if ((await logoutButton.count()) > 0) {
    await logoutButton.click()
    await page.waitForURL('**/login')
  }
  await loginAs(page, role)
}

test('Hisobot: filtered results + totals reconcile against a direct query, and a voided Barcode #2 stays findable', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  const plate = uniqueTestId('HISOBOT')

  // --- Seed one single-line KIRIM order straight through to a known gate
  // net (1050kg), via direct writes — same shape as fixtures.ts's own
  // seedDispatchablePallets, just for the KIRIM side of the engine. ---
  await switchRole(page, 'MENEJER')
  const serial = await page.evaluate(async (plate) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data: owner, error: ownerErr } = await w.supabase.from('owners').select('id').eq('name', 'Test Client A').single()
    if (ownerErr) throw new Error(`owner lookup: ${ownerErr.message}`)
    const { data: type, error: typeErr } = await w.supabase.from('product_types').select('id').eq('name', 'Subxon').single()
    if (typeErr) throw new Error(`type lookup: ${typeErr.message}`)
    const { data: order, error: orderErr } = await w.supabase
      .from('kirim_orders')
      .insert({ order_date: new Date().toISOString().slice(0, 10), plate, driver: 'TEST Driver', owner_id: owner.id, declared_total: 1000 })
      .select('order_id')
      .single()
    if (orderErr) throw new Error(`kirim_orders insert: ${orderErr.message}`)
    const { data: line, error: lineErr } = await w.supabase
      .from('kirim_lines')
      .insert({ order_id: order.order_id, type_id: type.id, declared_qty: 1000 })
      .select('serial')
      .single()
    if (lineErr) throw new Error(`kirim_lines insert: ${lineErr.message}`)
    return { serial: line.serial as string, orderId: order.order_id as string }
  }, plate)

  await switchRole(page, 'OMBOR')
  await page.evaluate(async (serial) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { error } = await w.supabase.from('storage_intake').insert({ serial, actual_qty: 1000 })
    if (error) throw new Error(`storage_intake insert: ${error.message}`)
  }, serial.serial)

  await switchRole(page, 'QOROVUL')
  await page.evaluate(async (orderId) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const now = new Date().toISOString()
    const { error } = await w.supabase.from('gate_weighings').insert({
      dir: 'kirim',
      order_id: orderId,
      gruzheny_kg: 1250,
      pustoy_kg: 200,
      stage1_completed_at: now,
      completed_at: now,
    })
    if (error) throw new Error(`gate_weighings insert: ${error.message}`)
  }, serial.orderId)

  // --- Seed a genuinely voided pallet off the same serial — no cycle-2
  // successor exists yet, so this also proves the "hali yangi barkod
  // chiqarilmagan" (no new barcode yet) branch, not just the happy path. ---
  // finished_pallets.ombor_writes RLS needs the OMBOR role (still QOROVUL
  // from the gate_weighings step above).
  await switchRole(page, 'OMBOR')
  const barcode2 = `PLT-${serial.serial}-VOIDTEST`
  await page.evaluate(
    async ({ serial, barcode2 }) => {
      const w = window as unknown as { supabase: { from: (t: string) => any } }
      const { data: type } = await w.supabase.from('kirim_lines').select('type_id').eq('serial', serial).single()
      const { data: calibre, error: calErr } = await w.supabase.from('calibres').select('id').eq('label', 'Kalibr 6').single()
      if (calErr) throw new Error(`calibre lookup: ${calErr.message}`)
      const { error } = await w.supabase.from('finished_pallets').insert({
        barcode2,
        serial,
        wash_cycle: 1,
        type_id: type.type_id,
        calibre_id: calibre.id,
        weight_kg: 500,
        received_date: new Date().toISOString().slice(0, 10),
        status: 'bekor_qilindi',
      })
      if (error) throw new Error(`finished_pallets insert: ${error.message}`)
    },
    { serial: serial.serial, barcode2 },
  )

  // --- Direct-query the expected numbers independently, before touching
  // the UI at all — this is the "confirm against a direct DB query" check. ---
  const expected = await page.evaluate(async (orderId) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data } = await w.supabase.from('gate_weighings').select('net_kg').eq('order_id', orderId).eq('dir', 'kirim').single()
    return data.net_kg as number
  }, serial.orderId)
  expect(expected).toBe(1050)

  // --- Menejer's Hisobot: filter to just this plate, confirm the row and
  // the totals strip both show the gate-net figure (§2.16.1: single-line ->
  // gate net, not the 1000kg declared/intake figure). ---
  await switchRole(page, 'MENEJER')
  await page.getByRole('link', { name: 'Hisobot' }).click()
  await expect(page.getByText('Sana asosi:')).toBeVisible()

  await page.getByRole('button', { name: /Filtrlar|Yopish/ }).click()
  const plateInput = page.locator('label', { hasText: 'Moshina raqami' }).locator('input')
  await plateInput.fill(plate)

  const row = page.locator('.rounded-md.border.border-slate-200', { hasText: plate })
  await expect(row).toBeVisible({ timeout: 15000 })
  await expect(row).toContainText('1,050 kg')
  await expect(row).not.toContainText('tarozi kutilmoqda')

  const totalsStrip = page.locator('.sticky.top-0')
  await expect(totalsStrip).toContainText('Kirim: 1,050 kg')
  await expect(totalsStrip).toContainText('Neto: +1,050 kg')

  // --- Voided Barcode #2: must return its record, never "not found". ---
  const barcode2Input = page.locator('label', { hasText: 'Barcode #2' }).locator('input')
  await barcode2Input.fill(barcode2)
  const voidedCallout = page.locator('.rounded-md.border-red-300', { hasText: barcode2 })
  await expect(voidedCallout).toBeVisible({ timeout: 15000 })
  await expect(voidedCallout).toContainText('bekor qilindi')
  await expect(voidedCallout).toContainText('Qayta yuvilgan, sikl 1.')
  await expect(voidedCallout).toContainText('hali yangi barkod chiqarilmagan')

  expect(consoleErrors, `Console errors during the flow: ${consoleErrors.join('\n')}`).toEqual([])
})
