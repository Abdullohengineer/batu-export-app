import type { ReportRow } from '../../lib/reportQuery'
import { ReportTableRow } from './ReportTableRow'

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'

// §3.2.4 results table — DESKTOP rework. Menejer and Rahbar use this
// screen on PCs (phones are Ombor/Qorovul/Laborator's surface); a real
// <table> — the first in this codebase — replaces the phone-oriented
// card+expand this screen shipped with first (see DECISIONS.md "Reporting
// results view: desktop rework" for why that was the wrong read for THIS
// surface specifically). Operational screens keep the card pattern
// unchanged; this one column layout is what every later saved view built
// on this engine inherits.
//
// `min-w-[960px]` + the wrapper's `overflow-x-auto` is the full answer to
// "must remain readable and horizontally scrollable on narrow screens, but
// do not compromise the desktop layout for it" — columns never shrink or
// wrap; a narrow viewport scrolls the whole table sideways instead.
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
    <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
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
  )
}
