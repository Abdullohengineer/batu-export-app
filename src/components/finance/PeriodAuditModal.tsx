import { useEffect, useMemo } from 'react'
import { usePeriodAudit, usePeriodEvents } from '../../lib/useFinance'
import { useProfileNames } from '../../lib/useProfileNames'
import { formatSom, monthLabel } from '../../lib/financeFormat'

// "Davr tarixi" (decision 0251): who closed / reopened a period and why, and
// every edit, void, confirm and skip of the rows that belong to it -- read
// from period_close_events + audit_log (finance tables only, migration 0167).
// Opened from Oyni yopish and from Tarix. An append-only event timeline:
// newest first, exactly as the log stores it (sort-rule exemption, SPEC §5).

const TABLE_LABEL: Record<string, string> = {
  expenses: 'Xarajat',
  cash_ins: 'Tushum',
  upcoming_obligations: 'Kutilayotgan majburiyat',
}

const ACTION_LABEL: Record<string, string> = {
  edit: 'tahrirlandi',
  confirm: 'tasdiqlandi',
  void: 'bekor qilindi',
  skip: "o'tkazib yuborildi",
}

const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tashkent',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

interface Item {
  key: string
  at: string
  actor: string | null
  title: string
  detail: string | null
  tone: 'lock' | 'unlock' | 'change'
}

function amountOf(v: Record<string, unknown> | null): number | null {
  const a = v?.amount ?? v?.estimated_amount
  return typeof a === 'number' ? a : null
}

export function PeriodAuditModal({ month, onClose }: { month: string; onClose: () => void }) {
  const { events } = usePeriodEvents()
  const { entries, loading, error } = usePeriodAudit(month, true)
  const { names } = useProfileNames()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const items = useMemo<Item[]>(() => {
    const out: Item[] = events
      .filter((e) => e.period_month === month)
      .map((e) => ({
        key: `ev-${e.id}`,
        at: e.at,
        actor: e.actor,
        title: e.action === 'close' ? 'Davr yopildi' : 'Davr qayta ochildi',
        detail: e.reason ? `Sabab: ${e.reason}` : null,
        tone: e.action === 'close' ? 'lock' : 'unlock',
      }))
    for (const a of entries) {
      const before = amountOf(a.before)
      const after = amountOf(a.after)
      const parts: string[] = []
      if (before !== null && after !== null && before !== after) parts.push(`${formatSom(before)} → ${formatSom(after)} so'm`)
      else if (before !== null) parts.push(`${formatSom(before)} so'm`)
      const reason = a.after?.void_reason ?? a.after?.reason
      if (typeof reason === 'string') parts.push(`Sabab: ${reason}`)
      out.push({
        key: `au-${a.id}`,
        at: a.at,
        actor: a.actor,
        title: `${TABLE_LABEL[a.table_name] ?? a.table_name} ${ACTION_LABEL[a.action] ?? a.action}`,
        detail: parts.join(' · ') || null,
        tone: 'change',
      })
    }
    return out.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0))
  }, [events, entries, month])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Davr tarixi — ${monthLabel(month)}`}
      onClick={onClose}
    >
      <div className="w-full max-w-xl rounded-lg bg-white shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Davr tarixi — {monthLabel(month)}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Yopish"
            className="rounded-md px-2 py-1 text-xl leading-none text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            ×
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4 text-sm">
          {loading && <p className="text-slate-400">Yuklanmoqda…</p>}
          {error && (
            <p className="font-medium text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
          {!loading && !error && items.length === 0 && <p className="text-slate-400">Bu davrda hali yopish, qayta ochish yoki tuzatish bo'lmagan.</p>}
          <ol className="space-y-3">
            {items.map((it) => (
              <li key={it.key} className="flex gap-3">
                <span aria-hidden className="mt-0.5 w-5 shrink-0 text-center">
                  {it.tone === 'lock' ? '🔒' : it.tone === 'unlock' ? '🔓' : '✎'}
                </span>
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 dark:text-slate-100">{it.title}</div>
                  {it.detail && <div className="text-slate-600 dark:text-slate-300">{it.detail}</div>}
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {TIME_FMT.format(new Date(it.at))} · {it.actor ? names[it.actor] ?? '—' : 'Tizim'}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}
