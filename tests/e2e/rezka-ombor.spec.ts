import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './helpers/login'
import { uniqueTestId } from './helpers/fixtures'
import { serviceClient } from './helpers/teardown'

// Rezka Prompt 2 (SPEC.md §5.R "Ombor sections 2 and 3"; docs/decisions/0224).
// Drives both Ombor Rezka flows through the real UI as TEST Ombor:
//   Tashqi: a process='rezka' delivery serial -> Tashqaridan olish (100 kg)
//           -> receive 104 kg Standard (a gain, cycle stays open) ->
//           Yakunlash, confirmation reads "Ortiqcha +4 kg".
//   Ichki:  60 kg of TEST Konditerka -> Ichkaridan olish 25 kg (mints a
//           serial) -> receive exactly 25 kg -> auto-close.
//
// Fixtures (CLAUDE.md "Testing workflow"): everything hangs off a DEDICATED
// owner, "TEST Rezka E2E" (found or created, never a real owner), with
// TEST- plates, so the irreversible Ichki draw can only ever consume the
// Konditerka this spec seeded. Seeding and cleanup use the Node-side
// service client (helpers/teardown.ts) -- never passed into the page.
// Cleanup VOIDS, never deletes: every pallet this run made (seeded KN and
// received Standard) -> bekor_qilindi, every Rezka/wash cycle it opened ->
// closed. The TEST owner is left in place, like the TEST role accounts.
//
// Run locally alongside full-chain.spec.ts (needs .env.test with the TEST_*
// credentials and SUPABASE_SERVICE_ROLE_KEY):
//   npx playwright test tests/e2e/rezka-ombor.spec.ts tests/e2e/full-chain.spec.ts

const OWNER_NAME = 'TEST Rezka E2E'
const TYPE_NAME = 'Subxon'

interface Seeded {
  ownerId: string
  typeId: string
  tashqiSerial: string
  knSerial: string
  knPallets: string[]
  washCycleId: string
}

let seeded: Seeded | null = null
let mintedSerial: string | null = null

async function one<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<NonNullable<T>> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  if (data === null || data === undefined) throw new Error(`${what}: no row`)
  return data
}

async function seed(): Promise<Seeded> {
  const db = serviceClient()
  const today = new Date().toISOString().slice(0, 10)

  let owner = (await db.from('owners').select('id').eq('name', OWNER_NAME).maybeSingle()).data as { id: string } | null
  if (!owner) {
    owner = await one(db.from('owners').insert({ name: OWNER_NAME, active: true }).select('id').single(), 'owner insert')
  }
  const type = await one(db.from('product_types').select('id, category_id').eq('name', TYPE_NAME).single(), 'type lookup')
  const kn = await one(
    db.from('calibres').select('id').eq('category_id', type.category_id).eq('code', 'KN').single(),
    'KN calibre lookup',
  )
  const ombor = await one(
    db.from('profiles').select('id').eq('role', 'ombor').like('full_name', 'TEST %').limit(1).single(),
    'TEST Ombor profile',
  )
  const lab = await one(
    db.from('profiles').select('id').eq('role', 'laborator').like('full_name', 'TEST %').limit(1).single(),
    'TEST Laborator profile',
  )

  // Tashqi: a real-shaped Rezka delivery, already accepted into storage (100 kg).
  const tOrder = await one(
    db
      .from('kirim_orders')
      .insert({
        order_date: today,
        plate: uniqueTestId('RZ-T'),
        driver: 'TEST Driver',
        owner_id: owner.id,
        declared_total: 100,
        origin: 'delivery',
        status: 'qabul_qilindi',
      })
      .select('order_id')
      .single(),
    'Tashqi order',
  )
  const tLine = await one(
    db.from('kirim_lines').insert({ order_id: tOrder.order_id, type_id: type.id, declared_qty: 100, process: 'rezka' }).select('serial').single(),
    'Tashqi line',
  )
  await one(
    db
      .from('storage_intake')
      .insert({ serial: tLine.serial, actual_qty: 100, box_mass_kg: 0, confirmed_at: new Date().toISOString(), confirmed_by: ombor.id })
      .select('serial')
      .single(),
    'Tashqi intake',
  )

  // Konditerka source: a Moyka serial, lab-passed, two 30 kg KN pallets.
  const kOrder = await one(
    db
      .from('kirim_orders')
      .insert({
        order_date: today,
        plate: uniqueTestId('RZ-KN'),
        driver: 'TEST Driver',
        owner_id: owner.id,
        declared_total: 60,
        origin: 'delivery',
        status: 'qabul_qilindi',
      })
      .select('order_id')
      .single(),
    'KN source order',
  )
  const kLine = await one(
    db.from('kirim_lines').insert({ order_id: kOrder.order_id, type_id: type.id, declared_qty: 60, process: 'moyka' }).select('serial').single(),
    'KN source line',
  )
  const wc = await one(
    db.from('wash_cycles').insert({ serial: kLine.serial, cycle_no: 1, status: 'active' }).select('id').single(),
    'KN source wash cycle',
  )
  await one(
    db
      .from('lab_results')
      .insert({
        scope: 'chiqim',
        parent_serial: kLine.serial,
        wash_cycle_id: wc.id,
        sample_date: today,
        moisture_pct: 8,
        verdict: 'o_tdi',
        status: 'complete',
        tested_by: lab.id,
      })
      .select('id')
      .single(),
    'KN source lab verdict',
  )
  const knPallets = [`PLT-${kLine.serial}-KN-1`, `PLT-${kLine.serial}-KN-2`]
  await one(
    db
      .from('finished_pallets')
      .insert(
        knPallets.map((b) => ({ barcode2: b, serial: kLine.serial, type_id: type.id, calibre_id: kn.id, weight_kg: 30, received_date: today })),
      )
      .select('barcode2'),
    'KN pallets',
  )

  return { ownerId: owner.id, typeId: type.id, tashqiSerial: tLine.serial, knSerial: kLine.serial, knPallets, washCycleId: wc.id }
}

// Void, never delete (SPEC.md §2.15).
async function cleanup() {
  if (!seeded) return
  const db = serviceClient()
  const serials = [seeded.tashqiSerial, seeded.knSerial, ...(mintedSerial ? [mintedSerial] : [])]
  const now = new Date().toISOString()
  await db.from('finished_pallets').update({ status: 'bekor_qilindi', voided_at: now }).in('serial', serials).is('voided_at', null)
  await db.from('rezka_cycles').update({ closed_at: now }).in('serial', serials).is('closed_at', null)
  await db.from('wash_cycles').update({ closed_at: now }).eq('id', seeded.washCycleId).is('closed_at', null)
}

test.beforeAll(async () => {
  seeded = await seed()
})

test.afterAll(async () => {
  await cleanup()
})

async function pickRezka(page: Page) {
  await page.getByRole('group', { name: 'Jarayon' }).getByRole('button', { name: 'Rezka' }).click()
  await expect(page.getByRole('group', { name: 'Jarayon' }).getByRole('button', { name: 'Rezka' })).toHaveAttribute('aria-pressed', 'true')
}

test('Ombor Rezka: Tashqi send + gain close, Ichki draw + exact auto-close', async ({ page }) => {
  test.setTimeout(150_000)
  const s = seeded!
  const db = serviceClient()
  const consoleErrors: string[] = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(e.message))

  await loginAs(page, 'OMBOR')

  // --- Section 2, Rezka pill: Tashqaridan olish, 100 kg ---
  await page.getByRole('link', { name: 'Moykaga', exact: true }).click()
  await pickRezka(page)
  await page.getByRole('button', { name: '+ Tashqaridan olish' }).click()
  await page.getByRole('button', { name: new RegExp(s.tashqiSerial) }).click()
  await page.locator('#tashqi-rezka-weighed').fill('100')
  await page.getByRole('button', { name: 'Rezkaga yuborish' }).click()
  await expect(page.getByText('100 kg Rezkaga yuborildi.')).toBeVisible()
  const sends = await one(db.from('rezka_sends').select('qty_kg').eq('serial', s.tashqiSerial), 'rezka_sends read')
  expect(sends.map((r) => Number(r.qty_kg))).toEqual([100])
  const tCycle = await one(db.from('rezka_cycles').select('closed_at').eq('serial', s.tashqiSerial), 'Tashqi cycle read')
  expect(tCycle).toHaveLength(1)
  expect(tCycle[0].closed_at).toBeNull()
  await page.getByRole('button', { name: 'Yopish' }).click()

  // --- Section 2: Ichkaridan olish, 25 kg of the seeded 60 kg ---
  await page.getByRole('button', { name: '+ Ichkaridan olish' }).click()
  await page.locator('#ichki-owner').selectOption({ label: OWNER_NAME })
  await page.locator('#ichki-type').selectOption({ label: TYPE_NAME })
  await expect(page.getByText('Mavjud Konditerka').locator('xpath=following-sibling::span[1]')).toHaveText('60 kg')
  await page.locator('#ichki-kg').fill('25')
  await expect(page.getByText('Odatda 10 kg dan kam olinmaydi')).toHaveCount(0)
  await page.getByRole('button', { name: 'Rezkaga yuborish' }).click()
  const ok = page.getByText(/Seriya \S+: 25 kg Rezkaga yuborildi\./)
  await expect(ok).toBeVisible()
  mintedSerial = (await ok.textContent())!.match(/Seriya (\S+):/)![1]
  const draws = await one(db.from('rezka_kn_draws').select('barcode2, qty_kg').eq('minted_serial', mintedSerial), 'draws read')
  expect(draws.reduce((a, d) => a + Number(d.qty_kg), 0)).toBe(25)
  expect(draws.every((d) => s.knPallets.includes(d.barcode2))).toBe(true)
  const mLine = await one(db.from('kirim_lines').select('process, order_id').eq('serial', mintedSerial).single(), 'minted line')
  expect(mLine.process).toBe('rezka')
  await page.getByRole('button', { name: 'Yopish' }).click()

  // --- Section 2 Window 2 "Rezkada": both serials, with provenance badges ---
  const rezkada = page.getByRole('heading', { name: '2 · Rezkada' }).locator('xpath=following-sibling::div[1]')
  await expect(rezkada.getByText(s.tashqiSerial)).toBeVisible()
  await expect(rezkada.getByText(mintedSerial)).toBeVisible()
  await expect(rezkada.getByText('Rezka · Tashqi')).toBeVisible()
  await expect(rezkada.getByText('Rezka · Ichki KN')).toBeVisible()

  // --- Section 3, Rezka pill: receive 104 kg Standard on Tashqi (a gain) ---
  await page.getByRole('link', { name: 'Tayyor', exact: true }).click()
  await pickRezka(page)
  await page.getByRole('button', { name: '+ Rezkadan qabul qilish' }).click()
  await page.getByRole('button', { name: new RegExp(s.tashqiSerial) }).click()
  const calSelect = page.locator(`#cal-${s.tashqiSerial}`)
  await expect(calSelect.locator('option:not([disabled])')).toHaveText(['Standard'])
  await calSelect.selectOption({ label: 'Standard' })
  await page.locator(`#w-${s.tashqiSerial}`).fill('104')
  await page.getByRole('button', { name: 'Saqlash', exact: true }).click()
  await expect(page.getByText(`PLT-${s.tashqiSerial}-RKN-1`)).toBeVisible()
  const tPallet = await one(db.from('finished_pallets').select('weight_kg').eq('barcode2', `PLT-${s.tashqiSerial}-RKN-1`).single(), 'Tashqi pallet')
  expect(Number(tPallet.weight_kg)).toBe(104)
  const stillOpen = await one(db.from('rezka_cycles').select('closed_at').eq('serial', s.tashqiSerial).single(), 'Tashqi cycle after gain')
  expect(stillOpen.closed_at).toBeNull() // over-receive never auto-closes

  // Ichki: receive exactly 25 kg -> auto-close
  await page.getByRole('button', { name: 'Yopish' }).click()
  await page.getByRole('button', { name: '+ Rezkadan qabul qilish' }).click()
  await page.getByRole('button', { name: new RegExp(mintedSerial) }).click()
  await page.locator(`#cal-${mintedSerial}`).selectOption({ label: 'Standard' })
  await page.locator(`#w-${mintedSerial}`).fill('25')
  await page.getByRole('button', { name: 'Saqlash', exact: true }).click()
  await expect(page.getByText(`PLT-${mintedSerial}-RKN-1`)).toBeVisible()
  const autoClosed = await one(db.from('rezka_cycles').select('closed_at').eq('serial', mintedSerial).single(), 'Ichki cycle')
  expect(autoClosed.closed_at).not.toBeNull()
  await page.getByRole('button', { name: 'Yopish' }).click()

  // --- Section 3 Window 2: Yakunlash the Tashqi serial, signed wording ---
  const received = page.getByRole('heading', { name: '2 · Qabul qilingan seriyalar' }).locator('xpath=following-sibling::div[1]')
  const tCard = received.locator('div', { hasText: s.tashqiSerial }).filter({ has: page.getByRole('button', { name: 'Yakunlash' }) }).last()
  await tCard.getByRole('button', { name: 'Yakunlash' }).click()
  await expect(tCard.getByText('Ortiqcha +4 kg')).toBeVisible()
  await tCard.getByRole('button', { name: 'Yakunlash' }).click()
  await expect(received.getByText('Ortiqcha +4 kg').first()).toBeVisible()
  const closed = await one(db.from('rezka_cycles').select('closed_at').eq('serial', s.tashqiSerial).single(), 'Tashqi cycle closed')
  expect(closed.closed_at).not.toBeNull()

  // Nothing on the Rezka path prints: no Barcode #2 print/preview controls rendered.
  await expect(page.getByRole('button', { name: 'Barcode #2' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Chop etish/ })).toHaveCount(0)
  expect(consoleErrors).toEqual([])
})
