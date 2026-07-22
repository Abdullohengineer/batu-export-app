import type { ReportRow } from '../../lib/reportQuery'
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
export function ReportResultsTable({
  rows,
  expandedKey,
  onToggle,
  ownerName,
  typeName,
  calibreLabel,
  onOpenPassport,
}: {
  rows: ReportRow[]
  expandedKey: string | null
  onToggle: (key: string) => void
  ownerName: (id: string) => string
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
  onOpenPassport: (serial: string) => void
}) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700 lg:block">
        <table className="w-full min-w-[960px] border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
              <th className={th}>Yo'nalish</th>
              <th className={th}>Sana</th>
              <th className={th}>Seriya / Barcode #2</th>
              <th className={th}>Buyurtmachi</th>
              <th className={th}>Tur</th>
              <th className={th}>Kalibr</th>
              <th className={`${th} text-right`}>Miqdor, kg</th>
              <th className={th}>Moshina</th>
              <th className={th}>Haydovchi</th>
              <th className={th}>Holat</th>
              <th className={th} aria-label="Batafsil" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ReportTableRow
                key={row.key}
                row={row}
                expanded={expandedKey === row.key}
                onToggle={() => onToggle(row.key)}
                ownerName={ownerName}
                typeName={typeName}
                calibreLabel={calibreLabel}
                onOpenPassport={onOpenPassport}
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
            onOpenPassport={onOpenPassport}
          />
        ))}
      </div>
    </>
  )
}
