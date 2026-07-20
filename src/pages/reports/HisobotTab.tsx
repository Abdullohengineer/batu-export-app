import { useState } from 'react'
import { HistoryView } from '../../components/HistoryView'
import { ReportFilterBar } from '../../components/report/ReportFilterBar'
import { TotalsStrip } from '../../components/report/TotalsStrip'
import { defaultDateRange } from '../../lib/dateRange'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useSettingsLimits } from '../../lib/useSettingsLimits'
import { useReportQuery } from '../../lib/useReportQuery'
import { downloadReportExcel } from '../../lib/reportExport'
import { computeTotals, dateBasisLabel, defaultReportFilters } from '../../lib/reportQuery'
import { ReportRowCard } from './ReportRowCard'

// §3.2 HISOBOT (Reporting) — the shared query engine + results table +
// totals strip + filter bar (§3.2.1-3.2.4, applied to SPEC.md this step).
// One component, mounted for both Menejer and Rahbar (§3.2: "Available to
// Menejer and Rahbar. Rahbar's is read-only" — this view has no write
// actions at all, so both roles get the literal same screen, no variant).
export function HisobotTab() {
  const initial = defaultDateRange()
  const [filters, setFilters] = useState(defaultReportFilters(initial.from, initial.to))
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const { owners } = useOwners()
  const { productTypes } = useProductTypes()
  const { calibres } = useCalibres()
  const { limits } = useSettingsLimits()
  const materialVariancePct = limits.kam_chiqdi_pct ?? 5

  const { rows, voidedBarcodeMatch, loading } = useReportQuery(filters, materialVariancePct)
  const totals = computeTotals(rows)

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
    try {
      await downloadReportExcel(rows, filters, { ownerName, typeName, calibreLabel })
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
        isEmpty={rows.length === 0 && !showVoidedCallout}
        emptyText="Natija topilmadi."
        resultCount={rows.length}
        filters={
          <ReportFilterBar filters={filters} onChange={setFilters} owners={owners} productTypes={productTypes} calibres={calibres} />
        }
      >
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || rows.length === 0}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {exporting ? 'Tayyorlanmoqda…' : 'Excel yuklab olish'}
          </button>
        </div>

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

        {rows.map((row) => (
          <ReportRowCard
            key={row.key}
            row={row}
            expanded={expandedKey === row.key}
            onToggle={() => setExpandedKey(expandedKey === row.key ? null : row.key)}
            ownerName={ownerName}
            typeName={typeName}
            calibreLabel={calibreLabel}
          />
        ))}
      </HistoryView>
    </div>
  )
}
