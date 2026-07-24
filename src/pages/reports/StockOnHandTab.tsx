import { useMemo, useState } from 'react'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useStockOnHand } from '../../lib/useStockOnHand'
import {
  defaultStockOnHandFilters,
  filterStockOnHandRows,
  sortStockOnHandRowsNewestFirst,
  computeStockOnHandTotals,
  STOCK_BUCKET_ORDER,
  STOCK_BUCKET_LABEL,
  type StockBucket,
} from '../../lib/stockOnHand'
import { ReportFilterBar } from '../../components/report/ReportFilterBar'
import { StockOnHandHeader } from './StockOnHandHeader'
import { StockOnHandTable } from './StockOnHandTable'
import { SerialPassportModal } from './SerialPassportModal'
import { StatusNote } from '../../components/ui/StatusNote'

const STATUS_OPTIONS = STOCK_BUCKET_ORDER.map((b) => ({ value: b, label: STOCK_BUCKET_LABEL[b] }))

// §3.2.6 Ombor qoldig'i (stock on hand) — reworked this task from a pure
// now-snapshot into a filterable lookup surface (SPEC.md §3.2.6, updated
// alongside this change, per the user's explicit instruction — the section
// used to document "no filter bar, no date range" as deliberate; that's no
// longer true, and the doc says why). Mounted at /menejer/qoldiq and
// /rahbar/qoldiq, identical component, same read-only-for-Rahbar shape as
// §3.2's own screen. One row per barcode now (requirement A) — filtering,
// newest-first ordering, and totals all happen client-side over the full
// row set useStockOnHand.ts fetches (stockOnHand.ts's pure functions),
// since this is a bounded "what's here right now" dataset, not the
// unbounded multi-month history §3.2.1-3.2.4's server-side engine exists
// to handle.
export function StockOnHandTab() {
  const [filters, setFilters] = useState(defaultStockOnHandFilters())
  const [passportSerial, setPassportSerial] = useState<string | null>(null)

  // §3.3: includeInactive=true -- resolves ids on in-stock/historical rows.
  const { owners } = useOwners(true)
  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)
  const { rows, turnaroundAvgDays, loading, error } = useStockOnHand()

  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }

  const visibleRows = useMemo(
    () => sortStockOnHandRowsNewestFirst(filterStockOnHandRows(rows, filters)),
    [rows, filters],
  )
  const totals = useMemo(() => computeStockOnHandTotals(visibleRows), [visibleRows])

  return (
    <div className="space-y-4">
      <ReportFilterBar
        from={filters.from}
        to={filters.to}
        onDateRangeChange={(from, to) => setFilters({ ...filters, from, to })}
        ownerId={filters.ownerId}
        onOwnerIdChange={(id) => setFilters({ ...filters, ownerId: id })}
        typeIds={filters.typeIds}
        onTypeIdsChange={(ids) => setFilters({ ...filters, typeIds: ids })}
        typeMultiSelect
        productTypes={productTypes}
        calibreIds={filters.calibreIds}
        onCalibreIdsChange={(ids) => setFilters({ ...filters, calibreIds: ids })}
        calibreMultiSelect
        calibres={calibres}
        statusOptions={STATUS_OPTIONS}
        statusValues={filters.buckets}
        onStatusValuesChange={(values) => setFilters({ ...filters, buckets: values as StockBucket[] })}
        statusMultiSelect
        owners={owners}
        search={filters.search}
        onSearchChange={(v) => setFilters({ ...filters, search: v })}
        searchPlaceholder="Barkod yoki seriya qidirish"
        onReset={() => setFilters(defaultStockOnHandFilters())}
      />

      <StockOnHandHeader totals={totals} turnaroundAvgDays={turnaroundAvgDays} />

      {error && <StatusNote tone="problem">{error}</StatusNote>}

      {loading ? (
        <p className="text-sm text-slate-400">Yuklanmoqda…</p>
      ) : visibleRows.length === 0 ? (
        <p className="text-sm text-slate-400">
          {rows.length === 0 ? "Omborda hech narsa yo'q." : 'Filtrga mos natija topilmadi.'}
        </p>
      ) : (
        <StockOnHandTable
          rows={visibleRows}
          ownerName={ownerName}
          typeName={typeName}
          calibreLabel={calibreLabel}
          onOpenPassport={setPassportSerial}
        />
      )}

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
