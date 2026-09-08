## 2026-08-05 — `full-chain.spec.ts`'s long-standing flake: root cause and fix

**Context.** `full-chain.spec.ts` had failed at the same "Moykada — chiqishi kutilmoqda" visibility wait across many runs this session, on a clean `main`, and was waved through as "the known flake" each time without anyone re-diagnosing it. Task: get real evidence rather than repeat the inference, fix it properly, and prove it with three consecutive full-suite runs.

**Root cause, confirmed with a captured Playwright trace, not inferred.** The failure's own DOM snapshot at the moment of timeout showed `Kutilayotgan serial yo'q` ("no serial waiting") — the list was genuinely empty, not a rendering/visibility timing issue. Unzipping the trace and reading the raw network log directly: the `moyka_sends` INSERT fired a few steps earlier shows `"status": -1, "_failureText": "net::ERR_ABORTED"` — the request never reached the server — at `_monotonicTime: 70496.136`, essentially the same instant (`70495.332`) the test's own `Chiqish` (logout) click completed its navigation to `/login`. Every `moyka_sends` GET in the trace, before and after, returned literal `[]`. `useMoykaOutput.ts` was reading the database correctly the entire time — the row was never written.

**Why the write raced the navigation.** `MoykaSendForm`'s submit button relabels from "Moykaga yuborish" to "Yuborilmoqda…" the instant React sets `submitting=true` — synchronously, before the `await supabase.from('moyka_sends').insert(...)` call even reaches the network. The test's own assertion, `await expect(row.getByRole('button', { name: 'Moykaga yuborish' })).toHaveCount(0)`, is satisfied by that relabel alone and proves nothing about whether the insert landed. The test then immediately clicked `Chiqish` (logout) — a real browser navigation, which Chrome aborts in-flight fetches for. Not an app defect: `handleSend`'s upsert-then-insert-then-refresh sequence and `useMoykaOutput`'s own list-membership query are both correct: they were just never given the chance to run to completion.

**Already found and fixed once before — never ported.** `git log -S` on the fix comment traced this to `lab-relocation-loss-verification.spec.ts`'s own first draft, written the same day `full-chain.spec.ts` was last restructured (2026-07-28, see that date's entry, "🚩 Real bug, found via this test: `OmborMoykaTab.tsx`'s send-to-Moyka step had no reliable success signal for a test to wait on"). That entry even names the mechanism identically ("isActive flips before any network call fires") and records the correct fix — `page.waitForResponse()` on the `moyka_sends` POST, asserting `.ok()`. It was applied only to the one new spec being written that day. `full-chain.spec.ts` was fixed for a *different*, real bug at the same date (a missing StrictMode request-id guard in `useLaboratorChiqim`/`useLaboratorKirim`, which genuinely resolved that day's "packing step" symptom) — but this second, separate defect in the *same* Moyka-send action was never checked for there, and nobody revisited it since. `lab-packing-hard-gate.spec.ts`'s own `sendToMoyka()` helper had the identical gap (waiting on `'+ Moykaga yuborish'`, the *toggle* button that vanishes on the very first click, before the actual submit — an even weaker, always-already-true check).

**Fix: ported the established `waitForResponse` pattern to both gaps**, matching `lab-relocation-loss-verification.spec.ts` exactly rather than inventing a second idiom for the same problem:
```ts
const [sendResponse] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/moyka_sends') && r.request().method() === 'POST'),
  row.getByRole('button', { name: 'Moykaga yuborish' }).click(),
])
expect(sendResponse.ok(), `moyka_sends insert must succeed, got HTTP ${sendResponse.status()}: ${await sendResponse.text()}`).toBe(true)
```
Applied to `full-chain.spec.ts`'s inline send block and `lab-packing-hard-gate.spec.ts`'s `sendToMoyka()` helper. No app code touched — the write path and `useMoykaOutput.ts` were already correct.

**Full source scan of `full-chain.spec.ts` for the same defect class:** every other `toHaveCount(0)`/`not.toBeVisible()` assertion in the file is a genuine cross-window exclusion or removal check performed after an already-confirmed positive state transition (e.g. `finishedRow` visible + `toContainText("O'tdi")` before proceeding) — none of them infer completion from a submit button's own transient relabel. The Moyka send was the only instance.

**`chiqim-undo-scan.spec.ts` and `lab-packing-hard-gate.spec.ts`, per the task's own request to check for a shared cause.** `lab-packing-hard-gate.spec.ts` shared the exact defect (fixed above). `chiqim-undo-scan.spec.ts`'s one observed failure this session was a click timeout on a barcode-picker button (`getByRole('button', { name: new RegExp(BARCODE_1) })`) with no Supabase write anywhere nearby — structurally a picker-list re-render/stale-element risk, not an async-write-vs-navigation race. It passed cleanly on an isolated re-run immediately after that failure, and passed again in all three of the runs below. Reported separately, not fixed: one occurrence, a different mechanism, no reproducing evidence to diagnose further against.

**Verification — three consecutive full-suite runs, no retries, no isolation:**

| Run | chiqim-undo-scan | full-chain | lab-packing-hard-gate | lab-relocation-loss-verification | report-effective-qty-parity |
|---|---|---|---|---|---|
| 1 | ok (51.0s) | ok (1.1m) | ok (37.6s) | ok (26.2s) | ok (1.4m) |
| 2 | ok (1.4m) | ok (1.1m) | ok (39.1s) | ok (25.5s) | ok (44.6s) |
| 3 | ok (1.3m) | ok (1.0m) | ok (37.0s) | ok (27.1s) | ok (49.0s) |

**5/5 passed, all three runs.** `full-chain.spec.ts`'s flake is gone, not merely not-observed-this-time.

**Verification.** `npx tsc -b --noEmit` clean. Test-file-only change — no app code touched, so no separate unit-suite run needed beyond the three Playwright runs above.

**Out of scope (per the task):** app behavior changes, Rezka, the origin-filtering rule.
