-- Operational tables — events, not balances (SPEC §8; PHASE0 Part B3)

create type direction as enum ('kirim', 'chiqim');
create type order_status as enum ('kutilmoqda', 'qabul_qilindi', 'olib_ketildi', 'yakunlandi');

create table kirim_orders (
  serial text primary key default next_serial(),
  order_date date not null,
  plate text not null,
  driver text not null,
  owner_id uuid not null references owners,
  doc_photo text,                      -- storage path
  status order_status not null default 'kutilmoqda',
  created_by uuid references profiles,
  created_at timestamptz not null default now()
);

create table kirim_lines (              -- multi-product: one truck, several types
  id uuid primary key default gen_random_uuid(),
  serial text not null references kirim_orders on delete cascade,
  type_id uuid not null references product_types,
  qty_kg numeric not null check (qty_kg > 0)
);

create table chiqim_requests (          -- NO goods-serial (SPEC §5.4)
  id uuid primary key default gen_random_uuid(),
  request_date date not null,
  plate text not null,
  driver text not null,
  owner_id uuid not null references owners,
  status order_status not null default 'kutilmoqda',
  created_by uuid references profiles,
  created_at timestamptz not null default now()
);

create table chiqim_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references chiqim_requests on delete cascade,
  type_id uuid not null references product_types,
  calibre_id uuid not null references calibres,
  qty_kg numeric not null check (qty_kg > 0)
);

-- gate: both stages, both scale photos (SPEC §4)
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
  created_by uuid references profiles,
  completed_at timestamptz,
  check (serial is not null or request_id is not null)
);
