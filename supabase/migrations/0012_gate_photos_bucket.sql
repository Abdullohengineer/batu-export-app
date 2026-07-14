-- Storage bucket for Qorovul's gate photos (SPEC §2.9, §4): plate photo +
-- both tarozi (scale) photos. Same pattern as 0010_kirim_photos_bucket.sql —
-- read-all, writes restricted to the role that captures them (qorovul here).

insert into storage.buckets (id, name, public)
values ('gate-photos', 'gate-photos', false)
on conflict (id) do nothing;

create policy gate_photos_read on storage.objects for select
  using (bucket_id = 'gate-photos' and auth.uid() is not null);

create policy gate_photos_insert on storage.objects for insert
  with check (bucket_id = 'gate-photos' and my_role() = 'qorovul');
