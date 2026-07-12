-- Master data + user profiles (SPEC §8, PHASE0 Part B1)

create type user_role as enum ('rahbar', 'menejer', 'qorovul', 'ombor', 'laborator');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  role user_role not null,
  active boolean not null default true,
  language text not null default 'uz',   -- 'uz' | 'ru' (SPEC §2.8)
  created_at timestamptz not null default now()
);

-- clients (goods owners). SPEC §2.4 — ALWAYS a dropdown, never free text
create table owners (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);

-- products. SPEC §2.3 — never hardcode types
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

-- configurable exception limits. SPEC §2.14
create table settings_limits (
  key text primary key,
  value numeric not null
);

insert into settings_limits (key, value) values
  ('sulfur_overdue_days', 2),
  ('moyka_idle_days', 7),
  ('abnormal_loss_pct', 22);
