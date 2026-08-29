// §5.4 FIFO dispatch (2026-08-28): split out of the now-deleted
// chiqimScan.ts (the Option B scan-to-load machinery it lived alongside is
// gone — see DECISIONS.md "CHIQIM quantity-based dispatch: FIFO cascade,
// consumption table"). Kept dependency-free (no `supabase` import) so
// `node --test` can exercise it directly, same reasoning chiqimScan.ts's
// own header used to state.
import { sortByDateDesc } from './sortByDate.ts'

// Ombor's own W2 sorts newest-first by its own finish signal
// (`ombor_finished_at`, per the CHIQIM per-role finalization invariant),
// not by request_date/created_at or any other role's timestamp.
export function sortFinishedByOmborFinish<T extends { ombor_finished_at: string | null }>(requests: T[]): T[] {
  return sortByDateDesc(requests, (r) => r.ombor_finished_at)
}
