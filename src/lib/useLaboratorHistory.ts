import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface LaboratorHistoryFilters {
  from: string // YYYY-MM-DD inclusive
  to: string // YYYY-MM-DD inclusive
  scope: '' | 'kirim' | 'chiqim' // '' = both
  ownerId: string // '' = all
  typeId: string // '' = all
  calibreId: string // '' = all -- CHIQIM rows only, see note below
  seriya: string // text match against parent serial, '' = all
  verdict: '' | 'o_tdi' | 'qayta_yuvish' // '' = all -- CHIQIM rows only
}

export interface LaboratorHistoryRow {
  id: string
  scope: 'kirim' | 'chiqim'
  serial: string
  cycleNo: number | null // null on kirim rows
  type_id: string
  owner_id: string
  sample_date: string
  moisture_pct: number
  so2_mg_kg: number | null
  sample_photo: string | null
  note: string | null
  sampled_pallet: string | null // null on kirim rows
  verdict: string | null // null on kirim rows (§5.5.2: no verdict there)
  target_moisture_pct: number | null
  target_so2_mg_kg: number | null
  calibre_id: string | null // resolved via sampled_pallet for chiqim; null on kirim
  created_at: string
}

// §5.5.6 "one history section, not three" -- both directions in a single
// filterable list, same "a lookup is a filter, not a screen" principle the
// manager's own reporting layer (§3.2) already applies. lab_results itself
// carries no owner/type/calibre, so both scopes resolve them the same way
// their own live tabs already do: KIRIM via parent_serial -> kirim_lines ->
// kirim_orders (useLaboratorKirim.ts's chain); CHIQIM via wash_cycle_id ->
// wash_cycles.serial -> the SAME kirim_lines -> kirim_orders chain
// (useLaboratorChiqim.ts's), plus sampled_pallet -> finished_pallets.
// calibre_id for the kalibr filter -- meaningless for KIRIM rows, which
// test raw material before any calibre exists (no calibre to filter by,
// not a gap).
export function useLaboratorHistory(filters: LaboratorHistoryFilters) {
  const [rows, setRows] = useState<LaboratorHistoryRow[]>([])
  const [loading, setLoading] = useState(true)

  const { from, to, scope, ownerId, typeId, calibreId, seriya, verdict } = filters

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        // Upper bound exclusive: next day at 00:00, so the whole `to` day
        // is included (same convention as useIntakeHistory.ts).
        const toExclusive = new Date(to)
        toExclusive.setDate(toExclusive.getDate() + 1)
        const toExclusiveStr = toExclusive.toISOString().slice(0, 10)

        let q = supabase
          .from('lab_results')
          .select(
            'id, scope, parent_serial, wash_cycle_id, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, sample_photo, note, verdict, created_at',
          )
          .gte('sample_date', from)
          .lt('sample_date', toExclusiveStr)
          .order('created_at', { ascending: false })
          .limit(300)
        if (scope) q = q.eq('scope', scope)
        if (verdict) q = q.eq('verdict', verdict)
        if (seriya.trim()) q = q.ilike('parent_serial', `%${seriya.trim()}%`)

        const { data: results } = await q
        if (!results || results.length === 0) {
          if (!cancelled) setRows([])
          return
        }

        const chiqimResults = results.filter((r) => r.scope === 'chiqim' && r.wash_cycle_id)
        const cycleIds = [...new Set(chiqimResults.map((r) => r.wash_cycle_id as string))]
        const { data: cycles } = cycleIds.length
          ? await supabase.from('wash_cycles').select('id, serial, cycle_no').in('id', cycleIds)
          : { data: [] as { id: string; serial: string; cycle_no: number }[] }
        const cycleById = new Map((cycles ?? []).map((c) => [c.id, c]))

        const kirimSerials = results
          .filter((r) => r.scope === 'kirim' && r.parent_serial)
          .map((r) => r.parent_serial as string)
        const chiqimSerials = (cycles ?? []).map((c) => c.serial)
        const allSerials = [...new Set([...kirimSerials, ...chiqimSerials])]

        const { data: lines } = allSerials.length
          ? await supabase
              .from('kirim_lines')
              .select('serial, order_id, type_id, target_moisture_pct, target_so2_mg_kg')
              .in('serial', allSerials)
          : { data: [] as { serial: string; order_id: string; type_id: string; target_moisture_pct: number | null; target_so2_mg_kg: number | null }[] }
        const lineBySerial = new Map((lines ?? []).map((l) => [l.serial, l]))

        const orderIds = [...new Set((lines ?? []).map((l) => l.order_id))]
        const { data: orders } = orderIds.length
          ? await supabase.from('kirim_orders').select('order_id, owner_id').in('order_id', orderIds)
          : { data: [] as { order_id: string; owner_id: string }[] }
        const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))

        const sampledBarcodes = [...new Set(chiqimResults.map((r) => r.sampled_pallet).filter((b): b is string => !!b))]
        const { data: pallets } = sampledBarcodes.length
          ? await supabase.from('finished_pallets').select('barcode2, calibre_id').in('barcode2', sampledBarcodes)
          : { data: [] as { barcode2: string; calibre_id: string }[] }
        const calibreByBarcode = new Map((pallets ?? []).map((p) => [p.barcode2, p.calibre_id]))

        const enriched: LaboratorHistoryRow[] = results
          .map((r): LaboratorHistoryRow | null => {
            const cycle = r.wash_cycle_id ? cycleById.get(r.wash_cycle_id) : null
            const serial = r.scope === 'chiqim' ? (cycle?.serial ?? null) : r.parent_serial
            if (!serial) return null
            const line = lineBySerial.get(serial)
            if (!line) return null
            const order = orderById.get(line.order_id)
            if (!order) return null

            return {
              id: r.id,
              scope: r.scope as 'kirim' | 'chiqim',
              serial,
              cycleNo: cycle?.cycle_no ?? null,
              type_id: line.type_id,
              owner_id: order.owner_id,
              sample_date: r.sample_date,
              moisture_pct: r.moisture_pct,
              so2_mg_kg: r.so2_mg_kg,
              sample_photo: r.sample_photo,
              note: r.note,
              sampled_pallet: r.sampled_pallet,
              verdict: r.verdict,
              target_moisture_pct: line.target_moisture_pct,
              target_so2_mg_kg: line.target_so2_mg_kg,
              calibre_id: r.sampled_pallet ? (calibreByBarcode.get(r.sampled_pallet) ?? null) : null,
              created_at: r.created_at,
            }
          })
          .filter((r): r is LaboratorHistoryRow => r !== null)
          .filter((r) => (typeId ? r.type_id === typeId : true))
          .filter((r) => (ownerId ? r.owner_id === ownerId : true))
          .filter((r) => (calibreId ? r.calibre_id === calibreId : true))

        if (!cancelled) setRows(enriched)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [from, to, scope, ownerId, typeId, calibreId, seriya, verdict])

  return { rows, loading }
}
