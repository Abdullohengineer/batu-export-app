import { useMemo, useState } from 'react'
import { useAuth } from '../../lib/AuthProvider'
import { todayInTashkent } from '../../lib/dateRange'
import {
  createCategory,
  createCounterparty,
  saveRecurring,
  setRecurringActive,
  useCategories,
  useCounterparties,
  useRecurring,
  type RecurringRow,
} from '../../lib/useFinance'
import { useFinanceAccounts } from '../../lib/useFinanceAccounts'
import { dayLabel, daysBetween, formatSom, nextDueDate } from '../../lib/financeFormat'
import { ComboField, type ComboOption } from '../../components/finance/ComboField'
import { AmountInput, ChoicePills, FormSection, NoteInput } from '../../components/finance/FinanceInputs'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { StatusNote } from '../../components/ui/StatusNote'
import { StatusPill } from '../../components/ui/StatusPill'

// Doimiy xarajatlar (mockup artboard "Recurring", decision 0250): schedules
// the daily job turns into pending expenses on their day (migration 0166);
// the accountant confirms each one on the Xarajat tab.

type RecType = 'recurring_required' | 'recurring_optional'

interface FormState {
  counterparty: ComboOption | null
  category: ComboOption | null
  sourceAccountId: string
  amount: number
  day: number
  type: RecType
  note: string
}

const blank: FormState = { counterparty: null, category: null, sourceAccountId: '', amount: 0, day: 1, type: 'recurring_required', note: '' }

export function DoimiyPage() {
  const { profile } = useAuth()
  const today = todayInTashkent()
  const { recurring } = useRecurring()
  const { accounts } = useFinanceAccounts()
  const { counterparties } = useCounterparties('receiver')
  const { categories } = useCategories()

  const [editing, setEditing] = useState<RecurringRow | 'new' | null>(null)
  const [form, setForm] = useState<FormState>(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))

  const name = useMemo(() => {
    const cp = new Map(counterparties.map((c) => [c.id, c.name]))
    const cat = new Map(categories.map((c) => [c.id, c.name_uz]))
    const acc = new Map(accounts.map((a) => [a.id, a.name_uz]))
    return { cp: (id: string) => cp.get(id) ?? '—', cat: (id: string | null) => (id ? cat.get(id) ?? '—' : 'Kategoriyasiz'), acc: (id: string) => acc.get(id) ?? '—' }
  }, [counterparties, categories, accounts])

  const active = recurring.filter((r) => r.is_active)
  const monthlyTotal = active.reduce((s, r) => s + r.monthly_amount, 0)
  const next7 = active.filter((r) => daysBetween(today, nextDueDate(r.day_of_month, today)) <= 7)

  function open(row: RecurringRow | 'new') {
    setError(null)
    setEditing(row)
    setForm(
      row === 'new'
        ? blank
        : {
            counterparty: { id: row.counterparty_id, name: name.cp(row.counterparty_id) },
            category: row.category_id ? { id: row.category_id, name: name.cat(row.category_id) } : null,
            sourceAccountId: row.source_account_id,
            amount: row.monthly_amount,
            day: row.day_of_month,
            type: row.expense_type,
            note: row.note ?? '',
          },
    )
  }

  async function submit() {
    setError(null)
    const source = form.sourceAccountId || accounts[0]?.id
    if (!form.counterparty) return setError('Qabul qiluvchini tanlang.')
    if (form.amount <= 0) return setError('Oylik summani kiriting.')
    if (!source) return setError('Hisobni tanlang.')
    if (!(form.day >= 1 && form.day <= 31)) return setError("Kun 1 dan 31 gacha bo'lsin.")
    setBusy(true)
    try {
      await saveRecurring(
        {
          counterparty_id: form.counterparty.id,
          category_id: form.category?.id ?? null,
          source_account_id: source,
          monthly_amount: form.amount,
          day_of_month: form.day,
          expense_type: form.type,
          note: form.note.trim() || null,
        },
        editing === 'new' ? null : editing,
        profile?.id,
      )
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setBusy(false)
    }
  }

  async function toggle(r: RecurringRow) {
    setError(null)
    try {
      await setRecurringActive(r, !r.is_active, profile?.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Doimiy xarajatlar</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Har oy avtomatik qayd etiladigan xarajatlar. Belgilangan kuni tizim yozuvni o'zi yaratadi — "Xarajat" bo'limida tasdiqlashingizgina kerak.
          </p>
        </div>
        {editing === null && (
          <Button variant="primary" size="md" onClick={() => open('new')}>
            + Yangi doimiy xarajat
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card padding="compact">
          <div className="text-xs text-slate-500 dark:text-slate-400">Oylik jami</div>
          <div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatSom(monthlyTotal)} so'm</div>
        </Card>
        <Card padding="compact">
          <div className="text-xs text-slate-500 dark:text-slate-400">Faol yozuvlar</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{active.length} ta</div>
        </Card>
        <Card padding="compact">
          <div className="text-xs text-slate-500 dark:text-slate-400">Keyingi 7 kun</div>
          <div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {formatSom(next7.reduce((s, r) => s + r.monthly_amount, 0))} · {next7.length} ta
          </div>
        </Card>
      </div>

      {editing !== null && (
        <FormSection title={editing === 'new' ? 'Yangi doimiy xarajat' : 'Doimiy xarajatni tahrirlash'}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ComboField
              label="Qabul qiluvchi"
              value={form.counterparty}
              options={counterparties.map((c) => ({ id: c.id, name: c.name }))}
              onSelect={(counterparty) => set({ counterparty })}
              onCreate={async (n) => {
                const c = await createCounterparty(n, 'receiver')
                return { id: c.id, name: c.name }
              }}
              addLabel={(n) => `"${n}" nomli yangi qabul qiluvchi qo'shish`}
              placeholder="Yozing yoki tanlang"
            />
            <ComboField
              label="Maqsad (kategoriya)"
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
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_140px]">
            <div>
              <label htmlFor="rec-account" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Qaysi hisobdan
              </label>
              <select
                id="rec-account"
                value={form.sourceAccountId || accounts[0]?.id || ''}
                onChange={(e) => set({ sourceAccountId: e.target.value })}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name_uz}
                  </option>
                ))}
              </select>
            </div>
            <AmountInput label="Oylik summa" value={form.amount} onChange={(amount) => set({ amount })} />
            <div>
              <label htmlFor="rec-day" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Har oyning kuni
              </label>
              <input
                id="rec-day"
                type="number"
                min={1}
                max={31}
                value={form.day}
                onChange={(e) => set({ day: Number(e.target.value) })}
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
          <ChoicePills<RecType>
            label="Turi"
            value={form.type}
            options={[
              { value: 'recurring_required', label: 'Doimiy — majburiy' },
              { value: 'recurring_optional', label: 'Doimiy — ixtiyoriy' },
            ]}
            onChange={(type) => set({ type })}
          />
          <NoteInput label="Izoh (ixtiyoriy)" value={form.note} onChange={(note) => set({ note })} />
          {error && <StatusNote tone="problem">{error}</StatusNote>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="md" onClick={() => setEditing(null)}>
              Bekor qilish
            </Button>
            <Button variant="primary" size="md" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Saqlanmoqda…' : 'Saqlash'}
            </Button>
          </div>
        </FormSection>
      )}
      {editing === null && error && <StatusNote tone="problem">{error}</StatusNote>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <th className="px-3 py-2">Qabul qiluvchi</th>
              <th className="px-3 py-2">Maqsad</th>
              <th className="px-3 py-2">Hisobdan</th>
              <th className="px-3 py-2 text-right">Oylik summa</th>
              <th className="px-3 py-2">Keyingi to'lov</th>
              <th className="px-3 py-2">Holat</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {recurring.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  Hali doimiy xarajat yo'q.
                </td>
              </tr>
            )}
            {recurring.map((r) => {
              const due = nextDueDate(r.day_of_month, today)
              const days = daysBetween(today, due)
              const soon = r.is_active && days <= 7
              return (
                <tr key={r.id} className={`border-b border-slate-100 dark:border-slate-800 ${r.is_active ? '' : 'opacity-60'}`}>
                  <td className="px-3 py-2 text-slate-900 dark:text-slate-100">{name.cp(r.counterparty_id)}</td>
                  <td className="px-3 py-2">{name.cat(r.category_id)}</td>
                  <td className="px-3 py-2">{name.acc(r.source_account_id)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatSom(r.monthly_amount)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.is_active ? `${dayLabel(due)}${days <= 7 ? ` (${days === 0 ? 'bugun' : `${days} kun`})` : ''}` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone={!r.is_active ? 'neutral' : soon ? 'pending' : 'ok'}>{!r.is_active ? 'Nofaol' : soon ? 'Yaqin' : 'Faol'}</StatusPill>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <button type="button" className="mr-3 text-slate-600 underline dark:text-slate-400" onClick={() => open(r)}>
                      Tahrirlash
                    </button>
                    <button type="button" className="text-slate-600 underline dark:text-slate-400" onClick={() => void toggle(r)}>
                      {r.is_active ? "To'xtatish" : 'Faollashtirish'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
