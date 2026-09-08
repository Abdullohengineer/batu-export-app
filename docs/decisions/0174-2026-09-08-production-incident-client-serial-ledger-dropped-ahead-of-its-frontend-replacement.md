## 2026-09-08 — Production incident: `client_serial_ledger` dropped ahead of its frontend replacement

**Context:** Reported live: `Could not find the function public.client_serial_ledger(p_from_date,
p_product_type_id, p_to_date) in the schema cache` on the deployed Приход tab. Root cause,
confirmed by reading `main` directly (not assumed): migration `0118_drop_client_serial_ledger.sql`
and the `ClientPrihodTab.tsx` rewrite that stops calling that function are both part of PR #140 —
which was still open, unmerged, when 0118 was applied directly to the live Supabase project (with
explicit confirmation, per this project's "ask before applying migrations to the live project"
rule — the rule was followed for *that* action; the miss was not recognizing that dropping a
function `main`'s still-deployed frontend depends on is unsafe until the frontend side ships too).
`main`'s `src/lib/clientSerialLedger.ts` still calls `supabase.rpc('client_serial_ledger',
{p_from_date, p_to_date, p_product_type_id})` — an exact match for the reported error. This was a
deployment-sequencing failure, not an incomplete rewrite: the new frontend (`report_query_page`/
`report_totals`, no RPC of its own) was already complete and correct on PR #140's branch the whole
time.

**Decision:** Restore service immediately rather than wait on a merge+deploy this session has no
way to trigger or time. `0119_emergency_restore_client_serial_ledger.sql` recreates the function
byte-for-byte as it stood in production immediately before 0118 (0109's body as amended by 0110's
Остаток сырья fix — confirmed no other migration between 0110 and 0118 touched it), applied live
immediately. This is a stopgap, not a reversal: once PR #140 merges and deploys, nothing calls this
function any more (confirmed already, same dependency check 0118 itself ran) and it can be dropped
a second time in a small follow-up migration — tracked as a suggested follow-up task rather than
done here, to avoid re-creating the exact same race.

**Verification:** Recreated function re-tested live, role-switched to the TEST CLIENT account,
returning correct totals for real production data — confirms the currently-deployed `main`
frontend is unbroken again. No way to confirm the actual deployed site in a browser from this
sandboxed session (same egress-policy block prior entries in this log describe) — recommend the
project owner do one real click-through of Приход as a client user to confirm past this SQL-level
verification.

**Process fix, going forward:** a migration that drops a function must not be applied to the live
project until the frontend change that stops needing it has actually reached `main` and deployed
— "the migration is part of an already-approved PR" is not sufficient; "merged and live" is the
bar. Flagging this here rather than only fixing the immediate incident.
