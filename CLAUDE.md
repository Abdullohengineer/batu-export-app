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
- **Universal sort rule** (SPEC.md §5 intro named invariant): every stage
  and history list sorts newest-first via the shared `sortByDateDesc`
  (`src/lib/sortByDate.ts`), sorted once inside the hook that owns the data
  so every consumer inherits it — never sorted again per-component, and
  never skipped on a new list in this family. Exempt: append-only event
  timelines (Qaydlar/notes, per-serial send-history) and raw FIFO arrival
  queues (pending trucks/gate trips) — see the named invariant for why.

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

## Testing workflow
Automated (Playwright) end-to-end tests exist from Step 7 onward. See
`docs/DECISIONS.md` "Step 7 testing infra" for the full history, including
why this section reads the way it does.

- 🚩 **Plan limitation, not the original design.** Supabase dev branching
  (isolated per-task databases) was the intended approach but **this
  project's plan does not support branching** (`create_branch` returns
  `PaymentRequiredException: Branching is supported only on the Pro plan or
  above`). Everything below is a workaround for that limitation — if the
  project ever upgrades to Pro, branch-per-task is the better design and
  should replace this section, not sit alongside it.
- **No branch. Tests run directly against the main Supabase project.**
  Because of that, every automated test run MUST:
  1. **Create only `TEST-`-prefixed fixtures.** Any row an automated test
     creates for itself — serials, request IDs, owners, anything — gets a
     `TEST-` prefix (already the manual convention from prior sessions'
     fixture work; see DECISIONS.md "Voided 4 confirmed-artifact serials").
     This is what makes test data trivially filterable and distinguishable
     from real business data at a glance, in any list or query.
  2. **Clean up its own fixtures at the end of the run — void, never
     DELETE**, matching the app's own `never DELETE, only void` rule
     (SPEC.md §2.15). A test that creates a `TEST-` wash cycle voids it
     (`wash_cycles.status='voided'`) when done, the same way a real re-wash
     would be voided, not removed from the audit trail.
  3. **Never touch or modify any non-`TEST-`-prefixed record.** No test may
     read-then-write real business data, even incidentally. If a test needs
     to check availability/feasibility against real stock, it may read that
     data, but any row it writes must carry the prefix.
- **Test-role accounts** are dedicated, permanent Supabase Auth accounts
  (not throwaway, not real users) — one per `profiles.role` value, phone
  numbers `900000001`–`900000005`, full names prefixed `TEST `. Credentials
  live in `.env.test` (gitignored — confirmed covered by the `.env.*` glob
  before it was ever written to; never commit it). Since these are real rows
  on the main project (no branch to isolate them on), they are themselves
  exempt from the void-on-cleanup rule above — they're infrastructure, not
  per-run fixtures, and persist across test runs by design.
- Template/example: `tests/e2e/smoke.spec.ts` + `tests/e2e/helpers/login.ts`
  — proves the pipeline (real login, real navigation, zero console errors),
  not feature coverage. Feature-specific tests build on this pattern.
- **Every e2e/Playwright report must include a plain-language walkthrough**,
  in addition to (not instead of) the usual before/after technical report.
  Written for someone unfamiliar with the codebase, using real values from
  the actual run — not placeholders, not a generic description of what the
  test *would* do. Shape: "Logged in as [role]. Did [action]. Expected
  [result]. Checked the database directly — [what was found]." One line per
  real step of the run, in the order it happened.

## Scope discipline
- Build only what the task specifies. Explicitly flag (don't silently fix
  or silently skip) anything adjacent that's broken, missing, or ambiguous.
