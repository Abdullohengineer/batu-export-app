## 2026-09-30 — Client Приход stuck/erroring: the 2026-09-22 5s per-RPC statement
cap, not Stage A, not client_serial_ledger

**Reported:** client stuck on Приход, tab throwing errors, not loading at all.

**Investigation (live project `qohoqbapevrcjqxbstxi`, via Supabase MCP `query_logs`/
`execute_sql`, not assumed):**

- `postgres_logs`, 2026-09-30 13:19:50–15:04:25: a real client session (desktop
  Chrome/Mac) repeatedly hit `canceling statement due to statement timeout`
  (Postgres 57014) on both `report_query_page_rows` and `report_totals`, each
  immediately preceded by `pgrst_statement_cap MATCH path=/rpc/report_totals
  statement_timeout=5s` (and the `_rows` equivalent). `edge_logs` shows the
  same session's `POST .../rpc/report_totals` and `.../rpc/report_query_page_rows`
  both returning HTTP 500 at the same timestamps.
- `ClientPrihodTab.tsx` → `useReportQuery.ts` calls exactly these two RPCs on
  every load (confirmed by reading the file) — this is the Приход tab's data
  path, not a coincidence.
- `pg_roles.rolconfig` confirms live: `authenticator` carries
  `pgrst.db_pre_request=public.pgrst_statement_cap` (role-level
  `statement_timeout=12s`). `pgrst_statement_cap()`
  (`docs/data-corrections/2026-09-22_hisobot_split_rows_enrich_and_request_cap.sql`,
  decision 0218) drops `statement_timeout` to **5s** for exactly four paths:
  `report_query_page_rows`, `report_page_enrich`, `report_totals`,
  `report_query_page`. That file's own closing note flagged this as **"STILL
  UNVERIFIED: that PostgREST populates `request.path`"** — it does, correctly,
  and has been biting real traffic since 2026-09-22. `report_totals` was
  deliberately left unmodified by that change (still the heavier pre-split
  shape) and is the one most often losing the 5s race under real concurrency.

**Ruled out, with evidence** (both named in the incident report):
- `ed49c48` (Phase 3 Stage A, rahbar_stock_snapshot/rahbar_dashboard_ledger
  set-based rewrite): that commit's own full `pg_proc`/`pg_views` dependency
  scan found neither function has any database dependant. Re-checked here —
  nothing in the Приход path calls either function. Not related.
- `client_serial_ledger` (migration 0119's emergency stopgap restore, from the
  PR #164 incident): still live in the database — the decision 0174 follow-up
  ("drop it a second time once PR #140 merges") was never actually done — but
  nothing calls it. `ClientPrihodTab.tsx` was rewritten in decisions 0171/0174
  onto `report_query_page`/`report_totals` directly; `grep -rn
  "client_serial_ledger" src/` returns zero hits outside this file's own
  research. Dead code, not today's incident. **Follow-up flagged, not done
  here** (scope discipline): a small migration dropping
  `client_serial_ledger(date,date,uuid)` a second time, now that it's safe.

**Separate, unrelated, still-live finding** (flagged, not fixed here — out of
scope for the client Приход report): `edge_logs`/`postgres_logs` show a
distinct, currently-recurring error, `column chiqim_lines_1.declared_tara_kg
does not exist`, on `GET /rest/v1/chiqim_requests?...,declared_tara_kg,...`,
every ~30–60s from a single Android WebView (Capacitor) client. Current
`src/` has zero references to that column outside comments (dropped cleanly
by migration 0103, along with matching `ChiqimForm.tsx`/
`useOmborChiqimRequests.ts` updates) — this is a stale JS bundle on one
device that predates 0103, most likely a Capgo OTA channel that hasn't
reached it. Ombor/CHIQIM-scoped, not client/Приход-scoped. Needs its own
investigation into why that device didn't receive the OTA update.

**Fix:** `0153_revert_report_rpc_statement_cap_5s.sql` — reverts the per-path
cap for these four RPCs back to the role's 12s default
(`alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload
config';`), exactly the "instant, no redeploy" rollback the 2026-09-22 change
itself pre-documented. 12s was already measured safe for this traffic shape
(decision 0213: "Hisobot fixed... zero timeouts" at 12s, before this 5s cap
existed). `pgrst_statement_cap()` itself is left in place, unbound, rather
than dropped — the function body is unaffected, so it can be re-wired at a
verified-safe value later without re-deriving it.

**Written to migrations/ but NOT applied live this session**, per this
project's "ask before applying migrations to the live project" rule — the
user explicitly chose "write the migration, don't apply live yet" when asked.
**The live project still has the 5s cap active as of this commit — Приход
will keep failing under concurrent load until someone applies
`0153_revert_report_rpc_statement_cap_5s.sql` to the live database** (e.g. via
the Supabase MCP `apply_migration` tool, or the Supabase SQL editor) and
confirms via `query_logs` that no further `pgrst_statement_cap MATCH
path=/rpc/report_totals statement_timeout=5s` lines appear.
