import { useMemo, useState } from 'react'
import { useAuth } from '../../lib/AuthProvider'
import { todayInTashkent } from '../../lib/dateRange'
import {
  EXPENSE_TYPE_LABEL,
  createCategory,
  createCounterparty,
  createExpense,
  signedFinanceFileUrl,
  updateExpense,
  uploadFinanceFile,
  useCategories,
  useCounterparties,
  useExpenses,
  usePeriodStatuses,
  voidFinanceRow,
  type ExpenseRow,
  type ExpenseType,
} from '../../lib/useFinance'
import { useFinanceAccounts } from '../../lib/useFinanceAccounts'
import { addMonths, coverageMonths, dayLabel, formatSom, formatSomShort, monthLabel, monthLabelShort, monthOptions } from '../../lib/financeFormat'
import { ComboField, type ComboOption } from '../../components/finance/ComboField'
import { AccountCards, AmountInput, ChoicePills, DateInput, FormSection, MonthSelect, NoteInput } from '../../components/finance/FinanceInputs'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { StatusNote } from '../../components/ui/StatusNote'

// Yangi xarajat (mockup artboard "Main", decision 0250): four sections --
// asosiy ma'lumot, kim va nima uchun (combo fields with inline add), qaysi
// hisobdan, qo'shimcha (note + receipt) -- a review aside, auto-posted
// entries waiting for confirmation, and the recent list with edit/void.

const EXPENSE_TYPES: { value: ExpenseType; label: string }[] = (Object.keys(EXPENSE_TYPE_LABEL) as ExpenseType[]).map((value) => ({
  value,
  label: EXPENSE_TYPE_LABEL[value],
}))

interface FormState {
  amount: number
  paymentDate: string
  periodMonth: string
  counterparty: ComboOption | null
  category: ComboOption | null
  expenseType: ExpenseType
  sourceAccountId: string
  note: string
  file: File | null
}

export function XarajatPage() {
  const { profile } = useAuth()
  const today = todayInTashkent()
  const { accounts, currentMonth, since } = useFinanceAccounts()
  const { expenses } = useExpenses(since)
  const { counterparties } = useCounterparties('receiver')
  const { categories } = useCategories()
  const statuses = usePeriodStatuses()

  const blank = (): FormState => ({
    amount: 0,
    paymentDate: today,
    periodMonth: currentMonth,
    counterparty: null,
    category: null,
    expenseType: 'one_off',
    sourceAccountId: '',
    note: '',
    file: null,
  })
  const [form, setForm] = useState<FormState>(blank)
  const [editing, setEditing] = useState<ExpenseRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [voiding, setVoiding] = useState<{ row: ExpenseRow; reason: string } | null>(null)

  const sourceId = form.sourceAccountId || accounts[0]?.id || ''
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))

  const nameOf = useMemo(() => {
    const cp = new Map(counterparties.map((c) => [c.id, c.name]))
    const cat = new Map(categories.map((c) => [c.id, c.name_uz]))
    const acc = new Map(accounts.map((a) => [a.id, a.name_uz]))
    return { cp: (id: string | null) => (id ? cp.get(id) ?? '—' : '—'), cat: (id: string | null) => (id ? cat.get(id) ?? '—' : 'Kategoriyasiz'), acc: (id: string) => acc.get(id) ?? '—' }
  }, [counterparties, categories, accounts])

  const confirmed = expenses.filter((e) => e.status === 'confirmed')
  const pending = expenses.filter((e) => e.status === 'pending')

  // "Oxirgi: Okt 2026 · 2.21M so'm" under each receiver in the combo.
  const counterpartyOptions: ComboOption[] = useMemo(() => {
    const last = new Map<string, ExpenseRow>()
    for (const e of confirmed) if (e.counterparty_id && !last.has(e.counterparty_id)) last.set(e.counterparty_id, e)
    return counterparties.map((c) => {
      const l = last.get(c.id)
      return { id: c.id, name: c.name, hint: l ? `Oxirgi: ${monthLabelShort(l.period_month)} · ${formatSomShort(l.amount)} so'm` : undefined }
    })
  }, [counterparties, confirmed])

  const source = accounts.find((a) => a.id === sourceId)
  const delta = editing ? (editing.source_account_id === sourceId ? editing.amount - form.amount : -form.amount) : -form.amount
  const afterBalance = source ? source.balance + delta : 0
  const covBefore = source && source.kind === 'utility' ? coverageMonths(source.balance, source.avgMonthlySpend ?? 0) : null
  const covAfter = source && source.kind === 'utility' ? coverageMonths(afterBalance, source.avgMonthlySpend ?? 0) : null

  // "Shu oyda — <kategoriya>" + 6-month average.
  const catStats = useMemo(() => {
    if (!form.category) return null
    const id = form.category.id
    const inPeriod = confirmed.filter((e) => e.category_id === id && e.period_month === form.periodMonth && e.id !== editing?.id)
    const total = inPeriod.reduce((s, e) => s + e.amount, 0) + form.amount
    const prev = new Map<string, number>()
    for (const e of confirmed) {
      if (e.category_id !== id) continue
      if (e.period_month >= form.periodMonth || e.period_month < addMonths(form.periodMonth, -6)) continue
      prev.set(e.period_month, (prev.get(e.period_month) ?? 0) + e.amount)
    }
    const avg = prev.size ? [...prev.values()].reduce((s, v) => s + v, 0) / prev.size : null
    return { total, avg }
  }, [form.category, form.periodMonth, form.amount, confirmed, editing])

  function startEdit(e: ExpenseRow) {
    setEditing(e)
    setSaved(null)
    setError(null)
    setForm({
      amount: e.amount,
      paymentDate: e.payment_date,
      periodMonth: e.period_month,
      counterparty: e.counterparty_id ? { id: e.counterparty_id, name: nameOf.cp(e.counterparty_id) } : null,
      category: e.category_id ? { id: e.category_id, name: nameOf.cat(e.category_id) } : null,
      expenseType: e.expense_type,
      sourceAccountId: e.source_account_id,
      note: e.note ?? '',
      file: null,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancel() {
    setEditing(null)
    setForm(blank())
    setError(null)
  }

  async function submit() {
    setError(null)
    setSaved(null)
    if (form.amount <= 0) return setError('Summani kiriting.')
    if (!sourceId) return setError('Qaysi hisobdan to‘lanishini tanlang.')
    if (statuses.get(form.periodMonth) === 'closed') return setError(`${monthLabel(form.periodMonth)} yopilgan — avval qayta oching.`)
    setBusy(true)
    try {
      const receipt_path = form.file ? await uploadFinanceFile(form.file, 'expenses') : editing?.receipt_path ?? null
      const values = {
        amount: form.amount,
        payment_date: form.paymentDate,
        period_month: form.periodMonth,
        category_id: form.category?.id ?? null,
        counterparty_id: form.counterparty?.id ?? null,
        source_account_id: sourceId,
        expense_type: form.expenseType,
        note: form.note.trim() || null,
        receipt_path,
      }
      if (editing) {
        await updateExpense(editing, editing.status === 'pending' ? { ...values, status: 'confirmed' } : values, profile?.id)
        setSaved(editing.status === 'pending' ? 'Tasdiqlandi.' : 'O‘zgarishlar saqlandi.')
      } else {
        await createExpense(values)
        setSaved(`Saqlandi: −${formatSom(form.amount)} so'm.`)
      }
      setEditing(null)
      setForm(blank())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmVoid() {
    if (!voiding) return
    setError(null)
    try {
      await voidFinanceRow('expenses', voiding.row, voiding.reason, profile?.id)
      setVoiding(null)
      if (editing?.id === voiding.row.id) cancel()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bekor qilib bo‘lmadi.')
    }
  }

  async function openReceipt(path: string) {
    const url = await signedFinanceFileUrl(path)
    if (url) window.open(url, '_blank', 'noopener')
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{editing ? (editing.status === 'pending' ? 'Avtomatik yozuvni tasdiqlash' : 'Xarajatni tahrirlash') : 'Yangi xarajat'}</h1>

      {pending.length > 0 && !editing && (
        <Card tone="pending">
          <div className="text-sm font-semibold text-amber-800 dark:text-amber-400">Tasdiqlash kutilmoqda · {pending.length} ta</div>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">Doimiy xarajatlar avtomatik yozildi. Summani tekshirib tasdiqlang — tasdiqlanmaguncha balans va hisobotlarga kirmaydi.</p>
          <ul className="mt-2 space-y-1.5">
            {pending.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-slate-800 dark:text-slate-200">
                  {dayLabel(e.payment_date)} · {nameOf.cp(e.counterparty_id)} · {nameOf.cat(e.category_id)} · {formatSom(e.amount)} so'm
                </span>
                <Button size="md" variant="secondary" onClick={() => startEdit(e)}>
                  Tasdiqlash
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <FormSection title="1 · Asosiy ma'lumot">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_170px_190px]">
              <AmountInput label="Summa" value={form.amount} onChange={(amount) => set({ amount })} large />
              <DateInput label="To'lov sanasi" value={form.paymentDate} onChange={(paymentDate) => set({ paymentDate })} />
              <MonthSelect label="Qaysi oy uchun" value={form.periodMonth} onChange={(periodMonth) => set({ periodMonth })} months={monthOptions(currentMonth, 12, 1)} statuses={statuses} />
            </div>
          </FormSection>

          <FormSection title="2 · Kim va nima uchun">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ComboField
                label="Qabul qiluvchi"
                value={form.counterparty}
                options={counterpartyOptions}
                onSelect={(counterparty) => set({ counterparty })}
                onCreate={async (name) => {
                  const c = await createCounterparty(name, 'receiver')
                  return { id: c.id, name: c.name }
                }}
                addLabel={(name) => `"${name}" nomli yangi qabul qiluvchi qo'shish`}
                placeholder="Yozing yoki tanlang"
                helpText="Yozib yangi qo'shishingiz mumkin"
                allowClear
              />
              <ComboField
                label="Maqsad (kategoriya)"
                value={form.category}
                options={categories.map((c) => ({ id: c.id, name: c.name_uz }))}
                onSelect={(category) => set({ category })}
                onCreate={async (name) => {
                  const c = await createCategory(name)
                  return { id: c.id, name: c.name_uz }
                }}
                addLabel={(name) => `"${name}" kategoriyasini qo'shish`}
                placeholder="Yozing yoki tanlang"
                helpText="Bo'sh qoldirish mumkin — oyni yopishda eslatiladi"
                allowClear
              />
            </div>
            <ChoicePills label="Xarajat turi" value={form.expenseType} options={EXPENSE_TYPES} onChange={(expenseType) => set({ expenseType })} />
          </FormSection>

          <FormSection title="3 · Qaysi hisobdan to'lanadi">
            <AccountCards legend="Hisob" accounts={accounts} value={sourceId} onChange={(sourceAccountId) => set({ sourceAccountId })} />
          </FormSection>

          <FormSection title="4 · Qo'shimcha">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_240px]">
              <NoteInput label="Izoh (ixtiyoriy)" value={form.note} onChange={(note) => set({ note })} />
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="receipt">
                  Chek yoki shartnoma
                </label>
                <input
                  id="receipt"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => set({ file: e.target.files?.[0] ?? null })}
                  className="mt-1 w-full text-sm text-slate-700 dark:text-slate-300"
                />
                {editing?.receipt_path && !form.file && (
                  <button type="button" onClick={() => void openReceipt(editing.receipt_path!)} className="mt-1 text-xs text-slate-600 underline dark:text-slate-400">
                    Mavjud faylni ko'rish
                  </button>
                )}
              </div>
            </div>
          </FormSection>

          {error && <StatusNote tone="problem">{error}</StatusNote>}
          {saved && <StatusNote tone="ok">{saved}</StatusNote>}

          <div className="flex flex-wrap justify-end gap-2">
            {editing && (
              <Button variant="ghost" size="lg" onClick={cancel}>
                Bekor qilish
              </Button>
            )}
            <Button variant="primary" size="lg" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Saqlanmoqda…' : editing?.status === 'pending' ? 'Tasdiqlash' : editing ? 'Saqlash' : 'Amalga oshirish'}
            </Button>
          </div>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-4">
          <Card>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Ko'rib chiqish</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">−{formatSom(form.amount)} so'm</div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {form.category?.name ?? 'Kategoriyasiz'} · {monthLabel(form.periodMonth)} uchun
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-slate-500 dark:text-slate-400">Qabul qiluvchi</dt>
              <dd className="text-slate-900 dark:text-slate-100">{form.counterparty?.name ?? '—'}</dd>
              <dt className="text-slate-500 dark:text-slate-400">Turi</dt>
              <dd className="text-slate-900 dark:text-slate-100">{EXPENSE_TYPE_LABEL[form.expenseType]}</dd>
              <dt className="text-slate-500 dark:text-slate-400">Manba</dt>
              <dd className="text-slate-900 dark:text-slate-100">{source?.name_uz ?? '—'}</dd>
            </dl>
          </Card>

          {source && form.amount > 0 && (
            <Card tone={covAfter !== null && covAfter < 1 ? 'problem' : 'neutral'}>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Saqlagandan keyin</div>
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">{source.name_uz}</span>
                <span className="tabular-nums text-slate-900 dark:text-slate-100">
                  {formatSomShort(source.balance)} → <b>{formatSomShort(afterBalance)}</b>
                </span>
              </div>
              {covBefore !== null && covAfter !== null && (
                <div className="mt-1 flex justify-between text-sm">
                  <span className="text-slate-600 dark:text-slate-400">Yetarli muddat</span>
                  <span className="tabular-nums text-slate-900 dark:text-slate-100">
                    ~{covBefore.toFixed(1)} oy → <b>~{covAfter.toFixed(1)} oy</b>
                  </span>
                </div>
              )}
              {afterBalance < 0 && <p className="mt-2 text-xs text-red-700 dark:text-red-400">⚠ Hisobda yetarli mablag' yo'q — balans manfiy bo'ladi.</p>}
              {afterBalance >= 0 && covAfter !== null && covAfter < 1 && (
                <p className="mt-2 text-xs text-red-700 dark:text-red-400">⚠ {source.name_uz} 1 oydan kam qoladi. Yaqin orada to'ldirish kerak bo'ladi.</p>
              )}
            </Card>
          )}

          {form.category && catStats && (
            <Card>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Shu oyda — {form.category.name}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatSom(catStats.total)} so'm</div>
              {catStats.avg !== null && catStats.avg > 0 && (
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  O'rtacha 6 oy: {formatSom(catStats.avg)} ·{' '}
                  <span className={catStats.total > catStats.avg ? 'text-amber-700 dark:text-amber-400' : 'text-teal-700 dark:text-teal-400'}>
                    {catStats.total >= catStats.avg ? '+' : ''}
                    {Math.round(((catStats.total - catStats.avg) / catStats.avg) * 100)}%
                  </span>
                </div>
              )}
            </Card>
          )}
        </aside>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">So'nggi xarajatlar</h2>
        {confirmed.length === 0 && <p className="text-sm text-slate-400">Hali xarajat yo'q.</p>}
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {confirmed.slice(0, 15).map((e) => (
            <li key={e.id} className="p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-900 dark:text-slate-100">
                  {dayLabel(e.payment_date)} · {nameOf.cp(e.counterparty_id)} · <span className="text-slate-500 dark:text-slate-400">{nameOf.cat(e.category_id)}</span>
                </span>
                <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">−{formatSom(e.amount)}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>
                  {nameOf.acc(e.source_account_id)} · {monthLabelShort(e.period_month)} · {EXPENSE_TYPE_LABEL[e.expense_type]}
                </span>
                <span className="flex gap-3">
                  {e.receipt_path && (
                    <button type="button" className="underline" onClick={() => void openReceipt(e.receipt_path!)}>
                      Chek
                    </button>
                  )}
                  {statuses.get(e.period_month) !== 'closed' && (
                    <>
                      <button type="button" className="underline" onClick={() => startEdit(e)}>
                        Tahrirlash
                      </button>
                      <button type="button" className="underline" onClick={() => setVoiding({ row: e, reason: '' })}>
                        Bekor qilish
                      </button>
                    </>
                  )}
                </span>
              </div>
              {voiding?.row.id === e.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    aria-label="Bekor qilish sababi"
                    placeholder="Sababi (majburiy)"
                    value={voiding.reason}
                    onChange={(ev) => setVoiding({ row: e, reason: ev.target.value })}
                    className="min-h-11 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                  <Button size="md" variant="danger" disabled={!voiding.reason.trim()} onClick={() => void confirmVoid()}>
                    Bekor qilish
                  </Button>
                  <Button size="md" variant="ghost" onClick={() => setVoiding(null)}>
                    Yopish
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
