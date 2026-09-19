import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys } from './queryClient'
import type { RahbarDashboardLedger, RahbarStockSnapshot, ZaxiraScope } from './rahbarDashboardV2'

// 2026-09-19 (Phase 1B): both hooks moved onto React Query. Previously each
// was a bare useEffect + useState that re-fired on every mount with no cache,
// no request cancellation, and no dedupe — and because Rahbar Bosh sahifa and
// the client Панель are separate routes that unmount on tab switch, simply
// navigating away and back re-issued both RPCs every time. Together these two
// accounted for ~34% of all measured database time. Behaviour preserved: same
// arguments, same mapping, same { data, loading, error } shape.
//
// One deliberate difference: on error, React Query keeps the last successful
// data rather than nulling it (the old code set snapshot/ledger to null).
// Stale-but-real numbers under an error banner beat a fabricated empty
// dashboard — the same reasoning useReportQuery.ts already documents for the
// Hisobot screen.

function n(v: number | string | null | undefined): number {
  return v === null || v === undefined ? 0 : Number(v)
}

interface ByCalibreTypeDb {
  typeId: string
  calibreId: string
  kg: number | string
}

function mapSnapshot(raw: Record<string, unknown>): RahbarStockSnapshot {
  return {
    rawKg: n(raw.rawKg as number),
    finishedCalibredKg: n(raw.finishedCalibredKg as number),
    konditirskiyKg: n(raw.konditirskiyKg as number),
    oldKnKg: n(raw.oldKnKg as number),
    moykadaKg: n(raw.moykadaKg as number),
    oldKnNote: String(raw.oldKnNote ?? ''),
    totalKg: n(raw.totalKg as number),
    byType: ((raw.byType as { typeId: string; kg: number | string }[]) ?? []).map((t) => ({ typeId: t.typeId, kg: n(t.kg) })),
    byCalibre: (
      (raw.byCalibre as { typeId: string; calibreId: string; isNumberless: boolean; kg: number | string }[]) ?? []
    ).map((c) => ({ typeId: c.typeId, calibreId: c.calibreId, isNumberless: Boolean(c.isNumberless), kg: n(c.kg) })),
    oldKnByType: ((raw.oldKnByType as { typeId: string; typeName: string; kg: number | string }[]) ?? []).map((t) => ({
      typeId: t.typeId,
      typeName: t.typeName,
      kg: n(t.kg),
    })),
    distinctTypeCount: n(raw.distinctTypeCount as number),
  }
}

function mapLedger(raw: Record<string, unknown>): RahbarDashboardLedger {
  const rawSection = raw.raw as Record<string, unknown>
  const moykadaSection = raw.moykadaSnapshot as Record<string, unknown>
  const moykaSection = raw.moyka as Record<string, unknown>
  const finishedSection = raw.finished as Record<string, unknown>
  const byCalibreType = raw.byCalibreType as { processed: ByCalibreTypeDb[]; dispatched: ByCalibreTypeDb[] }
  return {
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
  }
}

// rahbar_stock_snapshot(p_scope) -- live "hozir omborda nima bor" balance,
// no period involved. Re-fetches whenever scope changes.
export function useRahbarStockSnapshot(scope: ZaxiraScope) {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.rahbarStockSnapshot(scope),
    queryFn: async ({ signal }) => {
      const { data: rpcData, error: rpcError } = await supabase
        .rpc('rahbar_stock_snapshot', { p_scope: scope })
        .abortSignal(signal)
      if (rpcError) throw new Error(rpcError.message)
      return mapSnapshot(rpcData as Record<string, unknown>)
    },
  })

  return { snapshot: data ?? null, loading: isPending, error: error ? error.message : null }
}

// rahbar_dashboard_ledger(p_from, p_to, p_scope) -- the period ledger, chart,
// and calibre×type bars. Re-fetches whenever from/to/scope change.
export function useRahbarDashboardLedger(from: string, to: string, scope: ZaxiraScope) {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.rahbarDashboardLedger(from, to, scope),
    queryFn: async ({ signal }) => {
      const { data: rpcData, error: rpcError } = await supabase
        .rpc('rahbar_dashboard_ledger', { p_from: from, p_to: to, p_scope: scope })
        .abortSignal(signal)
      if (rpcError) throw new Error(rpcError.message)
      return mapLedger(rpcData as Record<string, unknown>)
    },
  })

  return { ledger: data ?? null, loading: isPending, error: error ? error.message : null }
}
