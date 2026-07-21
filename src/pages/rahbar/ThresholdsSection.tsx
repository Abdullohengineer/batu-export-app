import { useState } from 'react'
import { useSettingsLimits } from '../../lib/useSettingsLimits'
import { setThreshold } from '../../lib/masterDataAdmin'

const td = 'px-3 py-2 align-top text-sm'

interface ThresholdMeta {
  label: string
  unit: string
  purpose: string
  nullable?: boolean
}

// §2.14/§3.3 — plain-Uzbek label, unit, and what each threshold governs, so
// a raw number never appears without context. practical_capacity_kg_per_month
// is the one nullable key (§3.2.10) — its own row gets a "Tozalash" (clear)
// control alongside Saqlash, and the input is left blank (never "0") when
// currently unset.
const THRESHOLD_META: Record<string, ThresholdMeta> = {
  raw_idle_days: {
    label: 'Xom ashyo kutilmoqda',
    unit: 'kun',
    purpose: "Xom ashyo qabul qilingach shuncha kun Moykaga yuborilmasa, Kutilayotgan ishlar ro'yxatida ko'rinadi.",
  },
  moyka_idle_days: {
    label: 'Moykada turib qoldi',
    unit: 'kun',
    purpose: 'Seriya Moykada shuncha kundan ortiq tursa, Kutilayotgan ishlar ro\'yxatida ko\'rinadi.',
  },
  tahlil_kechikdi_days: {
    label: 'Tahlil kechikdi',
    unit: 'kun',
    purpose: "Tayyor mahsulot yuvilgach tahlil shuncha kun kechiksa, Kutilayotgan ishlar ro'yxatining eng muhim qatori bo'lib chiqadi (tekshirilmagan mahsulot jo'natilmaydi).",
  },
  sulfur_overdue_days: {
    label: 'Sera kechikdi',
    unit: 'kun',
    purpose: "Namlik natijasi kirgach SO₂ natijasi shuncha kun kechiksa, ogohlantiradi (naturel mahsulotlar bundan mustasno).",
  },
  chiqim_idle_days: {
    label: "Jo'natish kechikdi",
    unit: 'kun',
    purpose: "CHIQIM so'rovi yuklanmagan yoki jo'natilmagan holda shuncha kun tursa, Kutilayotgan ishlar ro'yxatida ko'rinadi.",
  },
  abnormal_loss_pct: {
    label: "G'ayrioddiy yo'qotish",
    unit: '%',
    purpose: "Bitta seriyaning yo'qotish foizi shundan yuqori bo'lsa, Rahbar diqqat talab ro'yxatida (§6.2) chiqadi.",
  },
  high_rewash_rate_pct: {
    label: 'Qayta yuvish darajasi',
    unit: '%',
    purpose: "Mijozning shu oydagi qayta yuvish darajasi shundan yuqori bo'lsa, Rahbar diqqat talab ro'yxatida chiqadi.",
  },
  practical_capacity_kg_per_month: {
    label: "Sig'imi",
    unit: 'kg/oy',
    purpose: "Amaliy qayta ishlash sig'imi. Rahbar boshqaruv panelida foydalanish % sifatida ko'rsatiladi. Bo'sh (tozalangan) bo'lsa, bu ko'rsatkich umuman ko'rsatilmaydi — taxminiy foiz hech qachon chiqmaydi.",
    nullable: true,
  },
}

const THRESHOLD_ORDER = Object.keys(THRESHOLD_META)

export function ThresholdsSection() {
  const { limits, loading, refetch } = useSettingsLimits()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  function draftFor(key: string): string {
    if (key in drafts) return drafts[key]
    const v = limits[key]
    return v === null || v === undefined ? '' : String(v)
  }

  async function handleSave(key: string) {
    const raw = draftFor(key)
    const value = raw.trim() === '' ? null : Number(raw)
    if (raw.trim() !== '' && Number.isNaN(value)) {
      setError("Qiymat raqam bo'lishi kerak.")
      return
    }
    setBusy(key)
    setError(null)
    const { error } = await setThreshold(key, value)
    setBusy(null)
    if (error) {
      setError(error)
      return
    }
    setDrafts((d) => {
      const next = { ...d }
      delete next[key]
      return next
    })
    await refetch()
  }

  async function handleClear(key: string) {
    setBusy(key)
    setError(null)
    const { error } = await setThreshold(key, null)
    setBusy(null)
    if (error) {
      setError(error)
      return
    }
    setDrafts((d) => {
      const next = { ...d }
      delete next[key]
      return next
    })
    await refetch()
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 p-6 dark:border-slate-800">
      <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Limitlar</h2>

      {loading ? (
        <p className="text-sm text-slate-400">Yuklanmoqda…</p>
      ) : (
        <div className="space-y-4">
          {THRESHOLD_ORDER.map((key) => {
            const meta = THRESHOLD_META[key]
            const isUnset = meta.nullable && (limits[key] === null || limits[key] === undefined)
            return (
              <div key={key} className={`${td} rounded-md border border-slate-200 p-3 dark:border-slate-700`}>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="font-medium text-slate-900 dark:text-slate-100">{meta.label}</div>
                    <p className="mt-0.5 max-w-xl text-xs text-slate-500 dark:text-slate-400">{meta.purpose}</p>
                    {isUnset && <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">Hozircha sozlanmagan.</p>}
                  </div>
                  <div className="flex items-end gap-2">
                    <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
                      Qiymat ({meta.unit})
                      <input
                        type="number"
                        value={draftFor(key)}
                        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                        placeholder={meta.nullable ? "bo'sh — sozlanmagan" : undefined}
                        className="mt-1 w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy === key}
                      onClick={() => handleSave(key)}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                    >
                      Saqlash
                    </button>
                    {meta.nullable && (
                      <button
                        type="button"
                        disabled={busy === key}
                        onClick={() => handleClear(key)}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        Tozalash
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
