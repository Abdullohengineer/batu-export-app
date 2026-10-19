-- "Qo'shimcha hujjatlar" (2026-10-19): any number of extra document photos
-- per incoming load (kirim_orders), attachable by Menejer at any time,
-- independent of Tahrirlash. See docs/decisions/0243.
--
-- STORAGE -- same mechanism as the nakladnoy (kirim_orders.doc_photo):
-- private bucket `kirim-photos`, row stores the object key only, client-side
-- compressImage() before upload. Extra documents live under the
-- `qoshimcha/<order_id>/` prefix of that bucket so the new DELETE policy
-- below can be scoped to them and can never reach a nakladnoy object
-- (those sit at the bucket root as `<uuid>.jpg`). kirim_photos_read and
-- kirim_photos_insert (0010) already cover read/upload; unchanged.
--
-- DELIBERATE DEVIATIONS (decided with the user, logged in 0243):
--   - Replace and delete ARE allowed, unlike kirim_fura_photos (0155,
--     append-only). These are attachments, not accounting records; nothing
--     derives a balance from them. Overrides SPEC §2.15 "Never DELETE --
--     void" for this table only; replace/delete are recorded in audit_log
--     by the app (same pattern as KirimOrdersList's Tahrirlash).
--   - NOT gated on gate_weighings. kirim_orders' menejer_edits (0038) locks
--     an order once Qorovul touches it; that lock is about date/plate/driver
--     and does not apply here -- documents attach to any load however old.
--     This table is separate precisely so that policy is never involved.
--   - read_all excludes the client role, same as kirim_fura_photos (0155):
--     the client portal shows no nakladnoy/photo links (SPEC §1.1, §3.6).

create table public.kirim_order_documents (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.kirim_orders(order_id),
  photo_path  text not null unique check (photo_path like 'qoshimcha/%'),
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references public.profiles(id),
  replaced_at timestamptz
);

create index kirim_order_documents_order_idx
  on public.kirim_order_documents (order_id, uploaded_at);

alter table public.kirim_order_documents enable row level security;

create policy read_all on public.kirim_order_documents for select
  using ((select auth.uid()) is not null and (select my_role()) <> 'client');

create policy menejer_writes on public.kirim_order_documents for insert
  with check ((select my_role()) = 'menejer');

create policy menejer_updates on public.kirim_order_documents for update
  using ((select my_role()) = 'menejer')
  with check ((select my_role()) = 'menejer');

create policy menejer_deletes on public.kirim_order_documents for delete
  using ((select my_role()) = 'menejer');

-- Storage: Menejer may remove ONLY objects under qoshimcha/ in kirim-photos
-- (a replaced or deleted extra document). No UPDATE policy: a replacement is
-- a new object, the old one is removed.
create policy kirim_photos_qoshimcha_delete on storage.objects for delete
  using (
    bucket_id = 'kirim-photos'
    and name like 'qoshimcha/%'
    and (select my_role()) = 'menejer'
  );
