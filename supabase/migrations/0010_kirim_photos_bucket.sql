-- Storage bucket for KIRIM's Hujjat rasmi (SPEC §2.9, §3.1). No bucket
-- existed yet anywhere in the project; this is minimal supporting
-- infrastructure for the doc_photo column added in 0009 — same
-- read-all / menejer-writes shape as the kirim_orders/kirim_lines RLS.

insert into storage.buckets (id, name, public)
values ('kirim-photos', 'kirim-photos', false)
on conflict (id) do nothing;

create policy kirim_photos_read on storage.objects for select
  using (bucket_id = 'kirim-photos' and auth.uid() is not null);

create policy kirim_photos_insert on storage.objects for insert
  with check (bucket_id = 'kirim-photos' and my_role() = 'menejer');
