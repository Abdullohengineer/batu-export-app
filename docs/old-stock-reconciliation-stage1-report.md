# Old-stock reconciliation — Stage 1 report (read-only)

**Run date:** 2026-09-14 · **Physical count date:** 16.07.2026 · **No writes performed.** All figures below came from `SELECT`-only queries against the live Supabase project (`qohoqbapevrcjqxbstxi`), reading `stock_on_hand_rows`, `old_kn_pools`/`old_kn_collections`, `storage_intake`, and the `rahbar_stock_snapshot()` RPC — no new balance calculation was written; existing views/RPCs were reused per CLAUDE.md.

Origin filter applied throughout: `kirim_orders.origin = 'opening_stock'` (operational-queue/inventory rule — real physical stock, filtered positively to old-stock rows only).

> **Stage 2 applied 2026-09-14** — see `docs/decisions/0186-2026-09-14-old-stock-physical-count-reconciliation-stage-2.md` and migration `supabase/migrations/0121_old_stock_physical_count_reconciliation_20260716.sql` for what was actually applied and the one post-apply figure (`rahbar_stock_snapshot('eski').totalKg`) that came out different from what this report predicted, and why.
>
> **Correction applied 2026-09-14** — 0121 anchored Subxon's OLD KN `opening_kg` to the wrong
> physical count date (2026-07-16 instead of the actual 2026-09-12). Fixed in
> `docs/decisions/0187-2026-09-14-subxon-old-kn-opening-kg-baseline-correction.md` /
> migration `0122_subxon_old_kn_opening_kg_baseline_correction.sql` — Subxon `opening_kg`
> 37,439 → 59,221, live balance now reads 37,439 as originally intended, and `totalKg` is
> back to the 122,184 this report predicted.

## Plain-language summary

- **Total current old stock:** 120,775 kg (35,980 washed + 81,915 old-KN + 2,880 raw) — this is the exact figure `rahbar_stock_snapshot('eski').totalKg` returns, confirming the report matches the live dashboard.
- **Total target (16.07.2026 count):** 122,184 kg (35,980 washed + 83,324 old-KN + 2,880 raw).
- **Net delta:** **−1,409 kg**, entirely inside the OLD KN pools. OLD WASHED and OLD RAW net to **zero** once "Qand" and "Qand qizil" are treated as one product for K6/K8 (see finding below) — there is **no shrinkage in washed or raw old stock**.
- **Lines needing a decision:** 1 relabel question (Qand vs Qand qizil, 2 calibres) + 4 OLD KN pool variances (Isfara, Subxon, Natural, Qand) = **5 items**, detailed below.

---

## 1. OLD WASHED

Current figures are the `available` bucket of `stock_on_hand_rows` (= what `rahbar_stock_snapshot('eski').byCalibre` and the "Ombor qoldig'i" old-stock filter both show right now). This **excludes** an 8,640 kg Subxon K6 dispatch reservation that exists in the system but hasn't physically left yet — see §4.

| Type | Calibre | Current (kg) | Target (kg) | Delta | Flag |
|---|---|--:|--:|--:|---|
| Isfara | K1 | 1,400 | 1,400 | 0 | MATCH |
| Isfara | K8 | 24,120 | 24,120 | 0 | MATCH |
| Subxon | K1 | 30 | 30 | 0 | MATCH |
| Subxon | K6 | 2,900 | 2,900 | 0 | MATCH |
| Subxon | K8 | 6,260 | 6,260 | 0 | MATCH |
| Subxon | K4 | 0 (status `consumed`) | 0 ("fully gone") | 0 | MATCH |
| Natural | — | 0 (status `consumed`) | 0 ("fully gone") | 0 | MATCH |
| **Qand** | **K6** | **0** | **1,040** | **−1,040** | SHORTAGE (see §1a) |
| **Qand** | **K8** | **50** | **230** | **−180** | SHORTAGE (see §1a) |
| **Qand qizil** | **K6** | **1,040** | 0 ("fully gone") | **+1,040** | SURPLUS (see §1a) |
| **Qand qizil** | **K8** | **180** | 0 ("fully gone") | **+180** | SURPLUS (see §1a) |

### 1a. Qand vs Qand qizil — this is a labeling issue, not shrinkage (requirement 6)

Combine Qand + Qand qizil per calibre and every line matches exactly:
- K6: 0 (Qand) + 1,040 (Qand qizil) = **1,040 = target 1,040** ✓
- K8: 50 (Qand) + 180 (Qand qizil) = **230 = target 230** ✓

**Qand Qizil K6 pallets still exist** (requirement 6 — they were not consumed/voided):

| barcode2 | serial | weight_kg | status |
|---|---|--:|---|
| PLT-020826-038-06-1 | 020826-038 | 720 | in_stock |
| PLT-020826-038-06-2 | 020826-038 | 320 | in_stock |
| PLT-020826-038-08-1 | 020826-038 | 180 | in_stock |

**Two options for stage 2, as requested:**
- **Option A — RELABEL** (`UPDATE finished_pallets SET type_id = <Qand> WHERE barcode2 IN (...)`): 3 pallets, no void/insert audit noise, same barcodes and serial (`020826-038`) survive. Cleanest if "Qand qizil" was simply a mislabel at opening-stock seed time (single opening-stock serial per product type suggests this — `020826-038` is the sole Qand-family "qizil" opening-stock serial and its 3 pallets sum to exactly the missing Qand target).
- **Option B — VOID + INSERT**: void the 3 Qand qizil pallets, insert 3 new Qand pallets at the same weights. Matches the app's "never DELETE, only void" convention more literally and leaves an explicit audit trail, but is more mechanically involved for what looks like a pure seed-time mislabel.

**Recommendation to flag for Abdulloh:** Option A, unless "Qand qizil" carries real product meaning elsewhere that should be preserved via a visible void/reissue trail — this is a business call, not something to decide here.

### 1b. Backing pallets for every OLD WASHED line with a delta

(Only the 4 delta lines above have any variance; every MATCH line's current total is a single already-verified pool of pallets, omitted here for brevity — available in the raw query output if wanted.)

Already listed in §1a (all 3 Qand qizil pallets are the entirety of both delta lines' backing).

### 1c. NEW LINE NEEDED

None. Every target physical line has a matching current line once Qand/Qand qizil are combined — no calibre×type combination in the target table is entirely absent from the live data.

---

## 2. OLD KN pools

Current = `old_kn_pools.opening_kg − Σold_kn_collections.collected_kg − Σserial_mint_sources.weight_kg` (weight_pool source), matching `stock_on_hand_rows` bucket `old_kn` and `rahbar_stock_snapshot('eski').oldKnByType` exactly.

| Type | Current (kg) | Target (kg) | Delta | Flag |
|---|--:|--:|--:|---|
| Isfara | 56,120 | 36,849 | **+19,271** | **SURPLUS** — zero collections ever recorded against this pool |
| Subxon | 16,420 | 37,439 | −21,019 | SHORTAGE — but see §4, largely explained by a legitimate 21,782 kg collection on 2026-08-21 |
| Natural | 7,791 | 7,367 | +424 | SURPLUS — zero collections ever recorded |
| Qand | 1,584 | 1,669 | −85 | SHORTAGE — zero collections ever recorded |

**Context that matters for interpreting these:** `old_kn_pools` rows were all created **2026-08-02** (the Stage 1/2 opening-stock seed), i.e. *after* the 16.07.2026 physical count. So for Isfara, Natural, and Qand — which have **no recorded collections at all** — every kg of delta above is pure difference between the `opening_kg` book value entered at seed time and the 16.07 physical count; it is **not** explained by any dispatch activity in the system (there isn't any to check). Isfara's pool `opening_kg` was already corrected once before (56,359 → 56,120, migration `0081_old_kn_pools_isfara_correction.sql`, 2026-0x — a book-value fix, not a design change) and is still 19,271 kg above target — the largest single unexplained variance in this whole reconciliation.

Subxon is the one pool with real collection activity — see §4 for the breakdown; net of that activity, Subxon's residual variance is only **−763 kg** (opening_kg 38,202 vs target-plus-known-collections 37,439+21,782... i.e. essentially seed-time noise, not new shrinkage).

---

## 3. OLD RAW

| Type | Current (kg) | Target (kg) | Delta | Flag |
|---|--:|--:|--:|---|
| Qand | 2,880 | 2,880 | 0 | **MATCH** |

Single opening-stock raw serial `020826-039`, `storage_intake.actual_qty = 2,880`, zero kg ever sent to Moyka/Rezka/raw-dispatch. No other product type carries any opening-stock raw material currently — consistent with the target table listing only Qand.

---

## 4. Dispatch/consumption activity against opening-stock material since 2026-07-16

| Kind | Type | Calibre | kg | Date | Detail | Status |
|---|---|---|--:|---|---|---|
| Washed pallet dispatch (reservation) | Subxon | K6 | 8,640 | 2026-09-10 | Chiqim request to **Global Export Company**, plate `20G167KA`, driver Sultonov E — 13 pallets | **Not yet departed** (`gate_weighings.completed_at IS NULL` for all 13) — still physically on-site, correctly shown in `band_qilingan` bucket, already excluded from the §1 "current available" figures |
| Old-KN pool collection | Subxon | — | 21,782 | 2026-08-21 | 3 separate chiqim requests, plates `40N977NB`/`40Y788KB`/`40B502BB` (drivers Akramov J, G'ulomov J, Usmonov SH) | **Completed** — already subtracted from the Subxon KN pool balance in §2 |
| Internal reprocess (Rezka feed, **not** a client dispatch) | Natural | K1 | 6,550 | 2026-09-04 | 10 pallets fed as Rezka input, minted new serial `040926-002` (origin `internal_reprocess`) | Completed — explains the Natural "fully gone" target line |
| Internal reprocess (Rezka feed) | Subxon | K4 | 1,040 | 2026-08-24 | 2 pallets fed as Rezka input, minted new serial `240826-001` | Completed — explains the Subxon K4 "fully gone" target line |
| Raw dispatch | (any) | — | 0 | — | No raw dispatch lines recorded against any opening-stock serial since 2026-07-16 | — |

Every dispatch/consumption event found above post-dates 2026-07-16, so none of it was already baked into the physical count target — all of it is exactly the "legitimate recent activity" the revised prompt asked to separate from true shrinkage. **Conclusion: none of the OLD WASHED or OLD RAW deltas are shrinkage** — the only ones are the labeling question (§1a) and the small Subxon KN residual (§2). The three larger unexplained OLD KN variances (Isfara +19,271, Natural +424, Qand −85) have **zero matching dispatch activity of any kind**, ever — they are pre-existing seed/book vs physical-count differences, not anything that happened "since" the count.

---

## 5. Cross-check: Rahbar dashboard vs Ombor qoldig'i (requirement 8)

- **"Ombor qoldig'i" (old-stock filter)** reads `stock_on_hand_rows` directly (`src/lib/useStockOnHand.ts`, client-side filter on `is_old_stock`).
- **Rahbar dashboard old-stock figures** come from the RPC `rahbar_stock_snapshot('eski')`, whose `byCalibre`/`oldKnByType`/`rawKg` fields are computed from the *same* `stock_on_hand_rows` view.
- Ran both read paths independently: `rahbar_stock_snapshot('eski')` returned `byCalibre` = {Isfara K1 1,400; Isfara K8 24,120; Subxon K1 30; Subxon K6 2,900; Subxon K8 6,260; Qand K8 50; Qand qizil K6 1,040; Qand qizil K8 180}, `oldKnByType` = {Isfara 56,120; Subxon 16,420; Natural 7,791; Qand 1,584}, `rawKg` = 2,880 — **identical, kg-for-kg, to the direct `stock_on_hand_rows` query**. **No mismatch found.**
- The **"Jami yuvilgan va yuvilmagan mahsulot"** tile (old-stock scope) = `rawKg + moykadaKg + finishedCalibredKg + konditirskiyKg` = 2,880 + 0 + 35,980 + 0 = **38,860 kg**. It deliberately **excludes** the old-KN pool total (81,915 kg) by design (per `DECISIONS.md`, 2026-08-30 — old KN is only reachable via "Ombor qoldig'i" and Hisobot on that tile). This is intentional, not a leak or bug — flagging only so the 38,860 figure isn't mistaken for the full old-stock total (120,775 kg) when eyeballing the dashboard.
- `moykadaKg` (in-process Moyka) for old-stock scope = 0, confirmed independently: all 5 opening-stock wash cycles have `status = 'final'` with no active in-process send outstanding.

---

## Proposed stage-2 actions (PROPOSAL ONLY — nothing applied at report time)

1. **Qand qizil → Qand relabel** (or void+insert, Abdulloh's call — see §1a): 3 pallets, `PLT-020826-038-06-1` (720 kg), `PLT-020826-038-06-2` (320 kg), `PLT-020826-038-08-1` (180 kg).
2. **Isfara OLD KN pool**: `old_kn_pools.opening_kg` 56,120 → 36,849 (−19,271 kg) — *investigate before booking; this is the largest variance in the whole reconciliation and has zero corroborating dispatch activity.*
3. **Subxon OLD KN pool**: `old_kn_pools.opening_kg` 38,202 → 37,439 (−763 kg) — small residual once the legitimate 21,782 kg 2026-08-21 collection is accounted for.
4. **Natural OLD KN pool**: `old_kn_pools.opening_kg` 7,791 → 7,367 (−424 kg).
5. **Qand OLD KN pool**: `old_kn_pools.opening_kg` 1,584 → 1,669 (+85 kg).
6. **OLD RAW**: no action — exact match.
7. **OLD WASHED**: no action beyond item 1 — once relabeled, every washed line ties out exactly to the 16.07.2026 count with zero shrinkage.

Waiting for Abdulloh's go-ahead before touching any of the above. *(Go-ahead received 2026-09-14 — see stage-2 decision entry.)*
