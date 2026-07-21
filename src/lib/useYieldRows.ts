import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { YieldRow, YieldCalibreMixEntry } from './yield'

interface YieldDbRow {
  serial: string
  type_id: string
  owner_id: string
  plate: string
  driver: string
  raw_received_kg: number | string
  raw_consumed_kg: number | string
  raw_overage_kg: number | string
  completed_date: string
  max_cycle_no: number
  rewashed: boolean
  live_calibre_kg: number | string
  live_konditirskiy_kg: number | string
  output_kg: number | string
  loss_kg: number | string
  loss_pct: number | string
  gross_yield_pct: number | string
  intake_moisture_pct: number | string | null
  delivered_moisture_pct: number | string | null
  dry_matter_available: boolean
  dry_matter_in_kg: number | string | null
  dry_matter_out_kg: number | string | null
  true_loss_pct: number | string | null
  calibre_mix: YieldCalibreMixEntry[]
}

function mapRow(r: YieldDbRow): YieldRow {
  return {
    serial: r.serial,
    typeId: r.type_id,
    ownerId: r.owner_id,
    plate: r.plate,
    driver: r.driver,
    rawReceivedKg: Number(r.raw_received_kg),
    rawConsumedKg: Number(r.raw_consumed_kg),
    rawOverageKg: Number(r.raw_overage_kg),
    completedDate: r.completed_date,
    maxCycleNo: r.max_cycle_no,
    rewashed: r.rewashed,
    liveCalibreKg: Number(r.live_calibre_kg),
    liveKonditirskiyKg: Number(r.live_konditirskiy_kg),
    outputKg: Number(r.output_kg),
    lossKg: Number(r.loss_kg),
    lossPct: Number(r.loss_pct),
    grossYieldPct: Number(r.gross_yield_pct),
    intakeMoisturePct: r.intake_moisture_pct === null ? null : Number(r.intake_moisture_pct),
    deliveredMoisturePct: r.delivered_moisture_pct === null ? null : Number(r.delivered_moisture_pct),
    dryMatterAvailable: r.dry_matter_available,
    dryMatterInKg: r.dry_matter_in_kg === null ? null : Number(r.dry_matter_in_kg),
    dryMatterOutKg: r.dry_matter_out_kg === null ? null : Number(r.dry_matter_out_kg),
    trueLossPct: r.true_loss_pct === null ? null : Number(r.true_loss_pct),
    calibreMix: r.calibre_mix ?? [],
  }
}

// §3.2.8 — filtered server-side (real SQL WHERE via the query builder, not
// the old fetch-then-filter-client-side anti-pattern §3.2.4 already fixed
// once) by owner/date range; per/product filtering is just another .eq().
// One row per finished serial (not per event), so unlike report_rows this
// stays small even at years of real business scale — no pagination RPC
// warranted (see the design discussion before this migration was applied).
export function useYieldRows(ownerId: string | null, typeId: string | null, from: string, to: string) {
  const [rows, setRows] = useState<YieldRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        let query = supabase.from('yield_rows').select('*').gte('completed_date', from).lte('completed_date', to)
        if (ownerId) query = query.eq('owner_id', ownerId)
        if (typeId) query = query.eq('type_id', typeId)
        const { data } = await query
        if (cancelled) return
        const mapped = ((data ?? []) as YieldDbRow[]).map(mapRow)
        mapped.sort((a, b) => b.completedDate.localeCompare(a.completedDate))
        setRows(mapped)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [ownerId, typeId, from, to])

  return { rows, loading }
}
