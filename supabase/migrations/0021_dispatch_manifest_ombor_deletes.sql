-- Ombor "undo scan" capability (§5.4 follow-up, post Step 7 prompt 4):
-- lets Ombor remove an individual scanned pallet from dispatch_manifest,
-- any time from request creation up to Qorovul's gate stage-2 completion.
-- dispatch_manifest had NO update/delete policy at all before this (only
-- read_all + ombor_writes insert, confirmed live) -- without this, any
-- delete attempt would already be refused 42501 regardless of UI.
--
-- Whitelist, not blacklist: chiqim_requests.status uses the shared
-- order_status enum (kutilmoqda/qabul_qilindi/olib_ketildi/yakunlandi).
-- An earlier draft checked `status <> 'olib_ketildi'`, which silently
-- re-opens the window once status reaches 'yakunlandi' (a fourth enum
-- value neither used nor excluded by that check) -- caught in review
-- before applying. Whitelisting the two pre-departure values is correct
-- regardless of which values chiqim_requests actually uses in practice.
-- 'olib_ketildi' is written only by complete_chiqim_stage2() (0020), per
-- the CHIQIM per-role finalization invariant -- this policy reads that
-- same signal rather than joining gate_weighings directly.

create policy ombor_deletes on dispatch_manifest for delete
  using (
    my_role() = 'ombor'
    and exists (
      select 1 from chiqim_requests r
      where r.id = dispatch_manifest.request_id
        and r.status in ('kutilmoqda', 'qabul_qilindi')
    )
  );
