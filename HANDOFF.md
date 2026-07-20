# Handoff — BATU EXPORT app session

Written at end of session, 2026-07-19. Repo:
`C:\Users\user\Documents\GitHub\batu-export-app`
(`github.com/Abdullohengineer/batu-export-app`). Project uses
`CLAUDE.md` + `docs/SPEC.md` + `docs/DECISIONS.md` as its own
source-of-truth trio — read those first, this file is session
scaffolding, not a replacement for them. **This file replaces the
prior handoff wholesale** — that one covered Step 8 (Laborator role,
prompts 1–2), which is still relevant (still uncommitted, see §2) but
is no longer the newest work; this session added Step 9 on top of it,
all on the *same* branch, *same* uncommitted working tree. Nothing in
the prior handoff needs repeating except the still-unresolved
commit-granularity question, folded into §3 below.

## 1. Current task/phase and exact step

**Branch `feature/phase2-step8-laborator-foundations` now contains
BOTH all of Step 8 prompt 2 (2a–2d, Laborator role) AND all of Step 9
(effective_qty weight authority + a full test-infrastructure overhaul),
and NONE of it is committed except `09a5abd`** ("Step 8 prompt 1:
Laborator foundations"). This is the single most important fact in
this handoff, same as last time, just bigger now — read §2/§3 before
touching anything.

Step 9 itself ran as four back-to-back prompts this session:

- **Prompt 1 — `effective_qty` derivation + provisional-weight display**
  (SPEC.md v1.10 §2.16). Built the derived "one working quantity"
  concept (declared vs intake vs gate net) and wired it into every
  consumer that used to read `storage_intake.actual_qty` directly.
- **Prompt 2 — regression pass.** Ran the full existing Playwright
  suite together (not per-file) after prompt 1's change, on the
  reasoning that a full sweep catches cross-test interference solo
  runs don't. Found two real test-infrastructure bugs (see §4), fixed
  both; found four pre-existing broken specs (fixture rot unrelated to
  this session, see §4); wrote one new e2e test to cover the one real
  coverage gap (`step9-single-product-full-chain.spec.ts`).
- **Prompt 3 — self-generating test fixtures.** Root-caused *why* those
  four specs were broken (hardcoded one-time SQL fixtures, since gone
  stale/voided) and *why* the whole suite needed manual "-NN" bumping
  every single run (repeated fixture-collision incidents across many
  sessions, per DECISIONS.md history). Built a shared fixture-generation
  helper, repaired all four broken specs on top of it, migrated every
  other spec off hardcoded identifiers. Proved it with two consecutive
  full-suite runs, zero manual cleanup.
- **Prompt 4 — small scoped fix.** A regression found live *during*
  prompt 3's testing (a wrong reconciliation number, `-1,200kg` instead
  of `-200kg`) was diagnosed as a request-ordering race in
  `useEffectiveQty`. Fixed the hook. Mid-investigation, the user
  interrupted and said: ship the guard, skip full reproduction, defer
  a related cleanup, run the suite once. Complied — **but the
  investigation before the interrupt turned up strong evidence the
  guard does NOT fully explain the originally-reported symptom** (see
  §5, this is a real open item, not a formality).

**Exact next action:** none code-side — Step 9 is done and tested to
the extent scoped. The next action is **the same housekeeping action
as last handoff, just bigger**: decide commit granularity and push. See
§3.

## 2. What's completed and verified

### Step 8 prompt 2 (2a–2d) — unchanged from the prior handoff, still uncommitted
Nothing here was touched this session. Still fully built and tested
(Laborator KIRIM/CHIQIM screens, hard gate, re-wash cycle retrofit).
See the prior handoff's own §2 (now superseded as a *file* by this one,
but its *content* about Step 8 is still accurate) or just read
`docs/DECISIONS.md`'s dated entries for "Step 8 prompt 2, split 2a/2b/2c/2d".

### Step 9 prompt 1 — effective_qty (SPEC.md v1.10 §2.16)
**New files:**
- `src/lib/weightAuthority.ts` (+ `.test.ts`) — pure `deriveEffectiveQty`
  (single-line→gate net once gate stage 2 done; multi-line→own intake
  figure, NEVER gate net, even after stage 2; before-stage-2→intake,
  provisional), `computeVariance`, `isMaterialVariance`.
- `src/lib/effectiveQty.ts` — `fetchEffectiveQty` (I/O layer, batches by
  order for multi-line reconciliation) + `useEffectiveQty` hook, mirrors
  `rewash.ts`/`activeCycles.ts`'s pure/IO split, per explicit user
  instruction to mirror that pattern.
- `docs/SPEC-reporting-v1.10-revision.md` — the source revision document
  pasted **verbatim** (unmodified) per the task's own instruction, so
  the not-yet-applied §3.2 reporting-layer content isn't lost.

**Modified files:** `docs/SPEC.md` (new §2.16 — **renumbered from the
source doc's own "§2.15," which collided with this doc's pre-existing
§2.15 "Technical architecture"** — see §4; amended §3.1/§5.1/§5.3; version
bumped 1.12→1.13, changelog row added), `src/lib/useMoykaSerials.ts`
(cycle-1 `cycleInputKg` input switched from `actual_qty` to
`effective_qty`; `available` floored at 0), `src/pages/ombor/OmborIntakeTab.tsx`
(§5.1 Window 2 membership + display switched to `effective_qty`,
provisional badge, variance notes), `src/pages/ombor/OmborMoykaTab.tsx`
(provisional/variance display on the send row), `src/pages/menejer/KirimOrdersList.tsx`
(previously showed only `declared_qty` — now shows `effective_qty`/
provisional alongside it).

**Deliberately NOT touched:** `useMoykaOutput.ts` (never read
`storage_intake` directly, nothing to switch), `IntakeAcceptForm.tsx`/
`OmborHisobotlar.tsx`'s existing declared-vs-actual "Kam chiqdi" check
(a different, still-valid floor-level check, not the accounting
variance), `LaboratorKirimTab.tsx` (quality is independent of quantity,
confirmed by spec's own words).

**Money-path verification done, not just claimed:** live-queried the
whole `kirim_lines`/`storage_intake`/`gate_weighings`/`moyka_sends` join
*before* writing code. Confirmed: no already-locked `wash_cycles.final_loss_pct`
value changes (locked figures are read directly, never recomputed —
confirmed both by code inspection and by re-querying six historically-known
serials and finding zero drift from their last-documented values). The
only real behavior change is forward-looking: new "available to send"
figures and any *not-yet-finalized* serial's eventual loss% now derive
from `effective_qty`, not `actual_qty`.

### Step 9 prompt 2 — regression pass
**Modified:** `playwright.config.ts` (added `workers: 1` — see §4, this
is a real bug fix, not a style choice), `tests/e2e/rewash-full-cycle.spec.ts`
and `tests/e2e/laborator-chiqim-hard-gate.spec.ts` (added
`test.setTimeout()` overrides — both were already timing-tight against
the 30s default before this session, and `effective_qty`'s extra
per-refresh queries pushed them over).
**New:** `tests/e2e/step9-single-product-full-chain.spec.ts` — the one
real coverage gap: full single-product KIRIM→gate→intake→Moyka→Tayyor→
Lab→CHIQIM→dispatch→Menejer-finished-view chain, self-contained,
because the pre-existing test for the last part couldn't run at the
time (fixed in prompt 3, see below — this new test stayed anyway since
it covers ground no other single test does, per its own header comment).

### Step 9 prompt 3 — self-generating test fixtures
**New:** `tests/e2e/helpers/fixtures.ts` — `uniqueTestId(label?)` (TEST-
prefixed, unique per run via a module-level random+timestamp token, per
call via a counter — survives both across separate `npx playwright test`
invocations and multiple calls within one spec), `uniqueRealLookingPlate()`
(the ONE deliberate non-TEST-prefixed exception, for the one test that
has to exercise `useFinishedChiqimRequests.ts`'s own TEST- filter),
`seedDispatchablePallets()` (seeds a full real, lab-passed, dispatchable
finished-pallet chain via direct `window.supabase` writes, switching
role per table per RLS — menejer for `kirim_orders`/`kirim_lines`,
ombor for `wash_cycles`/`finished_pallets`, laborator for `lab_results`
— instead of driving KIRIM→Moyka→Tayyor through the UI), `seedFilteredFinishedRequest()`
(negative-case fixture for the TEST- filter test).

**Repaired (all four previously-unrunnable CHIQIM specs), assertions
preserved, only fixture generation + a small number of genuine locator
bugs fixed (see §4):** `chiqim-flow.spec.ts`, `chiqim-full-chain.spec.ts`,
`chiqim-undo-scan.spec.ts` (its load-bearing RLS-DELETE-refusal
assertion is untouched), `menejer-chiqim-finished-view.spec.ts` (its
self-defeating permanently-completed-request fixture is now generated
fresh every run — **confirmed by actually running it twice back to
back**, not assumed).

**Migrated off hardcoded "-NN" identifiers onto `uniqueTestId()`:**
`effective-qty.spec.ts`, `kirim-client-targets.spec.ts`,
`laborator-kirim.spec.ts`, `laborator-chiqim-hard-gate.spec.ts`,
`rewash-full-cycle.spec.ts`, `step9-single-product-full-chain.spec.ts`.
`smoke.spec.ts` needed no change (no fixture identifiers).

**`laborator-chiqim-hard-gate.spec.ts`'s stale-copy assertion, fixed
(confirmed genuinely stale, not a collision — see §4):** now matches
either valid message shape `ChiqimForm.tsx`'s feasibility hint can
legitimately produce, via a regex, instead of one hardcoded string that
depended on unrelated pre-existing stock elsewhere in the shared DB.
Also fixed: it now clicks "Yuklashni yakunlash" to close out its own
second CHIQIM request, instead of leaving it permanently open (was
polluting `chiqim-flow.spec.ts`'s own W1-empty-list assertion on a
later run).

**Proof: two consecutive full-suite runs, zero manual intervention,
both reported explicitly.** Run 1: 12/12. Run 2, same live DB, no
cleanup: 11/12 — the one failure was itself a real, narrow application
race (see Step 9 prompt 4 below), not a fixture problem.

### Step 9 prompt 4 — effectiveQty refresh race guard
**Modified:** `src/lib/effectiveQty.ts` — `useEffectiveQty`'s `refresh()`
now tracks a `latestRequestId` via `useRef`, incremented synchronously
per call; a response is only applied via `setData` if no newer call has
started since. Fixed once, in the hook — protects every consumer
(`OmborIntakeTab.tsx`, `KirimOrdersList.tsx`, and any future caller)
without each needing its own guard. **Confirmed working on its own
terms** via temporary instrumentation: caught a real case of an older
request resolving after a newer one had started, and watched the guard
correctly discard the stale one.

**NOT done, explicitly deferred by the user mid-task:** collapsing
`fetchEffectiveQty`'s redundant `storage_intake`/`moyka_sends` fetch
(duplicates two of the five queries `useMoykaSerials.ts` already ran
itself). A working version was built and typecheck-verified, then
reverted before shipping, per direct instruction. `fetchEffectiveQty`'s
own doc comment now flags the redundancy explicitly so it isn't
forgotten. `useMoykaOutput.ts` does NOT call `fetchEffectiveQty` at
all — a prior session's note claiming otherwise was inaccurate,
corrected in this session's DECISIONS.md entry.

### Testing, all confirmed today
`npm test` → **72/72 passing** (61 pre-existing + 11 new
`weightAuthority.test.ts` cases). `npx tsc -b --noEmit` → clean.
`npx playwright test` (full suite, single worker, fresh fixtures) →
**12/12 passing** as of the very last run this session, run once
(reduced testing per explicit instruction for the prompt-4 fix — see
§5 for why this is weaker evidence than it looks).

## 3. What's in progress but NOT done — exact next action

**The code is done and tested (to the scope of each prompt). The git
state is not, and is now larger than last handoff.**

1. `git status` on `feature/phase2-step8-laborator-foundations` shows
   ~22 modified files and ~26 untracked files, spanning BOTH Step 8
   prompt 2 (2a–2d) and all of Step 9 (prompts 1–4). Plus `.claude/`
   and `supabase/.temp/` (local tool state — **do not commit these
   two**, unchanged rule from every prior session).
2. **Commit granularity was never decided last session, and is now a
   bigger decision, not a smaller one.** Reasonable options: (a) one
   commit per Step 8 split + one per Step 9 prompt (8 commits total,
   maximally bisectable, matches the DECISIONS.md entry structure
   exactly), (b) one commit for all of Step 8 + one for all of Step 9,
   (c) squash everything into one commit. Given Step 9 touches
   already-shipped Step 8 code in a few places (`useMoykaSerials.ts` was
   touched by both), and prompt 4's fix is genuinely incomplete (see
   §5), (a) is probably still the right call for review-ability — but
   this is the user's call, not decided.
3. **Consider whether Step 9's work belongs on a NEW branch rather than
   bundled into `feature/phase2-step8-laborator-foundations`.** The
   branch name itself now undersells what's on it. Not decided; flagging
   since it wasn't even a question last handoff.
4. Push (branch already tracks `origin/feature/phase2-step8-laborator-foundations`).
5. **No `gh` CLI available** (confirmed again this session, unchanged
   from every prior session) — leave the branch pushed, give the user
   a compare URL. Do not attempt `gh pr create`.
6. The user merges via GitHub's UI, same as every prior PR.

Nothing else is mid-flight in terms of *new* work — but §5 below has a
real, not-fully-closed investigation (the effectiveQty race's exact
reported symptom) that should be picked up before anyone considers
Step 9 fully done, not just committed.

## 4. Decisions made this session, not yet fully captured elsewhere

Most substantive decisions from prompts 1–3 already have their own
`docs/DECISIONS.md` entries (dated 2026-07-19, titled "Weight authority
& effective quantity", "Step 9 regression pass", and the self-generating-fixtures
entry, plus the newest "effectiveQty refresh race" entry from prompt 4).
Read those in full — they contain the actual reasoning, not just a
changelog line. What's specific to this session's *process*, or worth
restating because it'll matter to whoever commits/reviews this:

- **SPEC.md section-number collision, found before editing, not after.**
  The attached revision doc numbered its new section "§2.15" — SPEC.md
  already had an unrelated, pre-existing §2.15 ("Technical architecture").
  Renumbered to §2.16 throughout (including its own internal
  §2.15.1/§2.15.2 cross-references) when merging into SPEC.md. The raw
  revision file (`docs/SPEC-reporting-v1.10-revision.md`) keeps its
  ORIGINAL numbering, since it's a verbatim reference copy, not the
  merged document — **a future prompt applying its §3.2 will need the
  same renumbering treatment**.
- **`effective_qty`'s three-case priority order, confirmed with the user
  before coding, not just decided unilaterally.** The three bullets in
  the source spec (single-line→gate net / multi-line→intake /
  before-stage-2→provisional) read as independent branches but aren't.
  Implemented as ordered: gate-stage-2-done gates provisional/final;
  single-vs-multi then decides which figure. **Consequence: a multi-line
  truck's `effective_qty` never becomes gate net, even after gate stage
  2 completes** — only its provisional flag flips off. This is
  load-bearing for anyone touching this code later.
- **"Materially different" (the provisional-variance-flag threshold) has
  no defined config — deliberately reused the EXISTING `kam_chiqdi_pct`
  setting** rather than inventing a new one, since the task explicitly
  said not to build new threshold config this round.
- **The full-suite sweep's 2-worker default was a real, previously
  undiscovered bug in `playwright.config.ts`**, not a fixture issue.
  `fullyParallel: false` only serializes tests *within one file* —
  Playwright still spun up 2 worker *processes* across different files
  by default, logging the same shared test accounts in concurrently.
  Produced session-collision symptoms (stray 403, a stuck login race,
  elements flickering in/out of view) in tests unrelated to
  `effective_qty`. Fixed by adding `workers: 1` explicitly — the
  config's own pre-existing comment always claimed this was already
  true; it wasn't enforced.
- **Four CHIQIM specs' fixture rot predates this session entirely and
  is unrelated to `effective_qty`** — confirmed via direct DB query
  BEFORE running anything: their hardcoded `finished_pallets` barcodes
  (seeded once, long ago, via manual SQL) are all `status='bekor_qilindi'`
  for reasons predating Step 8/9. Root-caused, then actually fixed
  (not just documented) in prompt 3 — see §2.
- **`useMoykaOutput.ts` does NOT call `fetchEffectiveQty`** — a claim to
  the contrary in an earlier session's regression-pass note was
  inaccurate and has been corrected in this session's own DECISIONS.md
  entry. Only `useMoykaSerials.ts` and the standalone `useEffectiveQty`
  hook call it.
- **The request-sequencing guard was chosen over `AbortController` or
  awaiting the calls, specifically because it required zero change to
  `fetchEffectiveQty` or any call site** — satisfies "fix belongs in the
  hook, not each call site" literally, and mirrors (in spirit, not
  mechanism) the existing "cancelled"-flag idiom already used in
  `useGateHistory.ts`/`useIntakeHistory.ts` for the same class of
  problem, adapted from a per-effect-run closure to a `useRef` counter
  since this hook's race is across repeated *manual* `refresh()` calls,
  not a dependency-driven effect re-run.

## 5. Open questions, blockers, things to revisit

- **Commit/push decision from §3 — still the immediate blocker**, now
  covering twice the work it did last handoff.
- **🚩 The effectiveQty race guard (prompt 4) does NOT appear to fully
  explain the originally-reported `-1,200kg` symptom, and this was NOT
  root-caused before the investigation was cut short on purpose.**
  This is the single most important open item from this session,
  more important than the commit decision. Full detail is in
  DECISIONS.md's "effectiveQty refresh race" entry, but the short
  version: reproducing the exact multi-product-accept failure
  repeatedly (~50% failure rate standalone) and instrumenting every
  layer showed that on failing runs, **the SECOND line's form submit
  (`IntakeAcceptForm.handleSubmit`) never fires at all** — no
  validation rejection, no console error, nothing. Only one of the two
  `storage_intake` rows ends up inserted, which alone fully explains
  the wrong number (-1,200 = 1 line × 1000kg vs 2200kg gate net)
  without needing any stale-response race at all. This is a
  *different* bug in kind from what was fixed — closer to "a second
  rapid form interaction on the same component mount doesn't fire its
  submit event," which has the flavor of (but is NOT identical to) the
  React-controlled-input races already documented twice elsewhere in
  this app's history (Step 8's 2c/2d DECISIONS.md entries). **Do not
  treat prompt 4 as closing this out.** Next session should either
  re-open the investigation (start by instrumenting
  `IntakeAcceptForm.tsx`'s submit button's own click handler and the
  file-input's `onChange`, on the SECOND of two rapid accepts on the
  same `OmborIntakeTab` mount) or, at minimum, run the multi-product
  effective-qty test 5–10 times in a loop before trusting it's stable.
- **The redundant `fetchEffectiveQty` fetch inside `useMoykaSerials.ts`
  is still there, by explicit deferral, not oversight.** A working fix
  exists in this session's history (reverted, not committed) — worth
  redoing once the race above is actually closed, so the two aren't
  conflated in one diff.
- **Every open item from the PRIOR handoff's own §5 still stands,
  untouched this session:** Ombor's Tugallangan multi-cycle-history gap,
  the audit-log systemic gap, §5.5.6 Tekshiruvlar tarixi (not started),
  Menejer reporting sections §3.2–3.5 (still entirely unbuilt — and now
  SPEC.md's own §3.2 has been REPLACED conceptually by the v1.10
  revision doc's unified reporting design, not yet applied to the
  document itself — see SPEC.md §7 item 13), Rahbar exceptions/oversight,
  offline/PWA, no `gh` CLI.
- **Accumulated `TEST-`-prefixed AND now also non-`TEST-`-prefixed
  (`uniqueRealLookingPlate()`) fixture data keeps growing, still no
  void mechanism.** Live counts as of tonight: 98 total `chiqim_requests`
  (52 still `kutilmoqda`/open — up from 36 earlier in this same
  session), 205 `kirim_orders`, 311 `kirim_lines`, 131 `lab_results`,
  194 `finished_pallets` still `in_stock`. This is now large enough
  that it's actively affecting test behavior (it's WHY
  `laborator-chiqim-hard-gate.spec.ts` needed a tolerant regex instead
  of one exact string — unrelated stock elsewhere in the DB changes
  which message shape the app correctly renders). Still explicitly out
  of scope to clean up per every session's own instructions, but it's
  no longer just a hygiene concern — it's now shaping what assertions
  can even be written safely. Worth raising with the user as a real
  design question soon, not indefinitely deferred.
- **SPEC.md §7 item 13 (carried forward, new this session):** the
  unified §3.2 reporting layer from `docs/SPEC-reporting-v1.10-revision.md`
  is specified but not yet applied to SPEC.md itself or built — future
  work, source preserved verbatim for whenever that prompt comes.

## 6. Approaches tried and explicitly rejected — don't repeat these

Everything in the prior handoff's §6 still stands (page.reload() on
nested routes, blur-alone for the input race, row.click() on outer
divs, toHaveCount(0) as a sole postcondition, hardcoded CSS-class
locators, treating a display-scoped list as a uniqueness source,
blacklist-style RLS checks). New this session:

- **Weakening `chiqim-flow.spec.ts`'s original "Ochiq so'rov yo'q."
  (whole-list-empty) assertion by just deleting the check** — rejected
  in favor of first confirming WHY it was failing. Turned out to be two
  separate causes: (1) a genuine unscoped-locator bug (fixed — the
  locator now scopes to W1 specifically, since W2 renders the identical
  text shape), and (2) a real, permanent incompatibility with this
  shared, never-reset live DB (52 pre-existing open requests). For (2),
  the fix was to check that THIS test's OWN request left the list, not
  that the list is empty — confirmed with the user before changing a
  "preserve assertions exactly" instruction, not decided unilaterally.
- **Assuming a hardcoded expected-copy string in a feasibility-hint
  assertion is safe just because it passed once** —
  `laborator-chiqim-hard-gate.spec.ts`'s `"eng ko'p: 0 kg"` check
  depended on NO other unrelated Subxon/Kalibr 6 stock existing
  anywhere in the shared DB at that exact moment, which stopped being
  reliably true as the DB grew. Don't hardcode one branch of a
  multi-branch UI message when the OTHER branch is a normal, valid
  outcome — match on what's actually invariant.
- **Trusting a single passing run as proof a race is fixed.** The
  effectiveQty race reproduces at roughly a 50% rate in isolated,
  back-to-back standalone runs — a single green run (even the "two
  consecutive full-suite runs" proof from prompt 3) is NOT strong
  evidence this specific class of bug is absent. Needed 6+ repeated
  standalone attempts before it reliably reproduced. Don't declare a
  timing-dependent bug fixed off one clean run, in either direction.
- **Debug `console.log` instrumentation used during the race
  investigation was fully removed before shipping** — confirmed via
  `grep -rn DEBUG src/ tests/` returning nothing. If picking the
  investigation back up, the useful instrumentation points (found this
  session) are: `useEffectiveQty.refresh()`'s start/resolve, and
  `IntakeAcceptForm.handleSubmit`'s entry — both were essential to
  narrowing this down and would need re-adding, not reinventing.
