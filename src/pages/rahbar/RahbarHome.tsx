import { useMemo } from 'react'
import { usePersistentState } from '../../lib/FilterState'
import { useSearchTrigger } from '../../lib/useSearchTrigger'
import { SearchTrigger } from '../../components/ui/SearchTrigger'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useRahbarStockSnapshot, useRahbarDashboardLedger } from '../../lib/useRahbarDashboardV2'
import { SCOPE_LABEL, type ZaxiraScope } from '../../lib/rahbarDashboardV2'
import { computeDashboardDerived } from '../../lib/rahbarDashboardDerived'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'
import { OldStockDrilldown } from '../../components/OldStockDrilldown'
import { HeroTiles } from '../../components/rahbar/HeroTiles'
import { OmborHozirSection } from '../../components/rahbar/OmborHozirSection'
import { C, fmt } from '../../components/rahbar/dashboardTheme'
import { todayInTashkent, firstOfMonthInTashkent, previousMonthRangeInTashkent } from '../../lib/dateRange'

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
// side regroup of server totals, not a new sum (computeDashboardDerived).
//
// Hero tiles / "Omborda hozir" block extracted to
// components/rahbar/HeroTiles.tsx + OmborHozirSection.tsx (2026-09-16) so
// the client Панель mirror can reuse them instead of forking -- see
// docs/decisions/ "HeroTiles/OmborHozirSection extraction".

const BOSHIDAN = '2026-07-15'

type PeriodPreset = 'boshidan' | 'bu_oy' | 'otgan_oy' | 'custom'

const PERIOD_LABEL: Record<PeriodPreset, string> = {
  boshidan: 'Boshidan',
  bu_oy: 'Bu oy',
  otgan_oy: "O'tgan oy",
  custom: 'Boshqa davr',
}

type TileTone = 'raw' | 'moyka' | 'calibre' | 'kn' | 'oldKn' | 'neutral'

// Tone -> {bg,fg} lookup, unchanged from the pre-extraction local `Tile`
// component -- HeroTiles itself is palette-agnostic (see its own file
// comment), so each caller resolves its own colors before building tiles.
function tileStyle(tone: TileTone): { bg: string; fg: string } {
  const bg = tone === 'raw' ? C.rawBg : tone === 'moyka' ? C.moykaBg : tone === 'calibre' ? C.calibreBg : tone === 'kn' ? C.knBg : tone === 'oldKn' ? C.oldKnBg : '#f4efe6'
  const fg = tone === 'raw' ? C.raw : tone === 'moyka' ? C.moyka : tone === 'calibre' ? C.calibre : tone === 'kn' ? C.kn : tone === 'oldKn' ? C.oldKn : '#5d5140'
  return { bg, fg }
}

export function RahbarHome() {
  const [scope, setScope] = usePersistentState<ZaxiraScope>('rahbar.scope', 'yangi')
  // Default preset is 'bu_oy', NOT 'boshidan' (2026-09-19, Phase 1A). The
  // old default made every fresh dashboard mount ask rahbar_dashboard_ledger
  // for the entire dataset since project inception (BOSHIDAN -> today) — the
  // widest query the screen can issue, fired automatically, by default, with
  // no cache. That single RPC was ~15% of all measured database time.
  // 'Boshidan' is still one click away in the period selector.
  const [preset, setPreset] = usePersistentState<PeriodPreset>('rahbar.preset', 'bu_oy')
  const [customFrom, setCustomFrom] = usePersistentState('rahbar.customFrom', BOSHIDAN)
  const [customTo, setCustomTo] = usePersistentState('rahbar.customTo', () => todayInTashkent())
  const [selectedTypeIds, setSelectedTypeIds] = usePersistentState<string[] | null>('rahbar.types', null) // null = hammasi

  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)

  // Explicit Qidirish for the CUSTOM range only (2026-09-22,
  // docs/decisions/0218). The three presets stay live: one click is one
  // complete intent, and each is a single cheap change. The custom range is
  // two inputs over rahbar_dashboard_ledger, so typing a from-date fires a
  // query against a half-entered range that the to-date immediately
  // supersedes -- exactly the pattern the button exists to stop. This is the
  // period picker only; the dashboard itself stays live.
  const customRange = useSearchTrigger({ customFrom, customTo })

  const { from, to } = useMemo(() => {
    if (preset === 'boshidan') return { from: BOSHIDAN, to: todayInTashkent() }
    if (preset === 'bu_oy') return { from: firstOfMonthInTashkent(), to: todayInTashkent() }
    if (preset === 'otgan_oy') return previousMonthRangeInTashkent()
    return { from: customRange.applied.customFrom, to: customRange.applied.customTo }
  }, [preset, customRange.applied])

  const { snapshot, loading: snapLoading, error: snapError } = useRahbarStockSnapshot(scope)
  const { ledger, loading: ledgerLoading, error: ledgerError } = useRahbarDashboardLedger(from, to, scope)

  function calibreLabel(id: string): string {
    return calibres.find((c) => c.id === id)?.label ?? id
  }
  function typeName(id: string): string {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }

  const derived = computeDashboardDerived(snapshot, ledger, selectedTypeIds, calibres)

  // Eski drill-down (2026-09-08): two cards, only at scope='eski' -- see
  // docs/DECISIONS.md "Rahbar Eski drill-down: old KN reintroduced, scoped
  // to Eski toggle only". Эski (ювилган) is a type x calibre cross-tab
  // (Fix 3, 2026-09-19) fed directly by derived.stockByCalibreType --
  // already is_old_stock-scoped by rahbar_stock_snapshot at scope='eski',
  // no new arithmetic. oldKn is snapshot.oldKnByType (migration 0111),
  // naturally empty at scope != 'eski' since old_kn rows never pass the
  // 'yangi' scope filter -- never re-added to the main/Yangi dashboard.
  const oldKnSeries = snapshot ? snapshot.oldKnByType.map((t) => ({ label: t.typeName, kg: t.kg })) : []

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
            <span
              className="flex flex-wrap items-center gap-1 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  customRange.search()
                }
              }}
            >
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-full border border-slate-300 px-2.5 py-1 text-sm dark:border-slate-700 dark:bg-slate-900" />
              —
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-full border border-slate-300 px-2.5 py-1 text-sm dark:border-slate-700 dark:bg-slate-900" />
              <SearchTrigger isDirty={customRange.isDirty} loading={ledgerLoading} onSearch={customRange.search} />
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
        <HeroTiles
          className={scope === 'yangi' ? 'grid grid-cols-2 gap-3 lg:grid-cols-5' : 'grid grid-cols-2 gap-3 lg:grid-cols-6'}
          tiles={[
            { key: 'jami', label: 'Jami yuvilgan va yuvilmagan mahsulot', value: derived.grandTotal, unit: 'kg', caption: 'Hozirgi holat — xom, moykada va tayyor', ...tileStyle('neutral') },
            // "Xom · yuvilmagan" -- shown at Yangi (new raw only) and Hammasi
            // (combined new+old, since snapshot.rawKg is already the
            // unfiltered total at that scope -- no separate arithmetic).
            // Hidden at Eski (2026-09-19, option a): showing new-stock
            // language ("yuvishga tayyor") for what is, at that scope,
            // entirely old opening-stock material read as misleading -- and
            // it duplicated the new "Старое сырьё" tile below. "Старое
            // сырьё" takes over at Eski instead.
            ...(scope !== 'eski'
              ? [{ key: 'xom', label: 'Xom · yuvilmagan', value: snapshot.rawKg, unit: 'kg', caption: 'Hozirgi holat — yuvishga tayyor', ...tileStyle('raw') }]
              : []),
            { key: 'moyka', label: 'Moykada', value: snapshot.moykadaKg, unit: 'kg', caption: "Hozirgi holat — yuvilmoqda, xomdan chegirilgan, tayyorga hali qo'shilmagan", ...tileStyle('moyka') },
            // 2026-08-31: both tiles now name their own calibre set in the
            // label. This tile reads 11,210 kg where the two sentences lower
            // down the page read 17,580 kg, and the gap between them is
            // exactly the Konditerka tile beside it -- the numbers agreed
            // all along, the labels did not say so. "Tayyor · kalibrli"
            // alone was read as "finished product", not as "K1-K8 only".
            // Reported and confirmed: the figures stay as they are, the
            // wording is what changes -- here and in both sentences below.
            {
              key: 'kalibrli',
              label: 'Tayyor · kalibrli (K1–K8)',
              value: snapshot.finishedCalibredKg,
              unit: 'kg',
              caption: ledgerLoading ? 'Hozirgi qoldiq · konditerkasiz' : `Hozirgi qoldiq · konditerkasiz · bu davrda ${fmt(derived.dispatchedKalibrliPeriod)} kg olib ketilgan`,
              ...tileStyle('calibre'),
            },
            {
              key: 'kn',
              label: 'Konditerka (KN)',
              value: snapshot.konditirskiyKg,
              unit: 'kg',
              caption: ledgerLoading ? 'Hozirgi qoldiq · kalibrlidan alohida' : `Hozirgi qoldiq · kalibrlidan alohida · bu davrda ${fmt(derived.dispatchedKnPeriod)} kg olib ketilgan`,
              ...tileStyle('kn'),
            },
            // 6th tile (2026-09-08) — Старый склад Кондитерка, the old-KN pool
            // balance. snapshot.oldKnKg is itself scope-independent (migration
            // 0120 — the pool's real total, not zeroed out by the 'yangi'
            // filter), but the TILE's own visibility is not: this is old-stock
            // information, and showing an "old stock" number on the "new
            // stock" view read as if new production somehow includes it —
            // corrected 2026-09-19 to hide at scope='yangi', matching every
            // other old-stock-only element on this page (the Эski drill-down
            // below already only renders at scope='eski'). Still shown at
            // 'eski' and 'hammasi', where an old-stock figure belongs.
            ...(scope !== 'yangi'
              ? [{ key: 'oldKn', label: 'Старый склад Кондитерка', value: snapshot.oldKnKg, unit: 'kg', caption: 'Hozirgi qoldiq · havzadan', ...tileStyle('oldKn') }]
              : []),
            // 7th tile (2026-09-19) — Старое сырьё, old (opening-stock) raw
            // material that never got processed (Fix 4: snapshot.rawKg at
            // scope='eski' is already old-stock-only, since 'yangi' filters
            // to origin != 'opening_stock'). Shown ONLY at Eski (2026-09-19,
            // option a) -- replaces "Xom · yuvilmagan" there rather than
            // sitting alongside it (the two were showing the identical kg
            // under two labels). Hidden at Hammasi: that scope already shows
            // the combined new+old total under "Xom · yuvilmagan" itself
            // (an aggregation view, not a place for a third breakdown tile).
            ...(scope === 'eski'
              ? [{ key: 'oldRaw', label: 'Старое сырьё', value: snapshot.rawKg, unit: 'kg', caption: 'Hozirgi qoldiq · eski xom-ashyo', ...tileStyle('raw') }]
              : []),
          ]}
        />
      )}

      {/* Eski drill-down -- only at scope='eski', two separate graphs:
          Эски (ювилган) + Старый склад Кондитерка. Never shown at
          scope='yangi' (the main dashboard) -- see DECISIONS.md. */}
      {scope === 'eski' && snapshot && !snapLoading && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <SectionHeading>Эski zaxira</SectionHeading>
          <p className="mb-4 text-xs text-slate-400">Jonli qoldiq — ювилган mahsulot va Старый склад Кондитерка havzasi alohida</p>
          <OldStockDrilldown
            oldWashedRows={derived.stockByCalibreType}
            typeName={typeName}
            oldKn={{ totalKg: snapshot.oldKnKg, series: oldKnSeries }}
          />
        </div>
      )}

      <OmborHozirSection
        ledgerLoading={ledgerLoading}
        ledger={ledger}
        productTypes={productTypes}
        selectedTypeIds={selectedTypeIds}
        setSelectedTypeIds={setSelectedTypeIds}
        calibreLabel={calibreLabel}
        stockByCalibre={derived.stockByCalibre}
        stockKn={derived.stockKn}
        stockMax={derived.stockMax}
        stockCalibredTotal={derived.stockCalibredTotal}
        stockKnTotal={derived.stockKnTotal}
        stockTotal={derived.stockTotal}
        dispatchedByCalibre={derived.dispatchedByCalibre}
        dispatchedKnRows={derived.dispatchedKnRows}
        dispatchedMax={derived.dispatchedMax}
      />
    </div>
  )
}
