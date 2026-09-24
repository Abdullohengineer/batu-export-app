# Rezka Prompt 1: process field, close semantics, calibre rename, signed twins — and the dry run

Product-owner decisions for Rezka Prompt 1 (data layer only; UI is Prompts 2–4), with the
design audit in `docs/REZKA-AUDIT.md`.

**Process field (`0141`).** `kirim_lines.process text not null default 'moyka' check in
('moyka','rezka')`, no backfill. `enforce_serial_process()` trigger on `moyka_sends`,
`wash_cycles` (covers `ensure_open_wash_cycle`/`open_second_wash_cycle`), `rezka_sends`,
`rezka_cycles`, before insert or update of serial — the process-level twin of 0076's
cycle-level `prevent_dual_process_serial`.
- Laborator KIRIM, CHIQIM and history hooks exclude `process='rezka'` (CHIQIM is structurally
  redundant — anchored on `wash_cycles` — but kept explicit, same reasoning as
  `lab_turnaround_avg`'s origin filter).
- `useMoykaSerials` **exposes** `process` and does not filter: Rezka Tashqi serials are uncut
  outside KN the client can take back, so they stay in the Xom raw-dispatch pool (ChiqimForm,
  OmborChiqimTab). Only the Moyka send picker (`NewStockToMoykaForm`) filters. Rezka raw
  balance = netto − rezka_sends − raw dispatched, the same arithmetic as Moyka raw.

**Close semantics — decision (b).** `rezka_cycles` gains `opened_at`/`cycle_no`/`closed_at`
(Moyka's post-0124 multi-cycle shape; 0076 had copied the pre-0124 shape). Copies of the Moyka
trio with the lab gate removed: `ensure_open_rezka_cycle`; `close_rezka_cycle_if_settled`
auto-closes **only at exactly received = sent** (Moyka's closes at received ≥ sent — a straight
copy would have locked an over-received serial on its first gain); `close_rezka_cycle_serial`
closes at **any** residual, positive or negative (Moyka's refuses a residual ≤ 0) and returns
the signed yoqotish. Rezka output arrives in batches and gains are normal.

**Signed twins, not flags.** `isInRezka(sent, received, closedAt)` = open cycle and something
sent — an over-received serial stays receivable (unlike `isInMoyka`'s `sent − received > 0`).
`computeRezkaLossDisplay` is signed on both branches (open: `rezkadaKg = sent − received`,
negative = gain so far). Both are separate named functions, per the Rezka data-layer
decision that a flag is how the Moyka path eventually starts silently accepting gains.

**Calibre.** RKN's display label renamed "Rezka KN" → **"Standard"**, code unchanged (Barcode #2
ids embed it). `FinishedReceiptForm` gains `rezka?: boolean`: without it `is_rezka_output`
calibres are hidden (Moyka can never receive Standard), with it only they are offered. Rezka
dispatch is an ordinary `line_kind='finished'` CHIQIM line on that calibre. No printing on the
Rezka path — Barcode #2 is an identifier only.

**Dispatch gates (R4).** `finished_pallet_availability` and `attribute_chiqim_line_fifo` read
`lr.verdict = 'o_tdi' or exists (rezka_cycles for the serial)`; stock-on-hand's awaiting-lab
bucket skips Rezka serials (otherwise every Rezka pallet would sit under "awaiting lab"
forever). The finished_pallets INSERT policy already had this branch (0076). No other gate.

**Migration numbering (R7).** All 40+ remote branches fetched: **no branch carries 0138–0140**;
they exist only live (applied 2026-09-22) with their SQL in
`docs/data-corrections/2026-09-22_hisobot_split_rows_enrich_and_request_cap.sql`. Added as
comment-only record files so a fresh push does not re-apply them. Rezka takes 0141–0143.

**Dry run — one live `BEGIN … ROLLBACK`, TEST- fixtures only, nothing persisted.** The three
migration files were passed in as byte-exact literals and executed inside the transaction; their
`md5()` matched the committed files (0141 `6c7e6706…`, 0142 `420db29c…`, 0143 `13046f80…`).
Fixtures: owner `TEST-Rezka Owner`; delivery order `TEST-RZ-01` with serial `230926-001`
(Subxon), wash cycle + `o_tdi` lab verdict, pallets `TEST-PLT-RZ-KN-1`/`-2` (KN, 720 kg each);
Rezka delivery order `TEST-RZ-02`, serial `230926-002`, `process='rezka'`; CHIQIM request
`TEST-RZ-CHQ`. Actions as TEST Ombor through real RLS (`request.jwt.claims`).
- Regression: 11 baselines (ledger ×3 scopes, snapshot ×3, client report ×3 owners,
  stock_on_hand_rows, finished_pallet_availability) re-read after the migrations, before any
  fixture: identical except one owner's `get_client_report`, whose only difference is the
  **order** of `finished.byCalibre` (an unordered `jsonb_agg`, pre-existing); order-insensitive
  comparison identical, totals identical (closing 65,580 kg). Confirmed in a second ROLLBACK run.
- T1 draw 25 kg → minted `230926-003` (`internal_reprocess`, `process='rezka'`, plate
  `QAYTA-ISHLASH`, 0 storage_intake, 0 wash_cycles, 1 open rezka_cycle); ledger: 25 kg from
  `TEST-PLT-RZ-KN-1`; available on the two pallets **1,415 kg**; rezka_sends **25 kg**; pallets
  still `in_stock` at 720/720. Overdraw (2,000 kg) rejected: "Konditerka yetarli emas: 585.0 kg
  yetishmayapti".
- T2 receive 30 kg Standard pallet `TEST-PLT-RZ-RKN-1` through the RLS INSERT policy (no
  verdict) → accepted; `close_rezka_cycle_if_settled` left it **open** (30 ≠ 25);
  `close_rezka_cycle_serial` → `yoqotish_kg = −5`, closed.
- T3 CHIQIM line 30 kg on Standard → `attribute_chiqim_line_fifo` consumed **30 kg** from
  `TEST-PLT-RZ-RKN-1`, no verdict; available 30 → 0.
- T4 `230926-002` (Rezka delivery): moyka_sends rejected, `ensure_open_wash_cycle` rejected,
  rezka_sends accepted; rezka_sends on the Moyka serial `230926-001` rejected. Laborator/Moyka
  picker exclusion is a hook filter — unit-tested and typechecked, not exercisable in SQL.
- T5 `rahbar_stock_snapshot('hammasi')`: rezkaKnKg **30**, rezkaRawKg 0, konditirskiyKg
  9,040 = baseline, rawKg 53,581 = baseline; the Standard pallet sits in bucket `available`.
- Client report for the TEST owner: produced 1,470, rezkaDrawnKg 25, dispatched 0, closing 1,445.
  Both "+1,445" figures (Ledger C and client) were captured **before** T3's dispatch.

**Applied 2026-09-24.** `apply_migration` ×3: `0141_rezka_process_and_cycles` (version
`20260924051834`), `0142_rezka_kn_draws` (`20260924052123`),
`0143_rezka_ledger_c_and_snapshot_split` (`20260924052503`). Each stored `statements[1]` is
md5-identical to the committed file (`6c7e6706…` 7,787 B, `420db29c…` 28,945 B, `13046f80…`
51,045 B). schema_migrations holds 0138–0143 exactly once each (0138–0140 are the
2026-09-22 applies the record files document).
- Baselines: the same 11 reads (ledger ×3 scopes, snapshot ×3, client report ×3 owners,
  stock_on_hand_rows, finished_pallet_availability) fingerprinted with an order-insensitive
  canonical md5 at 05:17:53 UTC before the apply and 05:25:19 UTC after — **all 11 identical**
  once the new keys are set aside; new keys present and all 0 (`rezkaDrawnKg` in the 3
  ledgers and 3 client reports, incl. every `byCalibre` entry; `rezkaKnKg`/`rezkaRawKg` in the
  3 snapshots).
- Ledger C timing, re-run live in one ROLLBACK after the apply (hammasi, 2026-07-01 → today,
  deltas vs the in-transaction baseline): after draw + 30 kg receive, before dispatch —
  produced +1,470, rezkaDrawn +25, dispatched 0, **closing +1,445**; after FIFO loading the
  30 kg but before the truck leaves — **still +1,445** (Ledger C counts a dispatch only once
  `chiqim_departed_at` is set); after departure — dispatched +30, **closing +1,415**. The TEST
  request was created as a fura so departure = `ombor_finished_at` (truck type is immutable
  by trigger). Nothing persisted (0 TEST owners/orders/requests/pallets, 0 rows in
  rezka_kn_draws/rezka_sends/rezka_cycles afterwards).
