import { useState } from 'react'
import { HistoryView } from '../../components/HistoryView'
import { ReportFilterBar } from '../../components/report/ReportFilterBar'
import { TotalsStrip } from '../../components/report/TotalsStrip'
import { defaultDateRange } from '../../lib/dateRange'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useReportQuery, ExportTooLargeError } from '../../lib/useReportQuery'
import { downloadReportExcel } from '../../lib/reportExport'
import { dateBasisLabel, defaultReportFilters } from '../../lib/reportQuery'
import { ReportResultsTable } from './ReportResultsTable'
import { SerialPassportModal } from './SerialPassportModal'

// §3.2 HISOBOT (Reporting) — the shared query engine + results table +
// totals strip + filter bar (§3.2.1-3.2.4, applied to SPEC.md this step).
// One component, mounted for both Menejer and Rahbar (§3.2: "Available to
// Menejer and Rahbar. Rahbar's is read-only" — this view has no write
// actions at all, so both roles get the literal same screen, no variant).
//
// DESKTOP surface, deliberately: Menejer/Rahbar work this screen on PCs
// (phones are Ombor/Qorovul/Laborator's job) — results render as a real
// table (ReportResultsTable.tsx), not the phone-oriented card list this
// screen shipped with first. See DECISIONS.md "Reporting results view:
// desktop rework."
export function HisobotTab() {
  const initial = defaultDateRange()
  const [filters, setFilters] = useState(defaultReportFilters(initial.from, initial.to))
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  // §3.2.5 serial passport drill-down — reached from any row's expand panel,
  // KIRIM or CHIQIM, always resolving to that row's PARENT serial (see
  // KirimRowDetail.tsx/ChiqimRowDetail.tsx). Not a route; local modal state.
  const [passportSerial, setPassportSerial] = useState<string | null>(null)

  // §3.3: includeInactive=true -- resolves ids on historical rows, and the
  // filter bar (ReportFilterBar, below) must still be able to select a
  // deactivated client/type/calibre to filter their history.
  const { owners } = useOwners(true)
  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)

  // §requirement 3: totals are computed server-side (report_totals) over
  // the FULL filtered set, never summed from `rows` (which is only ever one
  // page). §requirement 1: filters are pushed into the query itself
  // (report_query_page/report_totals) — no client-side narrowing left here.
  const { rows, voidedBarcodeMatch, totals, totalCount, page, pageCount, setPage, loading } = useReportQuery(filters)

  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }

  async function handleExport() {
    setExporting(true)
    setExportError(null)
    try {
      await downloadReportExcel(filters, { ownerName, typeName, calibreLabel }, totals)
    } catch (err) {
      // §requirement 5: the export's own safety cap must fail loudly, never
      // silently hand back a truncated file.
      setExportError(err instanceof ExportTooLargeError ? err.message : 'Excel yuklab olishda xatolik yuz berdi.')
    } finally {
      setExporting(false)
    }
  }

  // The exact-match callout (§3.2.2 "a voided Barcode #2 must remain
  // findable") is suppressed only if that same pallet already surfaced in
  // the normal filtered rows (e.g. status filter explicitly set to "Bekor
  // qilingan") — avoids showing the same barcode twice.
  const showVoidedCallout = voidedBarcodeMatch !== null && !rows.some((r) => r.key === voidedBarcodeMatch.key)

  return (
    <div className="space-y-4">
      <TotalsStrip totals={totals} dateBasisText={dateBasisLabel(filters.direction)} />

      <HistoryView
        loading={loading}
        isEmpty={totalCount === 0 && !showVoidedCallout}
        emptyText="Natija topilmadi."
        resultCount={totalCount}
        filters={
          <ReportFilterBar filters={filters} onChange={setFilters} owners={owners} productTypes={productTypes} calibres={calibres} />
        }
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <button
              type="button"
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              ← Oldingi
            </button>
            <span>
              {page} / {pageCount}-sahifa
            </span>
            <button
              type="button"
              onClick={() => setPage(page + 1)}
              disabled={page >= pageCount}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Keyingi →
            </button>
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || totalCount === 0}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {exporting ? 'Tayyorlanmoqda…' : 'Excel yuklab olish'}
          </button>
        </div>

        {exportError && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400" role="alert">
            {exportError}
          </div>
        )}

        {showVoidedCallout && voidedBarcodeMatch && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
            <div className="font-medium text-red-700 dark:text-red-400">{voidedBarcodeMatch.barcode2} — bekor qilindi</div>
            <div className="mt-1 text-red-600 dark:text-red-400">
              Qayta yuvilgan, sikl {voidedBarcodeMatch.voidInfo?.voidedCycle}.{' '}
              {voidedBarcodeMatch.voidInfo && voidedBarcodeMatch.voidInfo.successorBarcodes.length > 0 ? (
                <>
                  Yangi barkod{voidedBarcodeMatch.voidInfo.successorBarcodes.length > 1 ? 'lar' : ''}:{' '}
                  {voidedBarcodeMatch.voidInfo.successorBarcodes.join(', ')}.
                </>
              ) : (
                <>Sikl {voidedBarcodeMatch.voidInfo?.successorCycle} hali yangi barkod chiqarilmagan.</>
              )}
            </div>
          </div>
        )}

        <ReportResultsTable
          rows={rows}
          expandedKey={expandedKey}
          onToggle={(key) => setExpandedKey(expandedKey === key ? null : key)}
          ownerName={ownerName}
          typeName={typeName}
          calibreLabel={calibreLabel}
          onOpenPassport={setPassportSerial}
        />
      </HistoryView>

      {passportSerial && (
        <SerialPassportModal
          serial={passportSerial}
          onClose={() => setPassportSerial(null)}
          typeName={typeName}
          calibreLabel={calibreLabel}
        />
      )}
    </div>
  )
}
