# BATU EXPORT — Ombor & Logistika App
## Master Design Specification

**Version:** 1.9
**Date:** 14 July 2026
**Status:** Manager — LOCKED · Client report — LOCKED · Qorovul — LOCKED · Storage Manager §1–§5 — LOCKED · Laborator — LOCKED · Rahbar (business owner) — DESIGNED

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
| Manager | Menejer | KIRIM orders & CHIQIM requests; Tarix log; **Kuzatuv** traceability; client reports; product settings |
| Gate guard | Qorovul | Two-stage truck weighing on arrival & departure |
| Storage manager | Ombor menejeri | 4 sections: raw intake → send to wash → finished intake → dispatch |
| Business owner | **Rahbar** | 🔒 Oversight / Exceptions / Reports / Administration (§6). **Read-only on all operations**, write rights on admin. Multiple Rahbar accounts supported. See §2.10 naming |
| Lab | Laborator | 🔒 Own window (§5.5): KIRIM & CHIQIM, identical workflow — namligi then SO₂; sample one pallet → applies to whole parent serial |

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

### 2.13 Re-wash loop (Qayta yuvish) 🔒 (NEW — rare but supported)
A serial whose lab result is **out of spec** (e.g. SO₂ too high) can be sent back through Moyka.
- **Trigger:** three-dot on the serial → **"Moykaga qayta yuborish"**. Confirmation required.
- **Scope: the WHOLE serial.** All of that serial's finished pallets return to Moyka — **except Konditirskiy, which stays in storage.**
- 🔒 **VOID, never delete.** The first wash's finished receipts, their Barcode #2s and its recorded yield-loss are marked **`bekor qilindi` (voided)**: they stop counting toward every live total (finished qty → 0, old loss cleared, barcodes dead). Operationally a clean slate — but the record survives in the audit log, and the **serial passport shows `1-yuvish (bekor qilindi) → 2-yuvish`**.
- 🔒 **Voided barcodes must fail loudly if scanned** (e.g. at dispatch): *"bekor qilindi — qayta yuvilgan"*. A stale sticker is still physically on the pallet, so a silent "unknown code" is not acceptable.
- **Return path:** the voided weight flows back into `Moykaga yuborilgan`; the serial re-enters the **existing §5.2 → §5.3 flow** unchanged. No new maths.
- **Second output:** new receipts, **new system-generated Barcode #2s**, printed fresh.
- 🔒 **Konditirskiy is additive:** any new KN from the second wash is **added to the existing KN quantity**; its new barcode is **stuck next to the old KN barcode** (both remain valid on that pallet).
- 🔒 **Yield-loss is recalculated at the second `Tugallash` and is FINAL** — whether higher or lower than the first.
- Client-visible in the passport/report (the re-wash explains any yield change).

### 2.14 Configurable thresholds 🔒 (NEW)
Exception rules are **settings, not hardcoded** — editable in Administration (§6.4):
- **Sera kechikdi** — sulfur result overdue after *N* days (default 2).
- **Moykada turib qoldi** — serial idle in Moyka longer than *N* days.
- **G'ayrioddiy yo'qotish** — yield-loss above *X* %.

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

## 3. Role: MANAGER (Menejer) 🔒

### 3.1 Operational window — TABBED 🔒
Segmented **`KIRIM | CHIQIM`** tabs switch the screen. Each = create button + live status list.
- **KIRIM form:** Sana · Moshina raqami · Haydovchi ismi · Buyurtmachi (OWNERS) · **repeatable Tur + Miqdori rows** (multi-product; one truck, several types; "+ Tur qo'shish"; **Jami avto**; **no calibre** — raw isn't graded yet) · 🔒 **auto Seriya per type row** (`next_serial()` called once per line; N types → N serials, all displayed back on save; each type-pile → own Barcode #1) · Hujjat rasmi (compressed). Status **Kutilmoqda → Qabul qilindi** (🔒 flips at gate **Yakunlandi**, i.e. when net weight is known — not at stage-1 arrival).
  - 🔒 **Declared vs actual.** The quantities on this form are the manager's **declared** figures (what the client says is coming). They are never overwritten. The **actual** per-type weight is entered later by the Storage Manager (§5.1). The gap between declared and actual is what "Kam chiqdi" means.
- **CHIQIM form:** Sana · Moshina · Haydovchi · Buyurtmachi · **repeatable Tur + Kalibr + Miqdori rows** (calibre set incl. Konditirskiy) · Jami avto. **No serial, no doc photo.** Status **Kutilmoqda → Olib ketildi**.
  - 🔒 **Whole-pallet soft warning:** since pallets are atomic (§5.4), the form checks each requested quantity against available whole pallets. If it doesn't map cleanly, it **soft-warns and suggests the nearest workable figures** so the manager confirms the exact number with the client **before the truck is sent**. **Never blocks** — the manager can save anyway and handle it. This is where dispatch discipline is enforced, keeping partial loads off the floor.

### 3.2 Tarix — operatsiyalar jurnali 🔒
Chronological event log. Excel export of filtered view; date presets; combinable filters; Hammasi/Kirim/Chiqim sub-tabs; footer → product settings.
- 🔒 **Filtered totals bar at the bottom** (§2.11) — row count + kg totals reflecting the current filter; included in the Excel export.
- 🔒 **"Sera kechikdi" (sulfur overdue) alerts** appear on the manager's dashboard as well as the Rahbar's (§6.2).

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
- **A — Kelgan seriyalar va sifat:** per serial — kelgan sana, tur, brutto/tara/netto, **namligi %**, **SO₂ mg/kg** (natural = "Yo'q"). **Document is an attached photo, no typed number.**
- **B — Tayyor mahsulot:** per serial, calibre breakdown incl. Konditirskiy, jami, xom netto, yo'qotish.
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
| §5.2 Moyka | = §5.1's Window 2 set, "Yuborish" action | unreceived sent material (serial-level) |
| §5.3 Tayyor | = §5.2's Window 2 set | finalized |

A serial legitimately appears in **both windows of two adjacent sections at once** — e.g. mid partial-send it has raw remainder left (§5.1 W2 / §5.2 W1) **and** some material already in Moyka (§5.2 W2 / §5.3 W1), simultaneously; an early-life serial can satisfy all three at once and so appear in **all four windows together** (§5.1 W2, §5.2 W1, §5.2 W2, §5.3 W1). That's the pattern working as designed, not a bug. Implementation-wise this means the same query/hook backs both windows across a boundary (`hasRawRemainder`/`isProcessing` in `src/lib/stageMembership.ts`; `useMoykaOutput` consumed directly by both §5.2's Window 2 and §5.3's Window 1) — never two copies of the same filter. 🔒 **§5.2 W2 / §5.3 W1 is independent of `wash_cycles.status`** (updated 2026-07-16, see DECISIONS.md "Serial-level in-process visibility") — a serial can be in-process here **and** already show in §5.3's Tugallangan (Window 2, finalized) at once, if more was sent after an earlier cycle closed. Graduation to Tugallangan itself is untouched — still `wash_cycles.status='final'` — this only concerns whether a serial *also* still shows as in-process.

### 5.1 Skladga KIRIM 🟡
Visible **immediately on manager KIRIM submit** (Kutilmoqda), read-only, so storage can see what's coming — but only **acceptable once gate stage 1 exists** (loaded weight recorded; does **not** wait for stage 2 / net weight, updated 2026-07-15, see DECISIONS.md "Storage §1 intake"). Showing the trip's serials (one per type, §2.1). 🔒 **Storage enters the actual weight per serial** on "Qabul qilish" — this is the measured per-type figure, entered by the person who physically separates the piles. Storage adds pile photo + optional komment; **namligi + oltingugurt** are entered by the **Laborator** (§5.5), not here; prints **Barcode #1 per serial** → Skladda turibdi.
- 🔒 **One reconciliation only, against the declared figure** (updated 2026-07-15 — see DECISIONS.md "Storage §1 intake"): each serial's entered weight against the manager's **declared qty** (§3.1) — a shortfall here is the red **"Kam chiqdi"** + cross-role note. ~~The trip-level "sum of actuals vs gate net" reconciliation described in earlier drafts of this section was dropped~~ — storage's per-type entries sum to the gate total by definition, so counter-checking them adds no information; the gate's figures remain visible on demand (the full-story detail view) but are not something storage reconciles against here.
- Two-window list; ⋯ full-story detail (manager + gate + storage figures) per received serial. `File: BATU (skladga-kirim mockup)`.
- 🔒 **Window 2 membership is DERIVED, not the stored `storage_intake.status`** (fixed 2026-07-16 — see DECISIONS.md "Section mirroring / derived stage membership"). `status` defaults to `skladda_turibdi` at accept time and is **never updated afterward** (nothing in the app issues an `UPDATE` on it) — using it for placement made every accepted serial appear stuck "in storage" forever, even long after all its raw material had moved to Moyka. Window 2 now shows a confirmed serial only while it still has **raw remainder > 0** (`actual_qty − Σ moyka_sends.qty_kg`) — **section mirroring**: the identical set §5.2's Window 1 already computes, reused via the same query rather than re-derived. Once fully sent, the serial leaves this window entirely. The row's stale status word was replaced with the same derived remainder figure ("Qoldiq"). `storage_intake.status` itself is untouched — no migration, still defaults to `skladda_turibdi`, simply no longer read for placement.
- 🔒 **Declared is always visible next to actual.** The Qabul qilish form lists one row per serial on the trip, each showing: Seriya · Tur · **Buyurtma (kutilgan, kg)** — the manager's declared_qty, read-only — and **Aniq (kg)** — the storage manager's measured input. He confirms against a number he can see, while the pile is in front of him.
- 🔒 **Live variance per row.** As he types the actual, the row shows the difference against declared (kg and %). A negative variance beyond the configured limit (§2.14) flags red **"Kam chiqdi"** on save. Never blocks — he can save a shortfall; it becomes a note for the manager (§5.1).
- The declared figure is **never editable here** (§3.1 — declared is the manager's record and is never overwritten). Storage records what he measured; the gap between the two is the finding, not an error to be corrected away.

### 5.2 Moykaga Chiqarish 🟡 (updated 2026-07-16 — see DECISIONS.md "Section mirroring / derived stage membership", "Serial-level in-process visibility")
Send raw to production; **partial sends** accumulate; no new barcode (#1 travels). **Window 1 ("Yuborish uchun")** is the identical set as §5.1's Window 2 (confirmed, raw remainder > 0 — section mirroring); send form with live "qoladi", ⋯ per-send history, Qaydlar qo'shish all live here, unchanged. ~~Window 2 was "sent, not yet finalized" (`sent > 0 AND wash_cycles.status ≠ 'final'`)~~ 🔒 **Window 2 is now unreceived sent material, SERIAL-LEVEL** — `total_sent − total_received > 0`, where both totals sum across the whole serial regardless of `wash_cycle` number, and `wash_cycles.status` is not read at all for this check. The earlier "not yet finalized" reading had a real bug: a serial with an already-`final` cycle 1 that later had *more* raw material sent (no re-wash/multi-cycle numbering exists yet, §2.13 — everything still writes `wash_cycle=1`) vanished from this window entirely, hiding real unreceived material. Window 2 is the identical set §5.3 Tayyor's Window 1 already computes (section mirroring again: `useMoykaOutput` is consumed directly here, not reimplemented). A partially-sent serial shows in **both** windows at once — still has raw remainder to send (Window 1) **and** already has unreceived material in Moyka (Window 2) — expected, not a bug; the same serial can *also* simultaneously show in §5.3's Tugallangan if an earlier cycle already finalized. Window 2 is read-only (no send action, no ⋯ expand): managing what happens to a serial once it's in Moyka is §5.3's job, this is just visibility that it's there.

### 5.3 Tayyor Mahsulot / Skladga KIRIM 🟡 (updated 2026-07-16 — see DECISIONS.md "Tayyor Mahsulot completion", "Tugallangan window")
Serials in Moyka awaiting output. `+ Qabul qilish` → **daily receipt form: one pallet per save** — **Tur** (🔒 read-only, auto-filled from the parent serial — a serial is single-type by construction (§2.1); shown as a floor-level confirmation that the right pile is being stickered, never editable) + **Kalibr** (incl. Konditirskiy) + **Og'irlik** → auto-prints **Barcode #2** (`PLT-<serial>-<calibre>`, `…-KN` for Konditirskiy) to stick. ~~`Tugallash` → summary of all receipts + running totals, double-confirm, locks final yield-loss, files to history.~~ 🔒 **The form closes on every submit — no auto-reopen.** A new entry needs an explicit **"+ Yana qo'shish"** click (the same button, relabeled once at least one pallet exists); the last pallet's Barcode #2 stays visible/printable after the form closes. Per-serial totals: **Yuborilgan / Qabul qilingan / Jarayonda** (neutral, not "loss" until finished; **floored at 0 — never negative**).
- 🔒 **No fixed tolerance.** The moment Qabul qilingan reaches or exceeds Yuborilgan, that same submit **auto-completes the cycle**: it locks the final yield-loss into `wash_cycles` (no confirmation dialog — nothing is ambiguous once the sent amount is fully accounted for) and the serial leaves the active list (updated 2026-07-16 — precisely, this window's membership is `total_sent > total_received`, so it leaves **as of that moment**; if §5.2 later sends this serial more raw material, it correctly reappears here even though this cycle already finalized — see DECISIONS.md "Serial-level in-process visibility"). If Qabul qilingan **overshoots** Yuborilgan, the excess shows as a non-blocking **`Ortiqcha: +N kg`** next to Jarayonda (same display philosophy as **Kam chiqdi**, §5.1) instead of a negative Jarayonda, and the locked yield-loss itself **floors at 0%** (an overage is never a negative "loss"). Manual `Tugallash` (double-confirm, unchanged) remains available to close a serial out **early** — for the case where Qabul qilingan will genuinely never reach Yuborilgan, accepting the shortfall as the final loss. Once a serial auto-completes, manual Tugallash is no longer reachable for it (it has already left the active list).
- 🔒 **Window 2 — Tugallangan.** A serial whose cycle 1 has a `final` `wash_cycles` row (auto-completed or manually Tugallash'd) files here — matching the two-window (Faol/Yakunlangan-style) pattern already used at §5.1/§5.2/gate. Row: **Seriya · Buyurtmachi · Tur · "Yuborilgan X → tayyor Y kg"** and a badge — the locked loss % (red, e.g. `-18.2%`) or, if the serial overshot, **`Ortiqcha: +N kg`** in the same non-alarming Ortiqcha styling (never both — an overage always shows Ortiqcha, never a negative-looking loss reading). ⋯ expand reuses the Window 1 pallet list (barcode2 · kalibr · og'irlik, each reprintable).
- 🔒 **Re-wash (§2.13):** three-dot on a serial → **"Moykaga qayta yuborish"** (confirm). Voids that serial's finished receipts + Barcode #2s + loss figure (`bekor qilindi`), returns everything **except Konditirskiy** to Moyka, and the serial re-enters the §5.2 → §5.3 flow. New barcodes on the second output; KN is additive; final loss recalculated at the second Tugallash (auto or manual, per the rule above).
- 🔒 **Moyka idle flag:** a serial sitting in Moyka beyond the configured threshold (§2.14) is flagged here **and** on the Rahbar's exceptions list (§6.2). `File: BATU-Storage-S3-Tayyor-Mahsulot-v1.pdf`.

### 5.4 Skladdan CHIQIM 🟡 (updated)
Triggered by CHIQIM request + gate stage-1 (empty truck on-site).
- **Dashboard Window 1:** requests ready to load. 🔒 **No serial on the request** — shows only the manager's details (buyurtmachi, date, truck, driver) + **target breakdown** (type+calibre). Window 2: loaded/handed-off trucks.
- **Scan-to-load:** target lines with **progress bars**; each **Skanerlash** reads a Barcode #2 pallet and **auto-adds its full known weight** (no typing) to the matching **type+calibre** line; wrong scan removable (✕). Pallets may come from **multiple serials** (many-to-many).
- 🔒 **Whole pallets only.** A pallet is **atomic** — loaded entirely or not at all. **No weight editing, no splitting, no remainder re-stickering.** (An earlier partial-pallet design was considered and explicitly **rejected** as too much floor hassle.)
- 🔒 **`Yuklashni yakunlash` is always enabled**; the total updates live. If the scanned total doesn't match the target (because no whole pallet fits the remainder), a **soft warning** appears — it never blocks. The shortfall is recorded as a note on the dispatch for the manager to settle with the client.
- **Manifest + handoff:** scanned list grouped **by serial** (traceability); each pallet **deducted from its serial's stock**; `Qorovulga topshirish` → gate stage-2 (Гружёный). **Gate net reconciles against manifest total** = the closing safety check.
- 🔒 **Dispatch discipline lives on the order form, not the floor** — see §3.1. `File: BATU-Storage-S4-Skladdan-CHIQIM-v2.pdf`.

### 5.5 LABORATOR (separate role) 🔒 (NEW)
Own window, **same shape as the gate**: tabs `KIRIM | CHIQIM`, counters, then lists. Language toggle. `File: BATU-Laborator-Screens-v1.pdf` (KIRIM screens shown; CHIQIM is identical in design and workflow).

🔒 **KIRIM and CHIQIM are identical in form design and workflow.** Both test **namligi (moisture) first**, then **oltingugurt (SO₂) added later** (~1-day wait). Same three-window shape, same two-step flow, same forms. The only difference is *what* is sampled: raw intake on KIRIM, finished goods before dispatch on CHIQIM.

**Shared workflow (both tabs):**
- **Window 1 — Tahlil kutilmoqda:** items awaiting sampling → **"Tahlil"**.
- 🔒 **Sample ONE pallet → result applies to the WHOLE parent serial.** Every calibre under that serial (K4/K6/K8/Konditirskiy) **inherits** its namligi + sera. No per-calibre testing.
- **Tahlil form:** pre-filled details · sampled pallet (dropdown) · sana · **Namligi %** · **Oltingugurt (SO₂)** left blank · optional sample photo. Save → moves to Window 2.
- **Window 2 — Sera kutilmoqda (amber):** moisture in, sulfur pending → **"Sera kiritish"** → single-field form: **SO₂ in mg/kg**, or dropdown **"Sulfatlanmagan (naturel)"** (this is what makes the client report print "Yo'q · naturel"). On save → analysis complete.
- **Window 3 — Yakunlangan:** completed, showing both values.

**KIRIM specifics:** subject = raw serials (Barcode #1) that reached storage. Feeds **Section A of the client report** and the serial passport.
**CHIQIM specifics:** subject = finished goods on a dispatch request, sampled before it ships. Results attach to the dispatch, travel with it, and can be shown to the client.

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
2. ~~Laborator window~~ — 🔒 **RESOLVED, designed** (§5.5).
3. ~~Manager KIRIM "Qabul qilindi" trigger~~ — 🔒 **RESOLVED: flips at `Yakunlandi`** (net weight known), not at gate stage-1.
4. ~~Weight-term language~~ — resolved by global toggle (§2.8).
5. ~~Buyurtmachi input~~ — 🔒 **RESOLVED: dropdown from OWNERS everywhere** (never free text). Prevents name drift ("GLOBAL EXPORT" vs "Global Export" vs "GLOBAL EKSPORT") silently fragmenting the per-client filter, the Mijoz bo'yicha lens, and the client report.
6. ~~Sulfur unit~~ — 🔒 **RESOLVED: mg/kg (SO₂)**, entered by the **Laborator**.
7. ~~Laborator CHIQIM scope~~ — 🔒 **RESOLVED: CHIQIM mirrors KIRIM exactly** — same form design and workflow (moisture first, sulfur added later). Subject is finished goods rather than raw intake.

---

## 8. Provisional data model
- **OWNERS** — id, name
- **MAHSULOT_TURLARI** — id, category, type_name, calibre_applies, calibre_set (incl. `Konditirskiy`)
- **KIRIM_ORDERS** — order_id (PK), sana, plate, driver, owner_id, doc_photo, declared_total, status — *delivery envelope; one truck-trip. No serial.*
- **KIRIM_LINES** — serial (PK, from `next_serial()`), order_id, type_id, declared_qty — *🔒 one line = one type = one serial. A serial is single-type by construction. `declared_qty` is the manager's figure and is never overwritten; the actual weight lives on STORAGE_STOCK.*
- **CHIQIM_REQUESTS** — id, sana, plate, driver, owner_id, status (no goods-serial) · **CHIQIM_LINES** — request_id, type_id, calibre, qty
- **GATE_WEIGHINGS** — id (PK), ref (🔒 `order_id` for KIRIM / `request_id` for CHIQIM — **a weighing belongs to a truck-trip, never to a serial**), direction, gruzheny, pustoy, net (generated), stage1_photo, stage1_scale_photo, stage2_photo, stage2_scale_photo, departure_doc_photo, status — *🔒 one weighing per trip. Net is the whole truck's, and is never split across the trip's serials (§4).*
- **STORAGE_STOCK** — serial (PK), actual_qty (🔒 **measured** — entered by Storage at §5.1), namligi, sulfur(pending), pile_photo, barcode1, sent_to_moyka_qty, available_qty (derived), status — *serial is single-type, so this row is inherently per-type. No compound key needed.*
- **MOYKA_SENDS** — serial, date, qty
- **FINISHED_PALLETS** — barcode2 (PK), parent_serial, type_id, calibre, weight, owner, wash_cycle (1,2…), status (in_stock / dispatched / **bekor_qilindi**) — *atomic; never split. Voided barcodes must fail loudly on scan (§2.13)*
- **DISPATCH_MANIFEST** — request_id, scanned barcode2[] (whole pallets only), shortfall_note
- **LAB_RESULTS** — id, scope (kirim/chiqim), ref (serial | dispatch_request_id), sampled_pallet, sample_date, moisture_pct, so2_mg_kg (nullable = pending), unsulfured_flag, sample_photo, status (moisture_in / complete)
- **NOTES** (append-only) — entity_ref, author, timestamp, text
- **AUDIT_LOG** — entity_ref, actor, timestamp, action, before, after
- **WASH_CYCLES** — serial, cycle_no, sent_qty, received_qty, loss_pct, status (active / voided / final) — *supports the re-wash loop (§2.13); Konditirskiy excluded from re-send and additive across cycles*
- **USERS** — id, name, role (rahbar/menejer/qorovul/ombor/laborator), active — *managed in §6.4*
- **SETTINGS_THRESHOLDS** — sulfur_overdue_days, moyka_idle_days, abnormal_loss_pct — *§2.14*
- **USER_PREFS** — user_id, language (uz/ru)

---

## 9. Changelog
| Version | Date | Change |
|---|---|---|
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
