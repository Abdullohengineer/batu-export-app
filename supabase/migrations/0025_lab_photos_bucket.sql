-- Storage bucket for Laborator's sample photos (SPEC §2.9, §5.5.2/§5.5.3).
-- Same pattern as 0010_kirim_photos_bucket.sql / 0012_gate_photos_bucket.sql
-- / 0015_intake_photos_bucket.sql — read-all, writes restricted to the role
-- that captures them (laborator here).

insert into storage.buckets (id, name, public)
values ('lab-photos', 'lab-photos', false)
on conflict (id) do nothing;

create policy lab_photos_read on storage.objects for select
  using (bucket_id = 'lab-photos' and auth.uid() is not null);

create policy lab_photos_insert on storage.objects for insert
  with check (bucket_id = 'lab-photos' and my_role() = 'laborator');
