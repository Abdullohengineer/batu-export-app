import { useMemo } from 'react'
import { usePersistentState } from '../../lib/FilterState'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useRahbarStockSnapshot, useRahbarDashboardLedger } from '../../lib/useRahbarDashboardV2'
import { computeDashboardDerived } from '../../lib/rahbarDashboardDerived'
import { StatusNote } from '../../components/ui/StatusNote'
import { OldStockDrilldown } from '../../components/OldStockDrilldown'
import { HeroTiles } from '../../components/rahbar/HeroTiles'
import { OmborHozirSection } from '../../components/rahbar/OmborHozirSection'
import { C, fmt } from '../../components/rahbar/dashboardTheme'
import { todayInTashkent, firstOfMonthInTashkent, previousMonthRangeInTashkent } from '../../lib/dateRange'

// Client Панель -- mirror of RahbarHome.tsx (docs/decisions/ "HeroTiles/
// OmborHozirSection extraction"), reusing the exact same components/hooks
// instead of a parallel build. Self-scoped to this client's own owner_id
// PURELY via RLS: useRahbarStockSnapshot/useRahbarDashboardLedger call the
// same SECURITY INVOKER RPCs Rahbar calls, with no owner parameter -- every
// underlying table/view they touch has a client_read_own_* policy (audited
// table-by-table and confirmed with a live role-switched query, 2026-09-16;
// see docs/decisions/0195-... and 0196-...). No new RPC, no client-only
// data path.
//
// Differs from RahbarHome.tsx in exactly two ways:
// 1. A 2-way Склад toggle (Новое/Старое) instead of Rahbar's 3-way Zaxira
//    (no "Hammasi" -- a client has no reason to see a merged old+new total).
//    Defaults to "Новое".
// 2. Rahbar shows its old-stock tile and Эski drill-down ALONGSIDE the
//    new-stock content at every scope. The client's toggle instead switches
//    between the two views entirely, per the client Панель's own exclusion
//    list: Новое -> the 5 new-stock tiles + "Omborda hozir" section only;
//    Старое -> the 2 old-stock tiles (Эски ювилган + Старый склад
//    Кондитерка) + the drill-down only.
//
// Russian-only throughout (ClientLayout.tsx's own convention) -- HeroTiles
// takes plain label/caption strings per caller, and OmborHozirSection takes
// an explicit locale="ru" (see that file) rather than the Uzbek copy
// RahbarHome gets by default.

const BOSHIDAN = '2026-07-15'

type PeriodPreset = 'boshidan' | 'bu_oy' | 'otgan_oy' | 'custom'
type ClientScope = 'yangi' | 'eski'

const PERIOD_LABEL: Record<PeriodPreset, string> = {
  boshidan: 'С начала',
  bu_oy: 'Этот месяц',
  otgan_oy: 'Прошлый месяц',
  custom: 'Другой период',
}

const SCOPE_LABEL: Record<ClientScope, string> = {
  yangi: 'Новое',
  eski: 'Старое',
}

type TileTone = 'raw' | 'moyka' | 'calibre' | 'kn' | 'oldKn' | 'neutral' | 'oldWashed'

// Same tone->{bg,fg} resolution as RahbarHome.tsx's own local `tileStyle`
// (same shared C palette), plus one client-only tone: "Эски ювилган" has no
// Rahbar hero-tile counterpart to match, so its teal isn't in the shared
// palette -- established color, see docs/decisions/0177 (picked distinct
// from this screen's own "Готовая продукция" green).
function tileStyle(tone: TileTone): { bg: string; fg: string } {
  if (tone === 'oldWashed') return { bg: '#ccfbf1', fg: '#0d9488' }
  const bg = tone === 'raw' ? C.rawBg : tone === 'moyka' ? C.moykaBg : tone === 'calibre' ? C.calibreBg : tone === 'kn' ? C.knBg : tone === 'oldKn' ? C.oldKnBg : '#f4efe6'
  const fg = tone === 'raw' ? C.raw : tone === 'moyka' ? C.moyka : tone === 'calibre' ? C.calibre : tone === 'kn' ? C.kn : tone === 'oldKn' ? C.oldKn : '#5d5140'
  return { bg, fg }
}

export function ClientPanelTab() {
  const [scope, setScope] = usePersistentState<ClientScope>('client.panel.scope', 'yangi')
  const [preset, setPreset] = usePersistentState<PeriodPreset>('client.panel.preset', 'boshidan')
  const [customFrom, setCustomFrom] = usePersistentState('client.panel.customFrom', BOSHIDAN)
  const [customTo, setCustomTo] = usePersistentState('client.panel.customTo', () => todayInTashkent())
  const [selectedTypeIds, setSelectedTypeIds] = usePersistentState<string[] | null>('client.panel.types', null) // null = все

  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)

  const { from, to } = useMemo(() => {
    if (preset === 'boshidan') return { from: BOSHIDAN, to: todayInTashkent() }
    if (preset === 'bu_oy') return { from: firstOfMonthInTashkent(), to: todayInTashkent() }
    if (preset === 'otgan_oy') return previousMonthRangeInTashkent()
    return { from: customFrom, to: customTo }
  }, [preset, customFrom, customTo])

  const { snapshot, loading: snapLoading, error: snapError } = useRahbarStockSnapshot(scope)
  const { ledger, loading: ledgerLoading, error: ledgerError } = useRahbarDashboardLedger(from, to, scope)

  function calibreLabel(id: string): string {
    return calibres.find((c) => c.id === id)?.label ?? id
  }
  function typeName(id: string): string {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }

  const derived = computeDashboardDerived(snapshot, ledger, selectedTypeIds, calibres)

  const oldWashedSeries = [...derived.stockByCalibre, ...derived.stockKn].map((r) => ({ label: calibreLabel(r.calibreId), kg: r.kg }))
  // Fix 3 (2026-09-19) -- mirrors Rahbar's own oldWashedByTypeSeries.
  const oldWashedByTypeSeries = derived.stockByType.map((r) => ({ label: typeName(r.typeId), kg: r.kg }))
  const oldKnSeries = snapshot ? snapshot.oldKnByType.map((t) => ({ label: t.typeName, kg: t.kg })) : []

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Склад</span>
          <div className="flex gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
            {(['yangi', 'eski'] as ClientScope[]).map((s) => (
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
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Период</span>
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
        <p className="text-sm text-slate-400">Загрузка…</p>
      ) : scope === 'eski' ? (
        <HeroTiles
          className="grid grid-cols-2 gap-3 lg:grid-cols-3"
          tiles={[
            { key: 'oldWashed', label: 'Эски ювилган', value: derived.stockTotal, unit: 'кг', caption: 'Текущий остаток · промытая продукция', ...tileStyle('oldWashed') },
            { key: 'oldKn', label: 'Старый склад Кондитерка', value: snapshot.oldKnKg, unit: 'кг', caption: 'Текущий остаток · из бассейна', ...tileStyle('oldKn') },
            // Fix 4 (2026-09-19) — old opening-stock raw material, investigated
            // and confirmed genuine (see docs/decisions/0199): already
            // correctly excluded from Новое's snapshot.rawKg, but until now had
            // no tile anywhere on the client screen at all. Mirrors Rahbar's
            // own 7th tile -- no duplication risk here the way Rahbar had:
            // this client toggle is 2-way only (no "Hammasi"), so this tile
            // and "Сырьё · непромытое" already live in mutually exclusive
            // branches (scope === 'eski' vs. else), never rendered together.
            { key: 'oldRaw', label: 'Старое сырьё', value: snapshot.rawKg, unit: 'кг', caption: 'Текущий остаток · старое сырьё', ...tileStyle('raw') },
          ]}
        />
      ) : (
        <HeroTiles
          className="grid grid-cols-2 gap-3 lg:grid-cols-5"
          tiles={[
            { key: 'jami', label: 'Всего продукции', value: derived.grandTotal, unit: 'кг', caption: 'Текущий остаток — сырьё, мойка и готовая продукция', ...tileStyle('neutral') },
            { key: 'xom', label: 'Сырьё · непромытое', value: snapshot.rawKg, unit: 'кг', caption: 'Текущий остаток — готово к мойке', ...tileStyle('raw') },
            { key: 'moyka', label: 'В мойке', value: snapshot.moykadaKg, unit: 'кг', caption: 'Текущий остаток — в процессе мойки, вычтено из сырья, ещё не добавлено в готовое', ...tileStyle('moyka') },
            {
              key: 'kalibrli',
              label: 'Готовая продукция · калиброванная (K1–K8)',
              value: snapshot.finishedCalibredKg,
              unit: 'кг',
              caption: ledgerLoading ? 'Текущий остаток · без кондитерки' : `Текущий остаток · без кондитерки · за период отгружено ${fmt(derived.dispatchedKalibrliPeriod)} кг`,
              ...tileStyle('calibre'),
            },
            {
              key: 'kn',
              label: 'Кондитерка (KN)',
              value: snapshot.konditirskiyKg,
              unit: 'кг',
              caption: ledgerLoading ? 'Текущий остаток · отдельно от калиброванной' : `Текущий остаток · отдельно от калиброванной · за период отгружено ${fmt(derived.dispatchedKnPeriod)} кг`,
              ...tileStyle('kn'),
            },
          ]}
        />
      )}

      {/* Эski drill-down -- only at scope='eski', replacing the "Omborda
          hozir" section entirely (no side-by-side reconciliation view for a
          client, unlike Rahbar which shows both at every scope). */}
      {scope === 'eski' && snapshot && !snapLoading && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 text-sm font-semibold text-slate-900 dark:text-slate-100">Старый склад — подробно</div>
          <OldStockDrilldown
            oldWashed={{ totalKg: derived.stockTotal, series: oldWashedSeries }}
            oldWashedByType={oldWashedByTypeSeries}
            oldKn={{ totalKg: snapshot.oldKnKg, series: oldKnSeries }}
          />
        </div>
      )}

      {scope === 'yangi' && (
        <OmborHozirSection
          locale="ru"
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
      )}
    </div>
  )
}
