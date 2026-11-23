import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../../lib/AuthProvider'
import { todayInTashkent } from '../../lib/dateRange'
import {
  EXPENSE_TYPE_LABEL,
  SERVICE_TYPE_LABEL,
  createCategory,
  createCounterparty,
  updateExpense,
  updateFinanceRow,
  useCategories,
  useCounterparties,
  usePeriodStatuses,
  voidFinanceRow,
  type CashInRow,
  type ExpenseRow,
  type ExpenseType,
  type ServiceType,
  type TransferRow,
} from '../../lib/useFinance'
import { useAccountBalances } from '../../lib/useAccountBalances'
import { formatSom, monthOf, monthOptions } from '../../lib/financeFormat'
import { ComboField, type ComboOption } from '../../components/finance/ComboField'
import { AmountInput, DateInput, MonthSelect, NoteInput } from '../../components/finance/FinanceInputs'
import { Button } from '../../components/ui/Button'
import { StatusNote } from '../../components/ui/StatusNote'

// Tarix row actions (2026-11-23, decision 0253): ✎ Tahrirlash edits any
// expense / cash-in / transfer in place; 🗑 O'chirish VOIDS it with a reason
// (never DELETE, SPEC §2.15) -- it leaves every list and total but stays in
// the audit trail (Davr tarixi). Both write audit_log; a closed period is
// refused by the database and the buttons aren't offered for it.

export type TarixSource =
  | { kind: 'expense'; row: ExpenseRow }
  | { kind: 'cash_in'; row: CashInRow }
  | { kind: 'transfer'; row: TransferRow }

const TITLE = { expense: 'xarajat', cash_in: 'tushum', transfer: "o'tkazma" } as const
const selectClass =
  'mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
const labelClass = 'block text-sm font-medium text-slate-700 dark:text-slate-300'

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Yopish" className="rounded-md px-2 py-1 text-xl leading-none text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            ×
          </button>
        </div>
        <div className="max-h-[80vh] space-y-3 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

function AccountSelect({ label, value, onChange, exclude }: { label: string; value: string; onChange: (v: string) => void; exclude?: string }) {
  const { accounts } = useAccountBalances()
  return (
    <div>
      <label className={labelClass}>
        {label}
        <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
          {accounts
            .filter((a) => a.id !== exclude)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name_uz}
              </option>
            ))}
        </select>
      </label>
    </div>
  )
}

// ------------------------------------------------------------------ ✎ edit

export function EditRowModal({ source, onClose }: { source: TarixSource; onClose: () => void }) {
  const { profile } = useAuth()
  const statuses = usePeriodStatuses()
  const { categories } = useCategories()
  const { counterparties: receivers } = useCounterparties('receiver')
  const months = monthOptions(monthOf(todayInTashkent()), 12, 1)

  const r = source.row
  const [amount, setAmount] = useState(r.amount)
  const [date, setDate] = useState(source.kind === 'expense' ? source.row.payment_date : source.kind === 'cash_in' ? source.row.received_date : source.row.transfer_date)
  const [period, setPeriod] = useState(source.kind === 'transfer' ? '' : source.row.period_month)
  const [note, setNote] = useState(r.note ?? '')
  // expense
  const [category, setCategory] = useState<ComboOption | null>(null)
  const [receiver, setReceiver] = useState<ComboOption | null>(null)
  const [expenseType, setExpenseType] = useState<ExpenseType>(source.kind === 'expense' ? source.row.expense_type : 'one_off')
  // cash-in
  const [service, setService] = useState<ServiceType>(source.kind === 'cash_in' ? source.row.service_type : 'moyka')
  // accounts
  const [account, setAccount] = useState(
    source.kind === 'expense' ? source.row.source_account_id : source.kind === 'cash_in' ? source.row.destination_account_id : source.row.source_account_id,
  )
  const [toAccount, setToAccount] = useState(source.kind === 'transfer' ? source.row.destination_account_id : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // combos resolve once the lists have loaded
  useEffect(() => {
    if (source.kind !== 'expense') return
    const c = categories.find((x) => x.id === source.row.category_id)
    if (c) setCategory((cur) => cur ?? { id: c.id, name: c.name_uz })
    const p = receivers.find((x) => x.id === source.row.counterparty_id)
    if (p) setReceiver((cur) => cur ?? { id: p.id, name: p.name })
  }, [source, categories, receivers])

  async function save() {
    setError(null)
    if (amount <= 0) return setError('Summani kiriting.')
    if (!date) return setError('Sanani tanlang.')
    if (source.kind !== 'transfer' && statuses.get(period) === 'closed') return setError('Bu davr yopilgan — boshqa oyni tanlang.')
    if (source.kind === 'transfer' && account === toAccount) return setError('Hisoblar har xil bo‘lsin.')
    setBusy(true)
    try {
      const n = note.trim() || null
      if (source.kind === 'expense') {
        await updateExpense(
          source.row,
          {
            amount,
            payment_date: date,
            period_month: period,
            category_id: category?.id ?? null,
            counterparty_id: receiver?.id ?? null,
            source_account_id: account,
            expense_type: expenseType,
            note: n,
          },
          profile?.id,
        )
      } else if (source.kind === 'cash_in') {
        await updateFinanceRow(
          'cash_ins',
          source.row as unknown as { id: string } & Record<string, unknown>,
          { amount, received_date: date, period_month: period, service_type: service, destination_account_id: account, note: n },
          profile?.id,
        )
      } else {
        await updateFinanceRow(
          'transfers',
          source.row as unknown as { id: string } & Record<string, unknown>,
          { amount, transfer_date: date, source_account_id: account, destination_account_id: toAccount, note: n },
          profile?.id,
        )
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title={`Tahrirlash — ${TITLE[source.kind]}`} onClose={onClose}>
      <AmountInput label="Summa" value={amount} onChange={setAmount} />
      <DateInput label={source.kind === 'expense' ? "To'lov sanasi" : source.kind === 'cash_in' ? 'Qabul qilingan sana' : "O'tkazma sanasi"} value={date} onChange={setDate} />
      {source.kind !== 'transfer' && <MonthSelect label="Qaysi oy uchun" value={period} onChange={setPeriod} months={months} statuses={statuses} />}

      {source.kind === 'expense' && (
        <>
          <ComboField
            label="Qabul qiluvchi"
            value={receiver}
            options={receivers.map((c) => ({ id: c.id, name: c.name }))}
            onSelect={setReceiver}
            onCreate={async (name) => {
              const c = await createCounterparty(name, 'receiver')
              return { id: c.id, name: c.name }
            }}
            addLabel={(name) => `"${name}" nomli yangi qabul qiluvchi qo'shish`}
            placeholder="Yozing yoki tanlang"
            allowClear
          />
          <ComboField
            label="Maqsad (kategoriya)"
            value={category}
            options={categories.map((c) => ({ id: c.id, name: c.name_uz }))}
            onSelect={setCategory}
            onCreate={async (name) => {
              const c = await createCategory(name)
              return { id: c.id, name: c.name_uz }
            }}
            addLabel={(name) => `"${name}" kategoriyasini qo'shish`}
            placeholder="Yozing yoki tanlang"
            allowClear
          />
          <label className={labelClass}>
            Xarajat turi
            <select value={expenseType} onChange={(e) => setExpenseType(e.target.value as ExpenseType)} className={selectClass}>
              {(Object.keys(EXPENSE_TYPE_LABEL) as ExpenseType[]).map((t) => (
                <option key={t} value={t}>
                  {EXPENSE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <AccountSelect label="Qaysi hisobdan" value={account} onChange={setAccount} />
        </>
      )}
      {source.kind === 'cash_in' && (
        <>
          <label className={labelClass}>
            Xizmat turi
            <select value={service} onChange={(e) => setService(e.target.value as ServiceType)} className={selectClass}>
              {(Object.keys(SERVICE_TYPE_LABEL) as ServiceType[]).map((t) => (
                <option key={t} value={t}>
                  {SERVICE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <AccountSelect label="Qaysi hisobga" value={account} onChange={setAccount} />
        </>
      )}
      {source.kind === 'transfer' && (
        <>
          <AccountSelect label="Qaysi hisobdan" value={account} onChange={setAccount} />
          <AccountSelect label="Qaysi hisobga" value={toAccount} onChange={setToAccount} exclude={account} />
        </>
      )}
      <NoteInput label="Izoh" value={note} onChange={setNote} />
      {source.kind === 'expense' && source.row.status === 'pending' && (
        <p className="text-xs text-amber-700 dark:text-amber-400">Bu avtomatik yozuv hali tasdiqlanmagan — tasdiqlash "Xarajat" bo'limida.</p>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">O'zgarish "Davr tarixi"da qayd etiladi (kim, qachon, nima o'zgardi).</p>
      {error && <StatusNote tone="problem">{error}</StatusNote>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="md" onClick={onClose}>
          Bekor qilish
        </Button>
        <Button variant="primary" size="md" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saqlanmoqda…' : 'Saqlash'}
        </Button>
      </div>
    </Shell>
  )
}

// ------------------------------------------------------------------ 🗑 delete (void)

export function VoidRowModal({ source, onClose }: { source: TarixSource; onClose: () => void }) {
  const { profile } = useAuth()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const table = source.kind === 'expense' ? 'expenses' : source.kind === 'cash_in' ? 'cash_ins' : 'transfers'

  async function confirm() {
    setError(null)
    setBusy(true)
    try {
      await voidFinanceRow(table, source.row, reason, profile?.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title={`O'chirish — ${TITLE[source.kind]}`} onClose={onClose}>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        <span className="font-semibold tabular-nums">{formatSom(source.row.amount)} so'm</span> — bu yozuv barcha ro'yxat, balans va hisobotlardan olib tashlanadi. Iz
        sifatida "Davr tarixi"da saqlanib qoladi.
      </p>
      <label className={labelClass}>
        Sababi (majburiy)
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: ikki marta kiritilgan" className={selectClass} />
      </label>
      {error && <StatusNote tone="problem">{error}</StatusNote>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="md" onClick={onClose}>
          Bekor qilish
        </Button>
        <Button variant="danger" size="md" disabled={busy || !reason.trim()} onClick={() => void confirm()}>
          {busy ? 'Saqlanmoqda…' : "O'chirish"}
        </Button>
      </div>
    </Shell>
  )
}
