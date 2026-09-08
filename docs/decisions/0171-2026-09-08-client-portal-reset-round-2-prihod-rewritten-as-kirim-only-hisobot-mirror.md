## 2026-09-08 — Client portal reset, round 2: Приход rewritten as a KIRIM-only Hisobot mirror

**Context:** Supersedes Part B.2's own `ClientPrihodTab.tsx` (the 19-column per-serial ledger
backed by `client_serial_ledger`, built earlier this same reset) after the user rejected the whole
bespoke-client-screens approach and asked for exact-Rahbar-component reuse instead. Rather than
mark up the resulting enumeration, the follow-up instruction gave a fully-specified rewrite for
Приход only (Расход/Производство/`client_chiqim_ledger`/`client_production_ledger` explicitly
untouched this round) plus an independent Rahbar-dashboard verification ask, covered in its own
entry.

**RPC safety check (gate question: can `report_query_page`/`report_totals` be filtered by owner +
direction without a new RPC?):** Yes, confirmed live, no new RPC or backend change needed. Those
two functions (0026, most recently reshaped by 0102/0111) are plain `language sql stable`
functions — NOT `security definer` — that already accept `p_directions text[]` and `p_owner_id
uuid`. The initial concern was whether skipping/spoofing `p_owner_id` client-side could leak other
owners' rows, given the views underneath (`report_rows_v2`, `report_kirim_rows`) are NOT
`security_invoker` and are owned by `postgres` (which has `BYPASSRLS`) — on paper, a real risk.
Tested directly against production by role-switching a SQL session to `authenticated` with the
TEST CLIENT account's `auth.uid()` (`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL
request.jwt.claim.sub = '<test client uuid>'; ...; ROLLBACK;`, read-only, rolled back): querying
`report_rows_v2`/`report_kirim_rows` directly, and calling `report_query_page`/`report_totals`
with `p_owner_id := NULL`, all returned rows/totals for exactly that client's own owner only (1
distinct `owner_id`, matching an independent count). Every base table these views read from
already carries a `client_read_own_*` RLS policy scoping to `my_owner_id()` for the `'client'`
role (alongside the existing `read_all` policy, which explicitly excludes `'client'`) —
established for the earlier `client_chiqim_ledger`/`client_production_ledger` work and, it turns
out, already sufficient here too. RLS policy evaluation is keyed on the actual invoking Postgres
role (`authenticated`, which does NOT have `BYPASSRLS`) regardless of a view's own
`security_invoker` setting or owner — the `report_rows_v2`/`report_kirim_rows` gap noted above is
real (worth fixing for its own sake — flagged, not fixed, since it's outside this task's scope and
the two RPCs are already safe in practice) but does not make these two RPCs unsafe for the client
role today. `ClientPrihodTab.tsx` therefore calls `useReportQuery`/`report_query_page`/
`report_totals` directly and unchanged, with `filters.directions` locked to `['kirim']` and
`filters.ownerId` never set from the UI at all — RLS alone is the scoping mechanism, same
belt-and-suspenders spirit as every `client_*` RPC's own "never trust a caller-supplied owner id"
convention, just enforced one layer down since these two functions predate the client role.

**What shipped:** `ClientPrihodTab.tsx` rewritten from scratch as a bespoke (not
`ReportTableRow`/`ReportRowCard`/`TotalsStrip`) desktop table — same divergence-from-shared-
Hisobot-files reasoning `ClientRashodTab.tsx` already established: `direction` is a hidden,
permanent `['kirim']` filter Rahbar's own filter bar has no way to lock, several of Rahbar's 34
columns needed dropping (`ReportTableRow`'s cellContent switch has no visibility knob), and the
row-detail/totals-strip labels needed Russian text where Rahbar's own components hardcode Uzbek —
none of which a shared-file prop addition could cleanly express without touching Menejer/Rahbar's
own screen. 27 columns kept (exact order `REPORT_COLUMNS` already declares, just filtered):
Yo'nalish, Sana, Seriya, Partiya, Tur, Kalibr, E'lon qilingan, Tara, Moshina, Haydovchi, and all 8
serial-state columns (Qabul qilingan → Olib ketilgan, including Yo'qotish) plus K1-K8/KN. Dropped:
Buyurtmachi (scope-locked), Barcode #2/Holat/Namlik/SO2 (finished-goods/lab concepts that never
populate on a KIRIM row), Netto (redundant with Приход нетто/`qabul_qilingan`). Filters shown:
Davr, Mahsulot turi, Seriya qidirish, Kalibr, Moshina, Haydovchi, Partiya — flagging one oddity per
instruction rather than silently building around it: **Kalibr is a structurally dead filter here**
(`reportQuery.ts`'s own comment: "KIRIM rows never match [calibre], raw isn't graded"), so setting
it will always empty the results; built anyway since it was explicitly requested, not silently
dropped or silently "fixed" by hiding it. Filters hidden: Yo'nalish (locked), Buyurtmachi
(scope-locked), Holat, Barcode #2, Laboratoriya xulosasi. Totals strip shows every group/chip
Rahbar's own `report_totals` computes (movement + per-serial state, including Yo'qotish and the
two columns dropped from the table — Netto/Hisobiy still get a chip), not just the ones tied to
the 27 visible columns, per explicit instruction — reimplemented locally (`ClientTotalsStrip`/
`ChipGroup` in `ClientPrihodTab.tsx`) rather than reusing `TotalsStrip.tsx` as-is, because that
component's chip labels are hardcoded Uzbek. Row-expand trimmed to "E'lon qilingan + date basis"
only (the literal first block of Rahbar's own `KirimRowDetail.tsx`, translated) — passport button,
truck-variance warning, and lab-reading comparison all dropped, not hidden. No column picker
(fixed 27-column set). No voided-barcode banner (KIRIM rows are never voided; that concept doesn't
reach this view). Excel export reuses `downloadReportExcel` verbatim — **flagging, not fixing:**
the exported `.xlsx` file's own column headers and summary-row labels come straight from
`REPORT_COLUMNS`'/the workbook-builder's hardcoded Uzbek strings, unlike the on-screen table — the
task asked to reuse Rahbar's export, not translate it, so this is a real, visible gap between the
on-screen Russian labels and the downloaded file's Uzbek ones, left for a follow-up decision rather
than silently forked into a second, parallel export implementation.

`clientLabels.ts` extended (no existing entries touched) with `col.*`-prefixed keys for the 27
column headers (deliberately NOT keyed by Rahbar's own Uzbek `label` text — several of those, e.g.
"Kalibr", already exist above as keys with a *different* Russian meaning for a different context)
plus three `total.*` keys for totals-strip chips that don't correspond to a shown column (Chiqim/
Neto/Hisobiy). This is `clientLabel()`'s first real caller — it shipped in an earlier round of
this same reset with zero call sites.

Backend: migration `0118_drop_client_serial_ledger.sql` drops `client_serial_ledger(date, date,
uuid)` only — confirmed dead first (grep over `src/` post-rewrite, plus a live
`pg_proc.prosrc ilike '%client_serial_ledger%'` search finding no other caller) — leaving
`client_chiqim_ledger` (same source migration, 0109) untouched, since it still backs the unmodified
`ClientRashodTab.tsx`. Applied to the live project after explicit confirmation.
`clientSerialLedger.ts`/`clientSerialLedgerExport.ts` deleted as orphans.

**Verification:** `npx tsc -b` and `oxlint` clean. `report_query_page`/`report_totals` re-verified
against real production data as the TEST CLIENT role post-migration (5-row page + full totals for
`directions=['kirim']`) — correct shape, correct single-owner scope. **No live browser/E2E run was
possible**: this sandboxed session's general egress proxy hard-denies (403, policy-level, logged as
`connect_rejected` at the proxy) any browser-initiated connection to the live Supabase project's
own hostname — confirmed by chasing the exact failure (`net::ERR_TUNNEL_CONNECTION_FAILED` in a
Playwright-launched Chromium) down to the proxy's own status log, not assumed. This session's own
Supabase MCP tool calls reach the same project fine, through a separate channel the egress policy
doesn't gate — a real environment asymmetry, not a bug in the app, the migration, or the test
setup. Per this environment's own operating rule ("403/407: do not retry or route around it,
report the blocked host"), no workaround was attempted. **A manual click-through of the Приход tab
as a client-role user in an environment that can reach the live project is still needed** before
merging — same open item this log's client-portal entries have flagged throughout this reset.

Also produced (secondary task): a live SQL cross-check of the Rahbar dashboard's Старый склад
Кондитерка graph, logged in the following entry.
