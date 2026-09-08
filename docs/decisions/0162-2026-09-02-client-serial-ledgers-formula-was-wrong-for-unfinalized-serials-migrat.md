## 2026-09-02 — client_serial_ledger's Остаток сырья formula was wrong for
## unfinalized serials (migration 0110, fixing 0109)

`client_serial_ledger()` (0109, "Client Hisobot rebuild") shipped `ostatokSyryaKg` as
`D − L − E − K` (netto − итого переработка − возврат − потеря, K read as 0 when the serial
isn't finalized). That formula is only correct by accident: it's algebraically identical to
`D − E − G` **only when the serial is finalized**, because then `K = G − L` and the two
expressions collapse to the same thing. For an unfinalized serial `K` reads as `0` while `L`
is only the output produced *so far*, so the subtraction silently drops the portion still
sitting in Moyka (`G2`, unrealized) — inflating the reported raw remainder by exactly `G2`
kg on every open serial. The immediately preceding entry above (the reopened `110826-001`)
is the live case this bug would have hit hardest, though it was actually caught on `190826-002`.

Caught by the user reviewing the shipped screen, not by me: I'd generalized the formula from
a single worked example two tasks earlier (a manual Excel reconciliation) where the one
serial in question happened to be finalized, and never re-derived or tested it against an
open serial before shipping it as the general case. The actual balance identity needs no `L`
or `K` at all — raw material that arrived (`D`) either left as a return (`E`), left for
processing (`G`), or is still in the yard; once it's sent to Moyka it's no longer "raw in the
yard" whether or not processing on it has finished. So `Остаток сырья = D − E − G`,
unconditionally, regardless of finalization state. `R` (Остаток гот. продукции = `L − ΣM`)
was never affected — it doesn't reference `K` or finalization.

**Verified against production** before and after the fix, self-scoped as the actual client
(`request.jwt.claims` set to Global's `client`-role profile, not the admin connection):
partiya 11 (`190826-002`, unfinalized, `moykaKg=700`, no output yet) read `ostatokSyryaKg=8112`
under the old formula and `7412` under the new one — exactly the predicted `G2` inflation.
Re-ran the corrected formula against all 20 serials in Global's window (07-16→09-02): every
row now equals `D − E − G` exactly, finalized and unfinalized alike, and the `totals` object's
`ostatokSyryaKg` (58,029) matches the independently-summed row total.

0109 is left as applied history rather than edited in place; 0110 is the actual fix. Numbered
0109/0110 rather than 0107/0108 (what they were applied to production as, and what they were
called in the commit that introduced them) because merging main revealed a same-day filename
collision — main independently added its own `0107_hisobot_yoqotish_column.sql` and
`0108_rahbar_ledger_open_wash_cycle_loss.sql` first. Both pairs were already applied directly
to the live project by their respective sessions before either saw the other's migration, so
renumbering here is pure repo hygiene (keeping `supabase/migrations/` monotonic for a future
clean replay) — nothing about the live database changed as part of the rename.
