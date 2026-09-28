# Rezka Prompt 3: Menejer KIRIM per-line process and the CHIQIM Rezka tab

Rezka Prompt 3 of 4. Spec: `docs/SPEC.md` §2.1, §3.1, §5.R (v1.69). Builds on `0219`–`0224`.
The four pre-coding answers below were approved as proposed, with the toggle chosen over a
dropdown.

## 1. KIRIM: per-line process toggle, fixed at creation

**Placement.** Each KIRIM line row has a **Moyka | Rezka** two-button toggle (`aria-pressed`,
default Moyka) between the type select and the kg input.
- It is deliberately not a `<select>`. `full-chain.spec.ts` and `partiya-raqami.spec.ts` pick
  the type with `row.locator('select')`, which a second select in the row would make ambiguous.
- It copies the CHIQIM form's "Transport turi" segmented-button pattern.

**Write path.** `process` is one more field in the existing `kirim_lines` insert
(`KirimForm.tsx`); the column already defaults to `'moyka'`.

**No edit path, so fixed at creation.**
- Menejer has INSERT only on `kirim_lines` (the `menejer_writes` policy); there is no UPDATE
  policy.
- The only KIRIM correction, `KirimOrdersList` "Tahrirlash", edits the order's date, plate and
  driver before any gate weighing. It never touches lines.
- So the brief's "before intake Menejer may still change it via the existing line edit path, if
  one exists" does not apply: none exists. Process is immutable from creation, the same as
  `type_id` in practice.

**Serial link on the save panel.** Rows are matched to returned serials on `type_id` +
`process`, not `type_id` alone. Subxon-Moyka and Subxon-Rezka on one truck are now a realistic
pair, and before this they would both have shown the same serial.

**Badges.** `RezkaBadge` "Rezka · Tashqi" appears on:
- the KIRIM save panel;
- the Menejer KIRIM list, in the collapsed header and on each expanded line, plus a read-only
  "Jarayon: Moyka/Rezka" on every line;
- the Qorovul gate card, per truck, when any line is Rezka;
- Ombor intake Window 1, which is new. Window 2 now reads `line.process` too, replacing
  Prompt 2's set built from `useMoykaSerials`.

**Hook changes.**
- `useKirimTrips`, `useIntakeLines` and `useIntakeHistory` now select `process`. The history
  hook shares `IntakeLine`, so it was changed alongside its live twin.
- The history screens themselves are not badged; that was not in scope.

## 2. CHIQIM Rezka tab: the split lives in the tab, not the hook

**What the tab stores.** The fourth row tab, **Rezka**, stores an ordinary `line_kind='finished'`
line on the `is_rezka_output` calibre. `LineRow.rezka` is a UI-only flag that decides only which
calibres the row offers. The calibre list is narrowed to the type's category and preselected from
the type (one Standard per category).

**Why the split is in the tab.**
- `finished_calibre_availability` is already grouped by `(type_id, calibre_id, is_old_stock)`,
  and `availableKg(row)` already matches the exact calibre. Offering the right calibre is
  therefore the entire split.
- Splitting in the hook would have needed the view joined to `calibres`, because the view has
  no `is_rezka_output` column. That would be a new query shape.
- The hook's other consumer, Ombor, needs no split.

**`useFinishedCalibreAvailability` moved onto React Query** (`docs/decisions/0223` follow-up).
- The query and columns are unchanged.
- It is now deduped across `ChiqimForm` and `OmborChiqimTab`, throws on error, and is refreshed
  by `invalidateReportData()` after every CHIQIM write.
- `useAvailableFinishedStock.ts` left the rpc-wrapper allowlist (42 → 41 entries).

**Badge provenance.** A Rezka CHIQIM line has no single provenance, because FIFO may fill it
from Tashqi or Ichki output. `RezkaBadge`'s `provenance` is now optional and renders a plain
"Rezka" without it. That badge appears on:
- Ombor's CHIQIM card: the finished-line header and the collapsed line summary;
- `ChiqimRequestDetail` (Menejer's list and the CHIQIM passport). It resolves
  `is_rezka_output` through the shared `useCalibres` cache, so there is no new read and no new
  prop threading.

**Xom tab.** Tashqi Rezka raw serials stay eligible and are badged "Rezka · Tashqi".

## 3. Kalibrlangan exclusion

The Kalibrlangan calibre select was `calibres.map(...)` with **no filter at all**. The brief
assumed a category-only filter. As a result, "Standard" and every other category's calibres
showed for every type.

It now uses `calibres.filter(c => !c.is_rezka_output)`, applied to both Kalibrlangan and Eski
zaxira "Yuvilgan" (Rezka output is never old stock). Konditerka stays.

Kalibrlangan has no separate availability list, only "Mavjud: X kg" for the chosen type and
calibre. Hiding Standard from the select therefore removes it from the tab.

## 4. No SQL (R6)

Live definitions were read on 2026-09-28.

| Object | Relevant logic | Konditerka/Standard cross-fulfilment? |
|---|---|---|
| `attribute_chiqim_line_fifo` | `where fp.type_id = v_type_id and fp.calibre_id = v_calibre_id and fp.is_old_stock = v_is_old and fp.status = 'in_stock' and (lr.verdict = 'o_tdi' or exists (rezka_cycles …))` | No: exact calibre match, and KN and RKN are different ids |
| `finished_calibre_availability` | `sum(available_kg) … group by type_id, calibre_id, is_old_stock` over `finished_pallet_availability` | No |
| `finished_pallet_availability` | Nets out consumption and Rezka draws; admits `rezka_cycles` pallets | No |
| The 0142 overdraw trigger | Guards each pallet's weight | No calibre logic at all |

## Found while reading, flagged not fixed

- **FIFO and availability are not owner-scoped.**
  - `attribute_chiqim_line_fifo` and `finished_calibre_availability` match on type + calibre
    only.
  - So Menejer's "Mavjud" counts every client's pallets of that type and calibre, and Ombor's
    finalize can consume another client's pallets (SPEC §2.10: "Egasi = the client who owns the
    goods").
  - This predates Rezka and is documented nowhere.
  - It shaped the e2e spec: test 3 never finalizes its Kalibr 6 request, and test 2 aborts if
    any Standard stock other than its own is available.
- **Kalibrlangan does not filter calibres by the type's category.** Deferred at the product
  owner's instruction.
- **Two lines of the same type and the same process on one truck still collide** in the
  save-panel serial link. Deferred at the product owner's instruction.
- **`check-rpc-wrapper` misses call chains split across lines** (`supabase\n  .from(`).
  `KirimForm.tsx` has two such calls and is not on the allowlist. Deferred at the product
  owner's instruction.
- **KIRIM raw has no void path.** An e2e run that fails between intake and dispatch can leave
  `TEST-` raw in Ombor's pickers and badges.

## Verification

**Local checks**
- `tsc -b` clean.
- `oxlint`: only the 2 warnings that were already there.
- `node --test`: 81/81 pass.
- `lint:rpc-wrapper` OK (41).
- `vite build` OK.

**No migration.** None was needed, so none was applied.

**`tests/e2e/rezka-menejer.spec.ts`** is written for the product owner to run locally. It could
not run in the cloud container: there is no `.env.test`, and the proxy blocks browser→Supabase.

It has three serial tests on the "TEST Rezka E2E" owner with `TEST-` plates:

| Test | What it does |
|---|---|
| 1 | KIRIM Moyka 10 kg + Rezka 30 kg on one truck → gate → intake with tara 1 kg → gate. Checks badges, each serial in only its own queues, Laborator Naturel test, Xom badge. |
| 2 | Send 30 kg to Rezka and receive 30 kg Standard (auto-close). The Menejer Rezka tab shows "Mavjud: 30 kg", and Kalibrlangan offers no Standard. One truck carries the Rezka line + a Xom line (the Moyka serial's 10 kg). Ombor finalize, then gate → `olib_ketildi`. Standard availability 30 → 0. |
| 3 | A Kalibr 6 request is created unchanged, then voided (see the owner-scoping finding above). |

It is designed to end with no live remainder, and cleanup only voids.
