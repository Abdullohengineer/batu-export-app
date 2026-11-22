import { useMemo, useState } from 'react'
import { useAuth } from '../../lib/AuthProvider'
import { todayInTashkent } from '../../lib/dateRange'
import {
  SERVICE_TYPE_LABEL,
  createCashIn,
  useCashIns,
  useCounterparties,
  useMonthlyRates,
  useMoykaOutputKg,
  usePeriodStatuses,
  voidFinanceRow,
  type CashInRow,
  type ServiceType,
} from '../../lib/useFinance'
import { useFinanceAccounts } from '../../lib/useFinanceAccounts'
import { addMonths, dayLabel, formatSom, formatSomShort, monthLabel, monthLabelShort, monthOptions } from '../../lib/financeFormat'
import { AccountCards, AmountInput, ChoicePills, DateInput, FormSection, MonthSelect, NoteInput } from '../../components/finance/FinanceInputs'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { StatusNote } from '../../components/ui/StatusNote'

// Yangi tushum (mockup artboard "CashIn", decision 0250). Global Export is
// the only customer. Expected earnings = Moyka output kg (existing Hisobot
// engine) × that month's moyka rate (decided 2026-11-22). Receivables are NOT
// tracked (brief invariant 5): expected and received are shown side by side
// as plain numbers -- no "qarzdorlik", no paid/unpaid state.

const SERVICES: { value: ServiceType; label: string }[] = (Object.keys(SERVICE_TYPE_LABEL) as ServiceType[]).map((value) => ({
  value,
  label: SERVICE_TYPE_LABEL[value],
}))

function useExpected(ownerId: string | null, month: string, rates: Map<string, number>) {
  const { kg, loading } = useMoykaOutputKg(ownerId, month)
  const rate = rates.get(`${month}:moyka`) ?? null
  return { kg, rate, expected: kg !== null && rate !== null ? Math.round(kg * rate) : null, loading }
}

function MonthRow({ month, ownerId, rates, received, selected }: { month: string; ownerId: string | null; rates: Map<string, number>; received: number; selected: boolean }) {
  const { kg, rate, expected } = useExpected(ownerId, month, rates)
  return (
    <div className={`rounded-md border p-3 ${selected ? 'border-teal-500 bg-teal-50 dark:border-teal-700 dark:bg-teal-950/30' : 'border-slate-200 dark:border-slate-800'}`}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-slate-900 dark:text-slate-100">{monthLabel(month)}</span>
        <span className="tabular-nums text-slate-700 dark:text-slate-300">Tushgan: {formatSomShort(received)}</span>
      </div>
      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        {kg === null ? 'Moyka kg…' : `${formatSom(kg)} kg`} × {rate !== null ? `${formatSom(rate)} so'm` : 'stavka yo‘q'}
        {expected !== null ? ` = kutilgan ${formatSomShort(expected)}` : ''}
      </div>
    </div>
  )
}

export function TushumPage() {
  const { profile } = useAuth()
  const today = todayInTashkent()
  const { accounts, currentMonth } = useFinanceAccounts()
  const since = addMonths(currentMonth, -6)
  const { cashIns } = useCashIns(since)
  const { counterparties } = useCounterparties('customer')
  const rates = useMonthlyRates()
  const statuses = usePeriodStatuses()
  const customer = counterparties[0] ?? null

  const [amount, setAmount] = useState(0)
  const [receivedDate, setReceivedDate] = useState(today)
  // Global Export usually pays for the previous month.
  const [periodMonth, setPeriodMonth] = useState(addMonths(currentMonth, -1))
  const [service, setService] = useState<ServiceType>('moyka')
  const [destId, setDestId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [voiding, setVoiding] = useState<{ row: CashInRow; reason: string } | null>(null)

  const moneyAccounts = accounts.filter((a) => a.kind === 'bank' || a.kind === 'kassa')
  const dest = destId || moneyAccounts[0]?.id || ''
  const { kg, rate, expected, loading: kgLoading } = useExpected(customer?.owner_id ?? null, periodMonth, rates)

  const receivedByMonth = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cashIns) if (c.service_type === 'moyka') m.set(c.period_month, (m.get(c.period_month) ?? 0) + c.amount)
    return m
  }, [cashIns])
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name_uz ?? '—'

  async function submit() {
    setError(null)
    setSaved(null)
    if (!customer) return setError('Mijoz topilmadi.')
    if (amount <= 0) return setError('Tushgan summani kiriting.')
    if (!dest) return setError('Qaysi hisobga tushganini tanlang.')
    if (statuses.get(periodMonth) === 'closed') return setError(`${monthLabel(periodMonth)} yopilgan — avval qayta oching.`)
    setBusy(true)
    try {
      await createCashIn({
        amount,
        received_date: receivedDate,
        period_month: periodMonth,
        customer_id: customer.id,
        service_type: service,
        destination_account_id: dest,
        note: note.trim() || null,
      })
      setSaved(`Saqlandi: +${formatSom(amount)} so'm · ${monthLabel(periodMonth)} uchun.`)
      setAmount(0)
      setNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmVoid() {
    if (!voiding) return
    try {
      await voidFinanceRow('cash_ins', voiding.row, voiding.reason, profile?.id)
      setVoiding(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bekor qilib bo‘lmadi.')
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Yangi tushum (kelgan pul)</h1>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <FormSection title="1 · Mijoz va davr">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_170px_190px]">
              <div>
                <div className="block text-sm font-medium text-slate-700 dark:text-slate-300">Kimdan (mijoz)</div>
                <div className="mt-1 flex min-h-11 items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                  {customer?.name ?? '—'}
                  <span className="text-xs text-slate-500 dark:text-slate-400">Yagona mijoz</span>
                </div>
              </div>
              <DateInput label="Qabul sanasi" value={receivedDate} onChange={setReceivedDate} />
              <MonthSelect label="Qaysi oy uchun" value={periodMonth} onChange={setPeriodMonth} months={monthOptions(currentMonth, 12, 0)} statuses={statuses} />
            </div>
            <ChoicePills label="Xizmat turi" value={service} options={SERVICES} onChange={setService} />
            {service === 'moyka' && (
              <div className="rounded-md border border-teal-200 bg-teal-50 p-3 dark:border-teal-900 dark:bg-teal-950/30">
                <div className="text-xs font-semibold uppercase tracking-wide text-teal-800 dark:text-teal-400">{monthLabel(periodMonth)} uchun kutilayotgan</div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-slate-700 dark:text-slate-300">
                  <span>Moykadan chiqdi:</span>
                  <b className="tabular-nums">{kgLoading || kg === null ? '…' : `${formatSom(kg)} kg`}</b>
                  <span>×</span>
                  <span>stavka</span>
                  <b className="tabular-nums">{rate !== null ? `${rate.toLocaleString('en-US', { maximumFractionDigits: 2 })} so'm/kg` : 'belgilanmagan'}</b>
                  {expected !== null && (
                    <>
                      <span>=</span>
                      <b className="text-lg tabular-nums text-teal-800 dark:text-teal-300">{formatSom(expected)} so'm</b>
                    </>
                  )}
                </div>
                {rate === null && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Bu oy uchun stavka hali kiritilmagan.</p>}
                {expected !== null && amount !== expected && (
                  <button type="button" className="mt-2 text-xs font-medium text-teal-800 underline dark:text-teal-300" onClick={() => setAmount(expected)}>
                    Kutilgan summani qo'yish
                  </button>
                )}
              </div>
            )}
          </FormSection>

          <FormSection title="2 · Tushgan summa">
            <AmountInput label="Summa" value={amount} onChange={setAmount} large />
            {service === 'moyka' && expected !== null && amount > 0 && amount !== expected && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Kutilgandan farq: {amount > expected ? '+' : '−'}
                {formatSom(Math.abs(amount - expected))} so'm — shu oyning haqiqiy raqami sifatida qayd etiladi.
              </p>
            )}
          </FormSection>

          <FormSection title="3 · Qaysi hisobga tushdi">
            <AccountCards legend="Hisob" accounts={moneyAccounts} value={dest} onChange={setDestId} afterDelta={amount} />
          </FormSection>

          <FormSection title="Izoh">
            <NoteInput label="Izoh (ixtiyoriy)" value={note} onChange={setNote} placeholder="Masalan: bank o'tkazmasi orqali" />
          </FormSection>

          {error && <StatusNote tone="problem">{error}</StatusNote>}
          {saved && <StatusNote tone="ok">{saved}</StatusNote>}
          <div className="flex justify-end">
            <Button variant="primary" size="lg" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Saqlanmoqda…' : 'Amalga oshirish'}
            </Button>
          </div>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-4">
          <Card>
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{customer?.name ?? 'Mijoz'} · Moyka</div>
              <div className="text-[11px] text-slate-400">oylar bo'yicha</div>
            </div>
            <div className="mt-2 space-y-2">
              {[0, -1, -2, -3].map((i) => {
                const m = addMonths(currentMonth, i)
                return <MonthRow key={m} month={m} ownerId={customer?.owner_id ?? null} rates={rates} received={receivedByMonth.get(m) ?? 0} selected={m === periodMonth} />
              })}
            </div>
          </Card>
        </aside>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">So'nggi tushumlar</h2>
        {cashIns.length === 0 && <p className="text-sm text-slate-400">Hali tushum yo'q.</p>}
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {cashIns.slice(0, 15).map((c) => (
            <li key={c.id} className="p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-900 dark:text-slate-100">
                  {dayLabel(c.received_date)} · {SERVICE_TYPE_LABEL[c.service_type]} · {monthLabelShort(c.period_month)} uchun
                </span>
                <span className="font-semibold tabular-nums text-teal-700 dark:text-teal-400">+{formatSom(c.amount)}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>
                  {accName(c.destination_account_id)}
                  {c.note ? ` · ${c.note}` : ''}
                </span>
                {statuses.get(c.period_month) !== 'closed' && (
                  <button type="button" className="underline" onClick={() => setVoiding({ row: c, reason: '' })}>
                    Bekor qilish
                  </button>
                )}
              </div>
              {voiding?.row.id === c.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    aria-label="Bekor qilish sababi"
                    placeholder="Sababi (majburiy)"
                    value={voiding.reason}
                    onChange={(ev) => setVoiding({ row: c, reason: ev.target.value })}
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
