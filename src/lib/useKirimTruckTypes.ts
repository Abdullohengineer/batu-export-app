import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { run } from './rpc'

// KIRIM truck type lookup for Hisobot (SPEC.md "KIRIM fura"). Mirrors
// useChiqimTruckTypes.ts exactly, including its own flagged deviation: a
// resolver keyed by the orderId the row already carries, not a column
// threaded through report_kirim_rows/report_query_page (same "display
// badge on a default-hidden column doesn't justify a multi-view
// DROP/CREATE" reasoning as that file's header comment). Unlike
// useChiqimTruckTypes.ts (grandfathered pre-wrapper), this is a genuinely
// new call site, so it goes through rpc.ts's run() (CLAUDE.md "Data access").
export function useKirimTruckTypes() {
  const [byOrderId, setByOrderId] = useState<Map<string, string>>(new Map())

  const refresh = useCallback(async () => {
    const data = await run(supabase.from('kirim_orders').select('order_id, truck_type'))
    setByOrderId(new Map((data ?? []).map((r) => [r.order_id, r.truck_type])))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Unknown ids resolve to 'regular', not to a nullish "unknown" state --
  // same reasoning as useChiqimTruckTypes.
  const truckType = useCallback((orderId: string) => byOrderId.get(orderId) ?? 'regular', [byOrderId])

  return { truckType, refresh }
}
