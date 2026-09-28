import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { loginAs, type TestRole } from './helpers/login'
import { uniqueTestId } from './helpers/fixtures'
import { serviceClient, voidPalletsWithStock, voidTestKirimLines } from './helpers/teardown'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_PHOTO = path.join(__dirname, 'fixtures', 'test-photo.png')

// Rezka Prompt 3 (SPEC.md §2 KIRIM/CHIQIM + §5.R; docs/decisions/0225).
// Menejer's two Rezka entry points, driven through the real UI:
//   1. One truck, two Subxon lines -- Moyka 10 kg + Rezka 30 kg (same type,
//      different process, which also exercises the serial-link fix) -> gate
//      weigh-1 -> Ombor intake with tara -> gate weigh-2. Each serial lands
//      in its own process's queues only (Ombor pickers, Laborator KIRIM),
//      badges on every KIRIM surface, Xom tab keeps and badges Rezka raw.
//   2. Ombor sends the Rezka serial's full 30 kg and receives 30 kg Standard
//      (auto-close). Menejer CHIQIM: Rezka tab shows 30 kg Standard,
//      Kalibrlangan offers no Standard; one truck carries the 30 kg Rezka
//      line + a Xom line pooling the Moyka serial's 10 kg -> Ombor finalize
//      (no "Yetarli emas") -> gate -> olib_ketildi. Standard availability
//      30 -> 0.
//   3. A Kalibrlangan Kalibr 6 request is created unchanged, then VOIDED --
//      never finalized: FIFO is not owner-scoped (attribute_chiqim_line_fifo
//      matches type + calibre only), so finalizing it would consume real
//      clients' Kalibr 6 pallets. Voiding is reversible (CLAUDE.md).
//
// Fixtures (CLAUDE.md "Testing workflow"): the dedicated owner "TEST Rezka
// E2E" (shared with rezka-ombor.spec.ts), TEST- plates. The run is designed
// to leave NO live remainder: both raw serials end at 0 kg (Rezka sent in
// full, Moyka dispatched raw), the Moyka serial's KIRIM lab test is done
// (Naturel), the Rezka cycle auto-closes. afterAll only voids -- never
// deletes -- whatever a failed run left live: pallets still holding stock (available kg > 0) -> bekor_
// qilindi, open cycles -> closed, unfinished CHIQIM requests -> voided, and
// the run's TEST KIRIM lines -> void_test_kirim_line (0152), so a run that
// fails between intake and test 2 no longer strands TEST raw in Ombor's
// pickers.
//
// Run locally with the other Rezka spec and test 6:
//   npx playwright test tests/e2e/rezka-menejer.spec.ts tests/e2e/rezka-ombor.spec.ts tests/e2e/full-chain.spec.ts

const OWNER_NAME = 'TEST Rezka E2E'
const TYPE_NAME = 'Subxon'
const MOYKA_KG = 10
const REZKA_KG = 30

test.describe.configure({ mode: 'serial' })

async function one<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<NonNullable<T>> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  if (data === null || data === undefined) throw new Error(`${what}: no row`)
  return data
}

interface Ctx {
  ownerId: string
  typeId: string
  standardId: string
  k6Id: string
  kirimPlate: string
  chiqimPlate: string
  k6Plate: string
  moykaSerial: string
  rezkaSerial: string
}
const ctx: Partial<Ctx> = {}

// Same waitFor-not-count logout guard as helpers/fixtures.ts switchRole
// (a bare .count() races the previous role's render).
async function switchTo(page: Page, role: TestRole) {
  const chiqish = page.getByRole('button', { name: 'Chiqish' })
  const loggedIn = await chiqish
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false)
  if (loggedIn) {
    await chiqish.click()
    await page.waitForURL('**/login')
  }
  await loginAs(page, role)
}

async function standardAvailableKg(): Promise<number> {
  const rows = await one(
    serviceClient()
      .from('finished_calibre_availability')
      .select('available_kg')
      .eq('type_id', ctx.typeId!)
      .eq('calibre_id', ctx.standardId!)
      .eq('is_old_stock', false)
      .eq('owner_id', ctx.ownerId!), // 0148: availability is per client
    'Standard availability',
  )
  return rows.reduce((sum, r) => sum + Number(r.available_kg), 0)
}

test.beforeAll(async () => {
  const db = serviceClient()
  let owner = (await db.from('owners').select('id, active').eq('name', OWNER_NAME).maybeSingle()).data as { id: string; active: boolean } | null
  if (!owner) {
    owner = await one(db.from('owners').insert({ name: OWNER_NAME, active: true }).select('id, active').single(), 'owner insert')
  }
  // Menejer's KIRIM/CHIQIM owner dropdowns list active owners only.
  expect(owner.active, `${OWNER_NAME} must be active`).toBe(true)
  const type = await one(db.from('product_types').select('id, category_id').eq('name', TYPE_NAME).single(), 'type')
  const std = await one(
    db.from('calibres').select('id').eq('category_id', type.category_id).eq('is_rezka_output', true).single(),
    'Standard calibre',
  )
  const k6 = await one(db.from('calibres').select('id').eq('category_id', type.category_id).eq('label', 'Kalibr 6').single(), 'Kalibr 6')
  Object.assign(ctx, {
    ownerId: owner.id,
    typeId: type.id,
    standardId: std.id,
    k6Id: k6.id,
    kirimPlate: uniqueTestId('RZM-K'),
    chiqimPlate: uniqueTestId('RZM-C'),
    k6Plate: uniqueTestId('RZM-K6'),
  })
})

// Void, never delete (SPEC.md §2.15).
test.afterAll(async () => {
  const db = serviceClient()
  const now = new Date().toISOString()
  const serials = [ctx.moykaSerial, ctx.rezkaSerial].filter((s): s is string => !!s)
  if (serials.length > 0) {
    // Only pallets still holding stock -- never a departed/consumed one.
    await voidPalletsWithStock(db, serials, now)
    await db.from('rezka_cycles').update({ closed_at: now }).in('serial', serials).is('closed_at', null)
    await db.from('wash_cycles').update({ closed_at: now }).in('serial', serials).is('closed_at', null)
    // Any raw a failed run left behind leaves every raw-stage queue (0152).
    await voidTestKirimLines(db, serials)
  }
  const menejer = (await db.from('profiles').select('id').eq('role', 'menejer').like('full_name', 'TEST %').limit(1).single()).data
  const plates = [ctx.chiqimPlate, ctx.k6Plate].filter((p): p is string => !!p)
  if (plates.length > 0) {
    await db
      .from('chiqim_requests')
      .update({ voided_at: now, voided_by: menejer?.id ?? null })
      .in('plate', plates)
      .is('ombor_finished_at', null)
      .is('voided_at', null)
  }
})

test('1 · KIRIM with a Moyka and a Rezka line: badges, gate, intake with tara, per-process queues', async ({ page }) => {
  test.setTimeout(180_000)
  const db = serviceClient()
  const consoleErrors: string[] = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(e.message))

  // --- Menejer: one truck, Subxon Moyka 10 kg + Subxon Rezka 30 kg ---
  await loginAs(page, 'MENEJER')
  await expect(page.getByRole('heading', { name: 'Yangi KIRIM' })).toBeVisible()
  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(ctx.kirimPlate!)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  await page.locator('div:has(> label:text-is("Buyurtmachi")) select').selectOption({ label: OWNER_NAME })
  const row1 = page.locator('form div.space-y-1.rounded-md').nth(0)
  await row1.locator('select').selectOption({ label: TYPE_NAME })
  await expect(row1.getByRole('button', { name: 'Moyka', exact: true })).toHaveAttribute('aria-pressed', 'true') // default
  await row1.getByPlaceholder('Miqdori (kg)').fill(String(MOYKA_KG))
  await page.getByRole('button', { name: "+ Tur qo'shish" }).click()
  const row2 = page.locator('form div.space-y-1.rounded-md').nth(1)
  await row2.locator('select').selectOption({ label: TYPE_NAME })
  await row2.getByRole('button', { name: 'Rezka', exact: true }).click()
  await expect(row2.getByRole('button', { name: 'Rezka', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await row2.getByPlaceholder('Miqdori (kg)').fill(String(REZKA_KG))
  await page.getByRole('button', { name: 'Saqlash' }).click()

  // Wait for the saved panel's two serials, then read which is which.
  const savedSerials = page.locator('div.rounded-md.border.border-slate-200.p-3 span.font-mono', { hasText: /^\d{6}-\d{3}$/ })
  await expect(savedSerials).toHaveCount(2, { timeout: 15_000 })
  const order = await one(db.from('kirim_orders').select('order_id').eq('plate', ctx.kirimPlate!).single(), 'order')
  const lines = await one(db.from('kirim_lines').select('serial, process, declared_qty').eq('order_id', order.order_id), 'lines')
  expect(lines).toHaveLength(2)
  const moykaSerial: string = lines.find((l) => l.process === 'moyka')!.serial
  const rezkaSerial: string = lines.find((l) => l.process === 'rezka')!.serial
  ctx.moykaSerial = moykaSerial
  ctx.rezkaSerial = rezkaSerial
  expect(Number(lines.find((l) => l.process === 'rezka')!.declared_qty)).toBe(REZKA_KG)

  // Saved panel links each row to ITS serial (type_id + process), Rezka badged.
  const savedPanel = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: rezkaSerial })
  await expect(savedPanel.getByText(moykaSerial)).toBeVisible()
  await expect(savedPanel.getByText('Rezka · Tashqi')).toHaveCount(1)

  // Menejer KIRIM list: badge + read-only Jarayon.
  const listCard = page.locator('.rounded-md', { hasText: ctx.kirimPlate! }).first()
  await expect(listCard.getByText('Rezka · Tashqi').first()).toBeVisible()
  await listCard.getByRole('button').first().click()
  await expect(listCard.getByText('Jarayon: Rezka')).toBeVisible()
  await expect(listCard.getByText('Jarayon: Moyka')).toBeVisible()

  // --- Qorovul: badge on the gate card, weigh-1 ---
  await switchTo(page, 'QOROVUL')
  const faol = page.getByRole('heading', { name: '1 · Faol yuklar' }).locator('xpath=following-sibling::div[1]')
  const gateRow = faol.locator('.rounded-md', { hasText: ctx.kirimPlate! })
  await expect(gateRow).toBeVisible()
  await expect(gateRow.getByText('Rezka · Tashqi')).toBeVisible()
  await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
  await gateRow.locator('div:has(> label:text-is("Moshina rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
  await gateRow.locator('div:has(> label:text-is("Yuk bilan vazn (Гружёный)")) input[type="number"]').fill('1000')
  await gateRow.locator('div:has(> label:text-is("Yuk bilan vazn rasmi (tarozi)")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await expect(gateRow.getByText('Siqilmoqda…')).toHaveCount(0)
  await gateRow.getByRole('button', { name: 'Saqlash' }).click()
  await expect(faol.locator('.rounded-md.border-red-300', { hasText: ctx.kirimPlate! })).toBeVisible()

  // --- Ombor: intake Window 1 badge, accept both lines with tara ---
  await switchTo(page, 'OMBOR')
  const pendingRezka = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: rezkaSerial })
  await expect(pendingRezka.getByText('Rezka · Tashqi')).toBeVisible()
  const pendingMoyka = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: moykaSerial })
  await expect(pendingMoyka.getByText('Rezka · Tashqi')).toHaveCount(0)
  async function acceptLine(serial: string, qty: number) {
    const lineRow = page.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: serial })
    await lineRow.getByRole('button', { name: 'Qabul qilish' }).click()
    await expect(page.locator(`#actual-${serial}`)).toHaveValue(String(qty))
    await lineRow.locator('div:has(> label:text-is("Quti massasi (kg)")) input[type="number"]').fill('1')
    await lineRow.locator('div:has(> label:text-is("Uyum rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
    await expect(lineRow.getByText('Siqilmoqda…')).toHaveCount(0)
    await lineRow.getByRole('button', { name: 'Qabul qilish va shtrix-kod chiqarish' }).click()
    const received = page.getByRole('heading', { name: '2 · Qabul qilingan' }).locator('xpath=following-sibling::div[1]')
    await expect(received.locator('div.rounded-md', { hasText: serial })).toBeVisible({ timeout: 20000 })
  }
  await acceptLine(moykaSerial, MOYKA_KG)
  await acceptLine(rezkaSerial, REZKA_KG)
  const intakes = await one(db.from('storage_intake').select('serial, actual_qty, box_mass_kg').in('serial', [moykaSerial, rezkaSerial]), 'intakes')
  expect(intakes.every((i) => Number(i.box_mass_kg) === 1)).toBe(true)

  // --- Qorovul: weigh-2 (40 kg + 2 kg tara) ---
  await switchTo(page, 'QOROVUL')
  const gateRow2 = page.getByRole('heading', { name: '1 · Faol yuklar' }).locator('xpath=following-sibling::div[1]').locator('.rounded-md', { hasText: ctx.kirimPlate! })
  await gateRow2.getByRole('button', { name: 'Yakunlash' }).click()
  await gateRow2.locator('div:has(> label:text-is("Bo\'sh vazn (Пустой)")) input[type="number"]').fill('958')
  await gateRow2.locator('div:has(> label:text-is("Bo\'sh vazn rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await expect(gateRow2.getByText('Siqilmoqda…')).toHaveCount(0)
  await gateRow2.getByRole('button', { name: 'Yakunlash' }).click()
  const yakunlangan = page.getByRole('heading', { name: '2 · Yakunlangan' }).locator('xpath=following-sibling::div[1]')
  await expect(yakunlangan.locator('.rounded-md', { hasText: ctx.kirimPlate! })).toContainText('42 kg', { timeout: 20000 })
  await expect(yakunlangan.locator('.rounded-md', { hasText: ctx.kirimPlate! }).getByText('Rezka · Tashqi')).toBeVisible()

  // --- Ombor pickers: each serial only under its own process ---
  await switchTo(page, 'OMBOR')
  await page.getByRole('link', { name: 'Moykaga', exact: true }).click()
  const pill = page.getByRole('group', { name: 'Jarayon' })
  await pill.getByRole('button', { name: 'Rezka' }).click()
  await page.getByRole('button', { name: '+ Tashqaridan olish' }).click()
  await expect(page.getByRole('button', { name: new RegExp(rezkaSerial) })).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(moykaSerial) })).toHaveCount(0)
  // No "Yopish" here: TashqiToRezkaForm only renders its close button once a
  // serial is picked. Switching the pill unmounts the whole Rezka body.
  await pill.getByRole('button', { name: 'Moyka' }).click()
  await page.getByRole('button', { name: '+ Yangi zaxiradan moykaga yuborish' }).click()
  await expect(page.getByRole('button', { name: new RegExp(moykaSerial) })).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(rezkaSerial) })).toHaveCount(0)

  // --- Laborator KIRIM: Moyka serial only; test it Naturel so it leaves the queue ---
  await switchTo(page, 'LABORATOR')
  const w1 = page.getByRole('heading', { name: 'Tahlil kutilmoqda' }).locator('xpath=following-sibling::div[1]')
  await expect(w1.locator('div.rounded-md', { hasText: moykaSerial })).toBeVisible()
  await expect(w1.locator('div.rounded-md', { hasText: rezkaSerial })).toHaveCount(0)
  const moykaW1 = w1.locator('div.rounded-md', { hasText: moykaSerial })
  await moykaW1.getByRole('button', { name: 'Tahlil' }).click()
  await moykaW1.locator('select').selectOption({ label: 'Naturel' })
  await moykaW1.locator('div:has(> label:text-is("Namligi %")) input').fill('8')
  await moykaW1.getByRole('button', { name: 'Saqlash' }).click()
  await expect(w1.locator('div.rounded-md', { hasText: moykaSerial })).toHaveCount(0, { timeout: 20000 })

  // --- Menejer CHIQIM Xom tab: Rezka Tashqi raw stays eligible, badged (not saved) ---
  await switchTo(page, 'MENEJER')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  const chiqimSelects = page.locator('form:has-text("Yangi CHIQIM") select')
  await chiqimSelects.nth(0).selectOption({ label: OWNER_NAME })
  await page.getByRole('button', { name: 'Xom', exact: true }).click()
  await chiqimSelects.nth(1).selectOption({ label: TYPE_NAME })
  const rezkaChip = page.getByRole('button', { name: new RegExp(rezkaSerial) })
  await expect(rezkaChip).toBeVisible()
  await expect(rezkaChip.getByText('Rezka · Tashqi')).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(moykaSerial) }).getByText('Rezka · Tashqi')).toHaveCount(0)

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
})

test('2 · Rezka output 30 kg Standard -> Menejer Rezka tab -> dispatch; availability 30 -> 0', async ({ page }) => {
  test.setTimeout(180_000)
  const db = serviceClient()
  const consoleErrors: string[] = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(e.message))

  // --- Ombor: send the full 30 kg to Rezka, receive 30 kg Standard (auto-close) ---
  await loginAs(page, 'OMBOR')
  await page.getByRole('link', { name: 'Moykaga', exact: true }).click()
  await page.getByRole('group', { name: 'Jarayon' }).getByRole('button', { name: 'Rezka' }).click()
  await page.getByRole('button', { name: '+ Tashqaridan olish' }).click()
  await page.getByRole('button', { name: new RegExp(ctx.rezkaSerial!) }).click()
  await page.locator('#tashqi-rezka-weighed').fill(String(REZKA_KG))
  await page.getByRole('button', { name: 'Rezkaga yuborish' }).click()
  await expect(page.getByText(`${REZKA_KG} kg Rezkaga yuborildi.`)).toBeVisible()

  await page.getByRole('link', { name: 'Tayyor', exact: true }).click()
  await page.getByRole('group', { name: 'Jarayon' }).getByRole('button', { name: 'Rezka' }).click()
  await page.getByRole('button', { name: '+ Rezkadan qabul qilish' }).click()
  await page.getByRole('button', { name: new RegExp(ctx.rezkaSerial!) }).click()
  await page.locator(`#cal-${ctx.rezkaSerial}`).selectOption({ label: 'Standard' })
  await page.locator(`#w-${ctx.rezkaSerial}`).fill(String(REZKA_KG))
  await page.getByRole('button', { name: 'Saqlash', exact: true }).click()
  await expect(page.getByText(`PLT-${ctx.rezkaSerial}-RKN-1`)).toBeVisible()
  const cycle = await one(db.from('rezka_cycles').select('closed_at').eq('serial', ctx.rezkaSerial!).single(), 'rezka cycle')
  expect(cycle.closed_at).not.toBeNull()

  // Safety: FIFO is not owner-scoped, so dispatching Standard is only safe if
  // ours is the ONLY available Standard for this type.
  const before = await standardAvailableKg()
  expect(before, 'other Standard stock exists for this type -- dispatch would consume it; aborting').toBe(REZKA_KG)

  // --- Menejer: Kalibrlangan has no Standard; Rezka tab shows 30 kg; one truck: Rezka + Xom ---
  await switchTo(page, 'MENEJER')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(ctx.chiqimPlate!)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  const form = page.locator('form:has-text("Yangi CHIQIM")')
  await form.locator('select').nth(0).selectOption({ label: OWNER_NAME })
  const line1 = form.locator('.rounded-md', { has: page.getByRole('button', { name: 'Kalibrlangan' }) }).first()
  await line1.locator('select').nth(0).selectOption({ label: TYPE_NAME })
  await expect(line1.locator('select').nth(1).locator('option', { hasText: 'Standard' })).toHaveCount(0)
  // KN stays. The list is not category-filtered (HANDOFF follow-up), so there
  // may be one Konditerka per category -- at least one is what matters.
  expect(await line1.locator('select').nth(1).locator('option', { hasText: 'Konditerka' }).count()).toBeGreaterThan(0)
  await line1.getByRole('button', { name: 'Rezka', exact: true }).click()
  await expect(line1.locator('select').nth(1).locator('option:not([disabled])')).toHaveText(['Standard'])
  await expect(line1.locator('select').nth(1)).toHaveValue(ctx.standardId!) // preselected from the type
  await expect(line1.getByText(`Mavjud: ${REZKA_KG} kg`)).toBeVisible()
  await line1.getByPlaceholder('Sof miqdor (kg)').fill(String(REZKA_KG))
  await expect(line1.getByText('Omborda yetarli emas')).toHaveCount(0)

  await page.getByRole('button', { name: "+ Tur/kalibr qo'shish" }).click()
  const line2 = form.locator('.rounded-md', { has: page.getByRole('button', { name: 'Kalibrlangan' }) }).nth(1)
  await line2.getByRole('button', { name: 'Xom', exact: true }).click()
  await line2.locator('select').nth(0).selectOption({ label: TYPE_NAME })
  await line2.getByRole('button', { name: new RegExp(ctx.moykaSerial!) }).click()
  await line2.getByPlaceholder('Taxminiy miqdor (ixtiyoriy)').fill(String(MOYKA_KG))
  await page.getByRole('button', { name: 'Saqlash', exact: true }).click()
  await expect(page.getByText(/Subxon · Rezka Standard/)).toBeVisible() // saved panel

  const req = await one(db.from('chiqim_requests').select('id').eq('plate', ctx.chiqimPlate!).single(), 'chiqim request')
  const clines = await one(db.from('chiqim_lines').select('line_kind, calibre_id, qty_kg').eq('request_id', req.id), 'chiqim lines')
  const rezkaLine = clines.find((l) => l.calibre_id === ctx.standardId)!
  expect(rezkaLine.line_kind).toBe('finished') // ordinary calibrated line
  expect(Number(rezkaLine.qty_kg)).toBe(REZKA_KG)
  expect(clines.some((l) => l.line_kind === 'raw')).toBe(true)

  // --- Qorovul weigh-1 ---
  await switchTo(page, 'QOROVUL')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  const faol = page.getByRole('heading', { name: '1 · Faol yuklar' }).locator('xpath=following-sibling::div[1]')
  const gateRow = faol.locator('.rounded-md', { hasText: ctx.chiqimPlate! })
  await gateRow.getByRole('button', { name: 'Qabul qilish' }).click()
  await gateRow.locator('div:has(> label:text-is("Moshina rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await gateRow.locator('div:has(> label:text-is("Bo\'sh vazn (Пустой)")) input[type="number"]').fill('8000')
  await gateRow.locator('div:has(> label:text-is("Bo\'sh vazn rasmi (tarozi)")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await gateRow.getByRole('button', { name: 'Saqlash' }).click()
  await expect(faol.locator('.rounded-md.border-red-300', { hasText: ctx.chiqimPlate! })).toBeVisible()

  // --- Ombor: Rezka line badged; load 30 kg Standard + 10 kg raw; finalize ---
  await switchTo(page, 'OMBOR')
  await page.getByRole('link', { name: 'CHIQIM', exact: true }).click()
  const omborW1 = page.getByRole('heading', { name: '1 · Yuklashga tayyor — moshina keldi' }).locator('xpath=following-sibling::div[1]')
  const omborRequest = omborW1.locator('div.rounded-md.border.border-slate-200.p-3', { hasText: ctx.chiqimPlate! })
  await expect(omborRequest).toBeVisible({ timeout: 20000 })
  await expect(omborRequest.getByText('Rezka').first()).toBeVisible()
  await omborRequest.getByRole('button', { name: 'Yuklashni boshlash' }).click()
  await page.getByPlaceholder("Yuklangan og'irlik (kg)").fill(String(REZKA_KG))
  // The shortfall note is live and lists EVERY short line. With the Standard
  // line loaded but the Xom line not yet, only Xom may be listed -- the
  // Rezka/Standard line itself must show no shortfall.
  const shortfall = page.getByText(/^Yetarli emas:/)
  await expect(shortfall).toBeVisible()
  await expect(shortfall).toContainText(`Xom — ${MOYKA_KG} kg kam`)
  await expect(shortfall).not.toContainText('Standard')
  await page.getByRole('button', { name: new RegExp(`${ctx.moykaSerial}.*kg mavjud`) }).click()
  await page.getByPlaceholder('Vazn (kg)').fill(String(MOYKA_KG + 1))
  await page.getByPlaceholder('Quti massasi (kg)').fill('1')
  await page.getByRole('button', { name: "+ Qo'shish" }).click()
  // Xom now loaded net 10 kg (11 − 1 tara): no line is short, note gone.
  await expect(page.getByText('Yetarli emas')).toHaveCount(0)
  await page.getByRole('button', { name: 'Yuklashni yakunlash' }).click()
  await page.getByRole('button', { name: 'Ha, yakunlash' }).click()
  await expect(omborRequest).not.toBeVisible({ timeout: 20000 })
  // Poll: the UI settling is not proof the DB read will see the commit.
  await expect.poll(standardAvailableKg, { timeout: 15_000 }).toBe(0)

  // --- Qorovul weigh-2 -> departed ---
  await switchTo(page, 'QOROVUL')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  const gateRow2 = page.getByRole('heading', { name: '1 · Faol yuklar' }).locator('xpath=following-sibling::div[1]').locator('.rounded-md', { hasText: ctx.chiqimPlate! })
  await gateRow2.getByRole('button', { name: 'Yakunlash' }).click()
  await gateRow2.locator('div:has(> label:text-is("Yuk bilan vazn (Гружёный)")) input[type="number"]').fill('8042')
  await gateRow2.locator('div:has(> label:text-is("Yuk bilan vazn rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await gateRow2.locator('div:has(> label:text-is("Chiqish hujjati rasmi")) input[type="file"]').setInputFiles(TEST_PHOTO)
  await gateRow2.getByRole('button', { name: 'Yakunlash' }).click()
  const yak = page.getByRole('heading', { name: '2 · Yakunlangan' }).locator('xpath=following-sibling::div[1]')
  await expect(yak.locator('.rounded-md', { hasText: ctx.chiqimPlate! })).toBeVisible({ timeout: 20000 })

  await expect
    .poll(async () => (await one(db.from('chiqim_requests').select('status').eq('id', req.id).single(), 'request status')).status, { timeout: 15_000 })
    .toBe('olib_ketildi')
  const consumed = await one(db.from('chiqim_pallet_consumption').select('barcode2, qty_kg').eq('chiqim_line_id', (await one(db.from('chiqim_lines').select('id').eq('request_id', req.id).eq('calibre_id', ctx.standardId!).single(), 'rezka line id')).id), 'consumption')
  expect(consumed).toEqual([{ barcode2: `PLT-${ctx.rezkaSerial}-RKN-1`, qty_kg: REZKA_KG }])
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
})

test('3 · Kalibrlangan Kalibr 6 request is unchanged (created, then voided -- never finalized)', async ({ page }) => {
  test.setTimeout(90_000)
  const db = serviceClient()
  const k6Rows = await one(
    db.from('finished_calibre_availability').select('available_kg').eq('type_id', ctx.typeId!).eq('calibre_id', ctx.k6Id!).eq('is_old_stock', false).eq('owner_id', ctx.ownerId!),
    'K6 availability',
  )
  const k6Avail = Math.round(k6Rows.reduce((s, r) => s + Number(r.available_kg), 0))

  await loginAs(page, 'MENEJER')
  await page.getByRole('link', { name: 'CHIQIM' }).click()
  await page.locator('div:has(> label:text-is("Moshina raqami")) > input').fill(ctx.k6Plate!)
  await page.locator('div:has(> label:text-is("Haydovchi ismi")) > input').fill('TEST Driver')
  const chiqimSelects = page.locator('form:has-text("Yangi CHIQIM") select')
  await chiqimSelects.nth(0).selectOption({ label: OWNER_NAME })
  await chiqimSelects.nth(1).selectOption({ label: TYPE_NAME })
  await chiqimSelects.nth(2).selectOption({ label: 'Kalibr 6' })
  await expect(page.getByText(`Mavjud: ${k6Avail.toLocaleString()} kg`)).toBeVisible()
  await page.getByPlaceholder('Sof miqdor (kg)').fill('10')
  await page.getByRole('button', { name: 'Saqlash', exact: true }).click()
  await expect(page.getByText('Subxon · Kalibr 6')).toBeVisible()

  const req = await one(db.from('chiqim_requests').select('id').eq('plate', ctx.k6Plate!).single(), 'K6 request')
  const [line] = await one(db.from('chiqim_lines').select('line_kind, calibre_id, qty_kg').eq('request_id', req.id), 'K6 line')
  expect(line).toEqual({ line_kind: 'finished', calibre_id: ctx.k6Id, qty_kg: 10 })

  // Void (reversible, same fields as FinishedChiqimList's own void) --
  // finalizing would FIFO-consume real clients' Kalibr 6 stock.
  const menejer = await one(db.from('profiles').select('id').eq('role', 'menejer').like('full_name', 'TEST %').limit(1).single(), 'TEST Menejer')
  await one(
    db.from('chiqim_requests').update({ voided_at: new Date().toISOString(), voided_by: menejer.id }).eq('id', req.id).select('id').single(),
    'void K6 request',
  )
})
