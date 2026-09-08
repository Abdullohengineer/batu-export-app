## 2026-08-14 — Client quality targets removed from Menejer/Laborator; explicit natural/sulphured flag
**Context:** Abdulloh flagged that Menejer's KIRIM form and Laborator's KIRIM/CHIQIM Tahlil and
Edit forms displayed the client's quality requirement ("Talab: X%", "Talab: X ppm") right next
to the field where the lab enters its own reading. The lab already knows the requirement and
judges against it independently — a displayed target anchors the reading before it's taken.
Separately, `kirim_lines.target_so2_mg_kg IS NULL` had been serving double duty as "this
product needs no sulfur test" (natural), which silently misclassified three real production
serials (`110826-001`, `110826-002`, `110826-003`) as natural — genuinely sulfured deliveries
that never got a target entered — hiding the SO₂ input entirely and leaving them stuck.

**Decision:**
- **Explicit flag, not an inference.** Added `kirim_lines.is_sulfured boolean`, nullable, no
  default. `NULL` means "not yet classified," and — critically — every consumer treats `NULL`
  the same as `true` (sulfured): shows the SO₂ field, marks it required, defers the CHIQIM
  verdict to Sera kiritish. Only an explicit `false` means natural (hides SO₂, allows an
  immediate verdict). This is a deliberate fail-safe inversion of the old bug: previously a
  data-entry gap silently meant "natural" (missing functionality, a serial gets stuck exactly
  like the three above); now a gap silently means "sulfured" (extra visible field, at worst one
  harmless extra step, never a block).
- **Who sets it: Menejer, immediately, coarse.** A required Naturel/Sulfatlangan select on
  Menejer's KIRIM form (`src/pages/menejer/KirimForm.tsx`) — no ppm, no percent, no numeric
  target of any kind. This is a statement of what the product *is*, not a quality spec, and
  Menejer can state it without seeing or entering any client number. Shipped in the same change
  as the flag rather than held: every intake before this lands inherits `NULL`, and under the
  fail-safe rule that's harmless (reads as sulfured), whereas the reverse design — nobody sets
  the flag, everything defaults to natural — would have reopened exactly the bug this fixes.
- **`talab` removed from active-input surfaces only.** No target inputs on Menejer's form. No
  "Talab: …" text, target value, tolerance band, or pass/fail note on Laborator's four
  Tahlil/Edit input forms (`KirimTahlilForm`, `KirimTahlilEditForm`, `ChiqimTahlilForm`,
  `ChiqimTahlilEditForm`) or the two tabs' inline Window 2 "Sera kiritish" cards
  (`LaboratorKirimTab.tsx`, `LaboratorChiqimTab.tsx`). Deliberately **not** touched: the
  Window 3 "Yakunlangan" expanded-row displays, `LaboratorTarixTab.tsx` (history), the serial
  passport, client report, and Hisobot — all retrospective/read-only, none of them anchor a
  not-yet-taken reading. `target_moisture_pct`/`target_so2_mg_kg` are kept on `kirim_lines`,
  still read by those surfaces; nothing writes to them anymore.
- **`wip_rows.so2_pending`** (the Laborator sulfur-overdue WIP alert) switched from
  `kl.target_so2_mg_kg IS NOT NULL` to `kl.is_sulfured IS DISTINCT FROM false` — same
  NULL-means-sulfured direction as everywhere else.

**Repair (production data, `110826-001`/`002`/`003`):**
- `kirim_lines.is_sulfured` set to `true` for all three — unambiguous, these are known-sulfured
  deliveries.
- Setting the flag alone does not reopen them: `useLaboratorKirim.ts`'s Window 1/2/3 membership
  is decided purely by `lab_results.status` (`moisture_in` → W2, `complete` → W3), independent
  of the flag. All three had already been written to `status='complete'` with `so2_mg_kg=null`
  by the branch being fixed. The flag makes Laborator's "Edit" action on the Yakunlangan row
  mechanically capable of showing and saving an SO₂ input (Edit's Window 3 membership doesn't
  depend on the flag), but leaving `status='complete'`/`so2_mg_kg=null` in place would be
  internally dishonest — the record would say "finished" while missing a value the flag now
  says is required. So the LATEST `lab_results` row per serial (one per serial; the current
  record) was corrected to `status='moisture_in'` as well. **Consequence, by design: all three
  now resolve via Window 2 "Sera kiritish", not "Edit."** Anyone looking for them under Edit
  won't find them — they're in Sera kutilmoqda instead, which is where a sulfured serial with
  moisture in and SO₂ pending is supposed to sit.
- `110826-001` carries four `lab_results` rows from repeated retries during the original
  incident — only the newest was touched by the status correction above; the three older ones
  stay `status='complete'` untouched. `lab_results` has no void/superseded state and no delete
  path (append-only, §2.15) — they remain visible, undeduplicated, in Laborator's Tarix
  (history) view, which is the honest record of what actually happened. Deleting them was
  considered and rejected.
- The six opening-stock seed rows keep `is_sulfured = NULL` — genuinely unclassified, no
  production consequence (opening-stock rows don't flow through Laborator).

**Testing (production data, post-repair, live browser session against the real dev server +
this same Supabase project).** Logged in as the real Laborator role: all three serials
(`110826-001`/`002`/`003`) appeared in **2 · Sera natijasi kutilmoqda**, each showing its
already-recorded moisture and a bare "Oltingugurt (SO₂)" label with no target/talab text.
**Sera kiritish** accepted an SO₂ reading for each (45/48/42 ppm respectively) and saved —
Sera kutilmoqda dropped to 0, all three moved to **3 · Yakunlangan** showing the correct
moisture+SO₂ pair (KIRIM has no verdict by design, §5.5.2; "reaching a correct verdict" here
means landing correctly in Yakunlangan with both values recorded, which they did). Flag-driven
visibility confirmed on two real cases: `150826-001` (a genuinely new, real, `NULL`-flag
production row that arrived mid-session) showed the SO₂ field on Tahlil — NULL reads as
sulphured, as designed — and the form was cancelled without submitting, leaving this real row
untouched; a disposable `TEST-VERIFY-SULFUR-FLAG` fixture (owner "Boysun Quritilgan Mevalar",
serial `150826-002`, `is_sulfured=false` via Menejer's own Naturel/Sulfatlangan select) showed
no SO₂ field at all on Tahlil, confirming the explicit-`false` case. No "Talab" text appeared
anywhere across either Laborator tab's active-input forms or W2 cards. Zero console errors
across the entire session. Fixture fully removed after (`kirim_orders`/`kirim_lines`/
`gate_weighings`, no downstream rows had been created), reverified at zero rows. Downstream
surfaces confirmed unbroken on rows still carrying old target values: Hisobot's expanded row
and the full serial passport for `110826-001` both rendered cleanly, correctly showing "Talab
yo'q" / "Talab yo'q · naturel" for the still-NULL, no-longer-written `target_moisture_pct`/
`target_so2_mg_kg`, alongside the repaired lab reading (17%, 45 ppm). `npx tsc -b --noEmit` and
`npm run lint` both clean throughout. `wip_rows` recompiles clean against the new
`is_sulfured`-based `so2_pending` predicate. Direct query confirmed all three serials'
`kirim_lines.is_sulfured = true` and their latest `lab_results.status` correctly resolved
through the save; the three older `110826-001` duplicate rows remain `status='complete'`
untouched, as decided.

**Two latent e2e bugs found and fixed while rewriting the suite, before they could go stale:**
`lab-packing-hard-gate.spec.ts` and `lab-relocation-loss-verification.spec.ts` both seed a
"natural product, one-step verdict" fixture via a direct `kirim_lines` insert (bypassing
Menejer's form) that never set `is_sulfured`. Under the old inference this correctly read as
natural (blank target); under the new NULL-means-sulfured fail-safe it would have silently
flipped to sulphured, deferring the verdict to Sera kiritish and breaking both tests' downstream
assumption that the verdict buttons sit directly on the Tahlil form. Both fixed by adding
`is_sulfured: false` explicitly to the insert.

**Out of scope, not touched:** the numeric `target_moisture_pct`/`target_so2_mg_kg` columns
themselves (kept, still read by passport/client report/Hisobot), any change to who can see
those read-only displays, Rahbar dashboard, Ombor Tugallash, Rezka.
