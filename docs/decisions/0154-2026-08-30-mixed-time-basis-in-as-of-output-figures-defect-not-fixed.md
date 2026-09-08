## 2026-08-30 — Mixed time basis in as-of output figures (defect, NOT fixed)

Logged separately from the fix above because it is a different defect with wider reach, it is
**client-facing**, and it will resurface. Nothing here was changed.

**The mechanism.** Every "output as of date D" subquery includes pallets by
`received_date <= D` but excludes them by `voided_at <= D`. Two different clocks on the same
row. A pallet received on the 18th and voided on the 20th therefore counts on the 19th and not
on the 21st, so *cumulative* output as-of moves **backwards**: measured on live,
**15,820 kg (19 Aug) → 7,910 kg (20 Aug)**. Re-running an August report today gives a
different answer than running it on 19 August.

To be precise about what is and isn't wrong: a stock *level* rising and falling over time is
correct — material enters Moyka and is packed out, and every move in the live Moykada series
(30,738 → 24,278 → 32,225 → 16,242 → 23,330) maps to a real send or receipt. What is wrong is
that a **historical figure mutates**. Two lesser issues sit alongside it: a serial's whole
residual drops to 0 on its `closed_at` date (a bookkeeping event with no physical
counterpart), and the per-line `greatest(0, …)` floor masks the double-count — on 19 Aug it
concealed 7,448 kg of negative per-line balances.

**Reach.**

- `rahbar_dashboard_ledger` lines 28–29 (`output_before_from_kg` / `output_as_of_to_kg`) —
  unfiltered, feed the raw ledger's opening/closing and `moykadaSnapshot`.
- **`get_client_report` line 20 — the identical unfiltered subquery, feeding `raw.moykadaKg`,
  and it is client-facing.** Measured for Global Export: understated by **462 kg** at
  p_to 2026-08-22, **482 kg** at 08-25, **865 kg** at 08-28. Zero today *only* because every
  affected serial has since closed — the error returns the moment a serial with voided pallets
  is open at a period end.
- Already correct, for contrast: `pallet_base`, `client_pallet_base`,
  `rahbar_stock_snapshot`'s `moyka_lines`, and `kirim_line_state`.

`get_client_report` was explicitly out of bounds for the pass that found this, which is why it
is recorded rather than repaired.

### Two figures still unexplained

Deliberately left unexplained rather than given a plausible story:

- **90,979** — reported as the donut's centre. Today that donut sums 68,369.4 kg (`yangi`);
  the nearest current figure is the old "Jami zaxira" tile at 91,699.4. Does not reproduce.
- **33,820** — reported as Moykada. Moykada is 23,330 today and stays 23,330 under every
  formula variant tested. 33,820 is *exactly* what `moyka.calibreKg` becomes **after** the fix
  above. How that value appeared on a screen before the fix is unknown; the coincidence is
  recorded as a fact, not resolved.
