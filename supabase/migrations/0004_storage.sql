-- Storage, pallets, wash cycles (SPEC §8; PHASE0 Part B4)

create table storage_intake (            -- §5.1
  serial text primary key references kirim_orders,
  confirmed_at timestamptz not null default now(),
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

create type pallet_status as enum ('in_stock', 'dispatched', 'bekor_qilindi');

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
  loaded_at timestamptz not null default now(),
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
