import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.png')
const PLATE = 'TEST-LAB-KIRIM-01'

// Step 8 prompt 2, split 2b: Laborator KIRIM screens (SPEC.md v1.9 §5.5.2).
// Full real chain: Menejer creates a KIRIM order with a sulfured line
// (Subxon, both targets) and a natural line (Isfara, moisture target only,
// blank SO2) -> Qorovul gate stage 1 (intake becomes acceptable) -> Ombor
// accepts both lines (actual weight recorded, the real W1 trigger) ->
// Laborator tests both. Confirms the natural line skips "Sera kutilmoqda"
// (W2) entirely and lands straight in "Yakunlangan" (W3), while the
// sulfured line goes through the two-step moisture-then-SO2 flow.
test('Laborator KIRIM: sulfured line goes through Sera kutilmoqda, natural line skips it entirely', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  // --- Menejer: KIRIM order, two lines ---
  await loginAs(page, 'MENEJER')
  await expect(page.getByRole('heading', { name: 'Yangi KIRIM' })).toBeVisible()

  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(PLATE)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  await page.locator('div:has(> label:text-is("Buyurtmachi")) select').selectOption({ label: 'Test Client A' })

  const row1 = page.locator('form div.space-y-1.rounded-md').nth(0)
  await row1.locator('select').selectOption({ label: 'Subxon' })
  await row1.getByPlaceholder('Miqdori (kg)').fill('1000')
  await row1.getByPlaceholder('—').fill('8')
  await row1.getByPlaceholder('naturel').fill('50')

  await page.getByRole('button', { name: "+ Tur qo'shish" }).click()
  const row2 = page.locator('form div.space-y-1.rounded-md').nth(1)
  await row2.locator('select').selectOption({ label: 'Isfara' })
  await row2.getByPlaceholder('Miqdori (kg)').fill('500')
  await row2.getByPlaceholder('—').fill('9')
  // SO2 target intentionally left blank — natural product.

  await page.getByRole('button', { name: 'Saqlash' }).click()

  const savedPanel = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: 'Subxon' })
  await expect(savedPanel.locator('span.font-mono')).toHaveCount(2, { timeout: 10000 })
  // Each span shows the placeholder "seriya: kutilmoqda" while the insert is
  // in flight, then swaps to the real serial — wait for the real pattern
  // before reading, not just the element count.
  await expect(savedPanel.locator('span.font-mono').nth(0)).toHaveText(/^\d{6}-\d{3}$/, { timeout: 10000 })
  await expect(savedPanel.locator('span.font-mono').nth(1)).toHaveText(/^\d{6}-\d{3}$/, { timeout: 10000 })
  const serials = await savedPanel.locator('span.font-mono').allTextContents()
  const subxonSerial = serials[0]
  const isfaraSerial = serials[1]

  // --- Qorovul: gate stage 1 only — intake only needs stage 1 (loaded
  // weight), not stage 2 (SPEC §5.1: "acceptable once gate stage 1 exists"). ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'QOROVUL')

  const faol = page.getByRole('heading', { name: 'Faol' }).locator('xpath=following-sibling::div[1]')
  const gateRow = faol.locator('.rounded-md', { hasText: PLATE })
  await expect(gateRow).toBeVisible()
  await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
  await gateRow.locator('div:has(> label:text-is("Moshina raqami rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  // PhotoField compresses async (compressImage) before calling onChange —
  // wait for "Siqilmoqda…" to clear so the parent form's state is actually
  // set before submitting, not just the file input event dispatched.
  await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
  await gateRow.locator('div:has(> label:text-is("Yuk bilan vazn (Гружёный)")) input[type="number"]').fill('1500')
  await gateRow.locator('div:has(> label:text-is("Tarozi rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
  await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
  // Confirm the submit actually landed (matches chiqim-full-chain.spec.ts's
  // proven pattern) before moving on to Ombor — a silent validation failure
  // here would otherwise only surface two role-hops later as a confusing
  // Ombor timeout.
  await expect(faol.locator('.rounded-md.border-red-300', { hasText: PLATE })).toBeVisible()

  // --- Ombor: accept both lines (this is the real W1 trigger for Lab) ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'OMBOR')

  async function acceptLine(serial: string, qty: string) {
    const omborGroup = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: PLATE })
    await expect(omborGroup).toBeVisible()
    // The header <span> (`{serial} · {type} · {qty} kg`) uniquely
    // identifies the line even once its form is open — IntakeAcceptForm
    // also repeats the bare serial, but in a <div>, not a <span>. Walk up
    // to the nearest "rounded-md" ancestor (the line's own row div, not the
    // outer group) — XPath's ancestor:: axis returns nearest-first, so [1]
    // is the immediate row, not the group.
    const lineRow = omborGroup
      .locator('span', { hasText: serial })
      .locator('xpath=ancestor::div[contains(@class, "rounded-md")][1]')
    await lineRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await page.locator(`#actual-${serial}`).fill(qty)
    await lineRow.locator('div:has(> label:text-is("Uyum rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(lineRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await lineRow.getByRole('button', { name: 'Qabul qilish' }).click()
    // Positive check, not just absence: once accepted, the line moves out
    // of "Kutilmoqda" entirely (storage_intake now exists — useIntakeLines
    // filters !intake), so the whole row/group can vanish for reasons that
    // have nothing to do with success (e.g. a broken locator chain would
    // also read as "0 buttons"). Confirming it lands in the received
    // section is the real signal.
    const received = page.getByRole('heading', { name: 'Qabul qilingan mahsulotlar' }).locator('xpath=following-sibling::div[1]')
    await expect(received.locator('.rounded-md', { hasText: serial })).toBeVisible()
  }
  await acceptLine(subxonSerial, '1000')
  await acceptLine(isfaraSerial, '500')

  // --- Laborator: both lines awaiting Tahlil ---
  await page.getByRole('button', { name: 'Chiqish' }).click()
  await page.waitForURL('**/login')
  await loginAs(page, 'LABORATOR')

  const w1 = page.getByRole('heading', { name: 'Tahlil kutilmoqda' }).locator('xpath=following-sibling::div[1]')
  const w2 = page.getByRole('heading', { name: 'Sera kutilmoqda' }).locator('xpath=following-sibling::div[1]')
  const w3 = page.getByRole('heading', { name: 'Yakunlangan' }).locator('xpath=following-sibling::div[1]')

  const subxonW1 = w1.locator('.rounded-md', { hasText: subxonSerial })
  await expect(subxonW1).toBeVisible()
  await subxonW1.getByRole('button', { name: 'Tahlil' }).click()
  await subxonW1.locator('div:has(> label:text-is("Namligi %")) input').fill('7.5')
  await subxonW1.locator('div:has(> label:text-is("Namuna rasmi (ixtiyoriy)")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await subxonW1.getByRole('button', { name: 'Saqlash' }).click()

  // Sulfured line: moves to W2, NOT W3.
  const subxonW2 = w2.locator('.rounded-md', { hasText: subxonSerial })
  await expect(subxonW2).toBeVisible()
  await expect(w3.locator('.rounded-md', { hasText: subxonSerial })).toHaveCount(0)
  await expect(subxonW2).toContainText('Talab: 50')

  const isfaraW1 = w1.locator('.rounded-md', { hasText: isfaraSerial })
  await expect(isfaraW1).toBeVisible()
  await isfaraW1.getByRole('button', { name: 'Tahlil' }).click()
  await isfaraW1.locator('div:has(> label:text-is("Namligi %")) input').fill('9.5')
  await isfaraW1.getByRole('button', { name: 'Saqlash' }).click()

  // Natural line: skips W2 entirely, lands straight in W3.
  await expect(w2.locator('.rounded-md', { hasText: isfaraSerial })).toHaveCount(0)
  const isfaraW3 = w3.locator('.rounded-md', { hasText: isfaraSerial })
  await expect(isfaraW3).toBeVisible()
  await expect(isfaraW3).toContainText("Yo'q · naturel")

  // Complete the sulfured line's Sera kiritish step.
  await subxonW2.locator('input[type="number"]').fill('45')
  await subxonW2.getByRole('button', { name: 'Sera kiritish' }).click()
  await expect(w2.locator('.rounded-md', { hasText: subxonSerial })).toHaveCount(0)
  const subxonW3 = w3.locator('.rounded-md', { hasText: subxonSerial })
  await expect(subxonW3).toBeVisible()
  await expect(subxonW3).toContainText('45')

  // --- Direct DB check, same session (dev-only window.supabase, see
  // src/lib/supabase.ts) — confirms real persisted values, not just what
  // the UI echoes back. The core proof: isfara's so2_mg_kg is a real null. ---
  const result = await page.evaluate(async ({ subxon, isfara }) => {
    const w = window as unknown as { supabase: { from: (t: string) => any } }
    const { data, error } = await w.supabase
      .from('lab_results')
      .select('parent_serial, moisture_pct, so2_mg_kg, status, sample_photo')
      .in('parent_serial', [subxon, isfara])
    return { data, error: error?.message ?? null }
  }, { subxon: subxonSerial, isfara: isfaraSerial })

  expect(result.error).toBeNull()
  const rows = result.data as { parent_serial: string; moisture_pct: number; so2_mg_kg: number | null; status: string; sample_photo: string | null }[]
  const subxonRow = rows.find((r) => r.parent_serial === subxonSerial)!
  const isfaraRow = rows.find((r) => r.parent_serial === isfaraSerial)!

  expect(subxonRow.status).toBe('complete')
  expect(subxonRow.moisture_pct).toBe(7.5)
  expect(subxonRow.so2_mg_kg).toBe(45)
  expect(subxonRow.sample_photo).not.toBeNull()

  expect(isfaraRow.status).toBe('complete')
  expect(isfaraRow.moisture_pct).toBe(9.5)
  expect(isfaraRow.so2_mg_kg).toBeNull()
  expect(typeof isfaraRow.so2_mg_kg).not.toBe('string')
  expect(isfaraRow.sample_photo).toBeNull()

  expect(consoleErrors, `Console errors during the flow: ${consoleErrors.join('\n')}`).toEqual([])
})
