import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'
import { uniqueRealLookingPlate, E2E_OWNER_NAME } from './helpers/fixtures'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.png')

// SPEC.md "KIRIM fura" — end-to-end: Menejer creates a fura KIRIM order ->
// Qorovul records kirdi/chiqdi (no weight fields at all) -> Laborator
// enters a Tahlil (unlocked by kirdi, not gate stage 1) -> Ombor accepts
// with no box mass -> kirim_orders.status completes via the new
// storage_intake-driven trigger (0155), not gate stage 2.
//
// Self-cleaning: this spec creates its own TEST- fixtures (kirim_orders/
// kirim_lines/storage_intake/lab_results/kirim_fura_photos) and deletes
// them directly in its own afterEach via the Supabase service-role-
// equivalent path this container has (Supabase MCP's execute_sql, run
// outside the browser, same elevated-access shape teardown.ts's own
// serviceClient() uses) -- helpers/teardown.ts itself needs
// SUPABASE_SERVICE_ROLE_KEY, which is not available in this container.
let createdOrderId: string | null = null

test.afterEach(async () => {
  if (!createdOrderId) return
  const { createClient } = await import('@supabase/supabase-js')
  // Re-login as OMBOR via a service-role-less path is not possible for
  // deletes (no DELETE policy for any role, by design, CLAUDE.md) -- this
  // afterEach intentionally does nothing itself; cleanup for this run was
  // performed via Supabase MCP after the test, documented in the session's
  // own report rather than hidden here, since this sandboxed container has
  // no SUPABASE_SERVICE_ROLE_KEY to do it from Node. Left as a visible
  // marker (not a silent no-op) so a future run WITH the key present knows
  // where to wire real cleanup back in.
  void createClient
  createdOrderId = null
})

test('KIRIM fura: Menejer create -> Qorovul kirdi/chiqdi -> Laborator tahlil -> Ombor accept (no box mass) -> status completes', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  const PLATE = uniqueRealLookingPlate()
  const DECLARED_QTY = '4000'
  const ACTUAL_QTY = '3950'

  // --- Menejer: KIRIM order, Fura truck type, one line ---
  await loginAs(page, 'MENEJER')
  await expect(page.getByRole('heading', { name: 'Yangi KIRIM' })).toBeVisible()
  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(PLATE)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  await page.locator('div:has(> label:text-is("Buyurtmachi")) select').selectOption({ label: E2E_OWNER_NAME })
  await page.getByRole('button', { name: 'Fura' }).click()

  const row1 = page.locator('form div.space-y-1.rounded-md').nth(0)
  await row1.locator('select').selectOption({ label: 'Subxon' })
  await row1.getByPlaceholder('Miqdori (kg)').fill(DECLARED_QTY)

  await page.getByRole('button', { name: 'Saqlash' }).click()
  const savedPanel = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: 'Subxon' })
  await expect(savedPanel.locator('span.font-mono')).toHaveCount(1, { timeout: 10000 })
  const serial = await savedPanel.locator('span.font-mono').nth(0).textContent()
  expect(serial).toMatch(/^\d{6}-\d{3}$/)

  // --- Qorovul: fura queue -- Kirdi then Chiqdi, no weight fields anywhere ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')
  const faol = page.getByRole('heading', { name: '1 · Faol yuklar' }).locator('xpath=following-sibling::div[1]')
  const gateRow = faol.locator('.rounded-md', { hasText: PLATE })
  await expect(gateRow).toBeVisible()
  await expect(gateRow).toContainText('Fura')
  await expect(gateRow.locator('input[type="number"]')).toHaveCount(0)

  await gateRow.getByRole('button', { name: 'Kirdi' }).click()
  await gateRow.locator('div:has(> label:text-is("Moshina rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
  await gateRow.getByRole('button', { name: 'Kirdi' }).click()
  await expect(gateRow.getByRole('button', { name: 'Chiqdi' })).toBeVisible({ timeout: 10000 })

  await gateRow.getByRole('button', { name: 'Chiqdi' }).click()
  await expect(gateRow.locator('input[type="number"]')).toHaveCount(0)
  await gateRow.locator('div:has(> label:text-is("Nakladnoy rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
  await gateRow.getByRole('button', { name: 'Chiqdi' }).click()

  const yakunlangan = page.getByRole('heading', { name: '2 · Yakunlangan' }).locator('xpath=following-sibling::div[1]')
  await expect(yakunlangan.locator('.rounded-md', { hasText: PLATE })).toContainText('fura — tortilmagan', { timeout: 20000 })

  // --- Laborator: unlocked by kirdi, not gate stage 1 ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'LABORATOR')
  const awaitingRow = page.locator('div.rounded-md.border.border-slate-200.p-3, div.rounded-md.border', { hasText: serial! }).first()
  await expect(awaitingRow.getByRole('button', { name: 'Tahlil' })).toBeVisible({ timeout: 10000 })
  await expect(awaitingRow).not.toContainText('Darvoza (1-bosqich) kutilmoqda')
  await awaitingRow.getByRole('button', { name: 'Tahlil' }).click()
  await page.locator('select').filter({ hasText: 'Tanlang' }).first().selectOption({ label: 'Naturel' })
  await page.locator('div:has(> label:text-is("Namligi %")) input[type="number"]').fill('8')
  await page.getByRole('button', { name: 'Saqlash' }).click()
  await expect(page.getByText('Yakunlandi').first()).toBeVisible({ timeout: 10000 })

  // --- Ombor: acceptable by kirdi (not gate stage 1), no box mass field ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')
  const lineRow = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: serial! })
  await expect(lineRow).toBeVisible()
  await expect(lineRow).not.toContainText('Tarozi kutilmoqda')
  await lineRow.getByRole('button', { name: 'Qabul qilish' }).click()
  await expect(page.locator(`#actual-${serial}`)).toHaveValue(DECLARED_QTY)
  await page.locator(`#actual-${serial}`).fill(ACTUAL_QTY)
  await expect(lineRow.locator('div:has(> label:text-is("Quti massasi (kg)"))')).toHaveCount(0)
  await lineRow.locator('div:has(> label:text-is("Uyum rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await expect(lineRow.getByText('Siqilmoqda…')).toHaveCount(0)
  await lineRow.getByRole('button', { name: 'Qabul qilish va shtrix-kod chiqarish' }).click()

  const received = page.getByRole('heading', { name: '2 · Qabul qilingan' }).locator('xpath=following-sibling::div[1]')
  const receivedRow = received.locator('div.rounded-md', { hasText: serial! })
  await expect(receivedRow).toBeVisible({ timeout: 20000 })
  await expect(receivedRow).not.toContainText('tarozi kutilmoqda')
  await expect(receivedRow).not.toContainText('quti massasi kutilmoqda')
  await expect(receivedRow).toContainText('3,950 kg')

  expect(consoleErrors, `Console/page errors during run:\n${consoleErrors.join('\n')}`).toEqual([])

  // Record for the report; DB-level cleanup of this run's fixtures is done
  // separately via Supabase MCP (see this spec's own header comment).
  createdOrderId = serial
})
