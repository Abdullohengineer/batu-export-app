## 2026-09-08 — Systemic fix: all client-side date stamps now use Asia/Tashkent, not UTC

**Context:** While verifying `finished_pallets.received_date` for `client_production_ledger`
(Производство tab), traced its write site to `OmborTayyorTab.tsx`'s
`received_date: new Date().toISOString().slice(0, 10)`. `Date.prototype.toISOString()` always
renders in UTC regardless of the device's own timezone setting. Tashkent is UTC+5 with no DST, so
the UTC calendar day and the Tashkent calendar day disagree for any local time between 00:00 and
04:59 — a pack entry logged in that window would be silently dated to the previous day.

**This was not an isolated bug.** Grepped the whole frontend for the same idiom and found it at
~20 call sites, all following one of three shapes:

1. **"Today"** — `new Date().toISOString().slice(0, 10)`. Wrong only in the 00:00–04:59 Tashkent
   window (confirmed empirically: an instant of `2026-09-08T20:00:00Z`, i.e. 01:00 Sept 9
   Tashkent, sliced to `"2026-09-08"` — one day behind).
2. **"First of month"** — `new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)`.
   **Worse than (1): wrong every single time**, not just in a narrow window. The 3-arg `Date`
   constructor builds *local* midnight of the 1st; converting local midnight to UTC for a
   positive-offset zone always lands on the previous UTC calendar day. Confirmed empirically:
   for a Tashkent "now" of Sept 8, this produced `"2026-08-31"` instead of `"2026-09-01"` — every
   "Bu oy"/"Этот месяц" default across this entire app (Rahbar's dashboard, all three client
   portal report tabs, and — via `ReportFilterBar.tsx` — Hisobot/Stock-on-hand's own date
   presets) has been starting one day early, always, not as an edge case.
3. **"N days ago"** (`dateRange.ts`'s `defaultDateRange`, used by 7 history screens) — same
   window-dependent risk as (1), applied to the `from` end of a rolling lookback.

**Fix:** `src/lib/dateRange.ts` (already the established home for these YYYY-MM-DD helpers per
`formatDate.ts`'s own header comment) gained `tashkentDateString`, `todayInTashkent`,
`firstOfMonthInTashkent`, `daysAgoInTashkent`, and `previousMonthRangeInTashkent`, all computed
via `Intl.DateTimeFormat` with an explicit `timeZone: 'Asia/Tashkent'` rather than the device's
own local `Date` accessors — correct even if a device's system timezone is itself misconfigured,
which local accessors would not be. `defaultDateRange` keeps its existing signature, now backed
by the Tashkent-correct helpers. Every one of the ~20 call sites (plus each file's own duplicated
private `isoToday`/`isoFirstOfMonth`/`lastMonthRange`-style wrapper functions, several near-
identical copies of which existed across `RahbarHome.tsx`, `ReportFilterBar.tsx`, and all three
client portal tabs — consolidated into the shared helpers rather than re-duplicated) now imports
from `dateRange.ts`:

- `KirimForm.tsx`/`ChiqimForm.tsx` (Menejer) — `sana` initial default.
- `OmborTayyorTab.tsx`/`ReceiveFromMoykaForm.tsx` — `received_date` (the original finding).
- `OmborMoykaTab.tsx` — `sent_date`.
- `KirimTahlilForm.tsx`/`ChiqimTahlilForm.tsx` (Laborator) — `sampleDate` initial default.
- `RahbarHome.tsx` — `Boshidan`/`Bu oy`/`O'tgan oy` period presets.
- `ReportFilterBar.tsx` — Hisobot/Stock-on-hand's own `Bugun`/`7 kun`/`Bu oy` presets.
- `ClientPrihodTab.tsx`/`ClientRashodTab.tsx`/`ClientProizvodstvoTab.tsx` — the client portal's
  own default period + `Сегодня`/`Этот месяц` buttons (this task's original three call sites).

**Deliberately NOT touched, verified correct as-is, not merely left alone:**
`useLaboratorHistory.ts`/`useIntakeHistory.ts`'s `toExclusive` (`new Date(to); setDate(+1);
toISOString().slice(0,10)`) looks like the same idiom but isn't — it shifts an *already-known*
date string by exactly one calendar day, never asks "what day is it now," and (confirmed
empirically both directions) round-trips correctly for any fixed-offset timezone because the
UTC-parse-then-local-setDate-then-UTC-format cancel out to a true +1-day shift regardless of
which offset you started from. Tashkent has no DST, so this holds without exception here. Left
as-is rather than forced into the new helpers, which would have been a no-op at best.

Also deliberately not touched: every `new Date().toISOString()` call producing a **full**
timestamp for a `timestamptz` column (`ombor_finished_at`, `voided_at`, `stage1_completed_at`,
`completed_at`, `created_at` on the Moyka-receipt optimistic-UI mirror) — UTC is the correct,
unambiguous choice for an actual instant; only the date-only `.slice(0, 10)` truncation loses the
timezone context that made it wrong.

**Verification:** `npx tsc --noEmit`, `npm run build`, `npm run lint` all clean. Each new helper
verified against hand-computed expected values via a standalone Node script — including at the
exact danger-window boundary (an instant 01:00 Tashkent time, where the old code and the new code
diverge by exactly one day) and confirming `firstOfMonthInTashkent`/`previousMonthRangeInTashkent`
agree with the old code outside their respective bug conditions. No live browser run was possible
in this environment (same constraint as the client-portal smoke test above) — recommend a manual
click-through of at least one "Bu oy" default (Rahbar or any client tab) before/after this change
in a running dev server, since the first-of-month finding changes an on-screen default date users
will notice immediately.
