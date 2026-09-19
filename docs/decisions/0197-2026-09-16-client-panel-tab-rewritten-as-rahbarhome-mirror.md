# Client Панель rewritten as a RahbarHome.tsx mirror (RLS-scoped, no new RPC)

## What changed

`ClientPanelTab.tsx` no longer has its own data path
(`clientPanelSummary.ts` -> `client_panel_summary`/`client_old_stock_breakdown`
RPCs). It now calls the exact same `useRahbarStockSnapshot`/
`useRahbarDashboardLedger` hooks RahbarHome.tsx calls, and renders through
the same extracted `HeroTiles`/`OmborHozirSection`/`OldStockDrilldown`
components (see `0196-...-hero-tiles-ombor-hozir-section-extraction.md`) --
per explicit instruction not to fork a parallel copy of that JSX.

Scoping to the client's own owner is handled entirely by RLS: both RPCs are
`SECURITY INVOKER` with no owner parameter of their own; every table/view
they touch relies on the caller's row-security policies. No new RPC, no
client-only data path, no owner_id passed from the frontend at all.

Two differences from RahbarHome.tsx, both by design:

1. A 2-way Склад toggle (Новое/Старое) replacing Rahbar's 3-way Zaxira
   (no "Hammasi" merged view -- a client has no reason to see old+new
   combined). Defaults to Новое.
2. Rahbar shows its 6th tile and Эski drill-down *alongside* the new-stock
   content at every scope. The client's toggle instead switches between
   two entirely separate views: Новое -> the 5 new-stock tiles +
   "Omborda hozir" section; Старое -> 2 old-stock tiles (Эски ювилган +
   Старый склад Кондитерка, both already established in the prior
   Панель tile-split round) + the drill-down, with the "Omborda hozir"
   section hidden.

## Localization

The client portal is Russian-only throughout (`ClientLayout.tsx`'s own
header comment). `HeroTiles` was already generic/text-agnostic (see
0196), so the client's tile configs simply pass Russian label/caption
strings directly -- no change needed there. `OmborHozirSection` was
hardcoded Uzbek (matched RahbarHome verbatim, by 0196's own design), which
would have left one section of an otherwise-Russian client screen in
Uzbek. Added an explicit `locale?: 'uz' | 'ru'` prop (default `'uz'`, so
RahbarHome's own call site is unchanged) rather than forking a
Russian-only copy of the component -- the two locales' static copy
(headings, filter labels, the two summary paragraphs) live side by side
in one `STRINGS` table / inline JSX branch, sharing every number and every
piece of markup/structure.

## Dead code

`src/lib/clientPanelSummary.ts` had no other callers after the rewrite --
deleted. The `client_panel_summary`/`client_old_stock_breakdown` RPCs
themselves were deliberately left in place in the database: dropping a
backend object ahead of confirming its replacement is solid was exactly
this session's own earlier production incident (emergency-restore of
`client_serial_ledger`, `0119_emergency_restore_client_serial_ledger.sql`).
Flagging here rather than silently dropping them, per scope discipline --
a follow-up cleanup task, not bundled into this one.

## RLS verification (before wiring the client screen to these RPCs directly)

This reuse means every table `rahbar_stock_snapshot`/`rahbar_dashboard_ledger`
touch is now reachable by a client-role caller, so audited each one by name
rather than assuming the earlier partial audit (which found and fixed the
`rezka_sends`/`old_stock_closeouts` gap, 0195) was complete:

- `pg_get_functiondef` on both RPCs, `stock_on_hand_rows`, and
  `report_kirim_rows` to enumerate every table/view/function they read:
  `kirim_lines`, `kirim_orders`, `wash_cycles`, `storage_intake`,
  `moyka_sends`, `rezka_sends`, `raw_dispatch_lines`, `chiqim_lines`,
  `chiqim_requests`, `old_stock_closeouts`, `finished_pallets`, `calibres`,
  `product_types`, `serial_mint_sources`, `chiqim_pallet_consumption`,
  `lab_results`, `old_kn_pools`, `old_kn_collections`,
  `report_kirim_rows_as_of()`, `chiqim_departed_at()`.
- `pg_policies` for every one of those tables: all already carry a working
  `client_read_own_*` policy (or, for `calibres`/`product_types`, a
  `read_all` with no client exclusion at all -- correct, since these are
  role-agnostic reference tables with no owner-scoped rows to leak).
- Confirmed every function involved (`rahbar_stock_snapshot`,
  `rahbar_dashboard_ledger`, `report_kirim_rows_as_of`,
  `chiqim_departed_at`) is `prosecdef = false` (SECURITY INVOKER) --
  consistent with the RLS-only scoping model this whole reuse depends on.
- `stock_on_hand_rows` has `security_invoker=true` (confirmed via
  `pg_class.reloptions`); `report_kirim_rows` has no `security_invoker`
  option set (defaults to legacy/definer-owner semantics for view
  permission checks) -- already established earlier this session as
  harmless in this Supabase setup: `my_role()`/`my_owner_id()` read
  session-level JWT claims via GUCs, not the view-owner's identity, so
  the policy conditions themselves still evaluate against the real caller
  regardless of the view's own `security_invoker` setting. Not re-derived
  from scratch here -- already established by role-switched testing
  earlier in this session.
- Live role-switched test (`SET LOCAL ROLE authenticated` +
  `request.jwt.claim.sub` = the TEST client's own id), calling both RPCs
  at both `yangi` and `eski` scope: all four calls succeeded with no SQL
  error and returned real, non-error, internally-consistent numbers (e.g.
  Старый склад Кондитерка's `oldKnKg` = 83,324 identically at both
  scopes, confirming migration 0120's scope-independence still holds
  after this round's other changes).

## Verification

- `npx tsc -b`, `npx oxlint` (same 2 pre-existing warnings), `npm run
  build` -- all clean.
- Not independently verified against a live rendered DOM (this sandbox
  cannot reach the live Supabase/Netlify hosts, per the same limitation
  noted in 0195/0196) -- relied on the live SQL role-switch test above
  for runtime behavior, and structural/type-level checks for the frontend.
