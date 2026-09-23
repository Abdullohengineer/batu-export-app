# Rezka: old KN pool is not a Rezka source — `send_old_kn_pool_to_rezka` is dead code

**Decision (product owner, 2026-09-23, Rezka Prompt 1).** Rezka has exactly two sources:
*Tashqi* (a `process='rezka'` delivery serial) and *Ichki* (new-season Konditerka drawn by kg
from finished stock, `send_kn_to_rezka`). The opening-stock old-KN weight pool is **not** a
Rezka source.

**What this leaves behind.** Migration `0076` shipped `send_old_kn_pool_to_rezka(owner, type,
pool, kg)` for the pool source while it was still undecided. It is left in place, unchanged
and still executable by Ombor, but nothing calls it and nothing will: no UI in Prompts 2–4,
not referenced by any hook. It is dead code by decision, not by accident — listed here so a
future cleanup can drop it deliberately (dropping backend objects ahead of confirming they are
unused is the documented cause of the v1.49 incident, so it is not dropped in this pass).

Related: `send_finished_pallets_to_rezka` (0076, whole-pallet internal source) is superseded by
the kg ledger (see `0220`) and has `execute` revoked from `anon`/`authenticated` in `0142` — it
would otherwise bypass `rezka_kn_draws`. It is not dropped either, for the same reason.
