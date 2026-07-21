import { useState } from 'react'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useSettingsLimits } from '../../lib/useSettingsLimits'
import { useMonthlyTrends, useClientRankingAndProductMix, useLabTurnaroundAvg } from '../../lib/useRahbarDashboard'
import { defaultDateRange } from '../../lib/dateRange'

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'
const td = 'px-3 py-2 align-top text-sm'

// §6.1 Umumiy ko'rinish (Oversight) — Rahbar's own landing page, now backed
// by §3.2.10's aggregates: trends by month, client ranking, product mix.
// Rahbar-only (unlike the shared §3.2 saved views) — reads the same tables
// everyone else does, read-only throughout (§2.12), no write action anywhere
// on this page.
export function RahbarHome() {
  const initial = defaultDateRange(30)
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)

  // §3.3: includeInactive=true -- monthly trends/product-mix resolve ids
  // over historical months, which may reference a since-deactivated type.
  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)
  const { limits } = useSettingsLimits()
  const { rows: trends, loading: trendsLoading } = useMonthlyTrends()
  const { ranking, productMix, loading: rankingLoading } = useClientRankingAndProductMix(from, to)
  const { avgDays: labTurnaroundAvg } = useLabTurnaroundAvg()

  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }

  // §2.14: capacity utilisation is hidden ENTIRELY (not shown as 0%/"n/a")
  // until a real practical_capacity_kg_per_month is configured — confirmed
  // with the user: a guessed denominator produces a meaningless percentage.
  const capacityConfigured = Boolean(limits.practical_capacity_kg_per_month)
  const latestMonth = trends.length > 0 ? trends[trends.length - 1] : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
        <span className="text-slate-700 dark:text-slate-300">
          Tahlil o'rtacha muddati:{' '}
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {labTurnaroundAvg === null ? "ma'lumot yo'q" : `${labTurnaroundAvg.toFixed(1)} kun`}
          </span>
        </span>
        {capacityConfigured && latestMonth?.utilizationPct !== null && (
          <span className="text-slate-700 dark:text-slate-300">
            Sig'imdan foydalanish (joriy oy):{' '}
            <span className="font-medium text-slate-900 dark:text-slate-100">{latestMonth?.utilizationPct}%</span>
          </span>
        )}
        <span className="text-xs text-slate-400">
          Ikkalasi birga: yuvish sig'imi yaxshi ko'rinsa ham, laboratoriya kechiksa jo'natish to'xtab qolishi mumkin.
        </span>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Oylik dinamika</h2>
        {trendsLoading ? (
          <p className="text-sm text-slate-400">Yuklanmoqda…</p>
        ) : trends.length === 0 ? (
          <p className="text-sm text-slate-400">Ma'lumot yo'q.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-[960px] border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
                  <th className={th}>Oy</th>
                  <th className={`${th} text-right`}>Kirim, kg</th>
                  <th className={`${th} text-right`}>Chiqim, kg</th>
                  <th className={`${th} text-right`}>Yalpi hosildorlik</th>
                  <th className={`${th} text-right`}>Yo'qotish</th>
                  <th className={`${th} text-right`}>Quruq moddaga solishtirilgan yo'qotish</th>
                  <th className={`${th} text-right`}>Qayta yuvish darajasi</th>
                  {capacityConfigured && <th className={`${th} text-right`}>Sig'imdan foydalanish</th>}
                  <th className={th}>Kalibr tarkibi</th>
                </tr>
              </thead>
              <tbody>
                {trends.map((row) => (
                  <tr key={row.month} className="border-b border-slate-200 text-sm dark:border-slate-700">
                    <td className={`${td} whitespace-nowrap font-medium text-slate-900 dark:text-slate-100`}>{row.month.slice(0, 7)}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{Math.round(row.volumeInKg).toLocaleString()}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{Math.round(row.volumeOutKg).toLocaleString()}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{row.grossYieldPct === null ? '—' : `${row.grossYieldPct}%`}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{row.grossLossPct === null ? '—' : `${row.grossLossPct}%`}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                      {row.dryMatterTrueLossPct === null ? (
                        <span className="text-slate-400">ma'lumot yo'q</span>
                      ) : (
                        `${row.dryMatterTrueLossPct}% (${row.dryMatterSerialCount}/${row.yieldSerialCount})`
                      )}
                    </td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                      {row.rewashRatePct === null ? '—' : `${row.rewashRatePct}% (${row.rewashCount}/${row.yieldSerialCount})`}
                    </td>
                    {capacityConfigured && (
                      <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{row.utilizationPct === null ? '—' : `${row.utilizationPct}%`}</td>
                    )}
                    <td className={`${td} whitespace-nowrap`}>
                      {row.calibreMix.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        row.calibreMix.map((c) => (
                          <span key={c.calibreId} className="mr-3 text-slate-600 dark:text-slate-300">
                            {calibreLabel(c.calibreId)} {c.pct}%
                          </span>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Buyurtmachilar reytingi va mahsulot tarkibi</h2>
          <div className="flex gap-3">
            <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
              Dan
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" />
            </label>
            <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
              Gacha
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" />
            </label>
          </div>
        </div>

        {rankingLoading ? (
          <p className="text-sm text-slate-400">Yuklanmoqda…</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
                    <th className={th}>Buyurtmachi</th>
                    <th className={`${th} text-right`}>Qabul, kg</th>
                    <th className={`${th} text-right`}>Jo'natilgan, kg</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.length === 0 ? (
                    <tr>
                      <td className={td} colSpan={3}>
                        <span className="text-slate-400">Davrda faoliyat yo'q.</span>
                      </td>
                    </tr>
                  ) : (
                    ranking.map((r) => (
                      <tr key={r.ownerId} className="border-b border-slate-200 text-sm dark:border-slate-700">
                        <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{r.ownerName}</td>
                        <td className={`${td} whitespace-nowrap text-right tabular-nums font-medium text-slate-900 dark:text-slate-100`}>
                          {Math.round(r.receivedKg).toLocaleString()}
                        </td>
                        <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{Math.round(r.dispatchedKg).toLocaleString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
                    <th className={th}>Mahsulot turi</th>
                    <th className={`${th} text-right`}>Qabul, kg</th>
                    <th className={`${th} text-right`}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {productMix.length === 0 ? (
                    <tr>
                      <td className={td} colSpan={3}>
                        <span className="text-slate-400">Davrda faoliyat yo'q.</span>
                      </td>
                    </tr>
                  ) : (
                    productMix.map((p) => (
                      <tr key={p.typeId} className="border-b border-slate-200 text-sm dark:border-slate-700">
                        <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{typeName(p.typeId)}</td>
                        <td className={`${td} whitespace-nowrap text-right tabular-nums font-medium text-slate-900 dark:text-slate-100`}>
                          {Math.round(p.receivedKg).toLocaleString()}
                        </td>
                        <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{p.pctOfTotal}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
