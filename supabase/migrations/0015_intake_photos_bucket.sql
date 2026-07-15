-- Storage bucket for Storage §1's pile photo (SPEC §2.9, §5.1). Same
-- pattern as 0010_kirim_photos_bucket.sql / 0012_gate_photos_bucket.sql —
-- read-all, writes restricted to the role that captures them (ombor here).

insert into storage.buckets (id, name, public)
values ('intake-photos', 'intake-photos', false)
on conflict (id) do nothing;

create policy intake_photos_read on storage.objects for select
  using (bucket_id = 'intake-photos' and auth.uid() is not null);

create policy intake_photos_insert on storage.objects for insert
  with check (bucket_id = 'intake-photos' and my_role() = 'ombor');
