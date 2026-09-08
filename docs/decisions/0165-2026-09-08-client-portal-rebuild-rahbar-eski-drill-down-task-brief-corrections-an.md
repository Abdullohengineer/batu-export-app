## 2026-09-08 — Client portal rebuild + Rahbar Eski drill-down: task-brief corrections and scope decisions

**Context:** Task brief ("Rebuild the client portal to reuse Rahbar's dashboard + Hisobot
patterns...") assumed several things about the current codebase that inspection (CLAUDE.md
"Inspect live/migration schema before assuming table/column names or shape") found to be
stale or incorrect. Logged here before any code was written, per CLAUDE.md "if ambiguous
after inspection: stop, report, do not invent a design."

**Findings, all confirmed against the live Supabase project (`qohoqbapevrcjqxbstxi`) and repo
migrations, not assumed:**
1. The brief's "migrations 0107/0108" (client Hisobot rebuild) are actually **0109/0110**
   (`client_serial_and_chiqim_ledger` / `client_serial_ledger_fix_ostatok_syrya`) — real
   0107/0108 are unrelated (Hisobot `Yo'qotish` column; Rahbar open-wash-cycle-loss fix). See
   the entry immediately above this one ("client_serial_ledger's Остаток сырья formula...")
   for the renumbering's own history. Migration head going into this task is **0110** — new
   migrations here start at 0111.
2. **No "Эски tile drill-down" exists on Rahbar's dashboard, and no charting library is
   installed anywhere in this app.** The brief's Part A ("currently shows one graph for Эски
   (ювилган)... change to two graphs") does not match `RahbarHome.tsx`: there is no Eski tile,
   no modal/route/expanding section for old stock, and `package.json` has no
   recharts/chart.js/d3/etc. — the dashboard's existing "graphs" are hand-rolled CSS
   width-`<div>` bars. Old KN (Старый склад Кондитерка / old_kn_pools) was **deliberately
   removed** from this dashboard in v1.43 (2026-08-30, `0106_rahbar_dashboard_corrections.sql`)
   — SPEC.md's own words: "old KN is no longer visible anywhere on this dashboard (81,915 kg,
   reachable via Ombor qoldig'i and Hisobot only), a recorded choice that reverses the
   reasoning which gave it a tile." The brief also cites "SPEC v1.10" for this removal; the
   real changelog version is **v1.43** — v1.10 is the unrelated weight-authority (§2.16) entry.
3. **`docs/SPEC.md` §3.6 (Client portal) is itself stale.** It still describes the pre-rebuild
   single-screen `ClientHisobotTab.tsx` design (migrations 0082-0085) with no changelog row or
   rewritten text for the 2026-09-02 rebuild into `ClientPrihodTab.tsx`/`ClientRashodTab.tsx`
   (commit "Rebuild client Hisobot as per-serial (Приход) + per-dispatch (Расход) ledger") —
   confirmed via `grep -n "client_serial_ledger\|client_chiqim_ledger" docs/SPEC.md` → zero
   hits before this task. §3.6 is being rewritten as part of this task's own migration/frontend
   work (see the Part B–E entry below), per this project's own convention that a build
   revealing stale spec text updates SPEC.md in the same pass rather than leaving it to drift
   further.
4. `chiqim_lines.line_kind` only has 3 live values (`finished`, `raw`, `old_kn`) — the brief's
   5 "Тип" labels for Расход are derived, not stored: `finished` + calibre `KN` (Konditerka) =
   Кондитерка, `finished` + `is_old_stock` = Эски (ювилган), `finished` otherwise = Готовая
   продукция, `raw`/`old_raw` = Возврат (Хом has zero rows — no field distinguishes a raw sale
   from a return, a known, previously-logged gap, not something this task closes), `old_kn` =
   Старый склад Кондитерка (pool-based, no serial).

**Decisions, confirmed with the user via `AskUserQuestion` before any code was written:**
- **Part A scope:** old KN gets a graph inside the existing Zaxira scope toggle's **Eski**
  setting — an old-stock-only view, where old KN belongs. **This does not reverse v1.43**:
  v1.43's removal of old KN from the new-products headline/Yangi scope was correct (old KN is
  old stock, not new stock) and stands completely unchanged here — Yangi, Hammasi, and the
  headline `totalKg` are byte-identical to before this task. Additive to the toggle that already
  exists (`ZaxiraScope: 'yangi'|'eski'|'hammasi'`), not a new tile on the main dashboard. See
  SPEC.md v1.46.
- **Charting:** `recharts` added as a dependency (first chart library in this app) — the user's
  explicit choice over reusing the hand-rolled CSS-bar style, for both this drill-down and its
  reuse in the client Панель tab.
- **Old-KN rows in the client Расход per-serial table (Part B.3):** shown as a synthetic
  per-type row (no real serial exists for a pool draw) rather than a separate summary block —
  keeps all 5 Тип values in one table, clearly marked as pool-based.

**Verification so far:** live-schema inspection only (via Supabase MCP `execute_sql`/
`list_tables`/`list_migrations` against the production project) — no code had been written at
the time of this entry. Frontend/migration work for Part A and Part B–E follows in subsequent
commits; see this file for their own entries.

**Correction found while writing the Part D migration (orphan-function drop, task's own
pre-flight question 3):** of the four functions named as orphaned leftovers
(`client_report_rows`, `client_report_totals`, `client_serial_summary`, `client_calibre_split`),
three are genuinely dead (confirmed via `pg_get_functiondef` regex search over every live
`public` function — nothing else in the database calls them, and the frontend grep already
showed zero call sites) and are dropped in `0116_drop_orphan_client_report_functions.sql`.
**`client_calibre_split` is NOT dropped** — it is a live dependency of `client_serial_loss_kg`
(`supabase/migrations/0101`, used by the *internal staff* Hisobot's `Yo'qotish, kg` column,
v1.44/`0107`) and of `client_serial_moyka_kg`, both confirmed via the same function-body search.
Dropping it would have broken an unrelated, currently-shipped feature — exactly the kind of
"confirm before assuming" this task's own pre-flight question asked for, so the recommendation
to "drop now" is followed for 3 of the 4 named functions, not all 4.

**Build log (Part A and Part B–E), migrations 0112–0117, all applied and verified against
production before commit.**

Part A: `0112_rahbar_old_kn_by_type.sql` adds `oldKnByType` to `rahbar_stock_snapshot` (additive,
no signature change) — verified live: at `p_scope='eski'`, `oldKnByType` sums exactly to
`oldKnKg` (81,915 kg across 4 types); at `p_scope='yangi'` it's empty, matching "old KN never
shows for new stock" with no separate condition needed (old_kn rows are always
`is_old_stock=true` in `stock_on_hand_rows`, so the existing scope filter already excludes them
at `yangi`).

Part D: `0113` (`client_old_stock_breakdown`/`client_panel_summary`), `0114`
(`client_production_ledger`), `0115` (`client_chiqim_ledger` flat→per-serial pivot), `0116`
(orphan-function drop, see above), `0117` (adds `p_type_id` to `client_chiqim_ledger`, appended
with a default so no existing caller breaks). All verified against the real "Global Export
Company" owner by temporarily setting `request.jwt.claim.sub` to that client account's real
`profiles.id` in a raw SQL session (`my_owner_id()` reads `auth.uid()` via that same JWT claim,
so this exercises the exact self-scoping path a real client session would) — not against
disposable TEST- fixtures, since every one of these RPCs is read-only (no INSERT/UPDATE/DELETE
anywhere in Part A/B–E), so CLAUDE.md's "Testing workflow" TEST- fixture rule (which governs
irreversible/destructive operations) doesn't apply; nothing was written to the database outside
the migrations themselves. Cross-checks that came back consistent: `client_panel_summary().stock.
oldStockKg` (126,535) = `client_old_stock_breakdown` oldWashed.totalKg (44,620) + oldKn.totalKg
(81,915); `client_panel_summary().dispatchedKg` (69,151) = `client_chiqim_ledger`'s own
`totals.totalKg` for the same all-time range; `client_chiqim_ledger` with a type filter (59,414)
< without (69,151), confirming `p_type_id` actually narrows the result.

Two real bugs caught during this verification, both before anything reached the live database
uncorrected: (1) a Postgres comma-join/explicit-JOIN precedence mistake in `client_old_stock_
breakdown`'s first draft (`from t s, me join other o on ...` parses as `t s` and `me join
other o` as two separate FROM items, so `o`'s ON clause can't see `s`) — fixed by keeping every
explicit JOIN chain as one FROM item and cross-joining `me` after it, not before; (2) a
mismatched-paren bug in the `'rows'` JSON construction shared by `client_production_ledger` and
the `client_chiqim_ledger` pivot, caught by test-running the query body standalone via
`execute_sql` before ever calling `apply_migration` — a `coalesce((select agg(...) ...), default)`
nested inside another `jsonb_build_object`/`jsonb_agg` needs one more closing paren than it looks
like at a glance; rewritten throughout to the already-proven `(select coalesce(agg(...) order by
..., default) from ...)` shape this codebase's other RPCs already use, rather than reintroducing
the same risk in a different spot.

**Хом/Возврат merge made permanent, not just "still zero rows":** `src/lib/clientLabels.ts`'s
`Хом → Возврат` entry and `client_chiqim_ledger`'s own `kind` derivation (`raw`/`old_raw` →
`vozvrat`, unconditionally) already meant Хом never actually appeared; Part B.3's fixed 5-Tип
list makes that permanent on the client side rather than leaving a 6th always-empty filter value
around as before. The underlying schema gap (no field distinguishes a raw sale from a return) is
unchanged and still open — flagged again here, not solved, since closing it needs a real schema
change out of this task's scope.

**`rezka_kn` (Резка KN) folded into the Кондитерка Тип bucket**, not given a 6th column: the
task's Расход spec names exactly 5 Тип values, and Rezka processing has zero live rows in this
project (`calibres.is_rezka_output`, confirmed via the earlier live-schema inspection) — closest
semantic fit, and if Rezka output ever starts flowing, it will show up inside the Кондитерка
total rather than being silently dropped by the `p_kinds` filter.

**Old-raw stock (`old_stock_closeouts.kind = 'old_raw'`, ~2,880 kg for this owner) is not a third
Эски drill-down graph.** The task named exactly two categories (Эски ювилган + Старый склад
Кондитерка); old-raw material is folded into the Панель's plain "Сырьё" bucket rather than into
"Старый склад", so the four Панель buckets still sum to the true total without inventing a
bucket or a graph the task never asked for. Flagged, not solved — a future task naming old-raw
explicitly would need its own decision on where it belongs.

**Verified:** `npx tsc --noEmit`, `npm run build`, and `npm run lint` all clean after every part.
No Playwright run was possible in this environment — no `.env.test` (gitignored, per CLAUDE.md,
and not present in this session's fresh clone) and no `TEST_CLIENT_PHONE`/`PASSWORD` account
exists yet in `tests/e2e/helpers/login.ts`'s `TestRole` union (`RAHBAR | MENEJER | QOROVUL |
OMBOR | LABORATOR` — no `CLIENT`), so authenticated browser verification of either the Rahbar
Eski drill-down or any client-portal screen was not possible here; live-data correctness was
established via direct RPC calls against the production database instead (see above), which is
as far as this session could go without a real browser session. Flagged for whoever verifies
this live: a `TEST CLIENT` account (phone `900000006`, matching the existing `900000001`-`5`
convention) and a `CLIENT` entry in `TestRole` would be needed before an e2e spec for this screen
family could be written at all.
