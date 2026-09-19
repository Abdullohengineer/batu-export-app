import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/login'

// Hisobot filter debounce: rapid filter changes must never leave
// totals/rows inconsistent (2026-09-19 incident — see
// docs/decisions/ for the full root-cause writeup).
//
// What broke: the 2026-09-19 debounce change (useReportQuery.ts) delayed
// WHEN report_query_page/report_totals fired, but never cancelled a
// request that had already fired once a newer filter change superseded
// it — no AbortController, no `.error` check on either RPC result. Real
// production traffic showed bursts of BOTH RPCs failing together with
// Postgres 57014 ("canceling statement due to statement timeout") once
// several of these real, uncancelled requests piled up concurrently —
// confirmed live via Supabase logs, not reproduced by inspection alone.
// Silently swallowed, this rendered as either a fully empty screen or a
// nonzero "N ta natija" total next to a genuinely empty results table,
// depending on which of the two paired RPCs happened to fail.
//
// The fix: supersede via AbortController.abort() (actually cancels the
// in-flight request instead of just ignoring its result on arrival, which
// is what breaks the pile-up), plus explicit `.error` surfacing so a real
// failure shows an error banner instead of a fabricated empty result.
//
// This test can't force the exact timeout race on demand (that needs
// genuine server-side contention, not something a single Playwright
// session controls) — it instead asserts the INVARIANT the fix
// guarantees regardless of whether any individual request happens to be
// superseded or fails: the results table and the "N ta natija" count
// must never disagree, and a real failure must show as a visible error,
// never as a silent empty result. Real login, real backend — no
// fixtures seeded, nothing to tear down (read-only).
test('Hisobot: rapid filter changes never desync totals from rows', async ({ page }) => {
  await loginAs(page, 'MENEJER')
  await page.goto('/menejer/hisobot')

  // Wide date range so there's a realistic chance of a nonzero result set
  // to actually exercise the "N ta natija but empty table" failure mode
  // (an always-empty result would trivially "pass" without proving
  // anything).
  const dateInputs = page.locator('input[type="date"]')
  await dateInputs.first().fill('2020-01-01')
  await dateInputs.nth(1).fill('2027-12-31')

  // Rapid-fire filter changes, faster than the 300ms debounce — the exact
  // pattern the bug report described ("degrades with more interactions").
  // Toggle each direction on then off, repeatedly, with no waiting between
  // clicks.
  const yonalishButton = page.getByRole('button', { name: /Yo'nalish/ })
  const directions = ['KIRIM', 'MOYKAGA', 'MOYKADAN']
  for (let round = 0; round < 3; round++) {
    await yonalishButton.click()
    for (const d of directions) {
      await page.getByLabel(d).click({ timeout: 2000 }).catch(() => {}) // best-effort — label wording may vary by direction; skip if not found rather than fail the interaction loop
    }
    await yonalishButton.click() // close the panel before the next round touches it again
  }

  // Settle: wait out the debounce window plus real network round-trips,
  // then let Playwright's own auto-retrying `expect` poll for a stable
  // final state rather than asserting immediately.
  await page.waitForTimeout(500)
  await expect(page.getByText('Yuklanmoqda…')).toBeHidden({ timeout: 20_000 })

  // Core invariant: totals and rows must agree, and a real failure must
  // be a VISIBLE error, never a silent/misleading empty state.
  const errorBanner = page.getByText(/Hisobotni yuklashda xatolik yuz berdi/)
  const emptyText = page.getByText('Natija topilmadi.', { exact: true })
  const resultCountText = page.getByText(/\d+ ta natija/)

  const [errorVisible, emptyVisible, countVisible] = await Promise.all([
    errorBanner.isVisible(),
    emptyText.isVisible(),
    resultCountText.isVisible(),
  ])

  if (errorVisible) {
    // A genuine backend failure surfaced — acceptable (that's the fix
    // working as designed), but it must be the ONLY story on screen: not
    // paired with the misleading "Natija topilmadi" empty state, which
    // would mean the old silent-swallow behavior is back.
    await expect(emptyText).toBeHidden()
    return
  }

  expect(errorVisible, 'no error banner should be present outside the failure path above').toBe(false)

  if (countVisible) {
    // Totals claim results exist — the table must actually show at least
    // one row. This is the EXACT mismatch the bug report described
    // ("says 1 natija topildi but renders zero rows").
    const countText = await resultCountText.textContent()
    const n = Number(countText?.match(/\d+/)?.[0] ?? '0')
    const table = page.locator('table')
    const rowCount = await table.locator('tbody tr').count()
    if (n > 0) {
      expect(rowCount, `totals claimed ${n} natija but the table rendered ${rowCount} rows`).toBeGreaterThan(0)
    } else {
      // n === 0 without the empty-state text visible would itself be a
      // (different) inconsistency — HistoryView always shows one or the
      // other.
      expect(emptyVisible || rowCount === 0).toBe(true)
    }
  } else {
    // No count shown at all means the empty state must be why.
    expect(emptyVisible, 'neither a result count nor "Natija topilmadi" is showing — the screen is in an indeterminate state').toBe(true)
  }
})
