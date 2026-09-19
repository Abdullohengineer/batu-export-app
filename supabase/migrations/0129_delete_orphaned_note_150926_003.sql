-- Follow-up to migration 0128 (reversal of the Moyka send for 150926-003):
-- delete the orphaned notes row that reversal deliberately left behind.
-- send_old_stock_to_moyka auto-writes a notes row (entity_type='moyka',
-- entity_id=<minted serial>) at send time; 0128 reversed everything else
-- about that send but left this row in place, flagged rather than
-- silently deleted, since it wasn't part of that migration's required
-- steps. Confirmed exactly one notes row references entity_id='150926-003'
-- before writing this.
--
-- Out of scope: whether send_old_stock_to_moyka should auto-write this
-- note at all, and whether a future reversal helper should clean it up
-- automatically -- separate design question, not addressed here.

do $$
begin
  delete from notes where id = 'd0502abe-8cc3-462f-b789-9a822497fb8a';

  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('notes', 'd0502abe-8cc3-462f-b789-9a822497fb8a', null, 'manual_reversal',
    jsonb_build_object('reason',
      'Orphaned notes row from the 150926-003 send, left behind by migration 0128''s reversal; deleted as its own follow-up (parent action: migration 0128).'),
    null, now());
end $$;
