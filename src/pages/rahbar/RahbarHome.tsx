import { useMemo, useState } from 'react'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useRahbarStockSnapshot, useRahbarDashboardLedger } from '../../lib/useRahbarDashboardV2'
import { SCOPE_LABEL, type ZaxiraScope, type ByCalibreTypeRow } from '../../lib/rahbarDashboardV2'
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
const TYPE_PALETTE = ['#2f6d86', '#5aa0a8', '#7c86b8', '#c98a4b', '#9b6b9e', '#5f8f6f', '#b4886c']

function typeColor(i: number): string {
  return TYPE_PALETTE[i % TYPE_PALETTE.length]
}

// ---- small presentational helpers ------------------------------------

function Tile({ label, value, unit, caption, tone }: { label: string; value: number; unit?: string; caption: string; tone: 'raw' | 'calibre' | 'kn' | 'oldKn' | 'neutral' }) {
  const bg = tone === 'raw' ? C.rawBg : tone === 'calibre' ? C.calibreBg : tone === 'kn' ? C.knBg : tone === 'oldKn' ? C.oldKnBg : '#f4efe6'
  const fg = tone === 'raw' ? C.raw : tone === 'calibre' ? C.calibre : tone === 'kn' ? C.kn : tone === 'oldKn' ? C.oldKn : '#5d5140'
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

function LedgerRow({ label, value, sign, tone }: { label: string; value: string; sign?: '+' | '−' | '·'; tone?: 'departed' | 'loss' }) {
  const color = tone === 'departed' ? 'text-red-600 dark:text-red-400' : tone === 'loss' ? 'text-slate-700 dark:text-slate-300' : 'text-slate-700 dark:text-slate-300'
  return (
    <div className={`flex items-center justify-between border-b border-slate-100 py-2.5 text-sm dark:border-slate-800 ${color}`}>
      <span>
        {sign && <span className="mr-1.5 inline-block w-3 font-bold">{sign}</span>}
        {label}
      </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  )
}

function LedgerTotal({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t-2 border-slate-900 pt-3 text-base font-bold text-slate-900 dark:border-slate-100 dark:text-slate-100">
      <span>{label}</span>
      <span className="text-lg tabular-nums">{value}</span>
    </div>
  )
}

// A checksum row (kalibrli + Konditirskiy + yo'qotish = Yuvib tugallangan) --
// deliberately lighter than LedgerTotal, which is reserved for the ledger's
// actual bottom-line balance (Xom qoldiq / Tayyor qoldiq). Two full-weight
// totals stacked in the same block would both read as "the" total.
function LedgerSubtotal({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-0.5 flex items-center justify-between border-t border-slate-300 pt-2.5 text-sm font-semibold text-slate-900 dark:border-slate-600 dark:text-slate-100">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

function ResidualWarning({ label, residualKg }: { label: string; residualKg: number }) {
  if (residualKg === 0) return null
  return (
    <div className="my-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
      ⚠ {label}: {fmt(residualKg)} kg — diagnostik farq, hisob-kitob formulasi o'zgarmagan (qoldiqdan ko'p yuborilgan/jo'natilgan holatda paydo bo'ladi)
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

function Silo({ rawKg, calibreKg, knKg, oldKnKg }: { rawKg: number; calibreKg: number; knKg: number; oldKnKg: number }) {
  const reconcilable = rawKg + calibreKg + knKg
  const total = reconcilable + oldKnKg
  if (total <= 0) return <p className="text-sm text-slate-400">Ma'lumot yo'q.</p>
  const seg = (v: number) => (v / total) * 100
  return (
    <div>
      <div className="mb-4 flex h-14 gap-1 overflow-hidden rounded-xl">
        {rawKg > 0 && (
          <div className="flex items-center justify-center text-xs font-semibold text-white" style={{ width: `${seg(rawKg)}%`, background: C.raw }}>
            {seg(rawKg) > 8 ? fmt(rawKg) : ''}
          </div>
        )}
        {calibreKg > 0 && (
          <div className="flex items-center justify-center text-xs font-semibold text-white" style={{ width: `${seg(calibreKg)}%`, background: C.calibre }}>
            {seg(calibreKg) > 8 ? fmt(calibreKg) : ''}
          </div>
        )}
        {knKg > 0 && (
          <div className="flex items-center justify-center text-xs font-semibold text-white" style={{ width: `${seg(knKg)}%`, background: C.kn }}>
            {seg(knKg) > 8 ? fmt(knKg) : ''}
          </div>
        )}
        {oldKnKg > 0 && (
          <div
            className="ml-1 flex items-center justify-center rounded-md border-2 border-dashed text-xs font-semibold"
            style={{ width: `${seg(oldKnKg)}%`, background: C.oldKnBg, borderColor: C.oldKn, color: C.oldKn }}
          >
            {seg(oldKnKg) > 8 ? fmt(oldKnKg) : ''}
          </div>
        )}
      </div>
      <div className="space-y-2 text-sm">
        <LegendRow color={C.raw} name="Xom — yuvilmagan" kg={rawKg} pct={seg(rawKg)} />
        <LegendRow color={C.calibre} name="Tayyor — kalibrli" kg={calibreKg} pct={seg(calibreKg)} />
        <LegendRow color={C.kn} name="Konditirskiy" kg={knKg} pct={seg(knKg)} />
        <LegendRow color={C.oldKn} name="Eski KN (havza) — pool stock, alohida" kg={oldKnKg} pct={seg(oldKnKg)} dashed />
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Zavoddan chiqqan mahsulot — vozvrat va olib ketilgan tayyor — bu raqamlardan chegirilgan. Eski KN havzasi Ledger C bilan solishtirilmaydi (finished_pallets asosida emas).
      </p>
    </div>
  )
}

function LegendRow({ color, name, kg, pct, dashed }: { color: string; name: string; kg: number; pct: number; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-2.5 w-2.5 flex-none rounded-sm" style={{ background: dashed ? 'transparent' : color, border: dashed ? `2px dashed ${color}` : undefined }} />
      <span className="flex-1 text-slate-500 dark:text-slate-400">{name}</span>
      <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{fmt(kg)} kg</span>
      <span className="w-10 text-right text-xs text-slate-400">{Math.round(pct)}%</span>
    </div>
  )
}

function Donut({ byType, typeName }: { byType: { typeId: string; kg: number }[]; typeName: (id: string) => string }) {
  const total = byType.reduce((s, t) => s + t.kg, 0)
  if (total <= 0) return <p className="text-sm text-slate-400">Ma'lumot yo'q.</p>
  const r = 72
  const circumference = 2 * Math.PI * r
  let offset = 0
  const arcs = byType.map((t, i) => {
    const frac = t.kg / total
    const dash = frac * circumference
    const arc = (
      <circle
        key={t.typeId}
        cx="120"
        cy="100"
        r={r}
        fill="none"
        stroke={typeColor(i)}
        strokeWidth="26"
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeDashoffset={-offset}
        transform="rotate(-90 120 100)"
      />
    )
    offset += dash
    return arc
  })
  return (
    <div>
      <svg viewBox="0 0 240 200" width="100%" style={{ maxWidth: 250, display: 'block', margin: '0 auto 4px' }}>
        <circle cx="120" cy="100" r={r} fill="none" stroke="#f2efea" strokeWidth="26" />
        {arcs}
        <text x="120" y="96" textAnchor="middle" fontFamily="inherit" fontSize="24" fontWeight="800" fill="#1f1c18">
          {fmt(total)}
        </text>
        <text x="120" y="116" textAnchor="middle" fontFamily="inherit" fontSize="11.5" fill="#a39a8d">
          kg · {byType.length} tur
        </text>
      </svg>
      <div className="space-y-2 text-sm">
        {byType.map((t, i) => (
          <LegendRow key={t.typeId} color={typeColor(i)} name={typeName(t.typeId)} kg={t.kg} pct={(t.kg / total) * 100} />
        ))}
      </div>
    </div>
  )
}

function TrendChart({ chart }: { chart: { bucketStart: string; kirdiKg: number; chiqganKg: number; vozvratKg: number }[] }) {
  if (chart.length === 0) return <p className="text-sm text-slate-400">Ma'lumot yo'q.</p>
  const W = 470
  const H = 250
  const padL = 46
  const padB = 30
  const padT = 14
  const innerW = W - padL - 16
  const innerH = H - padB - padT
  const max = Math.max(1, ...chart.map((c) => Math.max(c.kirdiKg, c.chiqganKg, c.vozvratKg)))
  const x = (i: number) => padL + (chart.length === 1 ? innerW / 2 : (i / (chart.length - 1)) * innerW)
  const y = (v: number) => padT + innerH - (v / max) * innerH
  const line = (key: 'kirdiKg' | 'chiqganKg' | 'vozvratKg') => chart.map((c, i) => `${x(i)},${y(c[key])}`).join(' ')
  const areaPath = `M${chart.map((c, i) => `${x(i)},${y(c.kirdiKg)}`).join(' L')} L${x(chart.length - 1)},${y(0)} L${x(0)},${y(0)} Z`
  const labelEvery = Math.max(1, Math.ceil(chart.length / 6))
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%">
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#e9e4dd" />
        <line x1={padL} y1={H - padB} x2={W - 12} y2={H - padB} stroke="#e9e4dd" />
        <g fontSize="10.5" fill="#a39a8d">
          <text x={padL - 8} y={padT + 4} textAnchor="end">
            {fmt(max)}
          </text>
          <text x={padL - 8} y={H - padB + 4} textAnchor="end">
            0
          </text>
        </g>
        <path d={areaPath} fill={C.raw} opacity="0.12" />
        <polyline points={line('kirdiKg')} fill="none" stroke={C.raw} strokeWidth="2.6" strokeLinejoin="round" />
        <polyline points={line('chiqganKg')} fill="none" stroke={C.calibre} strokeWidth="2.6" strokeLinejoin="round" />
        <polyline points={line('vozvratKg')} fill="none" stroke={C.departed} strokeWidth="2.6" strokeDasharray="5 4" strokeLinejoin="round" />
        <g fontSize="10" fill="#a39a8d" textAnchor="middle">
          {chart.map((c, i) =>
            i % labelEvery === 0 || i === chart.length - 1 ? (
              <text key={c.bucketStart} x={x(i)} y={H - 8}>
                {c.bucketStart.slice(8, 10)}.{c.bucketStart.slice(5, 7)}
              </text>
            ) : null,
          )}
        </g>
      </svg>
      <div className="mt-1 space-y-2 text-sm">
        <LegendRow color={C.raw} name="Zavodga kirgan" kg={chart.reduce((s, c) => s + c.kirdiKg, 0)} pct={0} />
        <LegendRow color={C.calibre} name="Moykaga yuborilgan" kg={chart.reduce((s, c) => s + c.chiqganKg, 0)} pct={0} />
        <LegendRow color={C.departed} name="Vozvrat" kg={chart.reduce((s, c) => s + c.vozvratKg, 0)} pct={0} />
      </div>
    </div>
  )
}

// ---- page ---------------------------------------------------------------

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

  function typeName(id: string): string {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
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

  const processedByCalibre = ledger ? regroupByCalibre(ledger.byCalibreType.processed).filter((r) => !isKn(r.calibreId)) : []
  const processedKn = ledger ? regroupByCalibre(ledger.byCalibreType.processed).filter((r) => isKn(r.calibreId)) : []
  const dispatchedByCalibre = ledger ? regroupByCalibre(ledger.byCalibreType.dispatched).filter((r) => !isKn(r.calibreId)) : []
  const dispatchedKnRows = ledger ? regroupByCalibre(ledger.byCalibreType.dispatched).filter((r) => isKn(r.calibreId)) : []
  const processedMax = Math.max(1, ...processedByCalibre.map((r) => r.kg), ...processedKn.map((r) => r.kg))
  const dispatchedMax = Math.max(1, ...dispatchedByCalibre.map((r) => r.kg), ...dispatchedKnRows.map((r) => r.kg))

  const grandTotal = snapshot ? snapshot.rawKg + snapshot.finishedCalibredKg + snapshot.konditirskiyKg + snapshot.oldKnKg : 0

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
          <Tile label="Jami zaxira" value={grandTotal} unit="kg" caption="Hozirgi holat — omborda bor, barcha turkum" tone="neutral" />
          <Tile label="Xom · yuvilmagan" value={snapshot.rawKg} unit="kg" caption="Hozirgi holat — yuvishga tayyor" tone="raw" />
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
          <Tile label="Eski KN (havza)" value={snapshot.oldKnKg} unit="kg" caption="Hozirgi holat — havza zaxirasi, Ledger C'ga kirmaydi" tone="oldKn" />
        </div>
      )}

      {/* Zaxira tarkibi */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4">
          <SectionHeading>Zaxira tarkibi</SectionHeading>
          <p className="text-xs text-slate-400">Hozir omborda nima bor — olib ketilgani chegirilgan</p>
        </div>
        {snapLoading || !snapshot ? (
          <p className="text-sm text-slate-400">Yuklanmoqda…</p>
        ) : (
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Holat bo'yicha</p>
              <Silo rawKg={snapshot.rawKg} calibreKg={snapshot.finishedCalibredKg} knKg={snapshot.konditirskiyKg} oldKnKg={snapshot.oldKnKg} />
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Tur bo'yicha</p>
              <Donut byType={snapshot.byType} typeName={typeName} />
            </div>
          </div>
        )}
      </div>

      {/* Kirim va chiqim */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4">
          <SectionHeading>Kirim va chiqim</SectionHeading>
          <p className="text-xs text-slate-400">
            {from} — {to} · qizil rang — zavoddan chiqqan
          </p>
        </div>
        {ledgerLoading || !ledger ? (
          <p className="text-sm text-slate-400">Yuklanmoqda…</p>
        ) : (
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              {/* Ledger A -- raw, send-basis */}
              <div>
                <LedgerRow label="Zavodga kirdi" value={`${fmt(ledger.raw.receivedKg)} kg`} sign="+" />
                <LedgerRow label="Vozvrat — xom qaytdi" value={`${fmt(ledger.raw.dispatchedKg)} kg`} sign="−" tone="departed" />
                <LedgerRow label="Moykaga yuborilgan" value={`${fmt(ledger.raw.sentToMoykaKg)} kg`} sign="·" />
                {ledger.raw.storageLossKg !== 0 && <LedgerRow label="Saqlashda yo'qolgan (davrda)" value={`${fmt(ledger.raw.storageLossKg)} kg`} sign="−" />}
                <div className="pt-3">
                  <LedgerTotal label="Xom qoldiq" value={`${fmt(ledger.raw.closingKg)} kg`} />
                </div>
                <ResidualWarning label="Xom balans farqi" residualKg={ledger.raw.residualKg} />
              </div>

              {/* Moykada -- point-in-time, sits between Ledger A and B */}
              <div className="my-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/50">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Moykada — nuqtadagi holat, davr oqimi emas</p>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Davr boshida ({from})</span>
                  <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{fmt(ledger.moykadaSnapshot.openingKg)} kg</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Hozir ({ledger.moykadaSnapshot.asOfDate})</span>
                  <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{fmt(ledger.moykadaSnapshot.closingKg)} kg</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  "Moykaga yuborilgan" (yuborish sanasi) bilan "Yuvib tugallangan" (tugallanish sanasi) o'rtasidagi farqni tushuntiradi — bir xil kg emas, chunki bu ikkisi turli sanaga bog'liq.
                </p>
                <ResidualWarning label="Moykada balans farqi" residualKg={ledger.moykadaSnapshot.residualKg} />
              </div>

              {/* Ledger B -- finished, completion-basis. Kalibrli and
                  Konditirskiy are PEER rows, flush, never one nested under
                  the other -- both sum, with yo'qotish, exactly to "Yuvib
                  tugallangan" below them (standing project rule; matches
                  the peer treatment the bars section already used). */}
              <div>
                <LedgerRow label="Kalibrli" value={`${fmt(ledger.moyka.calibreKg)} kg`} />
                <LedgerRow label="Konditirskiy" value={`${fmt(ledger.moyka.konditirskiyKg)} kg`} />
                <LedgerRow label="Yo'qotish" value={`${fmt(ledger.moyka.lossKg)} kg · ${ledger.moyka.lossPct}%`} sign="−" tone="loss" />
                <LedgerSubtotal label="Yuvib tugallangan" value={`${fmt(ledger.moyka.processedKg)} kg`} />
                <div className="mt-3">
                  <LedgerRow label="Jami olib ketilgan" value={`${fmt(ledger.finished.dispatchedKg)} kg`} sign="−" tone="departed" />
                </div>
                <div className="pt-3">
                  <LedgerTotal label="Tayyor qoldiq" value={`${fmt(ledger.finished.closingKg)} kg`} />
                </div>
              </div>

              {/* Grand total */}
              {snapshot && (
                <div className="mt-6 rounded-xl border-2 border-slate-900 p-4 dark:border-slate-100">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Jami zaxira</div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        Xom {fmt(snapshot.rawKg)} · kalibrli {fmt(snapshot.finishedCalibredKg)} · KN {fmt(snapshot.konditirskiyKg)} · Eski KN havza {fmt(snapshot.oldKnKg)}
                      </div>
                    </div>
                    <div className="text-3xl font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
                      {fmt(grandTotal)}
                      <span className="ml-1 text-base font-semibold opacity-55">kg</span>
                    </div>
                  </div>
                </div>
              )}
              <p className="mt-3 text-xs text-slate-400">Vozvrat — mijoz yuvdirmasdan qaytarib olgan xom mahsulot. Yo'qotish yuvish jarayonida yo'qolgan qism, zavoddan chiqmagan.</p>
            </div>

            <div>
              <TrendChart chart={ledger.chart} />
            </div>
          </div>
        )}
      </div>

      {/* Yuvib tugallangan mahsulot */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionHeading>Yuvib tugallangan mahsulot</SectionHeading>
            <p className="text-xs text-slate-400">{ledger ? `${fmt(ledger.raw.sentToMoykaKg)} kg moykaga yuborilgandan tugallangan natija` : ''}</p>
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
              {processedByCalibre.map((r) => (
                <Bar key={r.calibreId} label={calibreLabel(r.calibreId)} value={r.kg} max={processedMax} color={C.calibre} pctOfLabel={ledger.moyka.processedKg > 0 ? `${Math.round((r.kg / ledger.moyka.processedKg) * 100)}%` : undefined} />
              ))}
              {processedByCalibre.length === 0 && <p className="text-sm text-slate-400">Bu davrda tugallangan natija yo'q.</p>}
              <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
              {processedKn.map((r) => (
                <Bar key={r.calibreId} label={calibreLabel(r.calibreId)} value={r.kg} max={processedMax} color={C.kn} pctOfLabel={ledger.moyka.processedKg > 0 ? `${Math.round((r.kg / ledger.moyka.processedKg) * 100)}%` : undefined} />
              ))}
              <Bar label="Yo'qotish" value={Math.max(0, ledger.moyka.lossKg)} max={processedMax} color={C.loss} pctOfLabel={`${ledger.moyka.lossPct}%`} />
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Turlar tugmasi orqali bir yoki bir nechta mahsulot turini tanlash mumkin — hech narsa tanlanmasa hammasi ko'rsatiladi. Konditirskiy kalibrli qatorlarga qo'shilmagan, alohida qator.
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
