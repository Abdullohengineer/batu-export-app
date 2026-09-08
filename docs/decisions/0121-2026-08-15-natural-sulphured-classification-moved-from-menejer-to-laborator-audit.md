## 2026-08-15 — Natural/sulphured classification moved from Menejer to Laborator; audit trail
**Context:** Abdulloh's reasoning: the lab physically sees the product, so they're the right
observer for whether it's sulphured — and because it's set on a form the lab can reopen, a
misclassification becomes fixable in-app instead of requiring SQL (the exact repair path the
prior entry above needed for `110826-001`/`002`/`003`). Investigated four questions before
touching anything; findings below, then the design.

**1. Does product type already encode the classification?** No — investigated live data, not
assumed. Five types (`Isfara`, `Natural`, `Qand`, `Qand qizil`, `Subxon`), all one category
(O'rik/apricot). Zero rows in the entire database have ever been explicitly classified `false`
(natural) — not one, of any type. Worse, every `true` value traces back to either the mechanical
backfill from the retired `target_so2_mg_kg` proxy or the manual 3-serial repair — never a
deliberate click on the real select — so even the strongest-looking signal (`Subxon`, 8-for-8
sulphured) is provenance-tainted by the exact mechanism this whole feature replaced because it
was proven unreliable. The type literally named "Natural" has the *least* evidence of any type
(its one real row is a permanently-exempt opening-stock line). Seed/demo data treats `Isfara` as
the flagship natural example; production's two real (backfilled) rows say sulphured — a direct
contradiction. **No type-level default was built.** If revisited once real lab-set volume
accumulates: a nullable `product_types.default_is_sulfured` column (mirroring the existing
`product_categories.calibre_applies` precedent), used only to pre-select Laborator's choice,
never to skip asking — the same "explicit click, never auto-derived" principle §5.5.3 already
holds for verdicts.

**2. Pre-lab window — can `wip_rows` fire prematurely on a `NULL` line?** No, confirmed
structurally, two independent ways. `wip_rows.so2_pending` reaches a `wash_cycles` row only via
`JOIN LATERAL` (not `LEFT JOIN LATERAL`) against `lab_results` — a wash cycle with zero CHIQIM
readings produces zero rows in that CTE, full stop, regardless of `is_sulfured`. Independently,
`lr.status = 'moisture_in'` is only ever written *as part of* the very insert that creates the
first CHIQIM reading, so that status literally cannot exist before a reading does. And before
Moyka-send, there's no `wash_cycles` row at all for `so2_pending` to look at. One correction to
how this was framed: the "Diqqat talab" screen doesn't read `wip_rows` directly — it goes
through `rahbar_exceptions()`, which folds `so2_pending` and `awaiting_lab` into one generic
"Tahlil kechikdi" label; the literal "Sera kechikdi" text only renders on the separate
"Kutilayotgan ishlar" screen. Both gate through the identical predicate, so the safety holds
either way.

**3. Can a serial reach CHIQIM lab with zero KIRIM lab history?** Yes — confirmed real, not
theoretical: 5 live serials today are `internal_reprocess`-origin (opening-stock re-wash, minted
by `send_old_stock_to_moyka`), which are **excluded by construction** from ever reaching KIRIM
Tahlil (`useLaboratorKirim.ts`'s own `origin = 'delivery'` filter) — CHIQIM is the *only* lab
check these serials will ever get. Before this change, nothing on the CHIQIM side (Tahlil, Sera
kiritish, or Edit) offered any way to set `is_sulfured` — these 5 serials were stuck reading
sulphured (fail-safe) forever, with no lab-side fix. This was the deciding case for scope:
selector placement is Option A, all six touchpoints (see Decision below), specifically because
Option B (KIRIM Tahlil only) would have left this real, already-occurring case permanently
unfixable in-app — the opposite of what this whole task exists to achieve.

**4. Correction via Edit — safe, with one real bug found and fixed.** `is_sulfured` is
genuinely one value per serial (`kirim_lines` PK is `serial`; `lab_results` carries no flag of
its own), so any change is inherently retroactive across every past-and-future reading for that
serial — expected, not a defect. Flipping natural→sulphured after an already-given CHIQIM
verdict is safe: the `finished_pallets` hard-gate RLS policy checks only the latest verdict,
never `is_sulfured`, and a later flag change can't retroactively un-gate an already-packed
pallet. **Bug found:** both Edit forms decided whether to show/require SO₂ from the *live* flag,
defaulting the omitted case to `null` — so flipping sulphured→natural, then later using Edit to
fix *any* unrelated field (a note, a typo), silently erased a real, previously-recorded SO₂
reading from every "current status" surface (Window 3, the serial passport), leaving it visible
only in raw Tarix history. Confirmed reproducible against `110826-001`'s own live row shape.
**Fixed as a general rule, not a symptom-patch:** an edit form now carries forward any value it
doesn't present, never writes `null` in place of an existing one. Clearing a real reading is not
something either Edit form can do as a side effect of an unrelated correction — there is no
"clear" action at all, deliberately. Audited both forms for the same exposure on every other
field: moisture, sample date, and (CHIQIM) sampled-source are always rendered/required, never
gated — no exposure. Verdict is the opposite case, by design: `ChiqimTahlilEditForm`'s two
buttons require an explicit click on every save, matching §5.5.3's "never auto-derived" invariant
— nothing to carry forward there, since nothing is ever silently reused.

**Decision — implementation:**
- Menejer's KIRIM form: reverted to plain Tur + Miqdori. No sulfur question, ever.
- The Naturel/Sulfatlangan select moved onto all six Laborator touchpoints that can be a line's
  "first genuine save" or a later correction of it: `KirimTahlilForm`, `ChiqimTahlilForm`, both
  Edit forms, and both tabs' inline Window 2 "Sera kiritish" cards. Each pre-fills from the
  line's current `is_sulfured` (blank/forced-choice only if still `NULL`) and re-derives what
  the rest of that form shows/requires live, in the same render — the classification and the
  reading are captured by the same save. `ChiqimTahlilForm`'s `requireVerdict` moved from a prop
  computed by the caller before the form opened to a value derived inside the form from the live
  selection, since the lab may change the classification while filling the form out.
- **Last-write-wins, stated plainly (asked explicitly, since one value can now be set from six
  places):** `is_sulfured` is a single plain column, written by a plain `UPDATE`, no version
  check. Whichever save reaches the database last simply overwrites — identical to every other
  single-value field on this table, no new concurrency model introduced. The realistic collision
  window is tiny (one lab, one record, one screen at a time); what changes is that every actual
  change is now recorded (see below), so even though only the latest value is "live," the full
  who/when history survives it.
- **Audit trail, and why it is an RPC, not a client-granted UPDATE policy or a client-side
  audit insert (both proposed first, both rejected on review):** a row-level `kirim_lines` UPDATE
  policy for Laborator would have granted write access to every column on the table —
  `declared_qty`, `type_id`, `order_id` — all of which feed `report_kirim_rows_as_of` and every
  downstream balance; "the UI only ever sends `is_sulfured`" is a client-side assumption, not an
  enforced one, and unlike Menejer's date/plate/driver Tahrirlash precedent (which accepts this
  exact tradeoff, `0038`), the blast radius here isn't comparable — `is_sulfured` gates dispatch.
  A client-side audit insert, alongside a client-side update, has two further problems: it can
  fail silently after the flag has already changed, and `audit_log`'s own INSERT policy is
  permissive-by-role (any authenticated user), so a client-supplied `actor` on a field that gates
  dispatch isn't trustworthy. **`classify_kirim_line_sulfur(p_serial, p_is_sulfured)`**
  (`security definer`, matching `send_old_stock_to_moyka`'s exact pattern — role check first,
  `search_path` pinned, `auth.uid()` captured server-side) does the column update and the
  `audit_log` insert in one transaction, with actor derived server-side, never passed by the
  client. Rejects a `NULL` `p_is_sulfured` outright (the never-classified state must only ever be
  *left*, never set backwards) and raises, rather than silently no-opping, if the serial doesn't
  exist. No-ops (skips both writes) if the submitted value matches the current one, so a save
  that doesn't touch classification doesn't add audit noise. No UPDATE policy exists on
  `kirim_lines` at all — this function is the only way `is_sulfured` can change post-intake.
  `audit_log` itself needed no schema change — existing since Phase 0, same table Menejer's own
  KIRIM/CHIQIM Tahrirlash already write to (`0038`), confirmed its `row_id` column is `text`
  (matching `kirim_lines.serial`, not `uuid`) before relying on it.

**Testing:** live browser session against the real dev server + this same database, plus direct
SQL checks. Confirmed: Menejer's KIRIM form has no sulfur field at all; a fresh two-line intake
(disposable `TEST-VERIFY-R2`) — one classified Sulfatlangan at KIRIM Tahlil correctly routed to
Sera kutilmoqda and completed there; one classified Naturel skipped Sera kutilmoqda entirely and
completed at moisture, in one save. `150826-001` (a real, still-unclassified production row) —
its Tahlil form still shows the SO₂ field by default, and `form.checkValidity()` confirmed the
browser blocks submission outright while the required select sits on its disabled placeholder
option; left untouched, not submitted. Correction path: flipped `150826-003` (sulphured, real
SO₂=33 already recorded) to natural via Edit while only touching the note field — the new
superseding `lab_results` row still carries `so2_mg_kg=33`, confirming the carry-forward fix.
Simulated the `internal_reprocess`-shape fixture directly (disposable `TEST-INTERNAL-REPROCESS`
owner/order, replicating what `send_old_stock_to_moyka` produces) — the resulting serial never
appeared on the KIRIM tab at all, reached CHIQIM Window 1 with `is_sulfured` still `NULL`,
classified Naturel there, and completed in one step with a verdict, since that form was its
first and only lab touchpoint. `audit_log` correctly recorded all four real classification
events from this session (2 initial, 1 correction, 1 CHIQIM-first), each with the right
before/after and a real server-derived actor. `wip_rows.so2_pending` stayed at zero rows
throughout. Zero console/server errors across the whole session. All fixtures (`kirim_orders`,
`kirim_lines`, `wash_cycles`, `moyka_sends`, `lab_results`, `audit_log` rows) fully deleted and
reverified at zero afterward.

**Out of scope, not touched:** the type-level default mechanism sketched above (deferred until
real volume exists), Rahbar dashboard, Ombor Tugallash, Rezka.
