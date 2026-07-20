# SPEC.md revision — Weight authority + unified reporting layer (v1.10)

**Supersedes:** §3.2 (Tarix), §3.4 (Kuzatuv), §3.5 (Mijoz hisoboti) — replaced by a single §3.2.
**Adds:** §2.15 (weight authority & effective quantity).
**Amends:** §5.1, §5.3, §3.1, §7, §8, §9.
**Reason:** three reporting screens were three default filters on one query. Consolidating them removes duplicate query logic. Separately, the accounting weight has been settled as the gate net figure, which requires an explicit invariant because it arrives *after* the intake step that currently records quantity.

---

## 2.15 WEIGHT AUTHORITY & EFFECTIVE QUANTITY 🔒 (NEW)

Three weights exist for the same material. **All three are permanently retained; none overwrites another.**

| Weight | Source | Meaning |
|---|---|---|
| **Declared** | Menejer, at order entry (`kirim_lines.declared_qty`) | What the client said they sent. Never modified by anyone, ever (existing rule, unchanged). |
| **Intake** | Ombor, at receipt (`storage_intake.actual_qty`) | Ombor's own figure. **Pre-filled with the declared quantity and usually accepted untouched** — on single-product trucks Ombor performs no independent measurement. Treat as a per-line split, **not** as a measurement. |
| **Gate net** | Qorovul, `gate_weighings` (loaded − empty) | 🔒 **The accounting truth.** This is the only figure produced by a calibrated scale and evidenced by two mandatory photos. |

### 2.15.1 Effective quantity — the derived figure everything reads

🔒 **`effective_qty` is derived, never stored**, computed per `kirim_line`:

- **Single-line truck (the norm):** `effective_qty = gate net`. The gate weighed exactly this material and nothing else.
- **Multi-line truck (rare):** `effective_qty = storage_intake.actual_qty` per line, because the gate produces one figure for the whole truck and cannot split it. Gate net remains the truck total; the sum of the lines is reconciled against it and any gap is shown as a **soft variance** (never blocks, per §3.1 philosophy).
- **Before gate stage 2 exists:** `effective_qty = storage_intake.actual_qty`, displayed as **provisional** (see §2.15.2).

🔒 **Every downstream calculation reads `effective_qty`, not intake or declared** — raw available to send to Moyka, process loss, yield %, client balances, all reports. One derived truth, all consumers — the same principle as availability (§5.5.3).

### 2.15.2 Sequencing: gate net arrives *after* intake 🔒

The KIRIM order of events is: gate weighs loaded → **Ombor receives, records intake, Barcode #1 issued** → truck unloads and departs → **gate weighs empty → net known**.

So the authoritative weight is established **after** Ombor and Menejer have already seen a quantity on screen. Therefore:

- Between intake and gate stage 2, the quantity displayed on Ombor's and Menejer's screens is **provisional**, visually marked (e.g. *"tarozi kutilmoqda"*).
- 🔒 **When gate stage 2 completes, the serial's effective quantity updates automatically on both screens** to the gate net figure. This is a derived recomputation, not a stored write — it changes no records, so it does not violate the no-silent-auto-transition invariant (§2.2). Nothing is accepted, finalized, or advanced; a displayed number simply becomes final.
- Where the gate net differs materially from the intake figure, both are shown with the variance — Menejer needs to see when a client's declaration was wrong, and that is a commercial conversation.
- **Lab checks are unaffected.** Laborator's KIRIM queue is keyed to intake existing, and quality is independent of quantity — a serial may be tested while its weight is still provisional.

⚠️ **Edge case to handle explicitly:** if material is sent to Moyka before gate stage 2 completes, the sent quantity was measured against a provisional figure. Flag rather than prevent — show the serial with a variance note if the gate net later lands materially different.

---

## 3.2 HISOBOT (Reporting) 🔒 — REPLACES §3.2 Tarix, §3.4 Kuzatuv, §3.5 Mijoz hisoboti

🔒 **One section, one query engine, several saved views.** Tarix, Kuzatuv and the client report were the same query with different default filters. They are consolidated. A lookup is a filter, not a screen.

Available to **Menejer** and **Rahbar**. Rahbar's is read-only and additionally exposes the aggregate views (§3.2.8).

### 3.2.1 The underlying identity everything reports against 🔒

```
RAW RECEIVED = CALIBRE OUTPUT + KONDITIRSKIY + PROCESS LOSS + STILL IN STORAGE
```

Every view is a slice of this. If a report does not reconcile to it, the report is wrong. All quantities use `effective_qty` (§2.15.1).

### 3.2.2 Filter bar — dimensions, all combinable

Direction (KIRIM / CHIQIM / both) · date range + presets · buyurtmachi · mahsulot turi · kalibr · seriya (Barcode #1) · **Barcode #2** · truck plate · driver · wash cycle (1 / 2 / any) · lab verdict (o'tdi / qayta yuvish / tekshirilmagan) · status (omborda / band qilingan / jo'natilgan / bekor qilingan).

🔒 **A voided Barcode #2 must remain findable.** Searching a dead sticker returns its record with an explicit result: *"bekor qilindi — qayta yuvilgan, sikl N, yangi barkod: X."* Never "not found" — staff scanning a real sticker and getting silence will stop trusting the system.

### 3.2.3 The date-filter rule 🔒

🔒 **The date filter always filters on the event matching the selected direction — never on wash date, never on lab date:**

- **KIRIM selected** → arrival date (gate stage 1 / order date)
- **CHIQIM selected** → dispatch date (gate stage 2 departure)
- **Both selected** → each row filters on its own governing event

The active date basis is **printed on screen and on every export** (*"sana asosi: kelish"* / *"jo'natish"*). Two people producing two different numbers from the same screen is how a reporting layer loses credibility, and an unlabelled date basis is the usual cause.

🔒 **One documented exception:** the client balance report (§3.2.7) computes its *middle* rows — "processed this period" — on **wash-completion date**, because processing is neither an arrival nor a dispatch. Opening/closing balances and the received/collected lines use arrival and dispatch as above. This is deliberate and must be labelled on the report; it is not an inconsistency to be "fixed."

### 3.2.4 Results table + totals strip

Rows are events (an arrival line, or a dispatch). Newest-first (universal sort). Columns adapt to direction.

🔒 **Filtered-totals strip** recalculates against the active filter — kg in, kg out, net — and is what makes this a report rather than a log. Applies to every view (§2.11).

Each row expands to its **serial passport** (§3.2.5). Excel export on every view, respecting the active filter, with the date basis and weight basis printed in the header.

### 3.2.5 Seriya pasporti — drill-down, not a separate screen 🔒

The expand target of any row. Full lifecycle of one parent serial:

- Order: client, declared qty, **client quality targets** (§3.1), truck, driver, date
- Gate in/out with net, both photos, actor, timestamps
- Intake: Ombor's figure, actor, timestamp, Barcode #1
- **Per wash cycle, repeated for cycles 1..N:** sent kg, returned calibre pallets (Barcode #2, calibre, kg, status incl. voided), Konditirskiy pallets (own barcodes, retained across cycles), process loss kg and %, lab result with target-vs-actual and verdict
- Dispatches: each CHIQIM this serial contributed to — request, truck, pallets, gate photos, actors, timestamps
- Current position: still in storage / collected, by calibre

🔒 **The passport reads the underlying records directly**, not through any role's filtered view. (Ombor's finished-goods screen shows only the active cycle — flagged in DECISIONS.md during Step 8. The passport must not inherit that limitation.)

### 3.2.6 Saved view — Ombor qoldig'i (stock on hand)

Current position, not history. Grouped by client → product → calibre:

- **Available** (lab-passed, unclaimed) / **claimed** by an open CHIQIM / **awaiting lab** / **flagged qayta yuvish** / **raw not yet washed**
- Konditirskiy shown separately per client (🔒 Konditirskiy belongs to the client and is held in their name — it is a collectible output, never a deduction)
- 🔒 **Ageing:** days held per batch, with a >90-day flag. Dried fruit degrades and clients forget material is here; both are avoidable with one column.

### 3.2.7 Saved view — Mijoz hisoboti (client report) 🔒

The external-facing document. One or two pages, must reconcile without explanation.

🔒 **Structure is opening balance → movements → closing balance.** Without opening/closing figures a client cannot tie one period to the next, and material lifecycles cross period boundaries routinely (arrive March, wash April, ship May).

```
MIJOZ: [client]                DAVR: [from] – [to]
MAHSULOT: [product]            OG'IRLIK ASOSI: darvoza tarozisi (net)

  Davr boshiga qoldiq (xom ashyo)                  X kg
+ Davrda qabul qilingan                            X kg
                                                  ──────
  Jami                                             X kg
- Davrda qayta ishlangan                           X kg
    kalibrlar                                      X kg
    Konditirskiy                                   X kg
    ishlov yo'qotishi                              X kg
                                                  ──────
  Davr oxiriga qoldiq (xom ashyo)                  X kg

  TAYYOR MAHSULOT
  Davr boshiga qoldiq                              X kg
+ Davrda ishlab chiqarilgan                        X kg
- Davrda olib ketilgan                             X kg
                                                  ──────
  Davr oxiriga qoldiq (saqlanmoqda)                X kg
```

**Section B — quality record**, one line per serial: intake moisture/SO₂, delivered moisture/SO₂, and 🔒 **the client's own target beside it**. Where no SO₂ target was set, print *"Talab yo'q · naturel"* (§5.5.1). This is the contract and the proof in one row.

🔒 **Not shown by default, but always one click away:** wash-cycle detail, staff names, truck plates and gate timings. A serial washed twice is an internal matter — the client contracted on total loss. But the moment there is a dispute they will ask for exactly the hidden layer, so it is **collapsed, never absent**.

PDF + Excel, Uz/Ru. 🔒 Weight basis and date basis printed in the header.

### 3.2.8 Saved view — Yo'qotish va unum (yield, incl. moisture-adjusted) 🔒

Per serial / product / client / period:

- Calibre mix: K4 / K6 / K8 / KN as % of output — the biggest-share question, and a real performance metric over time
- Process loss kg and %
- 🔒 **Moisture-adjusted (dry-matter) yield**, computed from the lab readings already captured:

```
Dry matter in  = effective_qty × (1 − intake moisture %)
Dry matter out = output kg      × (1 − delivered moisture %)
True loss      = (in − out) / in
```

Worked: 5 000 kg @ 18% → 4 100 kg dry. Out 4 500 kg @ 13% → 3 915 kg dry. Gross loss 10.0%; **true loss 4.5%**; 315 kg is water removed to meet the client's own 13% specification.

🔒 **Show both, never only one.** Gross governs the balance sheet (weights must tie to physical reality); dry-matter governs the quality conversation. Only computed where lab readings exist at both ends — otherwise show gross and state that plainly rather than estimating.

### 3.2.9 Saved view — Kutilayotgan ishlar (WIP / stuck)

The screen that stops items falling through cracks. Anything sitting beyond threshold (§2.14):

- Raw received, not yet sent to Moyka
- Sent to Moyka, not yet returned
- 🔒 **Awaiting lab test** — now a hard dispatch blocker (§5.5.3), so this is the highest-value row on the screen
- Moisture entered, SO₂ pending (excluding natural products — never overdue, §5.5.1)
- Flagged `qayta yuvish`, not yet re-sent
- Open CHIQIM requests not loaded / not departed
- Serials with provisional weight (gate stage 2 outstanding, §2.15.2)

### 3.2.10 Rahbar aggregates (read-only)

Trends by month: volume in/out, yield %, loss %, **re-wash rate %** (a rising re-wash rate is early warning on incoming raw quality or process control), calibre mix drift. Client ranking by volume. Capacity utilisation: kg processed per week against practical capacity — the number that decides whether another client can be taken on.

Exceptions only, never rows. 🔒 **No financials** — deliberately out of scope until inventory is trusted; volume exports cleanly into whatever pricing lives elsewhere.

---

## Amendments to other sections

### §3.1 Manager KIRIM/CHIQIM — AMEND
Quantity displayed against a serial is `effective_qty` (§2.15.1), marked **provisional** until gate stage 2 completes, then final. Declared quantity remains visible and permanently unmodified beside it.

### §5.1 Ombor Qabul — AMEND
`storage_intake.actual_qty` is pre-filled from the declared quantity and is 🔒 **not an independent measurement** — on single-product trucks Ombor takes no separate weight. It functions as a per-line split for multi-product trucks. It is never the accounting figure (§2.15). Variance reporting is computed **gate-vs-declared**, never intake-vs-declared, which would read ~0% everywhere and appear reassuring while measuring nothing.

### §5.3 Tayyor Mahsulot — AMEND
Process loss and yield are computed against `effective_qty` for cycle 1, and against the re-wash input weight for cycles 2+ (existing Step 8 behaviour, unchanged). Ombor's finished-goods view shows the active cycle only; the serial passport (§3.2.5) must read underlying records rather than this view.

### §7 Open questions — UPDATE
- **RESOLVED** — Konditirskiy ownership: belongs to the client, held in the client's name, reported as a collectible output.
- **RESOLVED** — contractual loss allowance: none exists; no allowance band in reports.
- **RESOLVED** — accounting weight basis: gate net (§2.15).
- **RESOLVED** — reporting consolidated into one §3.2; Kuzatuv and the serial passport are drill-downs, not screens.
- **NEW OPEN** — should the gate-net update (§2.15.2) notify Menejer when variance against declared exceeds a threshold, or only display it? Notification implies §2.14 threshold config.
- **CARRIED** — audit_log is populated for `lab_results` only; systemic retrofit still unscoped, and no UI reads it.

### §8 Data model — AMEND
- No new tables. `effective_qty` is 🔒 **derived, never stored** — a view or hook, read identically by every consumer.
- Konditirskiy ownership requires no field: pallet lineage already carries the client.
- Reporting reads existing tables only; no reporting-specific persistence.

### §9 Changelog — add
| 1.10 | 2026-07-19 | **Weight authority settled and reporting consolidated.** New §2.15: gate net is the accounting truth; `storage_intake.actual_qty` is a per-line split, not a measurement; `effective_qty` derived and read by all consumers; gate net arrives after intake, so displayed quantities are **provisional until gate stage 2**, then update automatically (derived recomputation, no stored write). §3.2 **replaces §3.2/§3.4/§3.5** — one query engine, saved views: results+totals, serial passport (drill-down), stock on hand with ageing, client balance report (opening→movements→closing, wash-date exception documented), yield incl. **moisture-adjusted dry-matter loss**, WIP/stuck, Rahbar aggregates. Konditirskiy confirmed client-owned; no loss allowance; date filter follows direction and is printed on every export. |
