import type { StockOnHandRow } from '../../lib/stockOnHand'
import { STOCK_BUCKET_LABEL, STOCK_BUCKET_BADGE_CLASS } from '../../lib/stockOnHand'

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'
const td = 'px-3 py-2 align-top'

// §3.2.6 results table, reworked this task: one row per barcode (requirement
// A) — a finished pallet's Barcode #2, or a raw balance's Barcode #1 (which
// IS the serial — barcodeLabel.ts renders Barcode #1 as the serial value
// itself, so there's no separate id to carry). No more expand panel: every
// field that used to hide behind one (barcode/serial, date) is now its own
// column, so the only thing left to reach via a click is the passport
// itself — a direct per-row action instead of expand-then-click.
export function StockOnHandTable({
  rows,
  ownerName,
  typeName,
  calibreLabel,
  onOpenPassport,
}: {
  rows: StockOnHandRow[]
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
            <th className={th}>Barkod</th>
            <th className={th}>Buyurtmachi</th>
            <th className={th}>Tur</th>
            <th className={th}>Kalibr</th>
            <th className={`${th} text-right`}>Miqdor, kg</th>
            <th className={`${th} text-right`}>Namligi</th>
            <th className={th}>Holat</th>
            <th className={th}>Sana</th>
            <th className={`${th} text-right`}>Necha kun</th>
            <th className={th} aria-label="Pasport" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.rowKey}
              className="border-b border-slate-200 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
            >
              <td className={`${td} whitespace-nowrap font-mono text-slate-900 dark:text-slate-100`}>
                {row.barcode2 ?? row.serial}
              </td>
              <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{ownerName(row.ownerId)}</td>
              <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{typeName(row.typeId)}</td>
              <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>
                {row.calibreId ? calibreLabel(row.calibreId) : '—'}
              </td>
              <td className={`${td} whitespace-nowrap text-right tabular-nums font-medium text-slate-900 dark:text-slate-100`}>
                {Math.round(row.qtyKg).toLocaleString()} kg
              </td>
              <td className={`${td} whitespace-nowrap text-right tabular-nums text-slate-700 dark:text-slate-300`}>
                {row.moisturePct === null ? '—' : `${row.moisturePct}%`}
              </td>
              <td className={`${td} whitespace-nowrap`}>
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STOCK_BUCKET_BADGE_CLASS[row.bucket]}`}>
                  {STOCK_BUCKET_LABEL[row.bucket]}
                </span>
              </td>
              <td className={`${td} whitespace-nowrap text-slate-600 dark:text-slate-300`}>{row.anchorDate}</td>
              <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                {row.aged90 ? (
                  <span className="font-medium text-red-600 dark:text-red-400">{row.daysHeld} kun</span>
                ) : (
                  <span className="text-slate-600 dark:text-slate-300">{row.daysHeld} kun</span>
                )}
              </td>
              <td className={`${td} text-right`}>
                <button
                  type="button"
                  onClick={() => onOpenPassport(row.serial)}
                  className="text-slate-400 underline decoration-dotted hover:text-slate-700 dark:hover:text-slate-200"
                >
                  Pasport →
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
