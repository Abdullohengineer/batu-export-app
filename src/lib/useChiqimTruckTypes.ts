import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// CHIQIM truck type lookup for Hisobot (2026-08-30, see DECISIONS.md "CHIQIM
// truck type: Fura"). Reads chiqim_request_totals (migration 0104) once and
// hands back a requestId -> truck_type resolver, threaded through
// ReportResultsTable exactly like ownerName/typeName/calibreLabel already
// are — this is a label resolver, not a row source.
//
// 🚩 Deliberate deviation, flagged rather than done silently: every other
// per-row fact in Hisobot is threaded through report_rows_v2 and its three
// query functions (the pattern 0093/0094 established for partiya_no). That
// path was NOT taken for truck_type. report_rows_v2 is a 7-branch UNION of
// 29 explicitly-listed columns, and `create or replace view` can only
// APPEND a column (0094's own hard-won finding, found via a live 42P16), so
// threading one more would mean rewriting that view plus DROP/CREATE on
// report_filtered_rows, report_query_page and report_totals — roughly 2,500
// lines of migration to put a display badge on a default-hidden column.
// Truck type is not a quantity, is not filterable, and is not summed; a
// resolver keyed by the requestId the row already carries is the
// proportionate shape. If truck_type ever needs to be FILTERED on in
// Hisobot, that is the point to pay for the full threading instead.
//
// Unfiltered fetch: chiqim_request_totals has one row per CHIQIM request
// (low hundreds at most, and the same table Qorovul's own tab already reads
// whole), so paging it by the visible page's ids would add a refetch per
// page change for no real saving.
export function useChiqimTruckTypes() {
  const [byRequestId, setByRequestId] = useState<Map<string, string>>(new Map())

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('chiqim_request_totals').select('request_id, truck_type')
    setByRequestId(new Map((data ?? []).map((r) => [r.request_id, r.truck_type])))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Unknown ids resolve to 'regular', not to a nullish "unknown" state: an
  // absent row can only mean the request predates this fetch, and every
  // pre-existing request IS regular (the column's own default). FuraBadge
  // renders nothing for it either way.
  const truckType = useCallback((requestId: string) => byRequestId.get(requestId) ?? 'regular', [byRequestId])

  return { truckType, refresh }
}
