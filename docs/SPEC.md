# BATU EXPORT — Ombor & Logistika App
## Master Design Specification

**Version:** 1.18
**Date:** 21 July 2026
**Status:** Manager — LOCKED · Client report — LOCKED · Qorovul — LOCKED · Storage Manager §1–§5 — LOCKED · Laborator — LOCKED (redesigned v1.9; §5.5.5 re-wash re-entry quantity basis OPEN) · Rahbar (business owner) — DESIGNED · Weight authority (§2.16) — LOCKED (v1.10 prompt 1) · Hisobot query engine + results view (§3.2.1-3.2.4) — LOCKED, **desktop table, server-side query** (v1.16) · Serial passport (§3.2.5) — LOCKED (v1.17) · **Stock on hand (§3.2.6) and WIP/stuck (§3.2.9) — LOCKED, applied** (v1.18) · §3.2.7 client report, §3.2.8 yield, §3.2.10 Rahbar aggregates — reserved section numbers, not yet built; written into this document directly as each is built, no separate companion doc

---

### How to use this document
Single source of truth. Keep it in the Claude **Project knowledge base**. Any new chat or Claude Code can read it and continue regardless of chat length. When a decision changes, edit the section and add a Changelog line.

**Status legend:** 🔒 LOCKED · 🟡 DESIGNED (mockup exists) · ⬜ PENDING · ❓ OPEN

---

## 1. System Overview
**Company:** BATU EXPORT — dried-apricot **toll processing** & export (Uzbekistan). Client owns the goods; BATU provides washing/processing/packaging. Apricot-first; other lines (raisins/*mayiz*, prunes) added later via settings, **no code change** (§2.3).
**Platform:** 🔒 PWA, **offline-first** (§2.6).

### 1.1 Roles
| Role | Uzbek | Owns |
|---|---|---|
| Manager | Menejer | KIRIM orders & CHIQIM requests; **Hisobot** reporting (§3.2); **Kuzatuv** traceability; client reports; product settings |
| Gate guard | Qorovul | Two-stage truck weighing on arrival & departure |
| Storage manager | Ombor menejeri | 4 sections: raw intake → send to wash → finished intake → dispatch |
| Business owner | **Rahbar** | 🔒 Oversight / Exceptions / Reports / Administration (§6). **Read-only on all operations**, write rights on admin. Multiple Rahbar accounts supported. See §2.10 naming |
| Lab | Laborator | 🔒 Own window (§5.5): KIRIM **descriptive** check on intake; CHIQIM **decisive** check on Moyka output. Verdict gates dispatch and flags material for Ombor to re-wash. Sample one pallet → applies to whole parent serial |

### 1.2 Lifecycle of one serial
```
MANAGER KIRIM order → serial DDMMYY-NNN (Kutilmoqda)
  → QOROVUL stage-1 (Гружёный, loaded) → Kirdi·bo'shatilmoqda
  → QOROVUL stage-2 (Пустой, empty)     → Yakunlandi
  → STORAGE §1 confirm + namligi + Barcode #1 → Skladda turibdi
  → STORAGE §2 send to Moyka (partial allowed) → Moykaga yuborilgan
  → STORAGE §3 finished receipt per PALLET + Barcode #2 → Tayyor (per type+calibre incl. Konditirskiy)
  → MANAGER CHIQIM request (no serial) → QOROVUL stage-1 (Пустой, empty)
  → STORAGE §4 scan Barcode #2 pallets → manifest → loaded
  → QOROVUL stage-2 (Гружёный + photos + doc photo) → Olib ketildi / Yakunlandi
```
🔒 One truck-trip may run several of these lifecycles in parallel — one per type, one per serial (§2.1). The gate stages are shared (one weighing per truck); everything from STORAGE §1 onward is per-serial.

---

## 2. Global decisions 🔒

### 2.1 Serial format 🔒
`DDMMYY-NNN` (e.g. `120826-003`). Resets daily. 🔒 **One serial per product type, not per truck.** A KIRIM order is a *delivery envelope* (one truck, one trip); each **type line** on it is minted its own serial by `next_serial()` on manager submit. A truck carrying Subxon + Isfara produces two serials; a single-type truck is simply the N=1 case. Consequence: **a serial is always single-type** — which is what makes Barcode #1 per type-pile (§5.1), single-sample lab results (§5.5), and per-type storage stock (§8) correct rather than approximate. Shown, never typed.

### 2.2 Barcodes 🔒 (updated)
| | #1 (raw serial) | #2 (physical pallet) |
|---|---|---|
| Printed when | Storage §1 confirms raw load | Storage §3 saves a finished receipt — **one sticker per physical pallet** |
| Encodes | serial + turi + egasi + sana | sticker ID + parent seriya + **turi** + kalibr + og'irlik + egasi |
| ID format | — | ~~`PLT-<serial>-<calibre>`~~ → **`PLT-<serial>-<calibre>-<seq>`** (Konditirskiy → `…-KN-<seq>`). *Updated 2026-07-15 (Step 6): the original format collides when a serial yields multiple pallets of the same calibre — which "one sticker per physical pallet" + atomic pallets require — since `barcode2` is the PK. `<seq>` is a per-(serial,calibre) 1-based counter. See DECISIONS.md.* |
| Notes | 🔒 one #1 per serial. Since a serial is single-type (§2.1), this is inherently one per type-pile. | **Barcode #2** carries type for scan-time confirmation and dispatch matching; the parent serial already determines the type (§2.1). 🔒 **A pallet is atomic — never split.** It is loaded whole or not at all (§5.4) |

### 2.3 Product master data 🔒
`MAHSULOT_TURLARI`: category (O'rik / Mayiz / Prune…) + type name + calibre-applies? + **calibre set**. Every dropdown reads from it; owner edits in-app.
- Active: **O'rik** — *Subxon, Isfara, Qand, Qand qizil, Natural*.
- Apricot calibre set: `Kalibr 4, 6, 8, …` **+ Konditirskiy** (numberless calibre; displays exactly `Konditirskiy`/`Kn`; bakery-only; counts in finished totals; `KN` in Barcode #2).

### 2.4 Owners master data 🔒
`OWNERS` (buyurtmachi / egasi). 🔒 **Buyurtmachi is ALWAYS a dropdown from OWNERS — never free text**, anywhere in the app. Free text causes name drift that silently fragments per-client filters, the Mijoz bo'yicha lens and the client report.

### 2.5 Notes — append-only 🔒
Button **"Qaydlar qo'shish"** (never edit); stack with author + timestamp; on every ⋯ detail.

### 2.6 Offline (PWA) 🔒
Local copy; view/submit offline; queued with **"sinxron kutilmoqda"**; auto-upload on reconnect; conflicts flagged, never silent-overwrite.

### 2.7 Audit log 🔒
All status changes + notes logged (who/when/what).

### 2.8 Language — global Uz/Ru toggle 🔒
Per-user switch **O'zbekcha / Русский** (also at report generation). Only labels swap; data & proper names (serials, Subxon/Isfara/Qand, owners) unchanged. Applies to all screens + reports. In the app manual.

### 2.9 Image handling — compress before upload 🔒
All photos (gate plate + **both weight-reading photos**, storage pile, manager doc) **compressed client-side** (longest edge ~1600px, JPEG ~0.7, target <~300 KB); UI shows original→compressed size. For bandwidth + offline queue size.

### 2.10 Naming — Rahbar vs Egasi 🔒
- **Rahbar** = the business owner/director (BATU side). Multiple Rahbar accounts supported; **no personal names hardcoded anywhere**.
- **Egasi / Buyurtmachi** = the *client* who owns the goods (toll processing). Never use "Egasi" for the business owner.

### 2.11 Filtered totals — global rule 🔒 (NEW)
**Every filtered list in the app shows a summary bar at the bottom that reflects the current filter**, not the whole dataset:
- Row count + relevant totals (kg by direction; where meaningful: by tur/kalibr, and yield-loss %).
- Change the filter → totals recompute live.
- **Excel export includes the same totals row.**
Applies to: manager's Tarix, all three Kuzatuv lenses, and every Rahbar list. *(Gap found in v1.5 — Tarix had filters and export but no totals.)*

### 2.12 Read-only enforcement 🔒 (NEW)
Roles have explicit write scopes. **Rahbar is read-only on ALL operational records** (orders, weighings, receipts, dispatches, lab results) and may open **any other role's screens read-only**. Write rights only in Administration (§6.4).
Rationale: if the owner can edit an operational record, the audit trail loses meaning. Corrections happen via **append-only notes** (§2.5) or by the responsible role redoing the action — never by silent owner edits. Enforce server-side, not just by hiding buttons.

### 2.13 Re-wash loop (Qayta yuvish) 🔒 (NEW — rare but supported; AMENDED v1.9 — see §5.5.4)
A serial whose lab result is **out of spec** (e.g. SO₂ too high) can be sent back through Moyka.
- 🔒 **Trigger (v1.9): a `Qayta yuvish` lab verdict** (§5.5.3) is now the primary route — the lab flags a batch on its CHIQIM check the moment Moyka produces it, not at dispatch time. Ombor's three-dot **"Moykaga qayta yuborish"** on the serial remains available as a manual path (e.g. a floor-level judgement call outside the lab's own flow) but is no longer the primary trigger.
- 🔒 **The void is Ombor's action, not the lab's** (§5.5.4). The lab's verdict changes no stored state — it only flags. Ombor performs the actual void + re-send, the same explicit, confirmed, human-clicked action described below, regardless of which of the two triggers above started it.
- **Scope: the WHOLE serial.** All of that serial's finished pallets return to Moyka — **except Konditirskiy, which stays in storage.**
- 🔒 **VOID, never delete.** The first wash's finished receipts, their Barcode #2s and its recorded yield-loss are marked **`bekor qilindi` (voided)**: they stop counting toward every live total (finished qty → 0, old loss cleared, barcodes dead). Operationally a clean slate — but the record survives in the audit log, and the **serial passport shows `1-yuvish (bekor qilindi) → 2-yuvish`**.
- 🔒 **Voided barcodes must fail loudly if scanned** (e.g. at dispatch): *"bekor qilindi — qayta yuvilgan"*. A stale sticker is still physically on the pallet, so a silent "unknown code" is not acceptable.
- **Return path:** the voided weight flows back into `Moykaga yuborilgan`; the serial re-enters the **existing §5.2 → §5.3 flow** unchanged. No new maths.
- **Second output:** new receipts, **new system-generated Barcode #2s**, printed fresh.
- 🔒 **Konditirskiy is additive:** any new KN from the second wash is **added to the existing KN quantity**; its new barcode is **stuck next to the old KN barcode** (both remain valid on that pallet).
- 🔒 **Yield-loss is recalculated at the second `Tugallash` and is FINAL** — whether higher or lower than the first.
- Client-visible in the passport/report (the re-wash explains any yield change).

### 2.14 Configurable thresholds 🔒 (NEW; extended v1.18 — §3.2.9 WIP view)
Exception rules are **settings, not hardcoded** — editable in Administration (§6.4):
- **Sera kechikdi** — sulfur result overdue after *N* days (default 2).
- **Moykada turib qoldi** — serial idle in Moyka longer than *N* days (default 7).
- **G'ayrioddiy yo'qotish** — yield-loss above *X* % (default 22).
- **Xom ashyo kutilmoqda** *(v1.18)* — raw received, not yet sent to Moyka, longer than *N* days (default 3).
- **Tahlil kechikdi** *(v1.18 — resolves §7 open question 9)* — a finished batch awaiting its CHIQIM lab check longer than *N* days (default 2). Untested stock cannot ship (§5.5.3 hard gate), so this is the highest-value row on the WIP view.
- **Jo'natish kechikdi** *(v1.18)* — a CHIQIM request neither fully loaded (Ombor) nor departed (Qorovul gate stage 2) longer than *N* days (default 2).

### 2.15 Technical architecture 🔒 (NEW)
**Stack:** React + Vite + TS + Tailwind (PWA) · **Netlify** (frontend, auto-deploy from GitHub) · **Supabase** (Postgres + Auth + RLS + Storage) · Dexie/IndexedDB (offline queue).

🔒 **The database is the source of truth, not the app.** Rules that must never break live in Postgres, not React — because there will eventually be multiple clients (phone, desktop, future finance module) and a rule in React can be bypassed by any of them.

🔒 **Serial generation happens in the DATABASE** (§2.1). A Postgres function (`next_serial()`) mints `DDMMYY-NNN` atomically, using the **Asia/Tashkent** timezone for the daily reset. JavaScript generation is forbidden — two phones would collide.
- *Consequence:* an **offline-created** KIRIM order receives **its serials** (one per type line, §2.1) **on sync**, not at submit. UI shows `seriya: kutilmoqda` until then.

🔒 **RLS (Row Level Security) enforces §2.12, from day one.** Enabled on **every** table. Hiding buttons in the UI is not security — the database must refuse the write.
- `rahbar` → SELECT everything; INSERT/UPDATE **only** on admin tables (owners, products, calibres, users, limits). No operational write policy exists for rahbar — that absence *is* the enforcement.
- `menejer` → writes orders/requests · `qorovul` → writes weighings · `ombor` → writes storage/pallets/dispatch · `laborator` → writes lab results.
- `notes` → **INSERT only; no UPDATE/DELETE policy for anyone** — this is what makes append-only (§2.5) real rather than a convention.
- `audit_log` → INSERT only.

🔒 **Store events, derive numbers.** Never store a running balance as a mutable number (inventory drifts and starts lying). Store the *events* (received / sent to Moyka / finished / dispatched) and derive balances via **views**. Every screen (Kuzatuv, passport, client report, Rahbar oversight) reads the same view, so they can never disagree.
- *This is also what makes a future **finance module** cheap:* money attaches to events already recorded — a price table + a view produces invoices with **zero changes to inventory tables**.

🔒 **Never DELETE — void.** Status flags everywhere (see §2.13). The audit trail is the defence in a client dispute.

🔒 **Derived columns:** net weight (`gruzheny − pustoy`) is a **generated column**, so a wrong net can never be typed.

---

## 2.16 WEIGHT AUTHORITY & EFFECTIVE QUANTITY 🔒 (NEW, v1.10)

*Renumbered from the source revision's "§2.15" — SPEC.md already has an unrelated §2.15 ("Technical architecture," above). See DECISIONS.md for the renumbering note (the source revision's own companion doc was never actually created in this repo — every section it would have held is now written directly into this document as each is built, per v1.18).*

Three weights exist for the same material. **All three are permanently retained; none overwrites another.**

| Weight | Source | Meaning |
|---|---|---|
| **Declared** | Menejer, at order entry (`kirim_lines.declared_qty`) | What the client said they sent. Never modified by anyone, ever (existing rule, unchanged). |
| **Intake** | Ombor, at receipt (`storage_intake.actual_qty`) | Ombor's own figure. **Pre-filled with the declared quantity and usually accepted untouched** — on single-product trucks Ombor performs no independent measurement. Treat as a per-line split, **not** as a measurement. |
| **Gate net** | Qorovul, `gate_weighings` (loaded − empty) | 🔒 **The accounting truth.** This is the only figure produced by a calibrated scale and evidenced by two mandatory photos. |

### 2.16.1 Effective quantity — the derived figure everything reads

🔒 **`effective_qty` is derived, never stored**, computed per `kirim_line`:

- **Single-line truck (the norm):** `effective_qty = gate net`. The gate weighed exactly this material and nothing else.
- **Multi-line truck (rare):** `effective_qty = storage_intake.actual_qty` per line, because the gate produces one figure for the whole truck and cannot split it. Gate net remains the truck total; the sum of the lines is reconciled against it and any gap is shown as a **soft variance** (never blocks, per §3.1 philosophy). 🔒 **A multi-line truck's `effective_qty` never becomes gate net, even after gate stage 2 completes** — only whether it is *provisional* flips; the number itself stays the per-line intake figure permanently (see DECISIONS.md — this ordering, not stated explicitly in the source revision, was confirmed with the user before implementation).
- **Before gate stage 2 exists:** `effective_qty = storage_intake.actual_qty`, displayed as **provisional** (see §2.16.2).

🔒 **Every downstream calculation reads `effective_qty`, not intake or declared** — raw available to send to Moyka, process loss, yield %, client balances, all reports. One derived truth, all consumers — the same principle as availability (§5.5.3). Implemented as `src/lib/weightAuthority.ts` (pure rule) + `src/lib/effectiveQty.ts` (I/O layer), mirroring the `rewash.ts`/`activeCycles.ts` split (Step 8).

### 2.16.2 Sequencing: gate net arrives *after* intake 🔒

The KIRIM order of events is: gate weighs loaded → **Ombor receives, records intake, Barcode #1 issued** → truck unloads and departs → **gate weighs empty → net known**.

So the authoritative weight is established **after** Ombor and Menejer have already seen a quantity on screen. Therefore:

- Between intake and gate stage 2, the quantity displayed on Ombor's and Menejer's screens is **provisional**, visually marked (*"tarozi kutilmoqda"*).
- 🔒 **When gate stage 2 completes, a single-line serial's effective quantity updates automatically on both screens** to the gate net figure. This is a derived recomputation, not a stored write — it changes no records, so it does not violate the no-silent-auto-transition invariant (§2.2). Nothing is accepted, finalized, or advanced; a displayed number simply becomes final. (A multi-line serial's *value* never changes this way — see §2.16.1 — only its provisional flag does.)
- Where the gate net differs materially from the declared quantity, both are shown with the variance — Menejer needs to see when a client's declaration was wrong, and that is a commercial conversation. 🔒 Variance is always **gate-vs-declared**, never intake-vs-declared (§5.1 amend) — intake is a pre-filled split, not a measurement, so comparing it to declared would read ~0% almost everywhere and measure nothing.
- **Lab checks are unaffected.** Laborator's KIRIM queue is keyed to intake existing, and quality is independent of quantity — a serial may be tested while its weight is still provisional.

⚠️ **Edge case, implemented:** if material is sent to Moyka before gate stage 2 completes, the sent quantity was measured against a provisional figure. Flagged, never blocked — the serial shows a variance note if the gate net later lands materially different, using the existing `kam_chiqdi_pct` threshold (§5.1) as the materiality bar rather than a new one (no threshold/notification config was built this prompt — deliberately deferred, see §7).

---

## 3. Role: MANAGER (Menejer) 🔒

### 3.1 Operational window — TABBED 🔒
Segmented **`KIRIM | CHIQIM`** tabs switch the screen. Each = create button + live status list.
- **KIRIM form:** Sana · Moshina raqami · Haydovchi ismi · Buyurtmachi (OWNERS) · **repeatable Tur + Miqdori rows** (multi-product; one truck, several types; "+ Tur qo'shish"; **Jami avto**; **no calibre** — raw isn't graded yet) · 🔒 **auto Seriya per type row** (`next_serial()` called once per line; N types → N serials, all displayed back on save; each type-pile → own Barcode #1) · Hujjat rasmi (compressed). Status **Kutilmoqda → Qabul qilindi** (🔒 flips at gate **Yakunlandi**, i.e. when net weight is known — not at stage-1 arrival).
  - 🔒 **Declared vs actual.** The quantities on this form are the manager's **declared** figures (what the client says is coming). They are never overwritten. The **actual** per-type weight is entered later by the Storage Manager (§5.1). The gap between declared and actual is what "Kam chiqdi" means.
  - 🔒 **Quantity displayed against a serial elsewhere (KIRIM order list, AMENDED v1.10) is `effective_qty` (§2.16.1)**, marked **provisional** until gate stage 2 completes, then final. Declared quantity stays visible and permanently unmodified beside it — this is an additional figure, not a replacement for declared.
  - 🔒 **Client quality targets, per line (NEW, v1.9).** Each Tur + Miqdori row also carries two optional fields: **Talab: Namligi %** (the client's target moisture) and **Talab: SO₂ mg/kg** (leave blank for a natural/unsulfured product). Targets live on `KIRIM_LINES`, not `KIRIM_ORDERS` — one truck may carry two products with different requirements — and flow down the lineage to every pallet produced from that serial. Entered once at intake, never re-entered at dispatch. 🔒 **A blank SO₂ target is a meaningful value, not a missing one** — it is what tells the Laborator there is no sulfur to measure (§5.5.1) and what makes the client report print "Yo'q · naturel"; it must never be treated as an incomplete form. *Rationale: the client states what they want back at the moment they hand over the goods — no one re-keys it days later at test time.*
- **CHIQIM form:** Sana · Moshina · Haydovchi · Buyurtmachi · **repeatable Tur + Kalibr + Miqdori rows** (calibre set incl. Konditirskiy) · Jami avto. **No serial, no doc photo.** Status **Kutilmoqda → Olib ketildi**.
  - 🔒 **Whole-pallet soft warning:** since pallets are atomic (§5.4), the form checks each requested quantity against available whole pallets. If it doesn't map cleanly, it **soft-warns and suggests the nearest workable figures** so the manager confirms the exact number with the client **before the truck is sent**. **Never blocks** — the manager can save anyway and handle it. This is where dispatch discipline is enforced, keeping partial loads off the floor.

### 3.2 HISOBOT (Reporting) 🔒 — query engine + results view APPLIED (v1.14 / Step 10 prompt 1)

*Supersedes this document's own prior §3.2 "Tarix" text (chronological event log, sub-tabbed by direction) — that functionality is now this section, built out as the unified engine the v1.10 revision called for. §3.4 Kuzatuv and §3.5 Client report, further down this document, are **NOT yet superseded** — they still describe not-yet-built functionality (the full client balance report) and stay as the only spec reference for it until the saved view that absorbs them (§3.2.7 client report) is actually built. Until then, §2.11's and §6.3's own mentions of "Tarix"/"Kuzatuv" as Rahbar's reporting toolkit are still accurate in spirit (same underlying screen) even though this section's own name changed. Each saved view is written directly into this section as it's built (§3.2.5 passport, §3.2.6 stock-on-hand, §3.2.9 WIP — all now below); §3.2.7 client report, §3.2.8 yield, §3.2.10 Rahbar aggregates remain reserved numbers with no body yet.*

🔒 **One shared query engine, results table, totals strip, and filter bar — the foundation every later saved view is built on, not a screen in its own right.** Available to **Menejer and Rahbar** (`/menejer/hisobot` and `/rahbar/hisobotlar` — identical component, no write actions on either side, so Rahbar's read-only rule §2.12 needs no special-casing here).

#### 3.2.1 The underlying identity everything reports against 🔒

```
RAW RECEIVED = CALIBRE OUTPUT + KONDITIRSKIY + PROCESS LOSS + STILL IN STORAGE
```

Every view is a slice of this. If a report does not reconcile to it, the report is wrong. All quantities use `effective_qty` (§2.16.1) — never `actual_qty`/`declared_qty` directly. A CHIQIM row's own quantity is a pallet's measured `weight_kg` (never derived, always atomic — §5.4), which is why it never needed a weight-authority derivation of its own.

#### 3.2.2 Filter bar — dimensions, all combinable 🔒

Direction (KIRIM / CHIQIM / both) · date range + presets · buyurtmachi · mahsulot turi · kalibr · seriya (Barcode #1) · **Barcode #2** · truck plate · driver · wash cycle (1 / 2+ / any) · lab verdict (o'tdi / qayta yuvish / tekshirilmagan) · status (omborda / band qilingan / jo'natilgan / bekor qilingan).

🔒 **Row granularity, decided during this prompt's build (not stated literally in the source revision):** a KIRIM row is one `kirim_lines` entry (one Barcode #1/serial) — "an arrival line." A CHIQIM row is one `finished_pallets` entry (one Barcode #2), **not** a whole CHIQIM request — because Barcode #2, wash cycle, and kalibr are each independent filter dimensions above and only make sense at pallet granularity; a request-level row would leave those ambiguous. Status is a pallet-lifecycle state, derived (`finished_pallets.status='dispatched'` is dead code — nothing in this app ever writes it, confirmed via `useAvailableFinishedStock.ts` — "jo'natilgan" really means claimed in `dispatch_manifest` **and** that dispatch's gate stage 2 is complete).

🔒 **A voided Barcode #2 must remain findable.** Searching a dead sticker returns its record with an explicit result: *"bekor qilindi — qayta yuvilgan, sikl N, yangi barkod: X"* (or, when the re-wash's next cycle hasn't produced output yet, a plain "hali yangi barkod chiqarilmagan" note — the successor cycle is always `voided cycle + 1`, never ambiguous about which later cycle to check, since only a serial's currently-active cycle can ever be voided). Never "not found" — staff scanning a real sticker and getting silence will stop trusting the system.

#### 3.2.3 The date-filter rule 🔒

🔒 **The date filter always filters on the event matching the selected direction — never on wash date, never on lab date:**

- **KIRIM selected** → arrival date — gate stage 1 completion (`gate_weighings.stage1_completed_at`), falling back to the order's own stated date (`kirim_orders.order_date`) only for the (in practice unreached, since intake requires stage 1 first, §5.1) case where stage 1 hasn't happened yet
- **CHIQIM selected** → dispatch date — gate stage 2 completion (`gate_weighings.completed_at`, `dir='chiqim'`)
- **Both selected** → each row filters on its own governing event

The active date basis is **printed on screen and on every export** (*"sana asosi: kelish"* / *"jo'natish"*). Two people producing two different numbers from the same screen is how a reporting layer loses credibility, and an unlabelled date basis is the usual cause.

🔒 **A CHIQIM/pallet row with no governing dispatch event yet (status omborda / band qilingan) has no date to range-filter on.** Left out of the default (date-ranged) view — the default stays a clean history of things that actually happened — but reachable by explicitly selecting that exact status, which overrides the date filter for rows of that status only. This was deliberate plumbing for the stock-on-hand saved view (§3.2.6) — now built, confirmed the same shape: `stock_on_hand_rows` derives its `available`/`band_qilingan`/`awaiting_lab`/`qayta_yuvish` buckets from the identical claimed/verdict logic, just without a date filter at all (stock-on-hand is a snapshot of *now*, not an event history).

#### 3.2.4 Results table + totals strip 🔒

Rows are events (an arrival line, or a dispatched pallet). Newest-first (universal sort, §5 intro), each row on its own governing date (§3.2.3).

🔒 **Filtered-totals strip** (kg in / kg out / net) recalculates against the active filter, **sticky while scrolling** (§2.11). Applies to every view.

Each row expands to its own extra fields (not the full serial passport — see §3.2.5 for that deeper drill-down, one level further in). Row expand reuses the same interaction (a toggle reveals a detail panel) `OmborChiqimTab`/`OmborHisobotlar` established — no new interaction pattern — just triggered from a table row now (see below), not a card header.

~~🔒 Phone-density decision, applies to every later view built on this engine: prioritised fields in a card + expand, not a literal table or horizontal scroll... A phone-width card shows date/plate/driver + owner on one line and type/quantity/flags on a second; the remaining fields sit behind the expand toggle.~~ **SUPERSEDED (v1.15) — wrong read for this surface, corrected same day.** Hisobot is used by **Menejer and Rahbar on PCs** — phones are Ombor/Qorovul/Laborator's surface, not this one. §3.2.4 now uses a real **`<table>`** (the first in this codebase — deliberate, not a violation of the card pattern every *operational* screen keeps): all primary columns (yo'nalish, sana, seriya/Barcode #2, buyurtmachi, tur, kalibr, miqdor kg, moshina, haydovchi, holat) visible at once, numeric quantity right-aligned and comparable down the column, many rows scannable together. Row expand still reveals this row's own extra fields via the same detail components, now triggered from a per-row expand button/click instead of a card header. The filter bar (§3.2.2) is **expanded by default** on this surface (collapsing had no purpose on a wide screen) — the toggle itself stays, for a narrower window. The table wrapper scrolls horizontally on a narrow viewport (`overflow-x-auto` + a fixed minimum table width) rather than shrinking columns or wrapping cell contents — readable if reached from a phone, but never at the cost of the desktop layout. This is now the layout every later saved view built on this engine inherits.

Excel export on every view, respecting the active filter, with the date basis and weight basis printed in the header. Built with `exceljs`, not the more commonly reached-for `xlsx`/SheetJS package — the npm-published `xlsx` build carries an unpatched high-severity prototype-pollution/ReDoS advisory (patched builds are CDN-only, not on the npm registry); `exceljs` avoids shipping the flagged package (see DECISIONS.md "Reporting query engine").

**Implemented as:** `src/lib/reportQuery.ts` (row shapes + the one remaining pure function, `mapDbRowToReportRow`) + `src/lib/useReportQuery.ts` (thin RPC client — pagination state, chunked export) + `src/lib/reportExport.ts`. **Filtering, pagination, and totals moved server-side (v1.16)** — Postgres views `report_kirim_rows`/`report_chiqim_rows`/`report_rows` and functions `report_filtered_rows`/`report_query_page`/`report_totals` (`supabase/migrations/0026_report_server_side_query.sql`) replaced the old client-side `FETCH_CAP=500` fetch-then-filter approach, which silently truncated past 500 rows. UI: `src/components/report/ReportFilterBar.tsx` (expanded by default on this desktop surface, v1.15), `src/components/report/TotalsStrip.tsx`, `src/pages/reports/HisobotTab.tsx` (now also holds Prev/Next paging) + `ReportResultsTable.tsx`/`ReportTableRow.tsx` + row-detail components. See DECISIONS.md "Reporting engine: server-side query."

#### 3.2.5 Serial passport 🔒 (v1.17 — first real body; previously a forward-reference only)

**One parent serial's whole life, reached as a drill-down from any Hisobot row** (KIRIM or CHIQIM — a CHIQIM row's own `serial` field is already its parent), never a separate screen/route. A button inside the existing row-expand panel (§3.2.4) opens it in a modal, scoped to that row's parent serial.

🔒 **Reads underlying records directly, not through any role's filtered view.** Ombor's finished-goods view (`useMoykaOutput.ts`, §5.3) shows the active wash cycle only — correct for that operational screen, wrong for a passport whose whole point is showing everything that ever happened to a serial. The passport's own RPC (`get_serial_passport`, `supabase/migrations/0027_serial_passport.sql`) reads `wash_cycles`/`moyka_sends`/`finished_pallets` unconditionally, every cycle, voided pallets included — reusing `report_kirim_rows`/`report_chiqim_rows` only for the two derivations (`effective_qty`, pallet status + void-successor lookup) that would otherwise need a third implementation, since neither view is active-cycle-scoped either.

Contents, in lifecycle order:
- **Buyurtma** — client, declared quantity, client quality targets (moisture/SO₂ or "Talab yo'q · naturel"), truck, driver, date, plus the serial's `effective_qty` (§2.16) and its variance against declared, if any.
- **Darvoza** — stage 1 and stage 2 weights, net, both photos per stage, actor and timestamp per stage.
- **Qabul qilish** — Ombor's figure, actor, timestamp, Barcode #1 (labelled as a per-line split, not a measurement, §2.16) — followed by the KIRIM descriptive lab check (§5.5.2: "feeds... the serial passport"), since it's intake-time information, not tied to any one wash cycle.
- **Yuvish sikllari**, repeated 1..N — kg sent, every pallet returned (Barcode #2, kalibr, kg, status including `bekor qilindi`, and what replaced it if voided), Konditirskiy pallets (own barcodes, retained across cycles — visible in the cycle that produced them, rolled up with every other cycle's in the current-position total below), the CHIQIM lab result (target vs. actual, verdict).
- **Jo'natishlar** — every CHIQIM request this serial contributed to (a serial may be dispatched partially across several trucks), each with its own gate photos/actors/timestamps and pallet list.
- **Joriy holat** — by kalibr, **three states, not two**: `omborda` (in storage, unclaimed), `band qilingan` (claimed onto a manifest but the truck hasn't cleared gate stage 2 — physically still on site), `jo'natilgan` (departed). A pallet is deducted from *available* stock the instant it's scanned onto a manifest (§5.4) — well before gate stage 2 — but that is not the same as being physically gone; only `jo'natilgan` counts as collected. §3.5's client report reads this same three-way split for "held for client," which must include reserved-but-not-departed.

**Implemented as:** `get_serial_passport(p_serial text) returns jsonb` — one RPC, one round trip, returning the whole nested document (order/gate/intake/kirimLab/effectiveQty/cycles/dispatches/currentPosition) rather than several flat queries, given how heterogeneous the shape is. `src/lib/serialPassport.ts` (types + fetch) + `src/pages/reports/SerialPassportModal.tsx` (first modal in this codebase, same "first of its kind, deliberately" precedent as §3.2.4's first `<table>` — the content is too dense for the row-expand `<tr>` it's reached from).

#### 3.2.6 Ombor qoldig'i — stock on hand 🔒 (v1.18 — first saved view built after the passport)

**A snapshot of *now*, not an event history** — the one saved view on this engine with no date filter at all. Available to Menejer and Rahbar, same screen, same read-only rule as §3.2 itself.

Grouped **buyurtmachi → mahsulot turi → kalibr**. Konditirskiy needs no special-case: it already carries its own calibre (§2.3, numberless), so it naturally lands in its own group per client rather than blending into a numbered calibre's total.

Five states, per batch:
- **Available** — `in_stock`, unclaimed, current wash cycle carries an `o'tdi` verdict (§5.5.3 hard gate) — the only state actually dispatchable today.
- **Band qilingan** — claimed onto a CHIQIM manifest, that dispatch's gate stage 2 not yet complete. Reserved, still physically on site — same three-state distinction §3.2.5's passport established (`Joriy holat`), reused here rather than re-invented.
- **Awaiting lab** — `in_stock`, unclaimed, no CHIQIM lab result yet for the current cycle.
- **Flagged qayta yuvish** — `in_stock`, unclaimed, current cycle's verdict is `qayta_yuvish` (§5.5.4: the lab has flagged it, Ombor hasn't voided/re-sent yet).
- **Raw not yet washed** — cycle-1 balance (`effective_qty`, §2.16 — never `actual_qty` directly, same figure `useMoykaSerials.ts`'s own cycle-1 cap already reads — minus whatever's already been sent for cycle 1) that hasn't gone to Moyka at all. A re-wash's own voided-but-not-yet-resent material is a *different* state (§3.2.9's own WIP row, not this one) — it already went through Moyka once.

**Ageing.** Each batch shows days held, anchored on the event that put it in its current bucket (a finished pallet's `received_date`; a raw balance's `storage_intake.confirmed_at`). **`> 90` days flags red.** Not a §2.14 setting — the task named 90 days directly, unlike the WIP thresholds below.

**Lab turnaround (§3.2.9 part C), shown here as one header stat:** the average number of days between a wash cycle producing pallets and its CHIQIM verdict landing, over every *completed* check — the benchmark an in-progress "awaiting lab" WIP row's own elapsed days is read against.

**Implemented as:** `stock_on_hand_rows` (view, one row per pallet or per raw balance, feeds ageing + passport drill-down) + `stock_on_hand_summary(p_owner_id)` (function, the grouped client→product→calibre→bucket aggregate the UI actually renders — same detail/aggregate split as `report_query_page`/`report_totals`) + `lab_turnaround_avg()` (function). `supabase/migrations/0028_stock_on_hand_and_wip.sql`. Same furniture as §3.2.4 throughout: a `<table>`, row expand, and the §3.2.5 passport reached from any row — no new interaction pattern.

#### 3.2.7 Client report — RESERVED, not yet built

Section number held per the original v1.10 revision plan. §3.5 (below) is still the only spec text for this until it's actually designed.

#### 3.2.8 Moisture-adjusted yield — RESERVED, not yet built

Section number held per the original v1.10 revision plan.

#### 3.2.9 Kutilayotgan ishlar — WIP / stuck 🔒 (v1.18)

**An exceptions list, not a history or a snapshot of stock.** One row per thing that has sat beyond its configured threshold (§2.14) — every threshold here is a `settings_limits` value, editable in Administration, not hardcoded. Available to Menejer and Rahbar; the natural forerunner of the Rahbar exceptions list named in §6.2 (§3.2.10, reserved, would aggregate this across the business — not built this prompt).

Seven checks, each its own row kind:
1. **Raw received, not sent to Moyka** — cycle-1 balance untouched beyond **Xom ashyo kutilmoqda** (default 3 days, §2.14).
2. **Sent to Moyka, not returned** — cycle still `active` beyond **Moykada turib qoldi** (default 7 days) — the same threshold §5.2/§5.3's own idle flag already uses; this view surfaces it, doesn't duplicate its definition.
3. **Awaiting lab test** — a finished cycle with no CHIQIM verdict yet, beyond **Tahlil kechikdi** (default 2 days). Highest-value row: untested stock cannot ship (§5.5.3).
4. **Moisture in, SO₂ pending** — beyond **Sera kechikdi** (default 2 days). Natural products (no SO₂ target) are excluded outright, never overdue (§5.5.1, §7 item 10) — this is the exact mechanism, not a new one.
5. **Flagged qayta yuvish, not yet re-sent** — a cycle whose CHIQIM verdict is `qayta_yuvish` with no next-cycle `wash_cycles` row yet. **Shows unconditionally, no threshold** — the moment the lab flags it, it's actionable.
6. **Open CHIQIM requests not loaded / not departed** — neither Ombor's `ombor_finished_at` nor Qorovul's gate-stage-2 `completed_at` set, beyond **Jo'natish kechikdi** (default 2 days).
7. **Serials with provisional weight** — gate stage 2 outstanding. **Shows unconditionally, no threshold** — every day it stays provisional is itself the signal.

**Lab turnaround, per batch (part C).** Row kind 3 (awaiting lab) shows its own elapsed days inline — that figure *is* an in-progress turnaround measurement, read against §3.2.6's header average for context (is this batch slower than usual, or normal for this lab).

**Implemented as:** `wip_rows` (view, one shared row shape, `wip_kind` distinguishing the seven checks; reuses `report_kirim_rows.provisional` directly for row kind 7 rather than re-deriving it). `supabase/migrations/0028_stock_on_hand_and_wip.sql`. Same table/expand/passport furniture as §3.2.4 and §3.2.6 — no new interaction pattern.

### 3.3 Product settings 🔒
Add categories / types / calibres (incl. Konditirskiy) → `MAHSULOT_TURLARI`.

### 3.4 Kuzatuv — traceability 🔒 (desktop)
Lenses: **Seriya / Mashina / Mijoz bo'yicha**. Search + date + Excel.
- **Seriya bo'yicha:** row per serial with pipeline balances + **Yo'qotish %**; → **Seriya pasporti**.
- **Seriya pasporti:** one serial's whole life — intake (single-type by construction, §2.1); Moyka batches; finished by calibre incl. Konditirskiy + loss %; dispatches (date · truck · client) with **hamroh seriyalar**; balance in stock. "Mijoz hisoboti" export.
- **Mashina bo'yicha:** every trip in/out + serials carried (many-to-many); Manifest opens pallet list.
- **Mijoz bo'yicha:** running in/out/stock per buyurtmachi; entry to client report.

### 3.5 Client report — "Mijoz hisoboti" 🔒
Generated doc: client + date range → one click. **PDF + Excel.** **Uz/Ru toggle.** Sample: `BATU-Mijoz-Hisoboti-namuna.pdf`.
- **Summary:** raw received · finished · **loss % + kg (shown; toggle-able)** · dispatched · in storage (loss on processed portion only).
- **A — Kelgan seriyalar va sifat:** per serial — kelgan sana, tur, brutto/tara/netto, **namligi %**, **SO₂ mg/kg** (natural = "Yo'q") **+ talab qilingan (AMENDED v1.9)** — the client's own target for each metric, printed alongside the reading (or "Talab yo'q" if none). **Document is an attached photo, no typed number.**
- **B — Tayyor mahsulot:** per serial, calibre breakdown incl. Konditirskiy, jami, xom netto, yo'qotish, **+ chiqqan namligi %/SO₂ + verdict + yuvish sikli where >1 (AMENDED v1.9)** — the finished-goods lab reading, the `O'tdi`/`Qayta yuvish` verdict, and the wash-cycle number when a batch went through re-wash. *Rationale: the client's own requirement printed beside the delivered result is the single most useful line in a toll-processing report — it is the contract and the proof in one row.*
- **C — Jo'natmalar (in body):** grouped **by trip** (vehicle header + serials underneath); columns seriya · kalibr tarkibi · netto; departure doc = **attached photo**. Serial is first-class for origin tracing.
- **D — Balans:** per serial — kelgan, **oxirgi chiqish** ("qisman" until fully shipped), omborda qolgan (raw/finished), holat.
- **Appendix (optional):** chronological ledger.

---

## 4. Role: QOROVUL (Gate) 🔒

Two **tabs** `KIRIM | CHIQIM`. Header counters `Kutilmoqda · Kirdi·bo'shatilmoqda · Yakunlandi`. Language toggle + compressed photos.

**Two windows per tab:**
- **Window 1 — Faol:** *Kutilayotgan* lines (manager's expected trucks, predefined values) → **"Qabul qilish"** (stage 1). *Red* lines (first weight in, second pending) → **"Yakunlash"** (stage 2).
- **Window 2 — Yakunlangan:** completed trips with net weight + timestamp.

**Two-stage weighing** (states `Kutilmoqda` → red `Kirdi/yakunlanmagan` → `Yakunlandi`; finished lines leave the active view):

| | KIRIM (arrives loaded) | CHIQIM (arrives empty) |
|---|---|---|
| Stage 1 "Qabul qilish" | plate photo + **Yuk bilan vazn (Гружёный)** + **weight-reading (tarozi) photo** | plate photo + **Bo'sh vazn (Пустой)** + **tarozi photo** |
| Stage 2 "Yakunlash" | **Bo'sh vazn (Пустой)** + tarozi photo | **Yuk bilan vazn (Гружёный)** + tarozi photo + **Chiqish hujjati rasmi** (required) |
| Auto | Yuk og'irligi = yuk bilan − bo'sh | same |
| Unlocks when | weight + tarozi photo present | weight + both photos present |

🔒 **Both stages, both directions require a weight-reading (tarozi) photo** alongside the weight. On Yakunlash: net auto-computed, line → Window 2; manager KIRIM → **Qabul qilindi** (🔒 at Yakunlandi), manager CHIQIM → **Olib ketildi**. No soft warnings. Departure doc is a **photo**, no typed number.

- 🔒 **Multi-serial trips — display only, no workflow change.** A KIRIM order may carry several types, each with its own serial (§2.1). The gate still weighs **the truck**, twice, exactly as before — one Гружёный, one Пустой, one net. The line simply lists the order's types + serials for reference. Qorovul never enters a per-type figure.
- 🔒 **Gate net is a truck-level total, and is never split.** One physical weighing yields one net for the whole load, regardless of how many types or serials it carries. That net is reconciled against the manager's declared **Jami avto** (§3.1) — truck total against truck total. It is **not** apportioned across serials. Per-type weights are entered by the Storage Manager at §5.1, where the piles are physically separated. No weight in the system is ever derived from a split.

---

## 5. Role: STORAGE MANAGER (Ombor menejeri) 🟡 (all four designed)

**Nav:** 4 sections + universal **"Skanerlash"** lookup (scan any #1/#2 → read-only serial history). Language toggle + compressed photos throughout.

🔒 **Named pattern — Section mirroring** (introduced 2026-07-16, see DECISIONS.md "Section mirroring / derived stage membership"): consecutive §5 sections share their window boundary — **Window N of section K is the same underlying set as Window (N−1) of section K+1**, not two independently-written conditions that happen to look similar. Cite **"section mirroring"** by name in future prompts instead of restating this table.

| Section | Window 1 | Window 2 |
|---|---|---|
| §5.1 KIRIM | pending trucks | confirmed, raw remainder > 0 |
| §5.2 Moyka | = §5.1's Window 2 set, "Yuborish" action | sent, not yet manually finished (Tugallash) |
| §5.3 Tayyor | = §5.2's Window 2 set | finalized |

A serial legitimately appears in **both windows of two adjacent sections at once** — e.g. mid partial-send it has raw remainder left (§5.1 W2 / §5.2 W1) **and** some material already in Moyka (§5.2 W2 / §5.3 W1), simultaneously; an early-life serial can satisfy all three at once and so appear in **all four windows together** (§5.1 W2, §5.2 W1, §5.2 W2, §5.3 W1). That's the pattern working as designed, not a bug. Implementation-wise this means the same query/hook backs both windows across a boundary (`hasRawRemainder`/`isAwaitingTugallash` in `src/lib/stageMembership.ts`; `useMoykaOutput` consumed directly by both §5.2's Window 2 and §5.3's Window 1) — never two copies of the same filter. 🔒 **§5.2 W2 / §5.3 W1 is independent of `wash_cycles.status` in one specific way** (updated 2026-07-16 — see DECISIONS.md "Manual-only finishing"): a serial can be awaiting Tugallash here **and** already show in §5.3's Tugallangan (Window 2, finalized) at once, if more was sent after an earlier Tugallash closed a prior batch. Graduation to Tugallangan itself is untouched — still `wash_cycles.status='final'`, set only by Tugallash — this only concerns whether a serial *also* still shows as awaiting-finish.

🔒 **Named invariant — Finishing is always manual** (introduced 2026-07-16, see DECISIONS.md "Manual-only finishing"): a serial reaches §5.3 Window 2 (Tugallangan) **only** when the operator clicks Tugallash. There is no automatic path — not on receiving enough to match Yuborilgan, not on overshooting it. §5.3 Window 1 shows a serial regardless of whether Jarayonda is positive, zero, or the serial has been over-received; Tugallash itself is **always clickable**, never disabled by any quantity. Clicking it shows a non-blocking soft warning (never blocks the action) when raw remainder is still in storage and/or the loss about to be locked exceeds 10% — stating the specific reason(s) — but the operator can always proceed. Cite **"manual-only finishing"** by name for any future work touching §5.3's completion flow.

🔒 **Named invariant — All stage/history lists sort newest-first** (introduced 2026-07-16, see DECISIONS.md "Universal sort rule"): every §5 window populated from a stage-membership derivation (§5.1 W2, §5.2 W1/W2, §5.3 W1/W2) and every read-only history view (Hisobotlar) sorts newest-first by its own most relevant date, via the shared `sortByDateDesc` (`src/lib/sortByDate.ts`). This was previously fixed per-component after the fact (see DECISIONS.md "History list ordering") rather than established as a rule, which is why it kept recurring on new lists — a new list in this family inherits the rule by construction (sorted once inside its hook, not re-sorted per consumer) rather than needing to remember it. Exempt by design: append-only event-timelines meant to read chronologically like a conversation (Qaydlar/notes, per-serial send-history) — oldest-first is the correct reading there, not a gap; and raw arrival queues (§5.1 Window 1 "Kutilmoqda", Qorovul's gate queues) — those are FIFO work queues, not stage-membership lists, and sorting them newest-first would bury the oldest-waiting item.

🔒 **Named pattern — Placement windows vs. acceptance windows** (introduced 2026-07-17, see DECISIONS.md same title): every §5 window's *second-window* membership follows exactly one of two shapes:
1. **Purely derived** — membership is arithmetic over the event logs (`moyka_sends`, `finished_pallets`, `wash_cycles`), auto-updates the instant those logs change, and no human action independently flips any stored state to produce it. §5.1/§5.2's `hasRawRemainder` boundary and §5.2/§5.3's in-process (`isProcessing`) boundary are both pattern (1) — nothing is being "accepted," the window is only reporting what the numbers already say.
2. **Displayed-but-gated** — arithmetic controls *eligibility* (what's shown, what's enabled), but the actual transition of stored state happens only via an explicit, human-clicked action. **§5.1 storage-intake** (`Qabul qilish`: a trip is visible the moment the manager submits and *acceptable* the moment gate stage 1 exists — both arithmetic/derived — but the serial is not *in storage* until Storage clicks Qabul qilish and a `storage_intake` row is written) and **§5.3 finished-goods intake** (`Tugallash`: arithmetic decides when a serial is *eligible* to finish, but `wash_cycles.status` only becomes `final` when the button is clicked) both follow pattern (2).

🔒 **No future section — including Step 7 CHIQIM — may auto-accept a serial into the next stage without an explicit human acceptance action.** Arithmetic may decide eligibility; it must never itself perform the acceptance. Any section proposing to skip the explicit click (an "auto-accept once the numbers line up" shortcut) must be built as pattern (2), not silently collapsed into pattern (1).

🔒 **Named invariant — CHIQIM per-role finalization** (introduced 2026-07-17, see DECISIONS.md same title): unlike §5.1–§5.3, §5.4 (CHIQIM) has **no single shared "finished" status.** Each role finalizes independently, on its own explicit action, and sees its own Window 2 the moment *its own* action fires:
- **Ombor** finishes when it scans the pallets and clicks `Yuklashni yakunlash` (stock pulled) — its own signal, separate from the gate's.
- **Qorovul** finishes when its **SECOND** (loaded, Гружёный) weighing completes — the existing two-stage gate pattern (§4), unchanged. The **FIRST** (empty, Пустой) weighing is a separate, earlier action and is **not** a finish.
- **Menejer** sees a request as finished once Qorovul's second weighing completes (the truck has physically left) — Menejer's own finished view reads Qorovul's signal, not Ombor's; Ombor finishing loading and the truck actually leaving are two different facts that can happen at different times.

🔒 **Finished/Window-2 membership for CHIQIM must be tracked per role — never collapsed into one shared status column.** `chiqim_requests.status` (the existing `kutilmoqda → olib_ketildi` field, §3.1) reflects only the truck-level lifecycle already locked there and must **not** be overloaded to also mean "Ombor is done loading" — those are different facts, owned by different roles. This is a different kind of rule than section mirroring/placement-vs-acceptance above: §5.1–§5.3 are one shared pipeline with a single progression per serial; §5.4 fans out into three independent finish events for the same request, and conflating them into one field would silently reintroduce the exact bug class those two invariants exist to prevent (one stale field standing in for a fact only a *different* action actually produced).

### 5.1 Skladga KIRIM 🟡
Visible **immediately on manager KIRIM submit** (Kutilmoqda), read-only, so storage can see what's coming — but only **acceptable once gate stage 1 exists** (loaded weight recorded; does **not** wait for stage 2 / net weight, updated 2026-07-15, see DECISIONS.md "Storage §1 intake"). Showing the trip's serials (one per type, §2.1). 🔒 **Storage enters the actual weight per serial** on "Qabul qilish" — this is the measured per-type figure, entered by the person who physically separates the piles. Storage adds pile photo + optional komment; **namligi + oltingugurt** are entered by the **Laborator** (§5.5), not here; prints **Barcode #1 per serial** → Skladda turibdi.
- 🔒 **One reconciliation only, against the declared figure** (updated 2026-07-15 — see DECISIONS.md "Storage §1 intake"): each serial's entered weight against the manager's **declared qty** (§3.1) — a shortfall here is the red **"Kam chiqdi"** + cross-role note. ~~The trip-level "sum of actuals vs gate net" reconciliation described in earlier drafts of this section was dropped~~ — storage's per-type entries sum to the gate total by definition, so counter-checking them adds no information; the gate's figures remain visible on demand (the full-story detail view) but are not something storage reconciles against here.
- Two-window list; ⋯ full-story detail (manager + gate + storage figures) per received serial. `File: BATU (skladga-kirim mockup)`.
- 🔒 **Window 2 membership is DERIVED, not the stored `storage_intake.status`** (fixed 2026-07-16 — see DECISIONS.md "Section mirroring / derived stage membership"). `status` defaults to `skladda_turibdi` at accept time and is **never updated afterward** (nothing in the app issues an `UPDATE` on it) — using it for placement made every accepted serial appear stuck "in storage" forever, even long after all its raw material had moved to Moyka. Window 2 now shows a confirmed serial only while it still has **raw remainder > 0** (`actual_qty − Σ moyka_sends.qty_kg`) — **section mirroring**: the identical set §5.2's Window 1 already computes, reused via the same query rather than re-derived. Once fully sent, the serial leaves this window entirely. The row's stale status word was replaced with the same derived remainder figure ("Qoldiq"). `storage_intake.status` itself is untouched — no migration, still defaults to `skladda_turibdi`, simply no longer read for placement.
- 🔒 **Declared is always visible next to actual.** The Qabul qilish form lists one row per serial on the trip, each showing: Seriya · Tur · **Buyurtma (kutilgan, kg)** — the manager's declared_qty, read-only — and **Aniq (kg)** — the storage manager's measured input. He confirms against a number he can see, while the pile is in front of him.
- 🔒 **Live variance per row.** As he types the actual, the row shows the difference against declared (kg and %). A negative variance beyond the configured limit (§2.14) flags red **"Kam chiqdi"** on save. Never blocks — he can save a shortfall; it becomes a note for the manager (§5.1).
- The declared figure is **never editable here** (§3.1 — declared is the manager's record and is never overwritten). Storage records what he measured; the gap between the two is the finding, not an error to be corrected away.
- 🔒 **AMENDED v1.10 — `actual_qty` is a per-line split, not a measurement (§2.16).** On single-product trucks Ombor takes no independent weight; `actual_qty` is pre-filled from declared and normally accepted untouched. The **accept-time reconciliation above stays intake-vs-declared** (line 270 — unchanged, it's a floor-level sanity check made before gate net is typically even known) — but it is never the accounting figure. Once gate stage 2 completes, the Window 2 ("Qabul qilingan") list additionally shows the **gate-vs-declared** variance (§2.16.2), a separate, additional figure from the accept-time Kam chiqdi check, not a replacement for it. `effective_qty` (§2.16.1) — gate net for a single-line truck once known, else the intake figure — is the working quantity Window 2's "Qoldiq" and every downstream Moyka/yield calculation reads, never `actual_qty` directly.

### 5.2 Moykaga Chiqarish 🟡 (updated 2026-07-16 — see DECISIONS.md "Section mirroring / derived stage membership", "Manual-only finishing"; AMENDED v1.9 — see §5.5.5)
Send raw to production; **partial sends** accumulate; no new barcode (#1 travels). **Window 1 ("Yuborish uchun")** is the identical set as §5.1's Window 2 (confirmed, raw remainder > 0 — section mirroring); send form with live "qoladi", ⋯ per-send history, Qaydlar qo'shish all live here, unchanged. Sorted newest-first by order_date (§5 intro named invariant). ~~Window 2 was unreceived sent material, `total_sent − total_received > 0`~~ 🔒 **Window 2 is sent, not yet manually finished** — `sent > 0 AND` no `final` `wash_cycles` row for cycle 1, independent of received/sent quantities entirely (updated 2026-07-16 — see DECISIONS.md "Manual-only finishing": since finishing is always a deliberate Tugallash click now, not an automatic quantity threshold, "not yet finished" is the correct membership test, not a quantity comparison). Window 2 is the identical set §5.3 Tayyor's Window 1 already computes (section mirroring again: `useMoykaOutput` is consumed directly here, not reimplemented). A partially-sent serial shows in **both** windows at once — still has raw remainder to send (Window 1) **and** hasn't been finished yet (Window 2) — expected, not a bug; the same serial can *also* simultaneously show in §5.3's Tugallangan if an earlier Tugallash already finalized a prior batch and more was sent since. Window 2 is read-only (no send action, no ⋯ expand): managing what happens to a serial once it's in Moyka is §5.3's job, this is just visibility that it's there.

🔒 **Re-wash material, NEW route (v1.9, see §5.5.4–5).** Window 1 also lists pallets flagged `Qayta yuvish` by the lab, visually distinguished from first-wash raw and carrying their cycle number, alongside the existing raw-remainder set. **❓ OPEN — quantity basis, do not build around it:** §5.2 sends raw material by weight against a serial's remaining balance; re-wash material arrives as a set of finished pallets with known individual weights. Whether the re-send is expressed as "these specific voided barcodes" or collapses back into a plain kg figure against the serial affects §5.3's yield-loss maths across cycles — unresolved, out of scope for this prompt (§5.5.5).

### 5.3 Tayyor Mahsulot / Skladga KIRIM 🟡 (updated 2026-07-16 — see DECISIONS.md "Tayyor Mahsulot completion", "Tugallangan window", "Manual-only finishing")
Serials in Moyka awaiting output. `+ Qabul qilish` → **daily receipt form: one pallet per save** — **Tur** (🔒 read-only, auto-filled from the parent serial — a serial is single-type by construction (§2.1); shown as a floor-level confirmation that the right pile is being stickered, never editable) + **Kalibr** (incl. Konditirskiy) + **Og'irlik** → auto-prints **Barcode #2** (`PLT-<serial>-<calibre>`, `…-KN` for Konditirskiy) to stick. ~~`Tugallash` → summary of all receipts + running totals, double-confirm, locks final yield-loss, files to history.~~ 🔒 **The form closes on every submit — no auto-reopen.** A new entry needs an explicit **"+ Yana qo'shish"** click (the same button, relabeled once at least one pallet exists); the last pallet's Barcode #2 stays visible/printable after the form closes. Per-serial totals: **Yuborilgan / Qabul qilingan / Jarayonda** (neutral, not "loss" until finished; **floored at 0 — never negative**).
- 🔒 **Finishing is always manual (named invariant, see §5 intro)** — ~~the moment Qabul qilingan reaches or exceeds Yuborilgan, that same submit auto-completes the cycle~~ **removed 2026-07-16: real workflows pack a serial's output across several days, and the operator — not a quantity threshold — decides when it's done.** Saving a receipt never locks anything; the serial stays in Window 1 regardless of Jarayonda's value — positive, zero, or negative (over-received, which now shows as **`Ortiqcha: +N kg`** next to Jarayonda, same display philosophy as **Kam chiqdi** §5.1, and stays in Window 1 just like an under-received serial — no auto-graduation). `Tugallash` is **always clickable**, never disabled by any quantity, and locks the final yield-loss into `wash_cycles` (floored at 0% — an overage is never a negative "loss") on confirm. Confirming shows a **non-blocking soft warning** stating the specific reason(s) when either applies: raw remainder still in storage (`hasRawRemainder`, same predicate §5.1/§5.2 use), or the loss about to be locked exceeds 10% — never blocks, the operator can always proceed.
- 🔒 **Window 2 — Tugallangan.** A serial whose cycle 1 has a `final` `wash_cycles` row (always via Tugallash) files here — matching the two-window (Faol/Yakunlangan-style) pattern already used at §5.1/§5.2/gate. Row: **Seriya · Buyurtmachi · Tur · "Yuborilgan X → tayyor Y kg"** and a badge — the locked loss % (red, e.g. `-18.2%`) or, if the serial overshot, **`Ortiqcha: +N kg`** in the same non-alarming Ortiqcha styling (never both — an overage always shows Ortiqcha, never a negative-looking loss reading). ⋯ expand reuses the Window 1 pallet list (barcode2 · kalibr · og'irlik, each reprintable). Sorted newest-first (§5 intro named invariant).
- 🔒 **Re-wash (§2.13):** three-dot on a serial → **"Moykaga qayta yuborish"** (confirm) remains the manual path. Voids that serial's finished receipts + Barcode #2s + loss figure (`bekor qilindi`), returns everything **except Konditirskiy** to Moyka, and the serial re-enters the §5.2 → §5.3 flow. New barcodes on the second output; KN is additive; final loss recalculated at the second Tugallash. **v1.9: the primary trigger is now a lab `Qayta yuvish` verdict, not this menu** — see the next two bullets and §5.5.4.
- 🔒 **NEW (v1.9) — Laborator CHIQIM Window 1 placement.** On `Tugallash`, produced pallets additionally appear in **Laborator CHIQIM Window 1** (§5.5.3), the moment the wash cycle completes — not on dispatch. Storage takes no extra action; this is a derived placement window, exactly like every other §5 cross-section boundary (section mirroring), not a handoff.
- 🔒 **NEW (v1.9) — Qayta yuvish flag + action here.** A pallet whose parent serial's current cycle carries a `Qayta yuvish` lab verdict displays **red** in this section with a "Qayta yuvish kerak" flag, and exposes the void + re-send action described above (§5.5.4) — this is where Ombor actually executes what the lab flagged. **Pallets are not dispatchable until lab-passed** (v1.9) — §5.4's scan screen will not find them, because it reads the same derived availability truth as Menejer's feasibility checker (§8).
- 🔒 **Moyka idle flag:** a serial sitting in Moyka beyond the configured threshold (§2.14) is flagged here **and** on the Rahbar's exceptions list (§6.2). `File: BATU-Storage-S3-Tayyor-Mahsulot-v1.pdf`.
- 🔒 **AMENDED v1.10 — cycle-1 input basis (§2.16).** Process loss and yield are computed against `effective_qty` for cycle 1 (gate net for a single-line truck, once known; the per-line intake figure for a multi-line truck — never `actual_qty` directly), and against the re-wash input weight for cycles 2+ (existing §5.5.4/§5.5.5 behaviour, unchanged — the re-wash input is not a weight-authority figure). "Yuborish uchun"/"Qoladi" (§5.2) uses the same `effective_qty`-derived cap, floored at 0 for display (a serial can be over-consumed relative to a just-arrived, lower gate net; never shown negative). Ombor's finished-goods view (this section) shows the active cycle only; the serial passport (§3.2.5, not yet built) must read underlying records rather than this view.

### 5.4 Skladdan CHIQIM 🟡 (updated)
Triggered by CHIQIM request + gate stage-1 (empty truck on-site).
- **Dashboard Window 1:** requests ready to load. 🔒 **No serial on the request** — shows only the manager's details (buyurtmachi, date, truck, driver) + **target breakdown** (type+calibre). Window 2: loaded/handed-off trucks.
- **Scan-to-load:** target lines with **progress bars**; each **Skanerlash** reads a Barcode #2 pallet and **auto-adds its full known weight** (no typing) to the matching **type+calibre** line; wrong scan removable (✕). Pallets may come from **multiple serials** (many-to-many).
- 🔒 **Whole pallets only.** A pallet is **atomic** — loaded entirely or not at all. **No weight editing, no splitting, no remainder re-stickering.** (An earlier partial-pallet design was considered and explicitly **rejected** as too much floor hassle.)
- 🔒 **`Yuklashni yakunlash` is always enabled**; the total updates live. If the scanned total doesn't match the target (because no whole pallet fits the remainder), a **soft warning** appears — it never blocks. The shortfall is recorded as a note on the dispatch for the manager to settle with the client.
- **Manifest + handoff:** scanned list grouped **by serial** (traceability); each pallet **deducted from its serial's stock**; `Qorovulga topshirish` → gate stage-2 (Гружёный). **Gate net reconciles against manifest total** = the closing safety check.
- 🔒 **Dispatch discipline lives on the order form, not the floor** — see §3.1. `File: BATU-Storage-S4-Skladdan-CHIQIM-v2.pdf`.

### 5.5 LABORATOR (separate role) 🔒 (REVISED v1.9 — replaces the v1.5 design wholesale; see DECISIONS.md "Laborator v1.9 redesign")

Own window, same shape as the gate: tabs `KIRIM | CHIQIM`, counters, then windows. Language toggle. Photos compressed (§2.9).

🔒 **KIRIM and CHIQIM are NO LONGER identical (v1.9 — supersedes the v1.5 "identical workflow" design).** They differ in purpose, trigger, and outcome:

| | KIRIM check | CHIQIM check |
|---|---|---|
| Subject | Raw intake (Barcode #1 serial) | Finished pallets from a wash cycle (Barcode #2) |
| Trigger | Ombor records actual received weight (§5.1) | Moyka wash cycle produces finished pallets (§5.3) — **not** a dispatch request |
| Purpose | **Descriptive** — record condition as received | **Decisive** — pass/fail against the client's target |
| Verdict | None | `O'tdi` / `Qayta yuvish` (two states only) |
| Consequence | Informs washing; supplier/price evidence | Hard gate on dispatch availability + flags for Ombor |

🔒 **Sample ONE pallet → result applies to the WHOLE parent serial.** Unchanged from v1.5. Every calibre under that serial (K4/K6/K8/Konditirskiy) inherits its namligi + sera. No per-calibre testing.

#### 5.5.1 Sulfur is conditional, not always asked 🔒 (NEW v1.9)

**If Menejer entered no SO₂ target for that product line (§3.1), the lab form shows no sulfur field at all** — not a blank one, not a "pending" state. The product is natural/unsulfured; there is nothing to measure and nothing to wait for.

- **Sulfured products** keep the two-step flow: moisture entered first, SO₂ added ~1 day later (lab physics — the wait is real). These pass through the amber **Sera kutilmoqda** window.
- **Natural products skip step two entirely.** Moisture is saved and the check is complete in one action. They never enter the amber window, and they must never appear in a "Sera kechikdi" (sulfur overdue) alert — the absence of a sulfur reading is correct, not late.
- The client report prints **"Yo'q · naturel"** for these, driven by the absent target rather than by a separate flag.

#### 5.5.2 KIRIM tab — descriptive check 🔒 (v1.9)

- **Window 1 — Tahlil kutilmoqda:** serials awaiting sampling, appearing the moment Ombor records actual intake weight. **FIFO order** (arrival queue — exempt from the newest-first universal sort, same exemption class as the gate's own queues, §5 intro). Row: seriya · buyurtmachi · tur · e'lon qilingan/haqiqiy kg · kelgan sana → **"Tahlil"**.
- **Tahlil form:** pre-filled details · sampled pallet (dropdown) · sana · **Namligi %** · **Oltingugurt (SO₂)** *only if a target exists* (§5.5.1) · optional sample photo · optional defect/foreign-matter note.
- **Window 2 — Sera kutilmoqda (amber):** sulfured products only, moisture in / sulfur pending → **"Sera kiritish"** → single field **SO₂ mg/kg**.
- **Window 3 — Yakunlangan:** all values recorded.

**No verdict on KIRIM.** Raw material is not expected to meet client spec — that is the point of washing. The client's target is displayed here **for reference only**, greyed, with no pass/fail treatment. Nothing on this tab gates anything.

**Feeds:** Section A of the client report; the serial passport; the washing decision.

#### 5.5.3 CHIQIM tab — decisive check 🔒 (v1.9)

- **Window 1 — Tahlil kutilmoqda:** finished batches awaiting sampling, appearing when a wash cycle produces pallets (§5.3 `Tugallash`). FIFO. Row: parent seriya · buyurtmachi · tur · pallet soni · jami kg · ishlab chiqarilgan sana · **yuvish sikli (1/2…)**.
- **Client target is shown next to the reading**, inherited from the parent serial's `KIRIM_LINES` (§3.1), per metric. No sulfur target → no sulfur row on screen at all.
- **Tahlil form / amber window:** as KIRIM, subject to §5.5.1.
- **Verdict step:** once all applicable metrics are in, Laborator selects **`O'tdi`** or **`Qayta yuvish`**. The verdict is an **explicit click — never auto-derived from the numbers**, even when the reading obviously meets or misses target (finishing-is-always-manual invariant, §5 intro). The form may soft-warn that a reading misses target; it never decides.
- **Window 3 — Yakunlangan:** values + verdict + cycle number.

🔒 **Hard gate.** A finished pallet is available for dispatch only when it is `in_stock`, **not** in `dispatch_manifest`, **and** its parent serial's current wash cycle carries an `O'tdi` verdict. Untested and re-wash-flagged stock is invisible to Menejer's feasibility checker and Ombor's scan screen alike — **one derived truth, all consumers** (§8).

**Operational consequence, accepted deliberately:** if the lab falls behind, dispatch stops. Correct for a quality-gated toll operation, but it makes Laborator a bottleneck **by design, not by accident**. Staffing must reflect it.

**Two verdicts only — there is no write-off path.** Every failed batch is assumed recoverable by re-washing. If a load is ever genuinely unsellable the app cannot express it, and the batch will sit in re-wash limbo. Known and accepted; revisit if it happens in practice.

#### 5.5.4 What `Qayta yuvish` actually does — the lab FLAGS, Ombor EXECUTES 🔒 (NEW v1.9)

**The lab verdict changes no stored state on pallets.** It does not void barcodes, does not move stock, does not send anything to Moyka. It records a judgement and raises a flag. Ombor performs every physical and destructive action, because Ombor is the one standing in front of the pallets.

Sequence:
1. Laborator saves verdict `Qayta yuvish` on a parent serial's current cycle.
2. Those pallets immediately become **unavailable for dispatch** (derived, automatic — the hard gate above; no human action, no stored change).
3. They appear in Ombor's storage view **flagged red** — "Qayta yuvish kerak" — identifying exactly which physical barcodes to pull (§5.3). This is the whole reason the verdict is per-serial rather than per-pallet: on a floor holding hundreds of stickered pallets, Ombor needs the system to name them, not describe them.
4. Ombor **voids** those Barcode #2s and re-sends the material to Moyka — an explicit, confirmed, human-clicked action (§2.13, §5.2). The void happens here and only here.
5. The material re-enters the existing §5.2 → §5.3 flow. New Barcode #2s on the second output. Konditirskiy stays behind and is additive, unchanged.
6. The new cycle's pallets appear again in Laborator CHIQIM Window 1 as cycle 2.

**Why not auto-void on the lab's verdict:** it would silently mutate Ombor's stock from another role's screen, and it would strand physical pallets whose stickers are dead but whose location only Ombor knows. Same reason no other section in this app auto-accepts into the next stage (§5 intro named invariant).

#### 5.5.5 Re-wash re-entry point — §5.2 amendment ❓ OPEN (v1.9)

Flagged pallets must **reappear in Storage §5.2 Window 1 (Moykaga chiqarish)** as sendable material, alongside first-wash raw. They arrive there with their re-wash flag visible so Ombor can tell a second-cycle send from a first-cycle one.

**❓ OPEN — quantity basis.** §5.2 sends raw material by weight against a serial's remaining balance; re-wash material arrives as a set of finished pallets with known individual weights. Whether the re-send is expressed as "these specific voided barcodes" or collapses back into a plain kg figure against the serial affects §5.3's yield-loss maths across cycles. **Resolve before building §5.5.5 — do not let the build decide it.** (Explicitly out of scope for Step 8 prompt 1.)

#### 5.5.6 Tekshiruvlar tarixi — one section, filtered 🔒 (NEW v1.9)

**One history section, not three.** Both directions in a single filterable list — the same principle applied to the manager's reporting layer (§3.2): a lookup is a filter, not a separate screen.

Filters (all combinable): date range + presets · KIRIM/CHIQIM · buyurtmachi · tur · kalibr · seriya/barkod · verdict.
Each row expands to the full record: who tested, when, all values, target vs. actual, verdict, cycle number, photos, notes.
Filtered-totals bar (§2.11) + Excel export, as everywhere.

This is the table the client report (§3.5-A) reads for its moisture/SO₂ columns.

---

## 6. Role: RAHBAR (business owner) 🟡 (NEW)

**Platform:** desktop (like Kuzatuv) — he reads and analyses, not standing on a floor. Optional slim mobile view with headline numbers only.
- 🔒 **Read-only on all operations** (§2.12); write rights only in Administration.
- 🔒 **Multiple Rahbar accounts** supported; no personal names anywhere.
- 🔒 May open **any other role's screens read-only**.
- 🔒 Every list carries the **filtered-totals bar** (§2.11) and Excel export.

### 6.1 Umumiy ko'rinish (Oversight) — landing page
The "is the business healthy?" glance. All date-filtered, all with totals.
- **Live inventory position** — what is physically in the factory *now*: xom skladda / moykada / tayyor (jo'natilmagan) — **broken down by client**.
- **Throughput** for the period — qabul qilingan / ishlangan / jo'natilgan.
- **Yield-loss trend** — the margin number in a toll business (a drift 17% → 22% is money leaking). Over time, by client, by type.

### 6.2 Diqqat talab (Exceptions) — "what needs attention"
Surfaces problems rather than making him hunt. Each row clicks through to the **Seriya pasporti**. Thresholds **configurable** (§2.14).
- **Kam chiqdi** — shortfall loads (arrived less than ordered).
- **G'ayrioddiy yo'qotish** — yield-loss above the configured %.
- **Nishonga to'g'ri kelmadi** — dispatches that missed target (§5.4 soft-warning cases).
- **Sera kechikdi** — sulfur result overdue (also on the manager's dashboard, §3.2).
- **Moykada turib qoldi** — serial idle in Moyka beyond threshold (also visible to storage, §5.3).
- **Qayta yuvilgan** — serials that went through the re-wash loop (§2.13).

### 6.3 Hisobotlar (Reports) — the manager's full toolkit, read-only
🔒 Everything built for the manager's reporting layer is available to the Rahbar, read-only:
- **Tarix** event log — combinable filters, date presets, **totals bar**, Excel export.
- **Kuzatuv** — all three lenses (Seriya / Mashina / Mijoz bo'yicha), each with totals + Excel.
- **Seriya pasporti** — full serial life (now also showing re-wash cycles).
- **Mijoz hisoboti** — client report generator (PDF + Excel, Uz/Ru).
- Cross-variable filtering and export throughout.

### 6.4 Boshqaruv (Administration) — the only place he WRITES
- **Mahsulot sozlamalari** — categories / types / calibres incl. Konditirskiy (§3.3).
- **Mijozlar (OWNERS)** — client master table (§2.4).
- 🔒 **Foydalanuvchilar va rollar (NEW — previously had no home):** create logins for menejer / qorovul / ombor / laborator, deactivate leavers, manage **other Rahbar accounts**.
- 🔒 **Limitlar (thresholds)** — configure the exception rules (§2.14).

---

## 7. Open questions ❓
1. ~~Owner role~~ — 🔒 **RESOLVED: designed as Rahbar** (§6).
2. ~~Laborator window~~ — 🔒 **RESOLVED, designed** (§5.5). **REOPENED and re-resolved (v1.9):** the v1.5 design was replaced wholesale, not amended — see item 7 below and §5.5.
3. ~~Manager KIRIM "Qabul qilindi" trigger~~ — 🔒 **RESOLVED: flips at `Yakunlandi`** (net weight known), not at gate stage-1.
4. ~~Weight-term language~~ — resolved by global toggle (§2.8).
5. ~~Buyurtmachi input~~ — 🔒 **RESOLVED: dropdown from OWNERS everywhere** (never free text). Prevents name drift ("GLOBAL EXPORT" vs "Global Export" vs "GLOBAL EKSPORT") silently fragmenting the per-client filter, the Mijoz bo'yicha lens, and the client report.
6. ~~Sulfur unit~~ — 🔒 **RESOLVED: mg/kg (SO₂)**, entered by the **Laborator**.
7. ~~Laborator CHIQIM scope~~ — ~~RESOLVED: CHIQIM mirrors KIRIM exactly~~ — 🔒 **REOPENED and re-resolved (v1.9): Laborator CHIQIM is NOT a mirror of KIRIM.** Trigger, purpose, and outcome all differ — CHIQIM triggers on Moyka output (not dispatch) and carries a hard-gating verdict; KIRIM is descriptive-only with no verdict. See §5.5.
8. **NEW OPEN (v1.9)** — re-send quantity basis for re-wash material returning to §5.2 (§5.5.5). Must be resolved before §5.5.5 is built.
9. ~~NEW OPEN (v1.9) — untested-batch exception~~ — 🔒 **RESOLVED (v1.18):** yes — "Tahlil kechikdi" (§2.14), surfaced as the highest-value row on the §3.2.9 WIP view.
10. **CLARIFIED (v1.9)** — "Sera kechikdi" must exclude products with no SO₂ target (§5.5.1). A natural product is never overdue.
11. ~~Accounting weight basis~~ — 🔒 **RESOLVED (v1.10): gate net** (§2.16).
12. **NEW OPEN (v1.10)** — should the gate-net update (§2.16.2) notify Menejer when variance against declared exceeds a threshold, or only display it (current, this prompt's build)? Notification implies §2.14 threshold config — deliberately not built this prompt.
13. **PARTIALLY RESOLVED (v1.18)** — the unified §3.2 reporting layer's query engine, results table, totals strip, filter bar (§3.2.1-3.2.4), serial passport (§3.2.5), stock on hand (§3.2.6), and WIP/stuck (§3.2.9) are now applied and built. **Still CARRIED:** client balance report consolidation (§3.2.7 — §3.4/§3.5 below still hold the only spec text for this until then), moisture-adjusted yield (§3.2.8), Rahbar aggregates (§3.2.10) — reserved section numbers, written into this document directly as each is actually built (no separate companion doc).
14. ~~NEW OPEN (v1.14) — dateless pallet states~~ — 🔒 **RESOLVED (v1.18):** confirmed the same shape carries over unchanged — §3.2.6's `stock_on_hand_rows` derives `band_qilingan`/`omborda` from the identical claimed/verdict logic §3.2.2 already established, just without a date filter (a snapshot of now, not a history).

---

## 8. Provisional data model
- **OWNERS** — id, name
- **MAHSULOT_TURLARI** — id, category, type_name, calibre_applies, calibre_set (incl. `Konditirskiy`)
- **KIRIM_ORDERS** — order_id (PK), sana, plate, driver, owner_id, doc_photo, declared_total, status — *delivery envelope; one truck-trip. No serial.*
- **KIRIM_LINES** — serial (PK, from `next_serial()`), order_id, type_id, declared_qty, **target_moisture_pct (nullable, v1.9)**, **target_so2_mg_kg (nullable, v1.9; blank = natural, meaningful not missing)** — *🔒 one line = one type = one serial. A serial is single-type by construction. `declared_qty` is the manager's figure and is never overwritten; the actual weight lives on STORAGE_STOCK. Targets attach here (not KIRIM_ORDERS) since one truck may carry two products with different requirements, and flow down the lineage to every pallet produced from this serial (§3.1).*
- **CHIQIM_REQUESTS** — id, sana, plate, driver, owner_id, status (no goods-serial) · **CHIQIM_LINES** — request_id, type_id, calibre, qty
- **GATE_WEIGHINGS** — id (PK), ref (🔒 `order_id` for KIRIM / `request_id` for CHIQIM — **a weighing belongs to a truck-trip, never to a serial**), direction, gruzheny, pustoy, net (generated), stage1_photo, stage1_scale_photo, stage2_photo, stage2_scale_photo, departure_doc_photo, status — *🔒 one weighing per trip. Net is the whole truck's, and is never split across the trip's serials (§4).*
- **STORAGE_STOCK** — serial (PK), actual_qty (🔒 **measured** — entered by Storage at §5.1), namligi, sulfur(pending), pile_photo, barcode1, sent_to_moyka_qty, available_qty (derived), status — *serial is single-type, so this row is inherently per-type. No compound key needed.*
- **MOYKA_SENDS** — serial, date, qty
- **FINISHED_PALLETS** — barcode2 (PK), parent_serial, type_id, calibre, weight, owner, wash_cycle (1,2…), status (in_stock / dispatched / **bekor_qilindi**) — *atomic; never split. Voided barcodes must fail loudly on scan (§2.13). Unchanged by v1.9 — the re-wash flag is **derived** from the parent serial's current-cycle verdict, not stored on the pallet. Only the void (`bekor_qilindi`) is stored, written by Ombor (§5.5.4).*
- **DISPATCH_MANIFEST** — request_id, scanned barcode2[] (whole pallets only), shortfall_note
- **LAB_RESULTS** — id, scope (kirim/chiqim), ref (serial | **wash_cycle_id, v1.9 — no longer dispatch_request_id**), sampled_pallet, sample_date, moisture_pct, so2_mg_kg (nullable — pending *or* not applicable; distinguish via the line's target, §5.5.1), sample_photo, note, **verdict (v1.9; null on kirim; `o_tdi` / `qayta_yuvish` on chiqim)**, **tested_by (v1.9)**, status
- **NOTES** (append-only) — entity_ref, author, timestamp, text
- **AUDIT_LOG** — entity_ref, actor, timestamp, action, before, after
- **WASH_CYCLES** — serial, cycle_no, sent_qty, received_qty, loss_pct, status (active / voided / final) — *supports the re-wash loop (§2.13); Konditirskiy excluded from re-send and additive across cycles*
- **USERS** — id, name, role (rahbar/menejer/qorovul/ombor/laborator), active — *managed in §6.4*
- **SETTINGS_THRESHOLDS** — sulfur_overdue_days, moyka_idle_days, abnormal_loss_pct — *§2.14*
- **USER_PREFS** — user_id, language (uz/ru)

🔒 **Availability is one derived view, not a per-screen calculation (NEW v1.9).** A finished pallet is available for dispatch when `in_stock` **AND** not in `dispatch_manifest` **AND** its parent serial's current wash cycle has verdict `o_tdi`. Every consumer (Menejer's feasibility checker, Ombor's scan screen) reads this same derived truth — no screen recomputes it independently. *Implementation note: this is a design target for the lab-screens build, not yet wired into `useAvailableFinishedStock.ts` — the verdict component of the check does not exist until LAB_RESULTS gains its v1.9 shape (out of scope for Step 8 prompt 1).*

🔒 **`effective_qty` (NEW v1.10, §2.16) is likewise a derived view, no new column or table.** No `KIRIM_LINES`/`STORAGE_STOCK`/`GATE_WEIGHINGS` schema change was needed — every input already existed. `src/lib/weightAuthority.ts` (pure rule) + `src/lib/effectiveQty.ts` (I/O, `fetchEffectiveQty`/`useEffectiveQty`) is the one implementation every consumer reads, same "one derived truth, all consumers" pattern as availability above.

~~🔒 **HISOBOT (§3.2, NEW v1.14) reads existing tables only — no reporting-specific persistence, confirmed before building, no migration this prompt.** `KIRIM_LINES`/`KIRIM_ORDERS`/`GATE_WEIGHINGS`/`STORAGE_STOCK`/`FINISHED_PALLETS`/`DISPATCH_MANIFEST`/`CHIQIM_REQUESTS`/`WASH_CYCLES`/`LAB_RESULTS` are joined and filtered client-side, the same "fetch broad, join via Maps, filter client-side" convention every other read-only history view in this app already uses (`useGateHistory.ts`, `useIntakeHistory.ts`) — not pushed server-side, since none of these tables carries a reliable, always-populated date column to page on server-side.~~ **SUPERSEDED (v1.16):** the client-side fetch (capped at 500 rows, a silent truncation point) was replaced with Postgres views + functions (`report_kirim_rows`/`report_chiqim_rows`/`report_rows`/`report_filtered_rows`/`report_query_page`/`report_totals`) — filtering, pagination, and totals all live server-side now, with no row cap at all. §3.2.5's own `get_serial_passport` RPC (v1.17) is a second, larger migration on top of the same tables.

---

## 9. Changelog
| Version | Date | Change |
|---|---|---|
| 1.18 | 2026-07-21 | 🔒 **Stock on hand (§3.2.6) and WIP/stuck (§3.2.9) applied — both written directly into this document now, the dangling `docs/SPEC-reporting-v1.10-revision.md` reference removed** (that file never existed in this repo; original section numbering kept regardless — §3.2.7 client report, §3.2.8 yield, §3.2.10 Rahbar aggregates stay reserved). §3.2.6: a snapshot of *now*, grouped buyurtmachi→tur→kalibr, five states (available / band qilingan / awaiting lab / qayta yuvish / raw not washed), ageing with a fixed >90-day flag, and a lab-turnaround header average. §3.2.9: seven threshold-based exception rows (raw idle, Moyka idle, lab-test overdue, SO₂ overdue, qayta-yuvish pending, CHIQIM-dispatch overdue, provisional weight), five of seven reading a `settings_limits` threshold (§2.14, three new keys added), two showing unconditionally. §2.14 gained three new configurable thresholds; §7 items 9 and 14 resolved. Before this prompt, KIRIM-side `gate_weighings` were independently re-verified correct (not reversed, unlike the CHIQIM bug v1.17 already fixed); one further data inconsistency (story 2's CHIQIM `net_kg` not matching its own dispatched pallet) found and corrected live + in the seed file. `supabase/migrations/0028_stock_on_hand_and_wip.sql`. See DECISIONS.md "Stock-on-hand + WIP saved views." |
| 1.17 | 2026-07-21 | 🔒 **Serial passport applied (§3.2.5) — first real body, previously a forward-reference only.** One parent serial's whole life, reached as a drill-down from any Hisobot row's existing expand panel (a button, opening a modal — not a route, not inline in the row-expand itself, which stays as-is). Reads underlying records directly, not through Ombor's active-cycle-only finished-goods view (§5.3's own v1.10 amendment names this exact requirement). Contents in lifecycle order: buyurtma + `effective_qty`, darvoza (both stages, photos, actors), qabul qilish (+ the KIRIM descriptive lab check, per §5.5.2's "feeds... the serial passport" line — not explicitly listed in this prompt's own requirements but included per that citation), every wash cycle 1..N (sent kg, every pallet including voided ones and what replaced them, Konditirskiy retained across cycles, CHIQIM lab verdict), every dispatch this serial contributed to, and current position by kalibr in **three states** (omborda / band qilingan / jo'natilgan — a manifest-scanned pallet is deducted from available stock before gate stage 2, per §5.4, but isn't collected until it actually departs; the client report's "held for client" figure must include this reserved-but-not-departed state, not just departed). One RPC, `get_serial_passport`, returning the whole nested document in one round trip (`supabase/migrations/0027_serial_passport.sql`). Found and fixed a real, pre-existing data bug while building this: the CHIQIM demo-data seed script (v1.16-era) had `gruzheny_kg`/`pustoy_kg` swapped on every dispatch (CHIQIM reverses KIRIM's stage order — confirmed against `QorovulChiqimTab.tsx`), producing a negative `net_kg` invisible until the passport first surfaced a CHIQIM dispatch's own gate weight. See DECISIONS.md "Serial passport." |
| 1.16 | 2026-07-20 | 🔒 **Hisobot moved server-side (§3.2.4) — retroactively logged** (built same-session as v1.15 but this document's own Version/Changelog were not updated at the time; corrected now while touching this section for §3.2.5). Filtering, pagination (100 rows/page), and totals-over-the-full-filtered-set all moved from the client into Postgres (`report_kirim_rows`/`report_chiqim_rows`/`report_rows` views + `report_filtered_rows`/`report_query_page`/`report_totals` functions, `supabase/migrations/0026_report_server_side_query.sql`), removing the old `FETCH_CAP=500` silent-truncation point entirely. `effective_qty` (§2.16) now has two implementations by necessity — TypeScript for Ombor's live screens, SQL for this engine — guarded by a new parity test (`report-effective-qty-parity.spec.ts`) rather than left to drift. Export fetches the full filtered set in chunks, never just the visible page. See DECISIONS.md "Reporting engine: server-side query." |
| 1.15 | 2026-07-20 | 🔒 **Hisobot results view reworked for desktop (§3.2.4, Step 10 prompt 2) — corrects v1.14's phone-density call, same day.** Menejer and Rahbar use this screen on PCs — phones are Ombor/Qorovul/Laborator's surface, not this one. Results now render as a real `<table>` (the first in this codebase; every other screen stays card-based, unchanged) — all primary columns visible, quantity right-aligned and comparable down the column, many rows scannable together. Row expand unchanged in behaviour (same detail components), just triggered from a table row instead of a card header. Filter bar (§3.2.2) now expanded by default (the collapse toggle stays, for a narrower window). Horizontal scroll on narrow viewports via a fixed minimum table width, never at the cost of the desktop layout. New: `src/pages/reports/ReportResultsTable.tsx`, `src/pages/reports/ReportTableRow.tsx` (replaces `ReportRowCard.tsx`, deleted). Also this prompt: confirmed the `useEffectiveQty` refresh-race guard (v1.13) is still exactly as shipped — the general out-of-order-refresh fix is in place, but the specific "-1,200kg" symptom's root cause (a second rapid form submission on `IntakeAcceptForm` not firing) was never fixed, only diagnosed; reproduced again live via the full e2e suite this session, unchanged from the 2026-07-19 DECISIONS.md entry. |
| 1.14 | 2026-07-20 | 🔒 **Reporting query engine, results table, totals strip, and filter bar applied and built (§3.2.1-3.2.4, Step 10 prompt 1).** Replaces this document's own prior §3.2 "Tarix" text — that functionality IS this section now. One shared engine: direction/date/client/type/kalibr/seriya/Barcode #2/plate/driver/wash-cycle/lab-verdict/status filters, all combinable; every quantity reads `effective_qty` (§2.16.1), never `actual_qty`/`declared_qty`; date basis follows direction (KIRIM → gate stage 1 / order date, CHIQIM → gate stage 2) and is printed on screen and in exports; a voided Barcode #2 always returns its record (voided cycle + successor barcode(s), never "not found"); filtered-totals strip (kg in/out/net) sticky while scrolling; Excel export via `exceljs` (not `xlsx`/SheetJS — unpatched npm advisory, see DECISIONS.md). **Row-granularity decision:** a KIRIM row is one `kirim_lines` entry, a CHIQIM row is one `finished_pallets` entry (pallet, not whole request) — needed for Barcode #2/wash-cycle/kalibr filters to be unambiguous. **Phone-density decision, inherited by every later saved view:** prioritised-fields-in-a-card + expand, matching every existing list in this app — no `<table>`, no horizontal scroll. Row expand is this row's own fields only, not the full serial passport (§3.2.5, still unbuilt). Mounted at `/menejer/hisobot` and `/rahbar/hisobotlar` (identical, read-only component). No schema change — reads existing tables only (§8). **This prompt applied §3.2.1-3.2.4 only** — §3.2.5 (serial passport), §3.2.6 (stock-on-hand), §3.2.7 (client balance report), §3.2.8 (yield), §3.2.9 (WIP), §3.2.10 (Rahbar aggregates) remain in `docs/SPEC-reporting-v1.10-revision.md`, not yet applied here (§7 item 13). |
| 1.13 | 2026-07-19 | 🔒 **Weight authority settled (§2.16, new — renumbered from the source revision's "§2.15," which collided with this document's existing §2.15 "Technical architecture"; see DECISIONS.md).** Three weights (declared / intake / gate net) permanently retained; gate net is the accounting truth. `effective_qty` derived per `kirim_line`, never stored: gate net for a single-line truck once gate stage 2 completes; the per-line intake figure for a multi-line truck always (gate net only feeds a truck-level reconciliation variance for these, never adopted as the line's own value, confirmed with the user before implementation); the intake figure, marked **provisional**, before gate stage 2. Amends §3.1 (KIRIM list shows `effective_qty`, provisional-then-final), §5.1 (gate-vs-declared variance is additional to, not a replacement for, the existing accept-time intake-vs-declared Kam chiqdi check), §5.3 (cycle-1 process loss/yield and §5.2's "available to send" cap read `effective_qty`, floored at 0 for display; cycle 2+ re-wash input unchanged). No schema change — implemented as `src/lib/weightAuthority.ts` + `src/lib/effectiveQty.ts`. **This prompt applied §2.16 and the §3.1/§5.1/§5.3 amendments only** — the unified §3.2 reporting layer (Tarix/Kuzatuv/client-report consolidation, serial passport, stock-on-hand, moisture-adjusted yield, WIP, Rahbar aggregates) from the same source revision is pasted verbatim at `docs/SPEC-reporting-v1.10-revision.md` for a future prompt, not yet applied here (§7 item 13). |
| 1.12 | 2026-07-18 | 🔒 **Laborator redesigned; v1.5 model replaced (§5.5, wholesale).** CHIQIM check now triggers on Moyka output rather than dispatch and carries a **verdict** (`O'tdi` / `Qayta yuvish`) that **hard-gates dispatch availability**; KIRIM check is explicitly descriptive-only, no verdict. **Client quality targets added to `KIRIM_LINES`** (§3.1), per product line, inherited down the serial lineage; a blank SO₂ target means natural product and **removes the sulfur field entirely** from the lab form and from overdue alerts (§5.5.1). **Lab flags, Ombor voids** — the verdict mutates no stored state; re-wash material is flagged red for Ombor, who voids the barcodes and re-sends via §5.2 (§5.5.4–5). Lab history consolidated into **one filtered section** (§5.5.6). Client report gains target-vs-actual (§3.5-A). Amends §1.1, §2.13, §3.1, §5.2, §5.3, §7, §8. **Open: re-send quantity basis (§5.5.5)** — do not build §5.5.5 until resolved. This prompt (Step 8 prompt 1) applied the spec text + `kirim_lines` target columns + the Menejer form fields only; no lab screens, no `lab_results` reshape, no hard gate on `useAvailableFinishedStock` yet. |
| 1.11 | 2026-07-17 | 🔒 **New §5 named invariant: "CHIQIM per-role finalization"** — §5.4 has no single shared "finished" status; Ombor (scan+`Yuklashni yakunlash`), Qorovul (second/loaded weighing), and Menejer (reads Qorovul's signal) each finalize independently and see their own Window 2 on their own action. `chiqim_requests.status` must not be overloaded to mean "Ombor done loading." Written ahead of Step 7 prompt 1 (Menejer CHIQIM request creation). |
| 1.10 | 2026-07-17 | 🔒 **New §5 named invariant: "Placement windows vs. acceptance windows"** — every §5 second-window is either purely derived (pattern 1, no human action changes stored state) or displayed-but-gated (pattern 2, arithmetic controls eligibility but stored state only changes via an explicit click). §5.1 storage-intake and §5.3 finished-goods intake are pattern (2); no future section, including Step 7 CHIQIM, may auto-accept a serial into the next stage without an explicit acceptance action. See DECISIONS.md same title. |
| 1.9 | 2026-07-14 | 🔒 **Serial is now per type-line, not per truck.** Serial moves from `KIRIM_ORDERS` to `KIRIM_LINES`; `next_serial()` called once per type row. A serial is therefore **always single-type**, which retroactively makes three existing rules *correct* rather than approximate: Barcode #1 per type-pile (§3.1/§5.1), Laborator's "one sample → whole parent serial" (§5.5), and `STORAGE_STOCK` keyed by serial (§8). 🔒 **Qorovul unchanged** — still one truck, two weighings, one truck-level net; multi-serial trips are display-only. 🔒 **No pro-rata apportionment**: the gate net is reconciled against the manager's declared *Jami avto* (truck total vs truck total), and **per-type actual weights are entered by Storage at §5.1**, where the piles are physically separated. Every weight in the system is measured, never derived. `GATE_WEIGHINGS.ref` re-pointed from serial → **order_id/request_id** (a weighing belongs to a truck-trip). §5.3 receipt-form `Tur` field kept but made **read-only**, auto-filled from the parent serial. |
| 1.0 | 2026-07-10 | Consolidated chat-1 decisions. |
| 1.1 | 2026-07-10 | Manager tabbed; multi-product KIRIM; Kuzatuv + Seriya pasporti; Konditirskiy; Client report; global Uz/Ru toggle; image compression. Qorovul redesign in review. |
| 1.2 | 2026-07-10 | **Qorovul LOCKED** (tabbed two-window; stage-1 & stage-2 both require weight-reading photo). **Barcode #2 = physical pallet, now carries type**. **Storage §3** — receipt per pallet, type + calibre + weight. **Storage §4** — no serial on request, live total, Yuklashni yakunlash always enabled, manifest by serial, gate reconciliation. All four storage sections designed. |
| 1.8 | 2026-07-10 | **§2.15 Technical architecture locked:** Netlify + Supabase + React PWA. **Serial generation moved into the DATABASE** (Postgres `next_serial()`, Tashkent TZ; offline orders get their serial on sync). **RLS enforced from day one on every table** — rahbar has no operational write policy at all; `notes` has no UPDATE/DELETE policy, making append-only real. **Store events, derive numbers** (views, not mutable balances) — also the foundation for a future finance module. Never DELETE, only void. Net weight is a generated column. |
| 1.7 | 2026-07-10 | Terminology: **"Ostona" → "Limit"** throughout (exception-rule thresholds). |
| 1.6 | 2026-07-10 | **Rahbar (business owner) designed** (§6): Oversight / Exceptions / Reports / Administration; **read-only on all operations** (§2.12), write only in Administration; inherits the manager's full reporting toolkit; multiple accounts, no personal names. **Renamed** business owner Egasi → **Rahbar** (Egasi/Buyurtmachi now means the *client* only, §2.10). **NEW global rule: filtered-totals bar on every filtered list + in Excel exports** (§2.11 — gap found: Tarix had filters/export but no totals). **Re-wash loop** (§2.13): whole-serial re-send to Moyka, Konditirskiy stays, first wash **VOIDED not deleted** (audit survives; voided barcodes fail loudly on scan), KN additive across washes, final loss recalculated at second Tugallash. **Configurable thresholds** (§2.14): sulfur-overdue, Moyka-idle, abnormal-loss. **Sulfur-overdue alerts** added to manager + Rahbar. **Users & roles management** given a home (§6.4). |
| 1.5 | 2026-07-10 | **Laborator CHIQIM = identical to KIRIM** in form design and workflow (moisture tested first, sulfur added later; same three-window shape and two-step flow). Subject differs only: raw intake vs finished goods pre-dispatch. Laborator now LOCKED. Egasi/owner role is the sole remaining open item. |
| 1.4 | 2026-07-10 | **Laborator role designed** (§5.5): tabbed KIRIM/CHIQIM; sample one pallet → result applies to whole parent serial (all calibres inherit); two-step moisture-then-sulfur flow with amber pending list; SO₂ in mg/kg with "Sulfatlanmagan (naturel)" option; CHIQIM pre-dispatch quality check. **Resolved:** KIRIM status flips at Yakunlandi (#3); Buyurtmachi always a dropdown from OWNERS (#5); sulfur unit mg/kg entered by Laborator (#6). Only the Egasi/owner role remains open. |
| 1.3 | 2026-07-10 | **Partial-pallet design REVERTED** (rejected as too much floor hassle). Pallets are now **atomic — loaded whole or not at all**; no weight editing, no splitting, no `…-R` remainder stickers. Instead: **soft warning** on §4 when the scanned total misses the target (never blocks; shortfall noted), and a **whole-pallet soft warning on the manager's CHIQIM form** (§3.1) so dispatch discipline is enforced at order time via client communication, not on the loading floor. |
