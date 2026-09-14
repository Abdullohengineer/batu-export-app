import type { ReportRow } from '../../lib/reportQuery'
import { REPORT_COLUMNS } from '../../lib/reportColumns'
import { ReportTableRow } from './ReportTableRow'
import { ReportRowCard } from './ReportRowCard'

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'

// §3.2.4 results table — DESKTOP rework, still the primary rendering (see
// DECISIONS.md "Reporting results view: desktop rework"). Nav/visual-
// redesign pass adds a second, narrow-viewport rendering (ReportRowCard,
// matching the mockup's mobile "Tarix" cards) alongside it -- picked by a
// CSS breakpoint (`lg:`), not a separate data path: both read the exact
// same `rows` prop, same onToggle/onOpenPassport callbacks, same
// KirimRowDetail/ChiqimRowDetail expand content underneath. Only one of
// the two is ever actually rendered-and-visible at a given viewport (the
// other's wrapper is `hidden`/`lg:hidden`), so there's no duplicate
// accessible content for any assistive tech or automated test to trip on.
//
// `min-w-[960px]` + the wrapper's `overflow-x-auto` remains the desktop
// table's own answer for "must stay usable on a slightly narrow desktop
// window" — columns never shrink/wrap there; the card rendering below is
// what actually serves phone-width viewports now, not a horizontal scroll
// of the same dense table.
//
// Column picker (2026-08-15): header + row cells both driven by the same
// ordered, visibility-filtered column list (src/lib/reportColumns.ts) —
// previously the column set was hardcoded here AND in ReportTableRow.tsx
// independently, with nothing keeping the two in sync. ReportRowCard
// (mobile) is deliberately untouched — it's a fixed summary card, not a
// column-based layout, and was out of scope for this change.
export function ReportResultsTable({
  rows,
  visibleColumnKeys,
  expandedKey,
  onToggle,
  ownerName,
  typeName,
  calibreLabel,
  truckType,
  onOpenPassport,
  onOpenOldKnRequest,
}: {
  rows: ReportRow[]
  visibleColumnKeys: Set<string>
  expandedKey: string | null
  onToggle: (key: string) => void
  ownerName: (id: string) => string
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
  truckType: (requestId: string) => string
  onOpenPassport: (serial: string) => void
  onOpenOldKnRequest: (requestId: string) => void
}) {
  const visibleColumns = REPORT_COLUMNS.filter((c) => visibleColumnKeys.has(c.key))

  return (
    <>
      <div className="hidden overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700 lg:block">
        <table className="w-full min-w-[960px] border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
              {visibleColumns.map((col) => (
                <th key={col.key} className={col.align === 'right' ? `${th} text-right` : th}>
                  {col.label}
                </th>
              ))}
              <th className={th} aria-label="Batafsil" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ReportTableRow
                key={row.key}
                row={row}
                visibleColumns={visibleColumns}
                expanded={expandedKey === row.key}
                onToggle={() => onToggle(row.key)}
                ownerName={ownerName}
                typeName={typeName}
                calibreLabel={calibreLabel}
                truckType={truckType}
                onOpenPassport={onOpenPassport}
                onOpenOldKnRequest={onOpenOldKnRequest}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 lg:hidden">
        {rows.map((row) => (
          <ReportRowCard
            key={row.key}
            row={row}
            expanded={expandedKey === row.key}
            onToggle={() => onToggle(row.key)}
            ownerName={ownerName}
            typeName={typeName}
            calibreLabel={calibreLabel}
            truckType={truckType}
            onOpenPassport={onOpenPassport}
            onOpenOldKnRequest={onOpenOldKnRequest}
          />
        ))}
      </div>
    </>
  )
}
