import { useEffect, useState } from 'react'
import type { ChiqimDispatchReportRow } from '../../lib/reportQuery'
import { useDispatchManifestLines } from '../../lib/useDispatchManifestLines'
import { supabase } from '../../lib/supabase'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'

// Raw-dispatch/old-KN totals for this one request (2026-09-14) — the
// pallet breakdown below comes from useDispatchManifestLines; these two
// non-pallet component kinds have no per-line "seriya/kalibr" identity the
// way a pallet does, so they're shown as plain totals, not a table. Both
// (and the pallet table above) sit under the one general "So'rov
// tafsilotlarini ko'rish" button (ChiqimRequestPassportModal, see this
// file's own header comment) rather than old-KN keeping a private
// drill-down of its own.
function useDispatchRawAndOldKn(requestId: string) {
  const [rawKg, setRawKg] = useState(0)
  const [oldKnKg, setOldKnKg] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [raw, oldKn] = await Promise.all([
          supabase.from('report_raw_dispatch_rows_v2').select('qty_kg').eq('request_id', requestId),
          supabase.from('report_old_kn_rows_v2').select('qty_kg').eq('request_id', requestId),
        ])
        if (cancelled) return
        setRawKg((raw.data ?? []).reduce((sum, r) => sum + Number(r.qty_kg), 0))
        setOldKnKg((oldKn.data ?? []).reduce((sum, r) => sum + Number(r.qty_kg), 0))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [requestId])

  return { rawKg, oldKnKg, loading }
}

// Row-expand content for a rolled-up Chiqim dispatch line (2026-09-14, see
// docs/decisions/0188-...-chiqim-regrain-departure-date-dispatch-rollup.md)
// — sibling to MoykaOutputRowDetail.tsx, but INLINE rather than deferring to
// the serial passport: a dispatch's component pallets don't share one
// serial, so there's no single passport to send the reader to, and the
// task's own requirement was "pallet barcode, serial, kalibr, consumed qty"
// visible on expand. Reuses useDispatchManifestLines.ts unchanged in
// mechanism — it already existed for OmborChiqimTab's own manifest view
// (chiqim_pallet_consumption, one row per pallet-PORTION, not book
// weight — the same basis this row's own total is summed from) — not
// reimplemented here, just given a `serial` on top of the fields it always
// returned.
//
// Only the pallet (`chiqim`) component kind is listed in the table below —
// chiqim_raw/chiqim_old_kn components (raw exits, old-KN collections)
// don't have a pallet/barcode2 to show at this same grain; shown as plain
// totals instead. A request combining pallet AND raw/old-KN cargo will
// show its full summed total up top (all components) but only the pallet
// portion broken out in the table. Flagged, not silently incomplete: this
// is what "pallet barcode, serial, kalibr, consumed qty" as specified
// actually describes.
//
// Full request detail (2026-09-15, see docs/decisions/0189-...-chiqim-
// dispatch-full-detail-and-kalibr-breakdown.md) — "So'rov tafsilotlarini
// ko'rish →" always opens ChiqimRequestPassportModal (renamed from
// OldKnRequestPassportModal, reused here unchanged in mechanism): Menejer/
// Ombor/Qorovul actors+times, gate photos, and the full cargo composition.
// Was gated behind `oldKnKg > 0` at ship time (2026-09-14) — a leftover of
// the button's original narrower purpose (only old-KN's own drill-down
// existed before the rollup) — which meant a pure-pallet or pure-raw
// dispatch (the common case) had no way to see its own photos/actor
// timestamps at all. Regression, not a design choice; fixed by making the
// button unconditional, next to the row's own "Jami" total rather than
// nested under the old-KN line specifically.
export function ChiqimDispatchRowDetail({
  row,
  typeName,
  calibreLabel,
  onOpenPassport,
  onOpenChiqimRequest,
}: {
  row: ChiqimDispatchReportRow
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
  onOpenPassport: (serial: string) => void
  onOpenChiqimRequest: (requestId: string) => void
}) {
  const { lines, loading } = useDispatchManifestLines(row.requestId)
  const { rawKg, oldKnKg, loading: loadingOther } = useDispatchRawAndOldKn(row.requestId)
  const palletTotal = lines.reduce((sum, l) => sum + l.weight_kg, 0)

  return (
    <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 text-slate-500 dark:border-slate-700 dark:text-slate-400">
      <div className="flex items-center justify-between gap-3">
        <div>
          Jami: <span className="font-medium text-slate-700 dark:text-slate-300">{row.weightKg.toLocaleString()} kg</span> ·{' '}
          {row.plate || '—'} {row.driver ? `(${row.driver})` : ''}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpenChiqimRequest(row.requestId)
          }}
          className="whitespace-nowrap text-sm font-medium text-slate-700 underline hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
        >
          So'rov tafsilotlarini ko'rish →
        </button>
      </div>
      {loading && <div className="text-xs">Yuklanmoqda…</div>}
      {!loading && lines.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="pr-3 pb-1 font-normal">Barcode #2</th>
              <th className="pr-3 pb-1 font-normal">Seriya</th>
              <th className="pr-3 pb-1 font-normal">Kalibr</th>
              <th className="pb-1 text-right font-normal">Kg</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1 pr-3 font-mono text-slate-700 dark:text-slate-300">{l.barcode2}</td>
                <td className="py-1 pr-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenPassport(l.serial)
                    }}
                    className="font-mono text-slate-700 underline hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                  >
                    {l.serial}
                  </button>
                  <PartiyaBadge partiyaNo={null} typeName={typeName(l.type_id)} />
                </td>
                <td className="py-1 pr-3">{calibreLabel(l.calibre_id)}</td>
                <td className="py-1 text-right tabular-nums">{l.weight_kg.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!loading && lines.length === 0 && <div className="text-xs">Bu jo'natmada pallet komponenti yo'q.</div>}
      {!loadingOther && rawKg > 0 && <div className="text-xs">Xom holda: {rawKg.toLocaleString()} kg</div>}
      {!loadingOther && oldKnKg > 0 && <div className="text-xs">Eski Konditerka: {oldKnKg.toLocaleString()} kg</div>}
      {!loading && !loadingOther && palletTotal + rawKg + oldKnKg !== row.weightKg && (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          Diqqat: komponentlar yig'indisi ({(palletTotal + rawKg + oldKnKg).toLocaleString()} kg) jami bilan mos kelmadi
          ({row.weightKg.toLocaleString()} kg) — faol filtrlar (kalibr, seriya va h.k.) qisman moslikni yashirgan bo'lishi mumkin.
        </div>
      )}
    </div>
  )
}
