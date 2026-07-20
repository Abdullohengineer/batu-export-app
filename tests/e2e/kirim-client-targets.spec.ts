import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'
import { uniqueTestId } from './helpers/fixtures'

const PLATE = uniqueTestId('KIRIM-TARGETS')

// Step 8 prompt 1: Menejer KIRIM form gains per-line client quality targets
// (SPEC.md v1.9 §3.1). Two lines on one order: one with both targets set
// (sulfured product), one with moisture only and blank sulfur (natural
// product) — the blank must persist as a real SQL null, not 0 or ''.
test('KIRIM order with two lines: one fully targeted, one natural (blank SO2 persists as null)', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  await loginAs(page, 'MENEJER')
  await expect(page.getByRole('heading', { name: 'Yangi KIRIM' })).toBeVisible()

  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(PLATE)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  await page.locator('div:has(> label:text-is("Buyurtmachi")) select').selectOption({ label: 'Test Client A' })

  // Row 1 — Subxon, sulfured: both targets set.
  const row1 = page.locator('form div.space-y-1.rounded-md').nth(0)
  await row1.locator('select').selectOption({ label: 'Subxon' })
  await row1.getByPlaceholder('Miqdori (kg)').fill('1000')
  await row1.getByPlaceholder('—').fill('8')
  await row1.getByPlaceholder('naturel').fill('50')

  // Row 2 — Isfara, natural: moisture target only, sulfur left blank.
  await page.getByRole('button', { name: "+ Tur qo'shish" }).click()
  const row2 = page.locator('form div.space-y-1.rounded-md').nth(1)
  await row2.locator('select').selectOption({ label: 'Isfara' })
  await row2.getByPlaceholder('Miqdori (kg)').fill('500')
  await row2.getByPlaceholder('—').fill('9')
  // targetSo2 (placeholder "naturel") intentionally left blank.

  await page.getByRole('button', { name: 'Saqlash' }).click()

  // Both lines saved — confirmation panel shows a real serial for each,
  // not the in-flight placeholder.
  const savedPanel = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: 'Subxon' })
  await expect(savedPanel.getByText(/^\d{6}-\d{3}$/)).toHaveCount(2, { timeout: 10000 })

  // --- Direct DB check via the dev-only window.supabase client (same
  // session, same RLS as the logged-in menejer) — confirms the actual
  // persisted values, not just what the UI echoes back. ---
  const result = await page.evaluate(async (plate) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data: order, error: orderErr } = await w.supabase
      .from('kirim_orders')
      .select('order_id')
      .eq('plate', plate)
      .single()
    if (orderErr) return { error: orderErr.message }

    const { data: lines, error: linesErr } = await w.supabase
      .from('kirim_lines')
      .select('declared_qty, target_moisture_pct, target_so2_mg_kg, product_types(name)')
      .eq('order_id', order.order_id)
    if (linesErr) return { error: linesErr.message }

    return { lines }
  }, PLATE)

  expect(result.error).toBeUndefined()
  const lines = result.lines as {
    declared_qty: number
    target_moisture_pct: number | null
    target_so2_mg_kg: number | null
    product_types: { name: string }
  }[]
  expect(lines).toHaveLength(2)

  const subxon = lines.find((l) => l.product_types.name === 'Subxon')!
  const isfara = lines.find((l) => l.product_types.name === 'Isfara')!

  expect(subxon.target_moisture_pct).toBe(8)
  expect(subxon.target_so2_mg_kg).toBe(50)

  expect(isfara.target_moisture_pct).toBe(9)
  // The real assertion: a real SQL null, not 0, not '', not undefined.
  expect(isfara.target_so2_mg_kg).toBeNull()
  expect(typeof isfara.target_so2_mg_kg).not.toBe('string')
  expect(isfara.target_so2_mg_kg).not.toBe(0)

  expect(consoleErrors, `Console errors during the flow: ${consoleErrors.join('\n')}`).toEqual([])
})
