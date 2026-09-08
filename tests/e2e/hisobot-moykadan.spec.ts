import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'

// Hisobot MOYKADAN direction: one row per serial (not per pallet), correct
// "received from Moyka" total, and both headline volume columns default-
// visible (2026-09-03, migration 0111 — see docs/DECISIONS.md "Hisobot:
// MOYKADAN per-serial rows" for the full diagnosis this mirrors through the
// real UI, and the live-SQL numbers this test's assertions are drawn from).
//
// Read-only against real August 2026 business data — no fixtures seeded,
// nothing to tear down. CLAUDE.md's TEST--prefix rule governs test WRITES;
// a read-only assertion against real historical data is the explicitly
// carved-out case ("it may read that data, but any row it writes must
// carry the prefix").
//
// 🚩 Fragility, flagged rather than hidden: the 40,190 kg / 11-serial
// figures below are August 2026's real numbers as of 2026-09-03,
// independently reconciled against rahbar_dashboard_ledger and yield_rows
// (see DECISIONS.md — four independent paths agree on 40,190, not the task
// brief's originally-cited 40,200). Because a past-dated pallet can still be
// voided/corrected later (append-only, never deleted), these two numbers
// could in principle drift if August 2026 data is ever touched again after
// this test was written. The other assertions here (no duplicate serial,
// both headline columns visible without opening Ustunlar, the row-summed
// kg agreeing with the server-computed total) are structural and do not
// depend on August 2026 specifically — only the two hardcoded values below
// would need updating if that drift ever happens.
test('Hisobot MOYKADAN: one row per serial, correct total, headline columns visible by default', async ({ page }) => {
  await loginAs(page, 'MENEJER')
  await page.goto('/menejer/hisobot')

  // Direction: MOYKADAN only.
  await page.getByRole('button', { name: /Yo'nalish/ }).click()
  await page.getByLabel('MOYKADAN').check()
  await page.getByRole('button', { name: /Yo'nalish/ }).click() // close the checkbox panel before touching the date inputs beside it

  // Date range: August 2026, in full.
  const dateInputs = page.locator('input[type="date"]')
  await dateInputs.first().fill('2026-08-01')
  await dateInputs.nth(1).fill('2026-08-31')

  // (c) Both headline volume columns render by default — never opened
  // "Ustunlar" (the column picker) anywhere in this test.
  const table = page.locator('table')
  await expect(table.locator('thead').getByText('Moykaga yuborilgan, kg')).toBeVisible()
  await expect(table.locator('thead').getByText('Moykadan chiqgan, kg')).toBeVisible()

  // (a) Total = the reconciled figure (see the fragility note above for why
  // this is 40,190, not the task brief's original 40,200).
  await expect(page.getByText("Moykadan chiqgan (davrda): 40,190 kg")).toBeVisible()
  // "Moykaga yuborilgan (davrda)" is 0 kg in this view by construction —
  // filtering direction to MOYKADAN only excludes every moyka_send-kind
  // row from the filtered set that chip sums over, not a bug. Assert it
  // renders (structural requirement (c)), not its value.
  await expect(page.getByText(/Moykaga yuborilgan \(davrda\):/)).toBeVisible()

  // (b) No serial appears more than once. Scoped to the desktop <table>
  // specifically — ReportRowCard (the <lg:hidden> mobile card variant)
  // renders the exact same rows into the DOM at the same time, just
  // display:none at this (desktop) viewport, and would double-match a
  // page-wide text locator otherwise.
  const rowTexts = await table.locator('tbody tr').allInnerTexts()
  const serialPattern = /\b\d{6}-\d{3}\b/ // this app's serial format, e.g. "280726-029"
  const serials = rowTexts.map((t) => t.match(serialPattern)?.[0]).filter((s): s is string => !!s)
  expect(serials, 'every MOYKADAN row should carry a real serial').toHaveLength(rowTexts.length)
  expect(new Set(serials).size, 'no serial should appear on more than one row').toBe(serials.length)
  expect(serials).toHaveLength(11)
})
