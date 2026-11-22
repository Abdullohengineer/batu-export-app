import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { tashkentDateString, todayInTashkent } from '../../lib/dateRange'
import {
  closePeriod,
  reopenPeriod,
  useCashIns,
  useCloseBlockers,
  useCounterparties,
  useExpenses,
  useMoykaOutputKg,
  usePeriodEvents,
  usePeriodStatuses,
  type CashInRow,
  type CloseBlocker,
  type ExpenseRow,
} from '../../lib/useFinance'
import { useProfileNames } from '../../lib/useProfileNames'
import { addMonths, dayLabel, daysBetween, formatSom, formatSomShort, monthEnd, monthLabel, monthOf } from '../../lib/financeFormat'
import { PeriodAuditModal } from '../../components/finance/PeriodAuditModal'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { StatusNote } from '../../components/ui/StatusNote'
import { StatusPill } from '../../components/ui/StatusPill'

// Oyni yopish (mockup artboard "OyniYopish", decision 0251). The checklist is
// period_close_blockers() (migration 0167) -- the same function the DB runs
// before accepting a close, so the button and the database can't disagree.
// Rezka checks are cut (owner, 2026-11-22). Reopen needs a reason; every
// close/reopen is an append-only event shown in "Davr tarixi".

const HISTORY_MONTHS = 12

interface Totals {
  income: number
  expense: number
  recurringCount: number
  recurringSum: number
}

function totalsFor(month: string, expenses: ExpenseRow[], cashIns: CashInRow[]): Totals {
  const ex = expenses.filter((e) => e.period_month === month && e.status === 'confirmed')
  const rec = ex.filter((e) => e.recurring_expense_id)
  return {
    income: cashIns.filter((c) => c.period_month === month).reduce((s, c) => s + c.amount, 0),
    expense: ex.reduce((s, e) => s + e.amount, 0),
    recurringCount: rec.length,
    recurringSum: rec.reduce((s, e) => s + e.amount, 0),
  }
}

function monthName(month: string): string {
  return monthLabel(month).split(' ')[0]
}

function signed(v: number): string {
  return `${v > 0 ? '+' : ''}${formatSomShort(v)}`
}

export function OyniYopishPage() {
  const today = todayInTashkent()
  const currentMonth = monthOf(today)
  const since = addMonths(currentMonth, -HISTORY_MONTHS)
  const { expenses } = useExpenses(since)
  const { cashIns } = useCashIns(since)
  const statuses = usePeriodStatuses()
  const { events } = usePeriodEvents()
  const { names } = useProfileNames()
  const { counterparties: customers } = useCounterparties('customer')
  const ownerId = customers[0]?.owner_id ?? null

  const [auditMonth, setAuditMonth] = useState<string | null>(null)
  const [reopening, setReopening] = useState<{ month: string; reason: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Open past periods: from the first month that has any finance entry up to
  // last month, plus any reopened month, minus the closed ones.
  const openMonths = useMemo(() => {
    const seen = [...expenses.map((e) => e.period_month), ...cashIns.map((c) => c.period_month)].filter((m) => m < currentMonth)
    const out = new Set<string>()
    if (seen.length > 0) {
      for (let m = seen.reduce((a, b) => (a < b ? a : b)); m < currentMonth; m = addMonths(m, 1)) out.add(m)
    }
    for (const [m, st] of statuses) if (st === 'reopened' && m < currentMonth) out.add(m)
    return [...out].filter((m) => statuses.get(m) !== 'closed').sort().reverse()
  }, [expenses, cashIns, statuses, currentMonth])

  const closedMonths = useMemo(() => [...statuses].filter(([, st]) => st === 'closed').map(([m]) => m).sort().reverse(), [statuses])

  async function doReopen() {
    if (!reopening) return
    setError(null)
    setBusy(true)
    try {
      await reopenPeriod(reopening.month, reopening.reason)
      setReopening(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setBusy(false)
    }
  }

  const cur = totalsFor(currentMonth, expenses, cashIns)
  const daysLeft = daysBetween(today, monthEnd(currentMonth))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Oyni yopish</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
          Oy ochiq ekan — raqamlar jonli, yangi yozuvlar qo'shilsa o'zgarib turadi. Oyni yopganingizdan keyin raqamlar muzlab qoladi, hisobotlar aniq bo'ladi.
          Odatda keyingi oyning 5-7 kunlarida, Global Export tushumi kelganidan keyin yopiladi.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Ochiq davrlar</h2>
        {openMonths.map((m) => (
          <OpenPeriodCard
            key={m}
            month={m}
            reopened={statuses.get(m) === 'reopened'}
            totals={totalsFor(m, expenses, cashIns)}
            ownerId={ownerId}
            onAudit={() => setAuditMonth(m)}
          />
        ))}
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold text-slate-900 dark:text-slate-100">{monthLabel(currentMonth)}</div>
            <StatusPill tone="info">Joriy davr</StatusPill>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {daysLeft} kun qoldi · hozircha xarajat {formatSomShort(cur.expense)}, tushum {formatSomShort(cur.income)}
            {cur.income === 0 && ` (Global Export odatda ${monthName(addMonths(currentMonth, 1))} boshida to'laydi)`}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Yopishga hali erta — odatda 5-7 {monthName(addMonths(currentMonth, 1))}'da</p>
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Yopilgan davrlar</h2>
        {error && <StatusNote tone="problem">{error}</StatusNote>}
        {closedMonths.length === 0 && <p className="text-sm text-slate-400">Hali yopilgan davr yo'q.</p>}
        {closedMonths.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                <th className="px-3 py-2">Davr</th>
                <th className="px-3 py-2">Yopilgan sana</th>
                <th className="px-3 py-2 text-right">Daromad</th>
                <th className="px-3 py-2 text-right">Xarajat</th>
                <th className="px-3 py-2 text-right">Sof foyda</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {closedMonths.map((m) => {
                const t = totalsFor(m, expenses, cashIns)
                const ev = events.find((e) => e.period_month === m && e.action === 'close')
                const isReopening = reopening?.month === m
                return (
                  <tr key={m} className="border-b border-slate-100 align-top dark:border-slate-800">
                    <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">🔒 {monthLabel(m)}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                      {ev ? `${dayLabel(tashkentDateString(new Date(ev.at)))} ${tashkentDateString(new Date(ev.at)).slice(0, 4)} · ${ev.actor ? names[ev.actor] ?? '—' : '—'}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatSomShort(t.income)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatSomShort(t.expense)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{signed(t.income - t.expense)}</td>
                    <td className="px-3 py-2 text-right">
                      {isReopening ? (
                        <div className="ml-auto w-64 space-y-2 text-left">
                          <input
                            aria-label="Qayta ochish sababi"
                            value={reopening.reason}
                            onChange={(e) => setReopening({ month: m, reason: e.target.value })}
                            placeholder="Sababi (majburiy)"
                            className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          />
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="md" onClick={() => setReopening(null)}>
                              Bekor
                            </Button>
                            <Button variant="secondary" size="md" disabled={busy || !reopening.reason.trim()} onClick={() => void doReopen()}>
                              Qayta ochish
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-3 whitespace-nowrap">
                          <button type="button" className="text-slate-600 underline dark:text-slate-400" onClick={() => setAuditMonth(m)}>
                            Davr tarixi
                          </button>
                          <button type="button" className="text-slate-600 underline dark:text-slate-400" onClick={() => setReopening({ month: m, reason: '' })}>
                            Qayta ochish
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        )}
      </section>

      <Card tone="info">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">ⓘ Qayta ochish nima?</div>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Yopilgan oyga keyinchalik yangi yozuv qo'shish kerak bo'lsa (masalan, eski chek topildi), oyni qayta ochasiz, yozuvni qo'shasiz va qaytadan yopasiz.
          Har bir qayta ochish tarixda qayd etiladi (kim, qachon, nega), shuning uchun hisobotlar auditga tayyor bo'ladi.
        </p>
      </Card>

      {auditMonth && <PeriodAuditModal month={auditMonth} onClose={() => setAuditMonth(null)} />}
    </div>
  )
}

// ------------------------------------------------------------------ one open period

function OpenPeriodCard({
  month,
  reopened,
  totals,
  ownerId,
  onAudit,
}: {
  month: string
  reopened: boolean
  totals: Totals
  ownerId: string | null
  onAudit: () => void
}) {
  const { blockers, loading, error: loadError } = useCloseBlockers(month)
  const { kg } = useMoykaOutputKg(ownerId, month)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const issues = blockers.filter((b) => b.blocking && b.n > 0)
  const by = (code: CloseBlocker['code']) => blockers.find((b) => b.code === code)
  const missingExtra =
    (by('recurring_missing')?.detail ?? []).reduce((s, d) => s + Number(d.amount ?? 0), 0) +
    (by('pending')?.detail ?? []).reduce((s, d) => s + Number(d.amount ?? 0), 0)
  const profit = totals.income - totals.expense
  const name = monthName(month)

  async function doClose() {
    setError(null)
    setBusy(true)
    try {
      await closePeriod(month)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-slate-900 dark:text-slate-100">{monthLabel(month)}</div>
        <div className="flex items-center gap-2">
          {reopened && <StatusPill tone="info">Qayta ochilgan — vaqtincha</StatusPill>}
          {!loading && <StatusPill tone={issues.length ? 'pending' : 'ok'}>{issues.length ? `Ochiq · ${issues.length} ta masala` : 'Yopishga tayyor'}</StatusPill>}
        </div>
      </div>
      {issues.length > 0 && (
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Yopilish uchun tayyorlanmoqda — {issues.length} ta masalani hal qiling</p>
      )}

      <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Hozirgi raqamlar (vaqtincha)</div>
      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure label="Daromad" value={formatSomShort(totals.income)} />
        <Figure label="Xarajat" value={formatSomShort(totals.expense)} />
        <Figure label="Sof foyda" value={signed(profit)} />
        <Figure label="1 kg tannarxi" value={kg && kg > 0 ? `${formatSom(totals.expense / kg)} so'm` : '—'} />
      </div>
      {missingExtra > 0 && (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
          ⚠ Kiritilmagan va tasdiqlanmagan xarajatlar qo'shilsa xarajat ~{formatSomShort(missingExtra)} ga oshadi → sof foyda ~{signed(profit - missingExtra)}
        </p>
      )}

      <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Yopishdan oldin</div>
      {loadError && <StatusNote tone="problem">{loadError}</StatusNote>}
      <ul className="mt-1 space-y-2">
        {blockers.map((b) => (
          <ChecklistRow key={b.code} b={b} month={month} totals={totals} />
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
        <div className="text-sm text-slate-600 dark:text-slate-300">
          {issues.length > 0
            ? `${issues.length} ta masala qolgani uchun yopa olmaysiz. Hal qilingach "${name}ni yopish" tugmasi faollashadi.`
            : 'Hammasi joyida — oyni yopishingiz mumkin.'}
          <button type="button" className="ml-2 text-slate-600 underline dark:text-slate-400" onClick={onAudit}>
            Davr tarixi
          </button>
        </div>
        <Button variant="primary" size="md" disabled={loading || busy || issues.length > 0} onClick={() => void doClose()}>
          🔒 {name}ni yopish
        </Button>
      </div>
      {error && (
        <div className="mt-2">
          <StatusNote tone="problem">{error}</StatusNote>
        </div>
      )}
    </Card>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  )
}

function ChecklistRow({ b, month, totals }: { b: CloseBlocker; month: string; totals: Totals }) {
  const name = monthName(month)
  const ok = b.n === 0
  let title: string
  let sub: string | null = null
  let link: { to: string; label: string } | null = null

  switch (b.code) {
    case 'recurring_missing':
      title = ok ? (totals.recurringCount ? `${totals.recurringCount} ta doimiy xarajat qo'yildi` : "Kutilgan doimiy xarajatlarning barchasi qo'yilgan") : `${b.n} ta doimiy xarajat ${name} uchun kiritilmagan`
      sub = ok
        ? totals.recurringCount
          ? `${formatSom(totals.recurringSum)} so'm`
          : null
        : b.detail.map((d) => `${String(d.name)} · ~${formatSom(Number(d.amount))}`).join(', ')
      link = ok ? null : { to: '/buxgalter/kirim', label: 'Kiritish' }
      break
    case 'pending':
      title = ok ? 'Avtomatik yozuvlarning barchasi tasdiqlangan' : `${b.n} ta avtomatik yozuv tasdiqlanmagan`
      sub = ok ? null : b.detail.map((d) => `${dayLabel(String(d.date))} · ${formatSom(Number(d.amount))}`).join(', ')
      link = ok ? null : { to: '/buxgalter/kirim', label: 'Tasdiqlash' }
      break
    case 'cash_in_missing':
      title = ok ? `Global Export ${name} tushumi kiritildi` : `Global Export ${name} tushumi kiritilmagan`
      sub = ok ? b.detail.map((d) => `${dayLabel(String(d.date))} · ${formatSom(Number(d.amount))} so'm`).join(', ') : null
      link = ok ? null : { to: '/buxgalter/kirim/tushum', label: 'Kiritish' }
      break
    case 'uncategorized':
      title = ok ? 'Barcha xarajatlar kategoriyalangan' : `${b.n} ta xarajat kategoriyasiz`
      sub = ok ? null : "Xarajat ro'yxatida Tahrirlash orqali kategoriya tanlang"
      link = ok ? null : { to: '/buxgalter/kirim', label: 'Kiritish' }
      break
    case 'obligations_open':
      title = ok ? `${name}ga tegishli kutilayotgan majburiyatlar yo'q` : `${name}ga tegishli ${b.n} ta kutilayotgan majburiyat ochiq`
      sub = ok ? null : "Yopishga to'sqinlik qilmaydi"
      link = ok ? null : { to: '/buxgalter/kirim/kutilayotgan', label: "Ko'rish" }
      break
  }

  const mark = ok ? '✓' : b.blocking ? '!' : 'ⓘ'
  const markClass = ok
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
    : b.blocking
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'

  return (
    <li className="flex items-start gap-3">
      <span aria-hidden className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${markClass}`}>
        {mark}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</div>
        {sub && <div className="text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
      </div>
      {link && (
        <Link to={link.to} className="shrink-0 text-sm font-medium text-slate-700 underline dark:text-slate-300">
          {link.label}
        </Link>
      )}
    </li>
  )
}
