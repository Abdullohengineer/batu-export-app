# HANDOFF — Rezka build

Rezka is built in four prompts. Design audit: `docs/REZKA-AUDIT.md` (its wrong-premises list is
authoritative over the original brief). Rules: `docs/SPEC.md` §5.R. Decisions:
`docs/decisions/0219`–`0223`.

## Prompt 1 — data layer, blockers, regressions (branch `rezka-prompt-1`)

**Status:** code + docs committed. Migrations `0141`–`0143` verified in one live
`BEGIN … ROLLBACK` run on TEST- fixtures (values in `docs/decisions/0222`); **not yet applied
to the live database** — waiting on the product owner's go-ahead after reviewing the
ROLLBACK values. After applying: re-verify end-to-end, then run `full-chain.spec.ts`
(test 6) — it needs `.env.test`, which is not present in the cloud container used for
Prompt 1, so it has to run where `.env.test` exists.

**Built**
- `kirim_lines.process` (moyka/rezka) + `enforce_serial_process` guard on moyka_sends /
  wash_cycles / rezka_sends / rezka_cycles.
- `rezka_cycles.opened_at/cycle_no/closed_at`; `ensure_open_rezka_cycle`,
  `close_rezka_cycle_if_settled` (exact settlement only), `close_rezka_cycle_serial` (any
  residual, signed, no lab).
- `rezka_kn_draws` ledger + `send_kn_to_rezka(owner, type, kg)`; every available-KN site nets
  out draws; Ledger C / client report `finished.rezkaDrawnKg`.
- Dispatch verdict gates: "lab passed OR serial in rezka_cycles"; Rezka pallets never
  "awaiting lab" in stock-on-hand.
- `rahbar_stock_snapshot.rezkaKnKg` / `rezkaRawKg` (regression from 0080 fixed).
- RKN label → "Standard". `send_finished_pallets_to_rezka` revoked from app roles;
  `send_old_kn_pool_to_rezka` left as dead code.
- Frontend: Laborator KIRIM/CHIQIM/history exclude Rezka; `useMoykaSerials` exposes
  `process` (Moyka picker filters it; Xom raw pool keeps it); `isInRezka`,
  `computeRezkaLossDisplay`; `FinishedReceiptForm` `rezka` prop.

## Reported, not patched — must also exclude / handle `process='rezka'` (for Prompts 2/3)

SQL (each needs its origin-filter category stated when touched — CLAUDE.md):
- `classify_kirim_line_sulfur` — Laborator sulfur classification; a Rezka line has no lab.
- `lab_turnaround_avg` — processing aggregate; Rezka serials never have lab rows, but exclude
  explicitly (CLAUDE.md "an exclusion that only works because the data happens not to
  overlap is not acceptable").
- `wip_rows` (raw_not_sent) — a Tashqi Rezka serial awaiting a Rezka send would show as idle
  *Moyka* raw.
- `yield_rows` — Moyka yield; structurally gated on `wash_cycles`, exclude explicitly.

Frontend:
- `OmborIntakeTab` — Window 2 "remaining" / `hasRawRemainder` counts Rezka serials as
  awaiting a Moyka send.
- `OmborHome` badges (Moyka count via `useMoykaSerials` / `hasRawRemainder`) — would count
  Rezka serials in the Moyka badge.
- `OmborMoykaTab` Window 1 list (built from the same hook) — Prompt 2's Moyka/Rezka pill
  must split it by `process`.

## Notes for the next prompts
- **Prompt 2 (Ombor):** Tashqi send = `ensure_open_rezka_cycle` + a `rezka_sends` insert
  (RLS `ombor_writes`), picker = `useMoykaSerials` rows with `process='rezka'` and
  `available > 0`. Ichki = `send_kn_to_rezka`; UI warning (never a block) under 10 kg.
  Receive = `FinishedReceiptForm rezka`, no lab gate, then `close_rezka_cycle_if_settled`;
  Window membership = `isInRezka`; loss = `computeRezkaLossDisplay`; Yakunlash =
  `close_rezka_cycle_serial`. No printing on the Rezka path. New hooks on React Query;
  writes via `src/lib/rpc.ts`.
- **Prompt 3 (Menejer):** KIRIM per-line process select; CHIQIM Rezka tab = ordinary
  `finished` line on the Standard calibre. Migrate `useAvailableFinishedStock` onto React
  Query while there (`docs/decisions/0223`).
- **Prompt 4 (Hisobot/dashboard/qoldig'i):** Rezka directions, Yangi/Eski/Rezka toggle,
  passport Rezka lines. `RahbarHome` `grandTotal` and the client panel mirror read the
  snapshot keys by name — `rezkaRawKg`/`rezkaKnKg` are new and currently unread; `byCalibre`
  still carries Standard with `isNumberless: true`, so any frontend that sums
  `isNumberless` rows must exclude `is_rezka_output`.
- Pre-existing, flagged: dispatch verdict gates read an unordered first wash cycle
  (`docs/decisions/0223`); `get_client_report.finished.byCalibre` has no `ORDER BY`.
