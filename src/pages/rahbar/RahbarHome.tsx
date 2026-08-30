import { useMemo, useState } from 'react'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useRahbarStockSnapshot, useRahbarDashboardLedger } from '../../lib/useRahbarDashboardV2'
import { SCOPE_LABEL, type ZaxiraScope, type ByCalibreTypeRow } from '../../lib/rahbarDashboardV2'
import { formatLossKg, formatLossPct } from '../../lib/formatLoss'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'

// Rahbar "Bosh sahifa" -- stock-reconciliation dashboard, rebuilt against
// docs/mockups/BATU-Rahbar-dashboard-v3.html (2026-08-14). Replaces this
// route's previous trends/ranking/product-mix content -- see DECISIONS.md
// 2026-08-14 "migration applied, frontend built" for why that content isn't
// relocated (task didn't specify a destination; rahbar_monthly_trends etc.
// and useRahbarDashboard.ts are untouched, just unrouted for now).
//
// Reads ONLY rahbar_stock_snapshot / rahbar_dashboard_ledger
// (useRahbarDashboardV2.ts). No balance arithmetic here beyond re-slicing
// the already-summed byCalibreType rows by the Turlar filter -- a client-
// side regroup of server totals, not a new sum.

const BOSHIDAN = '2026-07-15'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function firstOfMonth(d: Date): string {
  return isoOf(new Date(d.getFullYear(), d.getMonth(), 1))
}
function lastMonthRange(): { from: string; to: string } {
  const now = new Date()
  const firstThis = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastPrev = new Date(firstThis.getTime() - 86400000)
  return { from: firstOfMonth(lastPrev), to: isoOf(lastPrev) }
}

type PeriodPreset = 'boshidan' | 'bu_oy' | 'otgan_oy' | 'custom'

const PERIOD_LABEL: Record<PeriodPreset, string> = {
  boshidan: 'Boshidan',
  bu_oy: 'Bu oy',
  otgan_oy: "O'tgan oy",
  custom: 'Boshqa davr',
}

function fmt(v: number): string {
  return Math.round(v).toLocaleString()
}

// Palette -- amber/emerald/red already load-bearing tokens.ts tones (xom /
// ok / departed). Purple and the muted pool-stock tone aren't in tokens.ts
// (no existing "Konditirskiy" or "pool stock" status concept there) so
// they're named locally, once, rather than scattered ad hoc classes.
const C = {
  raw: '#d97706', // amber-600
  rawBg: '#fef3c7', // amber-100
  moyka: '#0369a1', // sky-700 -- in-process, between raw and finished
  moykaBg: '#e0f2fe', // sky-100
  calibre: '#059669', // emerald-600
  calibreBg: '#d1fae5', // emerald-100
  kn: '#9333ea', // purple-600
  knBg: '#f3e8ff', // purple-100
  oldKn: '#78716c', // stone-500 -- deliberately muted/separate, "pool stock"
  oldKnBg: '#e7e5e4', // stone-200
  departed: '#dc2626', // red-600 -- material that left the factory
  loss: '#334155', // slate-700 -- lost in washing, not departed: black, not red
  lossBg: '#e2e8f0',
}

function Tile({ label, value, unit, caption, tone }: { label: string; value: number; unit?: string; caption: string; tone: 'raw' | 'moyka' | 'calibre' | 'kn' | 'oldKn' | 'neutral' }) {
  const bg = tone === 'raw' ? C.rawBg : tone === 'moyka' ? C.moykaBg : tone === 'calibre' ? C.calibreBg : tone === 'kn' ? C.knBg : tone === 'oldKn' ? C.oldKnBg : '#f4efe6'
  const fg = tone === 'raw' ? C.raw : tone === 'moyka' ? C.moyka : tone === 'calibre' ? C.calibre : tone === 'kn' ? C.kn : tone === 'oldKn' ? C.oldKn : '#5d5140'
  return (
    <div className="rounded-xl p-4" style={{ background: bg }}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-75" style={{ color: fg }}>
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-extrabold tabular-nums" style={{ color: fg }}>
        {fmt(value)}
        {unit && <span className="ml-1 text-sm font-semibold opacity-60">{unit}</span>}
      </div>
      <div className="mt-1.5 text-xs opacity-70" style={{ color: fg }}>
        {caption}
      </div>
    </div>
  )
}

function Bar({ label, value, max, color, pctOfLabel }: { label: string; value: number; max: number; color: string; pctOfLabel?: string }) {
  const widthPct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 1.5 : 0) : 0
  return (
    <div className="grid grid-cols-[100px_1fr_92px] items-center gap-3 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <div className="h-6 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-md" style={{ width: `${widthPct}%`, background: color }} />
      </div>
      <span className="text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {fmt(value)}
        {pctOfLabel && <small className="ml-1 font-normal text-slate-400">{pctOfLabel}</small>}
      </span>
    </div>
  )
}

export function RahbarHome() {
  const [scope, setScope] = useState<ZaxiraScope>('yangi')
  const [preset, setPreset] = useState<PeriodPreset>('boshidan')
  const [customFrom, setCustomFrom] = useState(BOSHIDAN)
  const [customTo, setCustomTo] = useState(todayIso())
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[] | null>(null) // null = hammasi

  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)

  const { from, to } = useMemo(() => {
    if (preset === 'boshidan') return { from: BOSHIDAN, to: todayIso() }
    if (preset === 'bu_oy') return { from: firstOfMonth(new Date()), to: todayIso() }
    if (preset === 'otgan_oy') return lastMonthRange()
    return { from: customFrom, to: customTo }
  }, [preset, customFrom, customTo])

  const { snapshot, loading: snapLoading, error: snapError } = useRahbarStockSnapshot(scope)
  const { ledger, loading: ledgerLoading, error: ledgerError } = useRahbarDashboardLedger(from, to, scope)

  function calibreLabel(id: string): string {
    return calibres.find((c) => c.id === id)?.label ?? id
  }
  function isKn(id: string): boolean {
    return calibres.find((c) => c.id === id)?.is_numberless ?? false
  }

  const activeTypeIds = selectedTypeIds ?? productTypes.map((t) => t.id)

  function sliceByType(rows: ByCalibreTypeRow[]): ByCalibreTypeRow[] {
    return selectedTypeIds === null ? rows : rows.filter((r) => selectedTypeIds.includes(r.typeId))
  }

  function regroupByCalibre(rows: ByCalibreTypeRow[]): { calibreId: string; kg: number }[] {
    const map = new Map<string, number>()
    for (const r of sliceByType(rows)) map.set(r.calibreId, (map.get(r.calibreId) ?? 0) + r.kg)
    return [...map.entries()].map(([calibreId, kg]) => ({ calibreId, kg })).sort((a, b) => b.kg - a.kg)
  }

  const dispatchedKalibrliPeriod = ledger ? ledger.byCalibreType.dispatched.filter((r) => !isKn(r.calibreId)).reduce((s, r) => s + r.kg, 0) : 0
  const dispatchedKnPeriod = ledger ? ledger.byCalibreType.dispatched.filter((r) => isKn(r.calibreId)).reduce((s, r) => s + r.kg, 0) : 0

  const dispatchedByCalibre = ledger ? regroupByCalibre(ledger.byCalibreType.dispatched).filter((r) => !isKn(r.calibreId)) : []
  const dispatchedKnRows = ledger ? regroupByCalibre(ledger.byCalibreType.dispatched).filter((r) => isKn(r.calibreId)) : []
  // 2026-08-30: the per-calibre bars are a LIVE BALANCE, not a period flow.
  // They plotted the period's output under a heading a reader takes for stock:
  // for August that read K4 = 23,570 kg while only 960 kg was on hand, the rest
  // dispatched. Now off stock_on_hand_rows via rahbar_stock_snapshot -- the same
  // view Ombor qoldig'i reads, so the two screens cannot disagree. regroupByCalibre
  // is reused unchanged, which keeps the Turlar filter working on these bars.
  const stockByCalibre = snapshot ? regroupByCalibre(snapshot.byCalibre).filter((r) => !isKn(r.calibreId)) : []
  const stockKn = snapshot ? regroupByCalibre(snapshot.byCalibre).filter((r) => isKn(r.calibreId)) : []
  const stockMax = Math.max(1, ...stockByCalibre.map((r) => r.kg), ...stockKn.map((r) => r.kg))
  const stockTotal = [...stockByCalibre, ...stockKn].reduce((sum, r) => sum + r.kg, 0)
  const dispatchedMax = Math.max(1, ...dispatchedByCalibre.map((r) => r.kg), ...dispatchedKnRows.map((r) => r.kg))

  // 2026-08-30: oldKnKg deliberately EXCLUDED from the headline. Its tile was
  // removed in the same pass, so leaving it in would put 81,915 kg of real
  // client stock inside a number with nothing on screen accounting for it.
  // A recorded choice, not a side effect -- see DECISIONS.md "Rahbar dashboard
  // corrections". Old KN is now reachable only via Ombor qoldig'i and Hisobot.
  const grandTotal = snapshot ? snapshot.rawKg + snapshot.moykadaKg + snapshot.finishedCalibredKg + snapshot.konditirskiyKg : 0

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Zaxira</span>
          <div className="flex gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
            {(['yangi', 'eski', 'hammasi'] as ZaxiraScope[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                  scope === s ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {SCOPE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Davr</span>
          {(['boshidan', 'bu_oy', 'otgan_oy', 'custom'] as PeriodPreset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${
                preset === p
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                  : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'
              }`}
            >
              {p === 'custom' && preset === 'custom' ? `${from} — ${to}` : PERIOD_LABEL[p]}
            </button>
          ))}
          {preset === 'custom' && (
            <span className="flex items-center gap-1 text-sm">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-full border border-slate-300 px-2.5 py-1 text-sm dark:border-slate-700 dark:bg-slate-900" />
              —
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-full border border-slate-300 px-2.5 py-1 text-sm dark:border-slate-700 dark:bg-slate-900" />
            </span>
          )}
        </div>
      </div>

      {snapError && <StatusNote tone="problem">{snapError}</StatusNote>}
      {ledgerError && <StatusNote tone="problem">{ledgerError}</StatusNote>}

      {/* Hero tiles */}
      {snapLoading || !snapshot ? (
        <p className="text-sm text-slate-400">Yuklanmoqda…</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Tile label="Jami yuvilgan va yuvilmagan mahsulot" value={grandTotal} unit="kg" caption="Hozirgi holat — xom, moykada va tayyor" tone="neutral" />
          <Tile label="Xom · yuvilmagan" value={snapshot.rawKg} unit="kg" caption="Hozirgi holat — yuvishga tayyor" tone="raw" />
          <Tile label="Moykada" value={snapshot.moykadaKg} unit="kg" caption="Hozirgi holat — yuvilmoqda, xomdan chegirilgan, tayyorga hali qo'shilmagan" tone="moyka" />
          <Tile
            label="Tayyor · kalibrli"
            value={snapshot.finishedCalibredKg}
            unit="kg"
            caption={ledgerLoading ? 'Hozirgi qoldiq' : `Hozirgi qoldiq · bu davrda ${fmt(dispatchedKalibrliPeriod)} kg olib ketilgan`}
            tone="calibre"
          />
          <Tile
            label="Konditirskiy"
            value={snapshot.konditirskiyKg}
            unit="kg"
            caption={ledgerLoading ? 'Hozirgi qoldiq' : `Hozirgi qoldiq · bu davrda ${fmt(dispatchedKnPeriod)} kg olib ketilgan`}
            tone="kn"
          />
        </div>
      )}

      {/* Yuvib tugallangan mahsulot */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionHeading>Omborda hozir — kalibr bo'yicha</SectionHeading>
            <p className="text-xs text-slate-400">Jonli qoldiq · yuqoridagi davr tanlovi bu qatorlarga ta'sir qilmaydi</p>
          </div>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300">
              Turlar: {selectedTypeIds === null ? 'hammasi' : `${selectedTypeIds.length} tanlangan`}
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-800">
                {activeTypeIds.length} / {productTypes.length}
              </span>{' '}
              ▾
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <button type="button" className="mb-1 block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => setSelectedTypeIds(null)}>
                Hammasi
              </button>
              {productTypes.map((t) => {
                const checked = activeTypeIds.includes(t.id)
                return (
                  <label key={t.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = new Set(activeTypeIds)
                        if (checked) next.delete(t.id)
                        else next.add(t.id)
                        setSelectedTypeIds([...next])
                      }}
                    />
                    {t.name}
                  </label>
                )
              })}
            </div>
          </details>
        </div>

        {ledgerLoading || !ledger ? (
          <p className="text-sm text-slate-400">Yuklanmoqda…</p>
        ) : (
          <>
            <div className="space-y-2.5">
              {stockByCalibre.map((r) => (
                <Bar key={r.calibreId} label={calibreLabel(r.calibreId)} value={r.kg} max={stockMax} color={C.calibre} pctOfLabel={stockTotal > 0 ? `${Math.round((r.kg / stockTotal) * 100)}%` : undefined} />
              ))}
              {stockByCalibre.length === 0 && <p className="text-sm text-slate-400">Omborda kalibrlangan mahsulot yo'q.</p>}
              {stockKn.length > 0 && <div className="my-1 border-t border-slate-100 dark:border-slate-800" />}
              {stockKn.map((r) => (
                <Bar key={r.calibreId} label={calibreLabel(r.calibreId)} value={r.kg} max={stockMax} color={C.kn} pctOfLabel={stockTotal > 0 ? `${Math.round((r.kg / stockTotal) * 100)}%` : undefined} />
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Hozir omborda <strong className="text-slate-700 dark:text-slate-300">{fmt(stockTotal)} kg</strong> tayyor mahsulot — olib ketilgani chegirilgan. Bu qatorlar{' '}
              <strong className="text-slate-700 dark:text-slate-300">jonli qoldiq</strong>, davr bo'yicha ishlab chiqarish emas. Foizlar — jami qoldiqdan ulush. Konditirskiy alohida qator.
              {ledger && ` Tanlangan davrda yuvishdan chiqqan: ${fmt(ledger.moyka.calibreKg + ledger.moyka.konditirskiyKg)} kg · yo'qotish ${formatLossKg(ledger.moyka.lossKg)} (${formatLossPct(ledger.moyka.lossPct)}).`}
            </p>

            <div className="my-6 h-px bg-slate-200 dark:bg-slate-800" />

            <div className="mb-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Olib ketilgan tayyor mahsulot</h3>
              <p className="text-xs text-slate-400">Yuvilgandan keyin mijozga qaytgan qismi</p>
            </div>
            <div className="space-y-2.5">
              {dispatchedByCalibre.map((r) => (
                <Bar key={r.calibreId} label={calibreLabel(r.calibreId)} value={r.kg} max={dispatchedMax} color={C.departed} pctOfLabel={ledger.finished.dispatchedKg > 0 ? `${Math.round((r.kg / ledger.finished.dispatchedKg) * 100)}%` : undefined} />
              ))}
              {dispatchedByCalibre.length === 0 && dispatchedKnRows.length === 0 && <p className="text-sm text-slate-400">Bu davrda olib ketilgan yo'q.</p>}
              {dispatchedKnRows.length > 0 && <div className="my-1 border-t border-slate-100 dark:border-slate-800" />}
              {dispatchedKnRows.map((r) => (
                <Bar key={r.calibreId} label={calibreLabel(r.calibreId)} value={r.kg} max={dispatchedMax} color={C.departed} pctOfLabel={ledger.finished.dispatchedKg > 0 ? `${Math.round((r.kg / ledger.finished.dispatchedKg) * 100)}%` : undefined} />
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Jami olib ketilgan <strong className="text-slate-700 dark:text-slate-300">{fmt(ledger.finished.dispatchedKg)} kg</strong> · omborda qolgan{' '}
              <strong className="text-slate-700 dark:text-slate-300">{fmt(ledger.finished.closingKg)} kg</strong>. Foizlar — o'sha kalibrning jami olib ketilgan miqdoridan qancha qismi.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
