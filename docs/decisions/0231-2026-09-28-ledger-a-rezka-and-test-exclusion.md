# Post-Rezka cleanup, item 5: Ledger A excludes Rezka; the ledger's event CTEs exclude TEST

Post-Rezka cleanup, HANDOFF item 5 (`rahbar_dashboard_ledger` counts Tashqi Rezka raw as ordinary
raw), plus a TEST leak found while doing it.

| Migration | Applied | Stored md5 | Body md5 after |
|---|---|---|---|
| `0150_ledger_a_excludes_rezka.sql` | 2026-09-28 | `e2734c6534f9603d2c6abdae3e3719cc` (file) | `78fbfa97…` |
| `0151_ledger_event_ctes_exclude_test.sql` | 2026-09-28 | `3524d9f25d40fc837c5191a562695b84` (file) | `28f20baa…` |

Both are checked text edits of `rahbar_dashboard_ledger_rls` (the 0147 invoker body), each
asserting the previous body's md5 and a single match per anchor, the same way as 0147 and 0149.

## 0150: Rezka out of Ledger A

0143 moved unsent Rezka raw out of the snapshot's `rawKg`. But the ledger's `lines` CTE filtered
on `origin` only, so a Tashqi Rezka delivery would have counted in raw opening / received /
closing.

- `lines` now joins `kirim_orders` with `kl.process <> 'rezka'`.
- `raw_dispatch_events` drops Rezka lines too. Rezka raw never enters Ledger A, so a Xom dispatch
  of it must not leave Ledger A either, or the identity opens.
- `moyka_send_events` and `processed_lines` need nothing: a Rezka serial never has moyka_sends or a
  wash cycle.

Scope note: Hisobot still shows a Xom dispatch of Tashqi Rezka raw as an Oddiy `chiqim_raw` row
(0226). That is a movement report of what left on a truck; Ledger A is a stock identity. There
are none today.

Live effect: **0 kg, as expected.** The 8 Rezka lines that were in `lines` are Ichki mints with no
intake (`has_intake` false, so every raw term already skipped them). Tashqi Rezka lines are all
TEST and already dropped by `report_kirim_rows_as_of`, and no Rezka serial has raw dispatch.
Dry-run: the full ledger output was identical before and after for all 6 windows.

## 0151: TEST out of the event CTEs

Every other ledger term reads lines through `report_kirim_rows_as_of`, which drops `TEST-` plates.
`raw_dispatch_events` (raw dispatchedKg and the "vozvrat" chart) and `moyka_send_events`
(sentToMoykaKg, Ledger B, the chart) had no such filter. On 2026-09-28 the leak was:
- **this month's Yangi raw "dispatched" was 50 kg, all of it** the five TEST Xom dispatches from
  `rezka-menejer` runs;
- 20 kg of TEST Moyka sends were in sentToMoykaKg.

Their matching receipts were excluded, so the residuals carried the difference. The fix is the
same filter as the rest of the ledger: `ko.plate not like 'TEST-%'`.

## Live verification (after both)

Six windows (Yangi / Eski / Hammasi × this month / from 2026-07-15), baseline captured live right
before applying:

| Window | Raw dispatched | Sent to Moyka | Raw residual | Moyka residual | Everything else |
|---|---|---|---|---|---|
| Eski, both windows | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | byte-identical |
| Yangi/Hammasi, from 2026-07-15 | 24,779 → 24,729 | 156,065 → 156,045 | −7,660 → −7,590 | 6,798 → 6,778 | identical |
| Yangi/Hammasi, this month | 50 → 0 | 90,413 → 90,393 | −6,620 → −6,550 | −7,310 → −7,330 | identical |

"Everything else" means the non-ledger sections, the whole Moyka section, and raw
opening/received/closing. The chart moves by the same TEST amounts.

## Not addressed (logged in HANDOFF)

The remaining raw residuals (about −6,600 / −7,600 kg) and Moyka residuals (about −7,300 to
+6,800 kg) are large and pre-existing. They are probably the documented over-send
`greatest(0, …)` floor plus the intake-vs-gate-weigh-2 registration gap, and need their own
investigation.
