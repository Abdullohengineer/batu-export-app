# CLAUDE.md — BATU EXPORT project rules

Source of truth: `/docs/SPEC.md` (versioned). Decision log: `/docs/DECISIONS.md`.
Read both, relevant sections only, before every task.

## Schema
- Inspect live/migration schema before assuming table/column names or shape.
  Prior steps repeatedly found Phase 0's real schema differs from §8's
  pseudocode (dropped FKs, missing/extra columns, unbuilt tables).
- If ambiguous after inspection: stop, report, do not invent a design.
- Serial lives on `kirim_lines`, never `kirim_orders`. A serial is
  single-type by construction.
- Declared (manager) vs actual (storage) are separate persisted fields.
  Never overwrite declared. Their gap is a finding, not an error to fix.
- Derive, don't store: running balances (e.g. Moyka "qoladi") are computed
  by summing an append-only event log, not kept as a stored/synced column.
- RLS pattern: `read_all` (any authenticated) + `<role>_writes`, via
  `my_role()`. Match existing policy shape for new tables.
- Status flips that a writing role isn't permitted to make directly (e.g.
  qorovul flipping kirim_orders.status) go through a `security definer`
  trigger, not app code.
- Storage buckets: one per photo type, `read_all` + `<role>_insert`, same
  shape as `kirim-photos`/`gate-photos`.

## Reuse, don't rebuild
- Photo compression: `src/lib/imageCompress.ts`.
- Append-only notes/Qaydlar: `notes` table + `useNotes`/`EntityNotes`.
- Top-tab per-role navigation: pattern from Step 4 (QorovulHome/OmborHome).
- Two-window list pattern (Faol/Yakunlangan-style) for queues.
- Barcode rendering: JsBarcode/Code128, `src/lib/barcodeLabel.ts`, 50x30mm.
- **Section mirroring** (SPEC.md §5 intro, `src/lib/stageMembership.ts`): a
  section's Window N is the same underlying set as the next section's
  Window N−1 — reuse the same query/hook across that boundary, never
  reimplement it. Cite this by name instead of restating the table.

## Workflow
- Feature branch off `main` per task. Open PR. Never merge — user reviews.
- If Supabase MCP is available: ask before applying migrations to the live
  project. Once applied, re-verify end-to-end against real data.
- If no MCP: verify against a disposable local Postgres sandbox, say so
  explicitly, and flag that live application/testing is still needed.
- Log schema surprises, resolved ambiguities, and spec deviations in
  DECISIONS.md. If a build reveals the spec text is wrong or superseded,
  update SPEC.md inline (mark/strike the old text, don't delete silently)
  and log why in DECISIONS.md — never contradict the spec silently.
- Don't leave debug code, temp routes, or test dependencies in the final
  diff — verify, then revert.

## Scope discipline
- Build only what the task specifies. Explicitly flag (don't silently fix
  or silently skip) anything adjacent that's broken, missing, or ambiguous.
