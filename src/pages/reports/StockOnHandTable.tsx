import { Fragment } from 'react'
import type { StockOnHandRow } from '../../lib/stockOnHand'
import { STOCK_BUCKET_LABEL, STOCK_BUCKET_BADGE_CLASS } from '../../lib/stockOnHand'

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'
const td = 'px-3 py-2 align-top'

export const STOCK_TABLE_COLUMN_COUNT = 7

// §3.2.6 results table — same furniture as §3.2.4's ReportResultsTable (a
// real <table>, row expand via a per-row toggle, passport drill-down from
// the expand panel): no new interaction pattern for this saved view. Rows
// arrive pre-sorted (useStockOnHand.ts) buyurtmachi -> tur -> kalibr ->
// holat -- that sort order IS the "grouped" requirement, not a collapsible
// tree this engine has never had.
export function StockOnHandTable({
  rows,
  expandedKey,
  onToggle,
  ownerName,
  typeName,
  calibreLabel,
  onOpenPassport,
}: {
  rows: StockOnHandRow[]
  expandedKey: string | null
  onToggle: (key: string) => void
  ownerName: (id: string) => string
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
  onOpenPassport: (serial: string) => void
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
      <table className="w-full min-w-[860px] border-collapse">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
            <th className={th}>Buyurtmachi</th>
            <th className={th}>Tur</th>
            <th className={th}>Kalibr</th>
            <th className={th}>Holat</th>
            <th className={`${th} text-right`}>Miqdor, kg</th>
            <th className={`${th} text-right`}>Necha kun</th>
            <th className={th} aria-label="Batafsil" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = expandedKey === row.rowKey
            return (
              <Fragment key={row.rowKey}>
                <tr
                  onClick={() => onToggle(row.rowKey)}
                  className="cursor-pointer border-b border-slate-200 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
                >
                  <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{ownerName(row.ownerId)}</td>
                  <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{typeName(row.typeId)}</td>
                  <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>
                    {row.calibreId ? calibreLabel(row.calibreId) : '—'}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STOCK_BUCKET_BADGE_CLASS[row.bucket]}`}>
                      {STOCK_BUCKET_LABEL[row.bucket]}
                    </span>
                  </td>
                  <td className={`${td} whitespace-nowrap text-right tabular-nums font-medium text-slate-900 dark:text-slate-100`}>
                    {Math.round(row.qtyKg).toLocaleString()} kg
                  </td>
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
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggle(row.rowKey)
                      }}
                      aria-expanded={expanded}
                      aria-label={expanded ? 'Yopish' : 'Batafsil'}
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                      {expanded ? '▲' : '▼'}
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <td colSpan={STOCK_TABLE_COLUMN_COUNT} className="bg-slate-50 px-3 py-3 text-sm dark:bg-slate-900/40">
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                        <span>
                          <span className="text-slate-500 dark:text-slate-400">Barkod / seriya: </span>
                          <span className="font-mono text-slate-900 dark:text-slate-100">{row.barcode2 ?? row.serial}</span>
                        </span>
                        <span>
                          <span className="text-slate-500 dark:text-slate-400">Sana: </span>
                          <span className="text-slate-900 dark:text-slate-100">{row.anchorDate}</span>
                        </span>
                        {row.aged90 && (
                          <span className="font-medium text-red-600 dark:text-red-400">Diqqat: 90 kundan ortiq</span>
                        )}
                        <button
                          type="button"
                          onClick={() => onOpenPassport(row.serial)}
                          className="text-slate-600 underline decoration-dotted hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                        >
                          Seriya pasportini ko'rish →
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
