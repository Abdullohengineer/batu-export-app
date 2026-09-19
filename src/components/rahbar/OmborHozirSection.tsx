import { SectionHeading } from '../ui/SectionHeading'
import { HorizontalBar } from '../ui/HorizontalBar'
import { formatLossKg, formatLossPct } from '../../lib/formatLoss'
import type { RahbarDashboardLedger } from '../../lib/rahbarDashboardV2'
import type { CalibreKgRow } from '../../lib/rahbarDashboardDerived'
import type { ProductType } from '../../lib/useProductTypes'
import { C, fmt } from './dashboardTheme'

// "Omborda hozir -- kalibr bo'yicha", extracted from RahbarHome.tsx
// (2026-09-16). Structure/data unchanged for both callers -- only the
// `locale` prop's static copy differs, added so the client Панель mirror
// (Russian-localized per the client portal's own project-wide requirement)
// doesn't render this section in Uzbek. Defaults to 'uz' so RahbarHome's own
// call site needs no changes and stays byte-identical.
export type OmborHozirLocale = 'uz' | 'ru'

const STRINGS: Record<OmborHozirLocale, {
  heading: string
  subtitle: string
  turlarAll: string
  turlarSelected: (n: number) => string
  hammasi: string
  noCalibredStock: string
  noDispatchedInPeriod: string
  dispatchedHeading: string
  dispatchedSubtitle: string
  loading: string
}> = {
  uz: {
    heading: "Omborda hozir — kalibr bo'yicha",
    subtitle: "Jonli qoldiq · yuqoridagi davr tanlovi bu qatorlarga ta'sir qilmaydi",
    turlarAll: 'Turlar: hammasi',
    turlarSelected: (n) => `Turlar: ${n} tanlangan`,
    hammasi: 'Hammasi',
    noCalibredStock: "Omborda kalibrlangan mahsulot yo'q.",
    noDispatchedInPeriod: "Bu davrda olib ketilgan yo'q.",
    dispatchedHeading: 'Olib ketilgan tayyor mahsulot',
    dispatchedSubtitle: 'Yuvilgandan keyin mijozga qaytgan qismi',
    loading: 'Yuklanmoqda…',
  },
  ru: {
    heading: 'Текущий остаток на складе — по калибрам',
    subtitle: 'Текущий остаток · выбор периода выше не влияет на эти строки',
    turlarAll: 'Виды: все',
    turlarSelected: (n) => `Виды: выбрано ${n}`,
    hammasi: 'Все',
    noCalibredStock: 'На складе нет калиброванной продукции.',
    noDispatchedInPeriod: 'За этот период отгрузок не было.',
    dispatchedHeading: 'Отгруженная готовая продукция',
    dispatchedSubtitle: 'Часть, вернувшаяся после мойки',
    loading: 'Загрузка…',
  },
}

export interface OmborHozirSectionProps {
  locale?: OmborHozirLocale
  ledgerLoading: boolean
  ledger: RahbarDashboardLedger | null
  productTypes: ProductType[]
  selectedTypeIds: string[] | null
  setSelectedTypeIds: (ids: string[] | null) => void
  calibreLabel: (id: string) => string
  stockByCalibre: CalibreKgRow[]
  stockKn: CalibreKgRow[]
  stockMax: number
  stockCalibredTotal: number
  stockKnTotal: number
  stockTotal: number
  dispatchedByCalibre: CalibreKgRow[]
  dispatchedKnRows: CalibreKgRow[]
  dispatchedMax: number
}

export function OmborHozirSection({
  locale = 'uz',
  ledgerLoading,
  ledger,
  productTypes,
  selectedTypeIds,
  setSelectedTypeIds,
  calibreLabel,
  stockByCalibre,
  stockKn,
  stockMax,
  stockCalibredTotal,
  stockKnTotal,
  stockTotal,
  dispatchedByCalibre,
  dispatchedKnRows,
  dispatchedMax,
}: OmborHozirSectionProps) {
  const t = STRINGS[locale]
  const activeTypeIds = selectedTypeIds ?? productTypes.map((t) => t.id)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <SectionHeading>{t.heading}</SectionHeading>
          <p className="text-xs text-slate-400">{t.subtitle}</p>
        </div>
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300">
            {selectedTypeIds === null ? t.turlarAll : t.turlarSelected(selectedTypeIds.length)}
            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-800">
              {activeTypeIds.length} / {productTypes.length}
            </span>{' '}
            ▾
          </summary>
          <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <button type="button" className="mb-1 block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => setSelectedTypeIds(null)}>
              {t.hammasi}
            </button>
            {productTypes.map((pt) => {
              const checked = activeTypeIds.includes(pt.id)
              return (
                <label key={pt.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = new Set(activeTypeIds)
                      if (checked) next.delete(pt.id)
                      else next.add(pt.id)
                      setSelectedTypeIds([...next])
                    }}
                  />
                  {pt.name}
                </label>
              )
            })}
          </div>
        </details>
      </div>

      {ledgerLoading || !ledger ? (
        <p className="text-sm text-slate-400">{t.loading}</p>
      ) : (
        <>
          <div className="space-y-2.5">
            {stockByCalibre.map((r) => (
              <HorizontalBar key={r.calibreId} label={calibreLabel(r.calibreId)} value={r.kg} max={stockMax} color={C.calibre} pctOfLabel={stockTotal > 0 ? `${Math.round((r.kg / stockTotal) * 100)}%` : undefined} />
            ))}
            {stockByCalibre.length === 0 && <p className="text-sm text-slate-400">{t.noCalibredStock}</p>}
            {stockKn.length > 0 && <div className="my-1 border-t border-slate-100 dark:border-slate-800" />}
            {stockKn.map((r) => (
              <HorizontalBar key={r.calibreId} label={calibreLabel(r.calibreId)} value={r.kg} max={stockMax} color={C.kn} pctOfLabel={stockTotal > 0 ? `${Math.round((r.kg / stockTotal) * 100)}%` : undefined} />
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            {locale === 'ru' ? (
              <>
                Сейчас на складе <strong className="text-slate-700 dark:text-slate-300">{fmt(stockTotal)} кг</strong> готовой продукции — калиброванной{' '}
                <strong className="text-slate-700 dark:text-slate-300">{fmt(stockCalibredTotal)} кг</strong> + кондитерки{' '}
                <strong className="text-slate-700 dark:text-slate-300">{fmt(stockKnTotal)} кг</strong>, за вычетом отгруженного. Эти строки —{' '}
                <strong className="text-slate-700 dark:text-slate-300">текущий остаток</strong>, а не производство за период. Проценты — доля от общего остатка. Кондитерка — отдельной строкой.
                {ledger && ` За выбранный период вышло из мойки: ${fmt(ledger.moyka.calibreKg + ledger.moyka.konditirskiyKg)} кг · потери ${formatLossKg(ledger.moyka.lossKg)} (${formatLossPct(ledger.moyka.lossPct)}).`}
              </>
            ) : (
              <>
                Hozir omborda <strong className="text-slate-700 dark:text-slate-300">{fmt(stockTotal)} kg</strong> tayyor mahsulot — kalibrli{' '}
                <strong className="text-slate-700 dark:text-slate-300">{fmt(stockCalibredTotal)} kg</strong> + konditerka{' '}
                <strong className="text-slate-700 dark:text-slate-300">{fmt(stockKnTotal)} kg</strong>, olib ketilgani chegirilgan. Bu qatorlar{' '}
                <strong className="text-slate-700 dark:text-slate-300">jonli qoldiq</strong>, davr bo'yicha ishlab chiqarish emas. Foizlar — jami qoldiqdan ulush. Konditerka alohida qator.
                {ledger && ` Tanlangan davrda yuvishdan chiqqan: ${fmt(ledger.moyka.calibreKg + ledger.moyka.konditirskiyKg)} kg · yo'qotish ${formatLossKg(ledger.moyka.lossKg)} (${formatLossPct(ledger.moyka.lossPct)}).`}
              </>
            )}
          </p>

          <div className="my-6 h-px bg-slate-200 dark:bg-slate-800" />

          <div className="mb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.dispatchedHeading}</h3>
            <p className="text-xs text-slate-400">{t.dispatchedSubtitle}</p>
          </div>
          <div className="space-y-2.5">
            {dispatchedByCalibre.map((r) => (
              <HorizontalBar key={r.calibreId} label={calibreLabel(r.calibreId)} value={r.kg} max={dispatchedMax} color={C.departed} pctOfLabel={ledger.finished.dispatchedKg > 0 ? `${Math.round((r.kg / ledger.finished.dispatchedKg) * 100)}%` : undefined} />
            ))}
            {dispatchedByCalibre.length === 0 && dispatchedKnRows.length === 0 && <p className="text-sm text-slate-400">{t.noDispatchedInPeriod}</p>}
            {dispatchedKnRows.length > 0 && <div className="my-1 border-t border-slate-100 dark:border-slate-800" />}
            {dispatchedKnRows.map((r) => (
              <HorizontalBar key={r.calibreId} label={calibreLabel(r.calibreId)} value={r.kg} max={dispatchedMax} color={C.departed} pctOfLabel={ledger.finished.dispatchedKg > 0 ? `${Math.round((r.kg / ledger.finished.dispatchedKg) * 100)}%` : undefined} />
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            {locale === 'ru' ? (
              <>
                Всего отгружено <strong className="text-slate-700 dark:text-slate-300">{fmt(ledger.finished.dispatchedKg)} кг</strong> · осталось на складе{' '}
                <strong className="text-slate-700 dark:text-slate-300">{fmt(ledger.finished.closingKg)} кг</strong> (калиброванная и кондитерка вместе — плитка{' '}
                <em>Готовая продукция · калиброванная</em> выше показывает только K1–K8). Проценты — доля от общего отгруженного по этому калибру.
              </>
            ) : (
              <>
                Jami olib ketilgan <strong className="text-slate-700 dark:text-slate-300">{fmt(ledger.finished.dispatchedKg)} kg</strong> · omborda qolgan{' '}
                <strong className="text-slate-700 dark:text-slate-300">{fmt(ledger.finished.closingKg)} kg</strong> (kalibrli va konditerka birgalikda — yuqoridagi{' '}
                <em>Tayyor · kalibrli</em> katakchasi faqat K1–K8ni ko'rsatadi). Foizlar — o'sha kalibrning jami olib ketilgan miqdoridan qancha qismi.
              </>
            )}
          </p>
        </>
      )}
    </div>
  )
}
