import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'

// Moykada/Yo'qotish period-scoping (2026-09-14, see docs/decisions/0186-...-
// moykada-yoqotish-period-scoping.md) — the invariant this fix exists to
// hold: on any Hisobot row, in any period, either Moykada is nonzero (the
// cycle is open, or closed but this period predates the close) or Yo'qotish
// is non-blank (the cycle closed THIS period) — never both. Before this fix,
// Moykada was as-of-now (kirim_line_state) and Yo'qotish was lifetime
// (client_serial_loss_kg), so a serial that closed in September showed 0 in
// Moykada AND its full loss figure in EVERY period it had a row in,
// including August, where the material was still genuinely in the wash.
//
// Read-only against real business data — no fixtures seeded, nothing to
// tear down. CLAUDE.md's TEST--prefix rule governs test WRITES; this test
// only reads (the explicitly carved-out case). Serial 110826-002 and its
// August/September figures are real, reconciled live-SQL numbers (see the
// decision doc) — same fragility caveat as hisobot-moykadan.spec.ts: an
// append-only correction to this specific serial's data after this test was
// written could in principle change these two hardcoded values.
test('Moykada/Yo\'qotish: 110826-002 shows the invariant correctly split across its closing month', async ({ page }) => {
  await loginAs(page, 'MENEJER')
  await page.goto('/menejer/hisobot')

  await page.getByPlaceholder('Seriya qidirish').fill('110826-002')

  // Moykada is default-hidden; Yo'qotish is already default-visible.
  await page.getByRole('button', { name: /Ustunlar/ }).click()
  await page.getByLabel('Moykada, kg').check()
  await page.getByRole('button', { name: /Ustunlar/ }).click()

  const table = page.locator('table')
  const headerCells = await table.locator('thead th').allInnerTexts()
  const moykadaCol = headerCells.findIndex((t) => t.trim() === 'Moykada, kg')
  const yoqotishCol = headerCells.findIndex((t) => t.trim() === "Yo'qotish, kg")
  expect(moykadaCol, 'Moykada column should be visible after enabling it via Ustunlar').toBeGreaterThanOrEqual(0)
  expect(yoqotishCol, "Yo'qotish column should be visible by default").toBeGreaterThanOrEqual(0)

  const dateInputs = page.locator('input[type="date"]')

  // August: cycle still open (closes 2026-09-04) — in-moyka balance 15 kg,
  // no loss recognized yet.
  await dateInputs.first().fill('2026-08-01')
  await dateInputs.nth(1).fill('2026-08-31')
  const augRow = table.locator('tbody tr').first()
  await expect(augRow.locator('td').nth(moykadaCol)).toHaveText('15 kg')
  await expect(augRow.locator('td').nth(yoqotishCol)).toHaveText('—')

  // September: cycle closes this month — nothing left in Moyka, the 55 kg
  // gap (received > sent) is recognized here as a surplus ("+55 kg", not a
  // loss — see formatLoss.ts's sign convention).
  await dateInputs.first().fill('2026-09-01')
  await dateInputs.nth(1).fill('2026-09-30')
  const sepRow = table.locator('tbody tr').first()
  await expect(sepRow.locator('td').nth(moykadaCol)).toHaveText('0 kg')
  await expect(sepRow.locator('td').nth(yoqotishCol)).toHaveText('+55 kg')
})

// Structural regression, not tied to one serial or one month: across every
// row MOYKADAN produces for the two months this session's data covers, no
// row may show both a nonzero Moykada and a non-blank Yo'qotish at once.
test('Moykada/Yo\'qotish: never both nonzero on the same row, across the whole August-September MOYKADAN view', async ({
  page,
}) => {
  await loginAs(page, 'MENEJER')
  await page.goto('/menejer/hisobot')

  await page.getByRole('button', { name: /Yo'nalish/ }).click()
  await page.getByLabel('MOYKADAN').check()
  await page.getByRole('button', { name: /Yo'nalish/ }).click()

  await page.getByRole('button', { name: /Ustunlar/ }).click()
  await page.getByLabel('Moykada, kg').check()
  await page.getByRole('button', { name: /Ustunlar/ }).click()

  const dateInputs = page.locator('input[type="date"]')
  await dateInputs.first().fill('2026-08-01')
  await dateInputs.nth(1).fill('2026-09-30')

  const table = page.locator('table')
  const headerCells = await table.locator('thead th').allInnerTexts()
  const moykadaCol = headerCells.findIndex((t) => t.trim() === 'Moykada, kg')
  const yoqotishCol = headerCells.findIndex((t) => t.trim() === "Yo'qotish, kg")

  const rows = table.locator('tbody tr')
  const rowCount = await rows.count()
  expect(rowCount, 'MOYKADAN, August-September should have at least one row to check').toBeGreaterThan(0)

  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i)
    const moykadaText = (await row.locator('td').nth(moykadaCol).innerText()).trim()
    const yoqotishText = (await row.locator('td').nth(yoqotishCol).innerText()).trim()
    const moykadaNonzero = moykadaText !== '0 kg' && moykadaText !== '—'
    const yoqotishNonBlank = yoqotishText !== '—'
    expect(
      moykadaNonzero && yoqotishNonBlank,
      `row ${i} shows both Moykada (${moykadaText}) and Yo'qotish (${yoqotishText}) — invariant violated`,
    ).toBe(false)
  }
})
