import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { wipKindSortIndex, type WipRow, type WipKind } from './wip'

interface WipDbRow {
  wip_kind: WipKind
  row_key: string
  serial: string | null
  request_id: string | null
  owner_id: string
  type_id: string | null
  days_waiting: number | string | null
  threshold_days: number | string | null
}

function mapRow(r: WipDbRow): WipRow {
  return {
    wipKind: r.wip_kind,
    rowKey: r.row_key,
    serial: r.serial,
    requestId: r.request_id,
    ownerId: r.owner_id,
    typeId: r.type_id,
    daysWaiting: r.days_waiting === null ? null : Number(r.days_waiting),
    thresholdDays: r.threshold_days === null ? null : Number(r.threshold_days),
  }
}

// §3.2.9 — one exceptions list, seven kinds, sorted by the section's own
// priority order (awaiting_lab first, per its own "highest-value row" note),
// then most-overdue first within a kind.
export function useWipRows() {
  const [rows, setRows] = useState<WipRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const { data } = await supabase.from('wip_rows').select('*')
        if (cancelled) return
        const mapped = ((data ?? []) as WipDbRow[]).map(mapRow)
        mapped.sort((a, b) => {
          const kindDiff = wipKindSortIndex(a.wipKind) - wipKindSortIndex(b.wipKind)
          if (kindDiff !== 0) return kindDiff
          return (b.daysWaiting ?? 0) - (a.daysWaiting ?? 0)
        })
        setRows(mapped)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return { rows, loading }
}
