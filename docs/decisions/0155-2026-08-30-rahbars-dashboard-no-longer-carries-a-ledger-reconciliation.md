## 2026-08-30 — Rahbar's dashboard no longer carries a ledger reconciliation

Confirmed by Abdulloh: the "Kirim va chiqim" removal stands as built — the whole section,
including the three-ledger reconciliation table (Ledger A raw, the Moykada line, Ledger B with
its Yo'qotish row, Ledger C dispatched/closing) and the residual diagnostic note. Nothing to
restore.

**Consequence to be aware of, recorded deliberately: there is no longer any surface where the
three ledgers are shown side by side, so a future disagreement between them will not surface
on the dashboard.** The residual diagnostics (`raw.residualKg`, `moykadaSnapshot.residualKg`)
are still computed by `rahbar_dashboard_ledger` and still returned in its payload — they are
simply no longer rendered anywhere. `moykadaSnapshot.residualKg` is currently **−15 kg**
(see the 0106 entry), which nothing on screen will now report.

Those movements remain visible only through **Hisobot** — `report_kirim_rows`,
`report_chiqim_rows`, `report_moyka_send_rows`, `report_moyka_output_rows` and the
`stock_on_hand_rows` / Yield views behind it. Anyone checking whether the ledgers still
reconcile has to query the RPC directly or reconstruct it from Hisobot; the dashboard will
show a plausible-looking set of tiles either way.

That is an accepted trade — the table was dense, rarely read, and its Ledger B half was
materially wrong for eighteen days before anyone noticed, which is itself evidence it was not
serving as a check. Recorded so the loss of that check is a known state rather than a
discovery.

**Branch note (resolved):** the removal shipped on
`claude/total-loss-finalized-serials-5jeugz` (commits `2918922`, `4a5f985`) and merged to main
as PR #123, so the dashboard and migration `0106` are now in step. This entry was written on
the follow-on branch while that PR was still open and has been rebased into place above.
