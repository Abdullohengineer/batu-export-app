# BATU EXPORT — Phase 0 Kickoff
**Companion to:** `SPEC.md` (v1.7) and `BUILD-LAUNCH-PLAN.md`
**Goal of Phase 0:** repo + database + auth + deploy working, before a single feature is built.

---

## PART A — How to think about Supabase (read this first)

Supabase is **just Postgres** with auth, storage, and an auto-generated API bolted on. That framing matters: every good decision you make is really a *database design* decision, and Postgres will still be there in 10 years.

### The four principles that make this "fundamentally strong"

**1. The database is the source of truth, not the app.**
Rules that must never be broken (serial uniqueness, who can write what, running totals) belong **in the database**, not in React. Reason: you will eventually have a phone app, a desktop view, an admin script, maybe a finance module — if the rule lives in React, each new client can break it. If it lives in Postgres, nothing can.

**2. Store events, derive numbers.**
Do **not** store `available_qty` as a number you keep updating — that's how inventory systems drift and end up lying to you. Store the **events** (received 8,410 · sent to Moyka 3,000 · received back 2,400 · dispatched 800) and **derive** the balance with a view. If a number ever looks wrong, you can prove where it came from. This is also *exactly* what makes a finance module possible later — money follows the same events.

**3. Separate "what happened" from "how we look at it."**
Tables = facts (immutable-ish). **Views** = presentation. Your Kuzatuv screen, serial passport, client report, and (later) finance module are all just **different views over the same events**. When you want a new way to see the data, you add a view — you don't touch the tables. This is the answer to your "changes on data view" worry.

**4. Never delete. Void.**
Already locked for re-wash (§2.13), but make it a house rule everywhere: status flags, not `DELETE`. Your audit trail is your defence in a client dispute.

### How this makes a future finance module easy
Finance = money attached to events you already record. A `services` table (price per kg processed, per kg stored, per truck loaded) plus a view joining it to `moyka_sends` / `finished_receipts` / `dispatches` **generates invoices with no changes to the inventory tables at all.** That only works if you followed principle #2. If you'd stored only running balances, you'd have to rebuild everything. This is the single most important architectural choice in this document.

---

## PART B — The SQL (Phase 0)

Put these in `/supabase/migrations/`, numbered. Never click tables together in the dashboard UI — you'll lose track of what's where.

### B1. Master data + profiles

```sql
-- roles
create type user_role as enum ('rahbar','menejer','qorovul','ombor','laborator');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  role user_role not null,
  active boolean not null default true,
  language text not null default 'uz',   -- 'uz' | 'ru'  (spec §2.8)
  created_at timestamptz default now()
);

-- clients (goods owners). Spec §2.4 — ALWAYS a dropdown, never free text
create table owners (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);

-- products. Spec §2.3 — never hardcode types
create table product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,              -- O'rik, Mayiz, Prune
  calibre_applies boolean not null default true,
  active boolean not null default true
);

create table product_types (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references product_categories,
  name text not null,                     -- Subxon, Isfara, Qand...
  active boolean not null default true,
  unique (category_id, name)
);

create table calibres (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references product_categories,
  code text not null,                     -- '04','06','08','KN'
  label text not null,                    -- 'Kalibr 4' ... 'Konditirskiy'
  is_numberless boolean not null default false,  -- true for Konditirskiy
  sort_order int not null default 0,
  unique (category_id, code)
);

-- configurable exception limits. Spec §2.14
create table settings_limits (
  key text primary key,
  value numeric not null
);
insert into settings_limits (key, value) values
  ('sulfur_overdue_days', 2),
  ('moyka_idle_days', 7),
  ('abnormal_loss_pct', 22);
```

### B2. Serial generation — IN THE DATABASE (spec §2.1)

This is the one you asked for. Two phones can never mint the same serial, because Postgres serialises it.

```sql
create table serial_counter (
  day date primary key,
  last_no int not null default 0
);

create or replace function next_serial() returns text
language plpgsql
as $$
declare
  n int;
  d date := (now() at time zone 'Asia/Tashkent')::date;
begin
  insert into serial_counter (day, last_no) values (d, 1)
  on conflict (day) do update set last_no = serial_counter.last_no + 1
  returning last_no into n;

  -- DDMMYY-NNN  e.g. 120826-003
  return to_char(d,'DDMMYY') || '-' || lpad(n::text, 3, '0');
end;
$$;
```

Note the **Tashkent timezone** — otherwise your "daily reset" happens at the wrong hour.
**Offline consequence:** an offline-created order gets its serial only on sync. Show `seriya: kutilmoqda` until then.

### B3. Operational tables (events, not balances)

```sql
create type direction as enum ('kirim','chiqim');
create type order_status as enum ('kutilmoqda','qabul_qilindi','olib_ketildi','yakunlandi');

create table kirim_orders (
  serial text primary key default next_serial(),
  order_date date not null,
  plate text not null,
  driver text not null,
  owner_id uuid not null references owners,
  doc_photo text,                      -- storage path
  status order_status not null default 'kutilmoqda',
  created_by uuid references profiles,
  created_at timestamptz default now()
);

create table kirim_lines (              -- multi-product: one truck, several types
  id uuid primary key default gen_random_uuid(),
  serial text not null references kirim_orders on delete cascade,
  type_id uuid not null references product_types,
  qty_kg numeric not null check (qty_kg > 0)
);

create table chiqim_requests (          -- NO goods-serial (spec §5.4)
  id uuid primary key default gen_random_uuid(),
  request_date date not null,
  plate text not null,
  driver text not null,
  owner_id uuid not null references owners,
  status order_status not null default 'kutilmoqda',
  created_by uuid references profiles,
  created_at timestamptz default now()
);

create table chiqim_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references chiqim_requests on delete cascade,
  type_id uuid not null references product_types,
  calibre_id uuid not null references calibres,
  qty_kg numeric not null check (qty_kg > 0)
);

-- gate: both stages, both scale photos (spec §4)
create table gate_weighings (
  id uuid primary key default gen_random_uuid(),
  dir direction not null,
  serial text references kirim_orders,
  request_id uuid references chiqim_requests,
  gruzheny_kg numeric,
  pustoy_kg numeric,
  net_kg numeric generated always as (gruzheny_kg - pustoy_kg) stored,  -- derived, never typed
  stage1_plate_photo text,
  stage1_scale_photo text,
  stage2_scale_photo text,
  departure_doc_photo text,
  completed_at timestamptz,
  check (serial is not null or request_id is not null)
);
```

**Note `net_kg` is a generated column** — nobody can ever type a wrong net weight. That's principle #1 in action.

### B4. Storage, pallets, wash cycles

```sql
create table storage_intake (            -- §5.1
  serial text primary key references kirim_orders,
  confirmed_at timestamptz default now(),
  pile_photo text,
  barcode1 text unique,
  confirmed_by uuid references profiles
);

create table moyka_sends (               -- §5.2 events, partial sends allowed
  id uuid primary key default gen_random_uuid(),
  serial text not null references kirim_orders,
  wash_cycle int not null default 1,
  sent_date date not null,
  qty_kg numeric not null check (qty_kg > 0),
  created_by uuid references profiles
);

create type pallet_status as enum ('in_stock','dispatched','bekor_qilindi');

create table finished_pallets (          -- §5.3 — one row = one physical pallet, ATOMIC
  barcode2 text primary key,             -- PLT-120826-001-04 / -KN
  serial text not null references kirim_orders,
  wash_cycle int not null default 1,
  type_id uuid not null references product_types,
  calibre_id uuid not null references calibres,
  weight_kg numeric not null check (weight_kg > 0),
  received_date date not null,
  status pallet_status not null default 'in_stock',
  created_by uuid references profiles
);

create table wash_cycles (               -- §2.13 re-wash
  id uuid primary key default gen_random_uuid(),
  serial text not null references kirim_orders,
  cycle_no int not null,
  status text not null default 'active',   -- active | voided | final
  final_loss_pct numeric,
  voided_at timestamptz,
  unique (serial, cycle_no)
);

create table dispatch_manifest (         -- §5.4 whole pallets only
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references chiqim_requests,
  barcode2 text not null references finished_pallets,
  loaded_at timestamptz default now(),
  unique (barcode2)                      -- a pallet can only leave once
);

create table lab_results (               -- §5.5 — one table, both tabs
  id uuid primary key default gen_random_uuid(),
  scope direction not null,              -- kirim | chiqim
  serial text references kirim_orders,
  request_id uuid references chiqim_requests,
  sampled_pallet text,
  sample_date date not null,
  moisture_pct numeric,
  so2_mg_kg numeric,                     -- null = pending
  unsulfured boolean not null default false,
  sample_photo text,
  created_by uuid references profiles
);
```

### B5. Append-only notes + audit (spec §2.5, §2.7)

```sql
create table notes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  author uuid references profiles,
  body text not null,
  created_at timestamptz default now()
);

create table audit_log (
  id bigserial primary key,
  table_name text not null,
  row_id text not null,
  actor uuid,
  action text not null,
  before jsonb,
  after jsonb,
  at timestamptz default now()
);
```

### B6. Derived views — this is where reports come from

```sql
-- one row per serial: the whole pipeline, always consistent
create view v_serial_balance as
select
  k.serial,
  k.owner_id,
  g.net_kg                                   as xom_kg,
  coalesce(ms.sent_kg, 0)                    as moykaga_kg,
  coalesce(fp.finished_kg, 0)                as tayyor_kg,
  coalesce(dp.dispatched_kg, 0)              as chiqgan_kg,
  coalesce(fp.finished_kg,0) - coalesce(dp.dispatched_kg,0) as omborda_kg,
  case when coalesce(ms.sent_kg,0) > 0
       then round((1 - coalesce(fp.finished_kg,0) / ms.sent_kg) * 100, 1)
  end                                        as yoqotish_pct
from kirim_orders k
left join gate_weighings g on g.serial = k.serial and g.dir = 'kirim'
left join (select serial, sum(qty_kg) sent_kg from moyka_sends group by serial) ms on ms.serial = k.serial
left join (select serial, sum(weight_kg) finished_kg from finished_pallets
           where status <> 'bekor_qilindi' group by serial) fp on fp.serial = k.serial
left join (select fpp.serial, sum(fpp.weight_kg) dispatched_kg
           from dispatch_manifest dm join finished_pallets fpp on fpp.barcode2 = dm.barcode2
           group by fpp.serial) dp on dp.serial = k.serial;
```

Every screen — Kuzatuv, passport, client report, Rahbar oversight — reads this **one view**. So they can never disagree with each other. Add a new report later? New view. Tables untouched.

### B7. RLS — do this NOW, not later (spec §2.12)

```sql
alter table kirim_orders     enable row level security;
alter table gate_weighings   enable row level security;
alter table finished_pallets enable row level security;
alter table notes            enable row level security;
alter table audit_log        enable row level security;
-- ...enable on EVERY table. No exceptions.

create or replace function my_role() returns user_role
language sql stable security definer as $$
  select role from profiles where id = auth.uid() and active
$$;

-- everyone signed in can read operations
create policy read_all on kirim_orders for select
  using (auth.uid() is not null);

-- only the manager writes orders
create policy menejer_writes on kirim_orders for insert
  with check (my_role() = 'menejer');

-- only the gate writes weighings
create policy qorovul_writes on gate_weighings for insert
  with check (my_role() = 'qorovul');
create policy qorovul_updates on gate_weighings for update
  using (my_role() = 'qorovul');

-- only storage writes pallets
create policy ombor_writes on finished_pallets for insert
  with check (my_role() = 'ombor');

-- notes: INSERT only, for everyone. No update, no delete. Ever.
create policy notes_insert on notes for insert with check (auth.uid() is not null);
create policy notes_read   on notes for select using (auth.uid() is not null);
-- (deliberately NO update/delete policy = nobody can. This is what makes append-only real.)

-- RAHBAR: reads everything, writes NOTHING operational.
-- Note there is no insert/update policy for rahbar on any operational table — that IS the enforcement.
-- Rahbar write policies exist only on: owners, product_*, calibres, settings_limits, profiles.
create policy rahbar_admin_owners on owners for all
  using (my_role() = 'rahbar') with check (my_role() = 'rahbar');
```

**Test it before building anything:** log in as `rahbar`, try to insert a `kirim_order`, and confirm the database **refuses**. If it succeeds, your security is fake.

---

## PART C — Netlify

1. GitHub repo (private) → Netlify → *Import from GitHub*.
2. Build command `npm run build` · publish dir `dist`.
3. Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
   The anon key is **meant** to be public — RLS protects you. **Never** put `service_role` in the frontend.
4. `netlify.toml`:
```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```
Without that redirect, refreshing a sub-page 404s.
5. Push to `main` → live. PRs get preview URLs — **test those on your phone before merging.**

---

## PART D — Working with Claude Code

### Set up the repo so it can actually help
```
/docs
  SPEC.md              ← the design spec (source of truth)
  BUILD-PLAN.md
  DECISIONS.md         ← append decisions made DURING the build
  /mockups             ← the PDFs, as reference
/supabase/migrations   ← all SQL, numbered
/src
```

**On the mockup PDFs:** Claude Code reads text well but images poorly. So don't rely on it "seeing" the PDF — **the SPEC is the contract**, the PDFs are supporting reference. If a visual detail matters (a button's position, a colour), *write it in the spec.*

### Your first commands, in order

**1. Scaffold**
> "Read /docs/SPEC.md. Set up a Vite + React + TypeScript + Tailwind PWA, with a Supabase client configured from VITE_ env vars. Add netlify.toml with an SPA redirect. No features yet — just a shell that builds, deploys, and has a login page."

**2. Database**
> "From /docs/SPEC.md §8 and /docs/PHASE0.md Part B, create numbered SQL migrations in /supabase/migrations: master data, the next_serial() function, operational tables, views, and RLS policies. Enable RLS on every table. Do not use DELETE anywhere — use status flags."

**3. Auth + roles**
> "Implement email/password login against Supabase Auth. Public signup disabled. After login, read the profile's role and route to that role's home screen. Add a role guard so a qorovul cannot open ombor screens."

**4. Prove the security**
> "Write a test that logs in as rahbar and asserts that inserting into kirim_orders is rejected by RLS."

**5. Then the vertical slice** (Phase 1) — one command per lifecycle step, referencing spec sections:
> "Implement SPEC §3.1 — the manager's tabbed KIRIM/CHIQIM operational screen and the KIRIM form (multi-product rows, auto-serial from next_serial(), compressed doc photo)."

### Working habits
- **One phase = one branch = one PR.** Review the diff before merging.
- **Reference section numbers.** "Implement §5.4" beats "build the loading screen."
- **When you decide something new, write it to `/docs/DECISIONS.md`** — that's what saved you from the memory problem in the first place.
- **Ask for tests on the money paths:** net weight, yield-loss, running totals, the void/re-wash reversal. A silent bug there costs real money.
- **Never commit `.env`.** Keys live in Netlify.

---

## PART E — Barcode & printing (Phase 2)

### Scanner — use the phone, no extra hardware
You asked to build scanning into the app. Use the **camera** via `html5-qrcode` or `@zxing/browser`:
- Needs **HTTPS** (Netlify gives you this free) and camera permission.
- Works offline once the app is cached.
- Keep a **manual code entry** fallback — cameras fail in bad light and on dirty stickers.
- If you later add a Bluetooth HID scanner, it just "types" the code — your same input handler catches it. **Support both; they don't conflict.**

### Printing — the Detonger P1 constraint (be aware)
The P1 prints via its **WePrint** app over Bluetooth. Detonger's SDKs are **native Android/iOS** — **a PWA cannot call them.** So:

- **Default path:** generate the label as a PNG in-app (**JsBarcode**, Code128, containing serial + type + calibre + weight + owner + the barcode) → `navigator.share({ files: [png] })` → user picks WePrint → prints. One extra tap, but robust and available today.
- **Batch path:** WePrint imports **CSV/Excel** to batch-print barcodes. For a day's pallets, export a CSV and print them in one go — genuinely faster than one-at-a-time.
- **True one-tap (only if needed later):** wrap the PWA with **Capacitor** and call Detonger's Android SDK. Don't do this in Phase 2 — see if the share sheet is actually painful first.

**Two things to confirm when the printer arrives:** the **label size** you'll standardise on (e.g. 50×30mm — that's what ships in the box) and whether WePrint accepts a **shared PNG** from the share sheet. Tell me both and I'll finalise the label layout.

---

## PART F — Phase 0 done-when

- [ ] Repo on GitHub, spec in `/docs`
- [ ] Netlify auto-deploys `main`; PR previews work on your phone
- [ ] Supabase project (Frankfurt region), migrations applied from files
- [ ] `next_serial()` returns `120826-001` and increments correctly
- [ ] Login works; each role lands on its own home
- [ ] **RLS proven:** rahbar is refused an operational insert *by the database*
- [ ] Backups verified — you have actually restored one

Only then start Phase 1.
