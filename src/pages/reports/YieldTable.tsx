import { Fragment } from 'react'
import type { YieldRow } from '../../lib/yield'

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'
const td = 'px-3 py-2 align-top'

export const YIELD_TABLE_COLUMN_COUNT = 8

// §3.2.8 results table — same furniture as §3.2.6's StockOnHandTable (a real
// <table>, row expand via a per-row toggle, passport drill-down from the
// expand panel): no new interaction pattern for this saved view either.
export function YieldTable({
  rows,
  expandedKey,
  onToggle,
  ownerName,
  typeName,
  calibreLabel,
  onOpenPassport,
}: {
  rows: YieldRow[]
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
            <th className={th}>Seriya</th>
            <th className={th}>Buyurtmachi</th>
            <th className={th}>Tur</th>
            <th className={th}>Tugagan sana</th>
            <th className={`${th} text-right`}>Xom (yuborilgan), kg</th>
            <th className={`${th} text-right`}>Chiqish, kg</th>
            <th className={`${th} text-right`}>Yo'qotish</th>
            <th className={`${th} text-right`}>Quruq moddaga solishtirilgan yo'qotish</th>
            <th className={th} aria-label="Batafsil" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = expandedKey === row.serial
            return (
              <Fragment key={row.serial}>
                <tr
                  onClick={() => onToggle(row.serial)}
                  className="cursor-pointer border-b border-slate-200 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
                >
                  <td className={`${td} whitespace-nowrap font-mono text-slate-700 dark:text-slate-300`}>
                    {row.serial}
                    {row.rewashed && (
                      <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                        sikl {row.maxCycleNo}
                      </span>
                    )}
                  </td>
                  <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{ownerName(row.ownerId)}</td>
                  <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{typeName(row.typeId)}</td>
                  <td className={`${td} whitespace-nowrap text-slate-600 dark:text-slate-300`}>{row.completedDate}</td>
                  <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                    {Math.round(row.rawConsumedKg).toLocaleString()} kg
                    {row.rawOverageKg > 0 && (
                      <span className="ml-1.5 rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/30 dark:text-red-400">
                        +{Math.round(row.rawOverageKg).toLocaleString()} ortiqcha
                      </span>
                    )}
                  </td>
                  <td className={`${td} whitespace-nowrap text-right tabular-nums font-medium text-slate-900 dark:text-slate-100`}>
                    {Math.round(row.outputKg).toLocaleString()} kg
                  </td>
                  <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                    {Math.round(row.lossKg).toLocaleString()} kg ({row.lossPct}%)
                  </td>
                  <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                    {row.dryMatterAvailable ? (
                      `${row.trueLossPct}%`
                    ) : (
                      <span className="text-slate-400">ma'lumot yo'q</span>
                    )}
                  </td>
                  <td className={`${td} text-right`}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggle(row.serial)
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
                    <td colSpan={YIELD_TABLE_COLUMN_COUNT} className="bg-slate-50 px-3 py-3 text-sm dark:bg-slate-900/40">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                          <span>
                            <span className="text-slate-500 dark:text-slate-400">Moshina / haydovchi: </span>
                            <span className="text-slate-900 dark:text-slate-100">{row.plate} · {row.driver}</span>
                          </span>
                          <span>
                            <span className="text-slate-500 dark:text-slate-400">Yalpi hosildorlik: </span>
                            <span className="font-medium text-slate-900 dark:text-slate-100">{row.grossYieldPct}%</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => onOpenPassport(row.serial)}
                            className="text-slate-600 underline decoration-dotted hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                          >
                            Seriya pasportini ko'rish →
                          </button>
                        </div>

                        <div>
                          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Kalibr tarkibi (chiqish %)
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {row.calibreMix.map((c) => (
                              <span key={c.calibreId} className="text-slate-700 dark:text-slate-300">
                                {calibreLabel(c.calibreId)}: <span className="font-medium">{Math.round(c.kg).toLocaleString()} kg ({c.pct}%)</span>
                              </span>
                            ))}
                          </div>
                        </div>

                        <div>
                          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Quruq moddaga solishtirilgan hisob
                          </div>
                          {row.dryMatterAvailable ? (
                            <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-700 dark:text-slate-300">
                              <span>Kirish namligi: <span className="font-medium">{row.intakeMoisturePct}%</span></span>
                              <span>Chiqish namligi: <span className="font-medium">{row.deliveredMoisturePct}%</span></span>
                              <span>Quruq modda (kirish): <span className="font-medium">{Math.round(row.dryMatterInKg ?? 0).toLocaleString()} kg</span></span>
                              <span>Quruq modda (chiqish): <span className="font-medium">{Math.round(row.dryMatterOutKg ?? 0).toLocaleString()} kg</span></span>
                              <span>Haqiqiy yo'qotish: <span className="font-medium">{row.trueLossPct}%</span></span>
                            </div>
                          ) : (
                            <span className="text-slate-400">
                              Quruq moddaga solishtirilgan hisob mavjud emas — kirish yoki chiqish namligi o'lchovi yo'q (faqat yalpi ko'rsatkich yuqorida).
                            </span>
                          )}
                        </div>

                        {row.rawOverageKg > 0 && (
                          <div className="text-red-600 dark:text-red-400">
                            Diqqat: qayd etilgan xom ashyodan ({Math.round(row.rawReceivedKg).toLocaleString()} kg) ko'proq yuvishga yuborilgan
                            ({Math.round(row.rawConsumedKg).toLocaleString()} kg, +{Math.round(row.rawOverageKg).toLocaleString()} kg ortiqcha).
                          </div>
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
