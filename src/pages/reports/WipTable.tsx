import { Fragment } from 'react'
import type { WipRow } from '../../lib/wip'
import { WIP_KIND_LABEL } from '../../lib/wip'

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'
const td = 'px-3 py-2 align-top'

export const WIP_TABLE_COLUMN_COUNT = 6

// §3.2.9 results table — same furniture as §3.2.4/§3.2.6 (a real <table>,
// row expand, passport drill-down where a serial exists). One exception per
// row; chiqim_open rows have a request, not a serial, so their expand panel
// has no passport button (nothing to drill into).
export function WipTable({
  rows,
  expandedKey,
  onToggle,
  ownerName,
  typeName,
  onOpenPassport,
}: {
  rows: WipRow[]
  expandedKey: string | null
  onToggle: (key: string) => void
  ownerName: (id: string) => string
  typeName: (id: string | null) => string
  onOpenPassport: (serial: string) => void
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
      <table className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
            <th className={th}>Turi</th>
            <th className={th}>Buyurtmachi</th>
            <th className={th}>Tur</th>
            <th className={th}>Seriya / So'rov</th>
            <th className={`${th} text-right`}>Necha kun</th>
            <th className={th} aria-label="Batafsil" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = expandedKey === row.rowKey
            const overThreshold = row.thresholdDays !== null && row.daysWaiting !== null
            return (
              <Fragment key={`${row.wipKind}-${row.rowKey}`}>
                <tr
                  onClick={() => onToggle(row.rowKey)}
                  className="cursor-pointer border-b border-slate-200 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
                >
                  <td className={`${td} whitespace-nowrap`}>
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                      {WIP_KIND_LABEL[row.wipKind]}
                    </span>
                  </td>
                  <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{ownerName(row.ownerId)}</td>
                  <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{typeName(row.typeId)}</td>
                  <td className={`${td} whitespace-nowrap font-mono text-slate-900 dark:text-slate-100`}>
                    {row.serial ?? (row.requestId ? `So'rov ${row.requestId.slice(0, 8)}` : '—')}
                  </td>
                  <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                    {row.daysWaiting === null ? (
                      <span className="text-slate-400">—</span>
                    ) : overThreshold ? (
                      <span className="font-medium text-red-600 dark:text-red-400">{row.daysWaiting} kun</span>
                    ) : (
                      <span className="text-slate-600 dark:text-slate-300">{row.daysWaiting} kun</span>
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
                    <td colSpan={WIP_TABLE_COLUMN_COUNT} className="bg-slate-50 px-3 py-3 text-sm dark:bg-slate-900/40">
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                        <span>
                          <span className="text-slate-500 dark:text-slate-400">Chegara: </span>
                          <span className="text-slate-900 dark:text-slate-100">
                            {row.thresholdDays === null ? 'shart yo\'q — doim ko\'rinadi' : `${row.thresholdDays} kun`}
                          </span>
                        </span>
                        {row.serial && (
                          <button
                            type="button"
                            onClick={() => onOpenPassport(row.serial!)}
                            className="text-slate-600 underline decoration-dotted hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                          >
                            Seriya pasportini ko'rish →
                          </button>
                        )}
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
