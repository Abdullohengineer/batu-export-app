import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { RahbarDashboardLedger, RahbarStockSnapshot, ZaxiraScope } from './rahbarDashboardV2'

function n(v: number | string | null | undefined): number {
  return v === null || v === undefined ? 0 : Number(v)
}

// rahbar_stock_snapshot(p_scope) -- live "hozir omborda nima bor" balance,
// no period involved. Re-fetches whenever scope changes.
export function useRahbarStockSnapshot(scope: ZaxiraScope) {
  const [snapshot, setSnapshot] = useState<RahbarStockSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data, error: rpcError } = await supabase.rpc('rahbar_stock_snapshot', { p_scope: scope })
        if (cancelled) return
        if (rpcError) {
          setError(rpcError.message)
          setSnapshot(null)
          return
        }
        const raw = data as Record<string, unknown>
        setSnapshot({
          rawKg: n(raw.rawKg as number),
          finishedCalibredKg: n(raw.finishedCalibredKg as number),
          konditirskiyKg: n(raw.konditirskiyKg as number),
          oldKnKg: n(raw.oldKnKg as number),
          oldKnNote: String(raw.oldKnNote ?? ''),
          totalKg: n(raw.totalKg as number),
          byType: ((raw.byType as { typeId: string; kg: number | string }[]) ?? []).map((t) => ({ typeId: t.typeId, kg: n(t.kg) })),
          distinctTypeCount: n(raw.distinctTypeCount as number),
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [scope])

  return { snapshot, loading, error }
}

// rahbar_dashboard_ledger(p_from, p_to, p_scope) -- the period ledger, chart,
// and calibre×type bars. Re-fetches whenever from/to/scope change.
export function useRahbarDashboardLedger(from: string, to: string, scope: ZaxiraScope) {
  const [ledger, setLedger] = useState<RahbarDashboardLedger | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data, error: rpcError } = await supabase.rpc('rahbar_dashboard_ledger', { p_from: from, p_to: to, p_scope: scope })
        if (cancelled) return
        if (rpcError) {
          setError(rpcError.message)
          setLedger(null)
          return
        }
        const raw = data as Record<string, unknown>
        const rawSection = raw.raw as Record<string, unknown>
        const moykadaSection = raw.moykadaSnapshot as Record<string, unknown>
        const moykaSection = raw.moyka as Record<string, unknown>
        const finishedSection = raw.finished as Record<string, unknown>
        const byCalibreType = raw.byCalibreType as { processed: ByCalibreTypeDb[]; dispatched: ByCalibreTypeDb[] }
        setLedger({
          period: raw.period as RahbarDashboardLedger['period'],
          raw: {
            openingKg: n(rawSection.openingKg as number),
            receivedKg: n(rawSection.receivedKg as number),
            dispatchedKg: n(rawSection.dispatchedKg as number),
            sentToMoykaKg: n(rawSection.sentToMoykaKg as number),
            storageLossKg: n(rawSection.storageLossKg as number),
            closingKg: n(rawSection.closingKg as number),
            residualKg: n(rawSection.residualKg as number),
            residualNote: String(rawSection.residualNote ?? ''),
          },
          moykadaSnapshot: {
            openingKg: n(moykadaSection.openingKg as number),
            closingKg: n(moykadaSection.closingKg as number),
            asOfDate: String(moykadaSection.asOfDate ?? ''),
            residualKg: n(moykadaSection.residualKg as number),
            note: String(moykadaSection.note ?? ''),
          },
          moyka: {
            processedKg: n(moykaSection.processedKg as number),
            calibreKg: n(moykaSection.calibreKg as number),
            konditirskiyKg: n(moykaSection.konditirskiyKg as number),
            lossKg: n(moykaSection.lossKg as number),
            lossPct: n(moykaSection.lossPct as number),
          },
          finished: {
            openingKg: n(finishedSection.openingKg as number),
            producedKg: n(finishedSection.producedKg as number),
            dispatchedKg: n(finishedSection.dispatchedKg as number),
            closingKg: n(finishedSection.closingKg as number),
          },
          byCalibreType: {
            processed: (byCalibreType?.processed ?? []).map((r) => ({ typeId: r.typeId, calibreId: r.calibreId, kg: n(r.kg) })),
            dispatched: (byCalibreType?.dispatched ?? []).map((r) => ({ typeId: r.typeId, calibreId: r.calibreId, kg: n(r.kg) })),
          },
          chart: ((raw.chart as { bucketStart: string; kirdiKg: number | string; chiqganKg: number | string; vozvratKg: number | string }[]) ?? []).map((c) => ({
            bucketStart: c.bucketStart,
            kirdiKg: n(c.kirdiKg),
            chiqganKg: n(c.chiqganKg),
            vozvratKg: n(c.vozvratKg),
          })),
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [from, to, scope])

  return { ledger, loading, error }
}

interface ByCalibreTypeDb {
  typeId: string
  calibreId: string
  kg: number | string
}
