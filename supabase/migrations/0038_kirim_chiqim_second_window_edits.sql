-- Allow Menejer to correct mistaken entries (date/plate/driver) from the
-- second window of KIRIM and CHIQIM, per the "correcting mistaken entries"
-- task. Row-level, not column-restricted -- the UI is what actually limits
-- which fields get sent in the update payload (date/plate/driver only,
-- never owner_id/qty/type/calibre/status), same acknowledged limitation as
-- the existing owners/master-data grants (see DECISIONS.md "Rahbar
-- settings (§3.3)").

-- kirim_orders had ZERO update policy before this. Locked as soon as any
-- gate_weighings row exists for the order (stage 1 OR stage 2) -- stricter
-- than kirim_orders.status flipping to 'qabul_qilindi' (which only happens
-- at stage 2 completion, via complete_kirim_stage2()'s trigger), since
-- dated/plated gate photos already exist the moment Qorovul touches this
-- order at all. Confirmed with the user.
create policy menejer_edits on kirim_orders for update to public
  using (
    my_role() = 'menejer'
    and not exists (select 1 from gate_weighings g where g.order_id = kirim_orders.order_id and g.dir = 'kirim')
  )
  with check (
    my_role() = 'menejer'
    and not exists (select 1 from gate_weighings g where g.order_id = kirim_orders.order_id and g.dir = 'kirim')
  );

-- chiqim_requests already had menejer_voids (0033), scoped to exactly the
-- boundary edits should use too (ombor_finished_at IS NULL -- Ombor hasn't
-- started/finished loading yet). Renamed rather than adding a second,
-- functionally-redundant UPDATE policy with an identical predicate --
-- voiding is just one kind of update this policy permits, always was.
drop policy menejer_voids on chiqim_requests;
create policy menejer_updates on chiqim_requests for update to public
  using (my_role() = 'menejer' and ombor_finished_at is null)
  with check (my_role() = 'menejer' and ombor_finished_at is null);
