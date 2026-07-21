import { useState } from 'react'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useYieldRows } from '../../lib/useYieldRows'
import { YIELD_LOSS_BASIS_NOTE } from '../../lib/yield'
import { defaultDateRange } from '../../lib/dateRange'
import { downloadYieldExcel } from '../../lib/yieldExport'
import { YieldTable } from './YieldTable'
import { SerialPassportModal } from './SerialPassportModal'

// §3.2.8 Moisture-adjusted yield — per serial/product/client/period, same
// "a lookup is a filter, not a separate screen" principle §3.2's whole
// engine already follows: filtering by client/product/period IS the
// grouping, no separate aggregate screen needed (§5.5.6 precedent). Mounted
// at /menejer/hosildorlik and /rahbar/hosildorlik, same read-only-for-Rahbar
// shape as every other §3.2 saved view.
export function YieldTab() {
  const initial = defaultDateRange(90)
  // §3.3: includeInactive=true -- this screen resolves ids on historical
  // serials (a completed serial's owner/type/calibre must never fall back
  // to a raw uuid just because that master-data row was later deactivated)
  // and its own filter selects must still be able to pick a deactivated
  // client/type to view their history.
  const { owners } = useOwners(true)
  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)

  const [ownerId, setOwnerId] = useState<string>('')
  const [typeId, setTypeId] = useState<string>('')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [passportSerial, setPassportSerial] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const { rows, loading } = useYieldRows(ownerId || null, typeId || null, from, to)

  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }

  const withDryMatter = rows.filter((r) => r.dryMatterAvailable).length
  const totalRawConsumed = rows.reduce((sum, r) => sum + r.rawConsumedKg, 0)
  const totalOutput = rows.reduce((sum, r) => sum + r.outputKg, 0)
  const totalLoss = rows.reduce((sum, r) => sum + r.lossKg, 0)
  const rewashCount = rows.filter((r) => r.rewashed).length

  async function handleExport() {
    setExporting(true)
    try {
      await downloadYieldExcel(rows, from, to, { ownerName, typeName, calibreLabel })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
          Buyurtmachi
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="">Barchasi</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
          Mahsulot turi
          <select
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="">Barchasi</option>
            {productTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
          Dan
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
          Gacha
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || rows.length === 0}
          className="ml-auto rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {exporting ? 'Tayyorlanmoqda…' : 'Excel yuklab olish'}
        </button>
      </div>

      <p className="text-xs text-slate-400">{YIELD_LOSS_BASIS_NOTE}</p>

      {loading ? (
        <p className="text-sm text-slate-400">Yuklanmoqda…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">Tanlangan davrda tugallangan seriya yo'q.</p>
      ) : (
        <>
          <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-slate-200 bg-slate-50/95 px-4 py-2 text-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
            <span className="text-slate-700 dark:text-slate-300">
              Xom (yuborilgan): <span className="font-medium text-slate-900 dark:text-slate-100">{Math.round(totalRawConsumed).toLocaleString()} kg</span>
            </span>
            <span className="text-slate-700 dark:text-slate-300">
              Chiqish: <span className="font-medium text-slate-900 dark:text-slate-100">{Math.round(totalOutput).toLocaleString()} kg</span>
            </span>
            <span className="text-slate-700 dark:text-slate-300">
              Yo'qotish: <span className="font-medium text-slate-900 dark:text-slate-100">
                {Math.round(totalLoss).toLocaleString()} kg ({totalRawConsumed > 0 ? Math.round((totalLoss / totalRawConsumed) * 1000) / 10 : 0}%)
              </span>
            </span>
            <span className="text-slate-700 dark:text-slate-300">
              Qayta yuvilgan: <span className="font-medium text-slate-900 dark:text-slate-100">{rewashCount} / {rows.length}</span>
            </span>
            <span className="text-xs text-slate-400">
              Quruq moddaga solishtirilgan hisob: {withDryMatter} / {rows.length} seriyada mavjud
            </span>
          </div>

          <YieldTable
            rows={rows}
            expandedKey={expandedKey}
            onToggle={(key) => setExpandedKey(expandedKey === key ? null : key)}
            ownerName={ownerName}
            typeName={typeName}
            calibreLabel={calibreLabel}
            onOpenPassport={setPassportSerial}
          />
          <p className="text-xs text-slate-400">{rows.length} ta seriya</p>
        </>
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
