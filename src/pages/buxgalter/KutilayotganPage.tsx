import { useMemo, useState } from 'react'
import { useAuth } from '../../lib/AuthProvider'
import { todayInTashkent } from '../../lib/dateRange'
import {
  RECURRENCE_LABEL,
  createCategory,
  saveObligation,
  skipObligation,
  useCategories,
  useExpenses,
  useObligations,
  usePeriodStatuses,
  type ObligationRow,
  type Recurrence,
} from '../../lib/useFinance'
import { useFinanceAccounts } from '../../lib/useFinanceAccounts'
import { dailyReserve, dayLabel, daysBetween, formatSom, monthOf, monthOptions } from '../../lib/financeFormat'
import { ComboField, type ComboOption } from '../../components/finance/ComboField'
import { AmountInput, ChoicePills, DateInput, FormSection, MonthSelect, NoteInput } from '../../components/finance/FinanceInputs'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { StatusNote } from '../../components/ui/StatusNote'
import { StatusPill } from '../../components/ui/StatusPill'

// Kutilayotgan majburiyatlar (mockup artboard "Kutilayotgan", decision 0251):
// future one-off / periodic payments. On the due date the daily job posts
// each one to Xarajat as a pending entry (migration 0167); confirming it there
// marks the obligation paid and a recurring one rolls on to its next date.

const REMINDER_OPTIONS = [3, 7, 14, 30]

interface FormState {
  name: string
  category: ComboOption | null
  amount: number
  dueDate: string
  periodMonth: string
  periodTouched: boolean
  recurrence: Recurrence
  sourceAccountId: string
  reminder: number
  note: string
}

function blank(today: string): FormState {
  return {
    name: '',
    category: null,
    amount: 0,
    dueDate: today,
    periodMonth: monthOf(today),
    periodTouched: false,
    recurrence: 'monthly',
    sourceAccountId: '',
    reminder: 7,
    note: '',
  }
}

/** "10 Dek", or "15 Yan 2027" outside the current year. */
function dueLabel(date: string, today: string): string {
  return date.slice(0, 4) === today.slice(0, 4) ? dayLabel(date) : `${dayLabel(date)} ${date.slice(0, 4)}`
}

function daysLeftLabel(days: number): string {
  if (days < 0) return `${-days} kun o'tdi`
  if (days === 0) return 'bugun'
  return `${days} kun qoldi`
}

export function KutilayotganPage() {
  const { profile } = useAuth()
  const today = todayInTashkent()
  const currentMonth = monthOf(today)
  const { obligations, loading } = useObligations()
  const { accounts, since } = useFinanceAccounts()
  const { expenses } = useExpenses(since)
  const { categories } = useCategories()
  const statuses = usePeriodStatuses()

  const [editing, setEditing] = useState<ObligationRow | null>(null)
  const [form, setForm] = useState<FormState>(() => blank(today))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [skipping, setSkipping] = useState<{ id: string; reason: string } | null>(null)
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))

  const bankId = accounts.find((a) => a.kind === 'bank')?.id ?? accounts[0]?.id ?? ''
  const sourceId = form.sourceAccountId || bankId

  const name = useMemo(() => {
    const cat = new Map(categories.map((c) => [c.id, c.name_uz]))
    const acc = new Map(accounts.map((a) => [a.id, a.name_uz]))
    return { cat: (id: string | null) => (id ? cat.get(id) ?? '—' : 'Kategoriyasiz'), acc: (id: string | null) => acc.get(id ?? bankId) ?? '—' }
  }, [categories, accounts, bankId])

  // Already posted to Xarajat, waiting for the accountant's confirmation there.
  const posted = useMemo(() => new Set(expenses.filter((e) => e.status === 'pending' && e.upcoming_obligation_id).map((e) => e.upcoming_obligation_id)), [expenses])

  const formDays = daysBetween(today, form.dueDate)

  function startEdit(o: ObligationRow) {
    setError(null)
    setSaved(null)
    setEditing(o)
    setForm({
      name: o.name,
      category: o.category_id ? { id: o.category_id, name: name.cat(o.category_id) } : null,
      amount: o.estimated_amount,
      dueDate: o.due_date,
      periodMonth: o.period_month,
      periodTouched: true,
      recurrence: o.recurrence,
      sourceAccountId: o.source_account_id ?? '',
      reminder: o.reminder_days_before,
      note: o.note ?? '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancel() {
    setEditing(null)
    setForm(blank(today))
    setError(null)
  }

  async function submit() {
    setError(null)
    setSaved(null)
    if (!form.name.trim()) return setError('Nomini yozing.')
    if (form.amount <= 0) return setError('Taxminiy summani kiriting.')
    if (!form.dueDate) return setError("To'lov muddatini tanlang.")
    if (statuses.get(form.periodMonth) === 'closed') return setError('Bu davr yopilgan — boshqa oyni tanlang.')
    setBusy(true)
    try {
      await saveObligation(
        {
          name: form.name.trim(),
          category_id: form.category?.id ?? null,
          estimated_amount: form.amount,
          due_date: form.dueDate,
          period_month: form.periodMonth,
          source_account_id: sourceId || null,
          recurrence: form.recurrence,
          reminder_days_before: form.reminder,
          note: form.note.trim() || null,
        },
        editing,
        profile?.id,
      )
      setSaved(editing ? "O'zgarishlar saqlandi." : "Qo'shildi.")
      setEditing(null)
      setForm(blank(today))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmSkip(o: ObligationRow) {
    if (!skipping) return
    setError(null)
    try {
      await skipObligation(o, skipping.reason, profile?.id)
      setSkipping(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    }
  }

  const selectClass =
    'mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Kutilayotgan majburiyatlar</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
          Kelasi oy yoki yillik to'lovlarni oldindan belgilang. Tizim muddat yaqinlashganda ogohlantirib, kunlik zaxira summasini taklif qiladi.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {editing && <StatusNote tone="info">Tahrirlanmoqda: {editing.name}</StatusNote>}
          <FormSection title="1 · Majburiyat">
            <div>
              <label htmlFor="obl-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Nomi
              </label>
              <input
                id="obl-name"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Masalan: QQS Noyabr 2026"
                className={selectClass}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ComboField
                label="Kategoriya"
                value={form.category}
                options={categories.map((c) => ({ id: c.id, name: c.name_uz }))}
                onSelect={(category) => set({ category })}
                onCreate={async (n) => {
                  const c = await createCategory(n)
                  return { id: c.id, name: c.name_uz }
                }}
                addLabel={(n) => `"${n}" kategoriyasini qo'shish`}
                placeholder="Yozing yoki tanlang"
                allowClear
              />
              <div>
                <AmountInput label="Taxminiy summa" value={form.amount} onChange={(amount) => set({ amount })} />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">~ belgisi — aniq summa muddat kelganda yangilanadi</p>
              </div>
            </div>
          </FormSection>

          <FormSection title="2 · Muddat va takror">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <DateInput
                  label="To'lov muddati"
                  value={form.dueDate}
                  onChange={(dueDate) => set(form.periodTouched || !dueDate ? { dueDate } : { dueDate, periodMonth: monthOf(dueDate) })}
                />
                {form.dueDate && (
                  <p className={`mt-1 text-xs ${formDays < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>{daysLeftLabel(formDays)}</p>
                )}
              </div>
              <div>
                <MonthSelect
                  label="Qaysi davr uchun"
                  value={form.periodMonth}
                  onChange={(periodMonth) => set({ periodMonth, periodTouched: true })}
                  months={monthOptions(currentMonth, 12, 13)}
                  statuses={statuses}
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Hisobotlarga shu oyga kiradi</p>
              </div>
            </div>
            <ChoicePills<Recurrence>
              label="Takror"
              value={form.recurrence}
              options={(['monthly', 'quarterly', 'yearly', 'one_off'] as Recurrence[]).map((r) => ({ value: r, label: RECURRENCE_LABEL[r] }))}
              onChange={(recurrence) => set({ recurrence })}
            />
          </FormSection>

          <FormSection title="3 · Sozlamalar">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="obl-account" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Qaysi hisobdan taxmin
                </label>
                <select id="obl-account" value={sourceId} onChange={(e) => set({ sourceAccountId: e.target.value })} className={selectClass}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name_uz}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="obl-reminder" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Oldindan eslatish
                </label>
                <select id="obl-reminder" value={form.reminder} onChange={(e) => set({ reminder: Number(e.target.value) })} className={selectClass}>
                  {REMINDER_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} kun oldin
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <NoteInput label="Izoh" value={form.note} onChange={(note) => set({ note })} />
          </FormSection>

          {error && <StatusNote tone="problem">{error}</StatusNote>}
          {saved && <StatusNote tone="ok">{saved}</StatusNote>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="md" onClick={cancel}>
              Bekor qilish
            </Button>
            <Button variant="primary" size="md" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Saqlanmoqda…' : editing ? 'Saqlash' : "Qo'shish"}
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Mavjud kutilayotgan majburiyatlar</h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">muddat bo'yicha</span>
          </div>
          {!loading && obligations.length === 0 && <p className="text-sm text-slate-400">Hali kutilayotgan majburiyat yo'q.</p>}
          {obligations.map((o) => {
            const days = daysBetween(today, o.due_date)
            const reserve = dailyReserve(o.estimated_amount, days)
            const isPosted = posted.has(o.id)
            const near = days <= o.reminder_days_before
            return (
              <Card key={o.id} padding="compact" tone={near ? 'pending' : undefined}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-slate-900 dark:text-slate-100">{o.name}</div>
                  <div className="shrink-0 font-semibold tabular-nums text-slate-900 dark:text-slate-100">~{formatSom(o.estimated_amount)}</div>
                </div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {name.cat(o.category_id)} · {RECURRENCE_LABEL[o.recurrence]} · {name.acc(o.source_account_id)}
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className={days < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}>
                    {dueLabel(o.due_date, today)} · {daysLeftLabel(days)}
                  </span>
                  {isPosted ? (
                    <StatusPill tone="pending">Xarajatda tasdiqlash kutilmoqda</StatusPill>
                  ) : (
                    reserve !== null && <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{formatSom(reserve)} so'm/kun ajrating</span>
                  )}
                </div>
                {!isPosted && skipping?.id !== o.id && (
                  <div className="mt-2 flex gap-3 text-sm">
                    <button type="button" className="text-slate-600 underline dark:text-slate-400" onClick={() => startEdit(o)}>
                      Taxminni yangilash
                    </button>
                    <button type="button" className="text-slate-600 underline dark:text-slate-400" onClick={() => setSkipping({ id: o.id, reason: '' })}>
                      O'tkazib yuborish
                    </button>
                  </div>
                )}
                {skipping?.id === o.id && (
                  <div className="mt-2 space-y-2">
                    <input
                      aria-label="O'tkazib yuborish sababi"
                      value={skipping.reason}
                      onChange={(e) => setSkipping({ id: o.id, reason: e.target.value })}
                      placeholder="Sababi (majburiy)"
                      className={selectClass}
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {o.recurrence === 'one_off' ? "Bu to'lov ro'yxatdan chiqadi." : "Shu muddat o'tkazib yuboriladi, keyingisi avtomatik qo'shiladi."}
                    </p>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="md" onClick={() => setSkipping(null)}>
                        Bekor
                      </Button>
                      <Button variant="secondary" size="md" disabled={!skipping.reason.trim()} onClick={() => void confirmSkip(o)}>
                        O'tkazib yuborish
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
          <Card padding="compact" tone="info">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              💡 Muddat kelganda tizim avtomatik "Xarajat" bo'limiga yozadi (sizdan tasdiq so'raydi). Summa noaniq bo'lsa, taxminni yangilashingiz mumkin.
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
