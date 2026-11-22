import { useMemo, useState } from 'react'
import { useAuth } from '../../lib/AuthProvider'
import { todayInTashkent } from '../../lib/dateRange'
import { createTransfer, createUtilityAccount, useTransfers, voidFinanceRow, type TransferRow } from '../../lib/useFinance'
import { useFinanceAccounts } from '../../lib/useFinanceAccounts'
import { addMonths, dayLabel, formatSom, formatSomShort } from '../../lib/financeFormat'
import { AccountCards, AmountInput, DateInput, FormSection, NoteInput } from '../../components/finance/FinanceInputs'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { StatusNote } from '../../components/ui/StatusNote'

// Hisobdan hisobga o'tkazma (mockup artboard "BalanceTopUp", decision 0250).
// Not an expense: money moves between accounts (bank → kassa cash
// withdrawal, prepaying a utility balance). Date-based only -- transfers have
// no period and never touch P&L.

export function BalansPage() {
  const { profile } = useAuth()
  const today = todayInTashkent()
  const { accounts, currentMonth } = useFinanceAccounts()
  const { transfers } = useTransfers(addMonths(currentMonth, -3))

  const [destId, setDestId] = useState('')
  const [srcId, setSrcId] = useState('')
  const [amount, setAmount] = useState(0)
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [newBalance, setNewBalance] = useState<{ name: string; supplier: string } | null>(null)
  const [voiding, setVoiding] = useState<{ row: TransferRow; reason: string } | null>(null)

  // Destinations: kassa + every utility balance (mockup's "Qaysi hisobga tushsin").
  const destinations = accounts.filter((a) => a.kind !== 'bank')
  const dest = destId || destinations[0]?.id || ''
  const sources = accounts.filter((a) => a.id !== dest)
  const src = srcId && srcId !== dest ? srcId : sources.find((a) => a.kind === 'bank')?.id || sources[0]?.id || ''
  const destAcc = accounts.find((a) => a.id === dest)
  const srcAcc = accounts.find((a) => a.id === src)
  const accName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name_uz])), [accounts])

  async function addBalance() {
    if (!newBalance?.name.trim()) return
    setError(null)
    try {
      const { id } = await createUtilityAccount(newBalance.name, newBalance.supplier)
      setDestId(id)
      setNewBalance(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Qo'shib bo'lmadi.")
    }
  }

  async function submit() {
    setError(null)
    setSaved(null)
    if (amount <= 0) return setError('Summani kiriting.')
    if (!dest || !src) return setError('Ikkala hisobni tanlang.')
    if (dest === src) return setError('Manba va qabul qiluvchi hisob bir xil bo‘lmasin.')
    setBusy(true)
    try {
      await createTransfer({ amount, transfer_date: date, source_account_id: src, destination_account_id: dest, note: note.trim() || null })
      setSaved(`O'tkazildi: ${formatSom(amount)} so'm · ${srcAcc?.name_uz} → ${destAcc?.name_uz}.`)
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
      await voidFinanceRow('transfers', voiding.row, voiding.reason, profile?.id)
      setVoiding(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bekor qilib bo‘lmadi.')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Hisobdan hisobga o'tkazma</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
          Bu xarajat emas. Pulni bir hisobdan boshqasiga ko'chiradi: kommunal balansga oldindan to'lov yoki bankdan kassaga naqd pul olish. Keyin kassadan
          to'langan xarajatlarni "Xarajat" bo'limida kassa manbasi bilan kiriting.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <FormSection title="1 · Qaysi hisobga tushsin">
            <AccountCards legend="Qabul qiluvchi hisob" accounts={destinations} value={dest} onChange={setDestId} afterDelta={amount} />
            {newBalance ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  aria-label="Yangi balans nomi"
                  placeholder="Nomi, masalan: Suv balansi"
                  value={newBalance.name}
                  onChange={(e) => setNewBalance({ ...newBalance, name: e.target.value })}
                  className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-base dark:border-slate-700 dark:bg-slate-900"
                />
                <input
                  aria-label="Yetkazib beruvchi"
                  placeholder='Yetkazib beruvchi, masalan: "Suvokava"'
                  value={newBalance.supplier}
                  onChange={(e) => setNewBalance({ ...newBalance, supplier: e.target.value })}
                  className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-base dark:border-slate-700 dark:bg-slate-900"
                />
                <div className="flex gap-2">
                  <Button size="md" variant="secondary" disabled={!newBalance.name.trim()} onClick={() => void addBalance()}>
                    Qo'shish
                  </Button>
                  <Button size="md" variant="ghost" onClick={() => setNewBalance(null)}>
                    Yopish
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="md" variant="ghost" onClick={() => setNewBalance({ name: '', supplier: '' })}>
                + Yangi balans
              </Button>
            )}
          </FormSection>

          <FormSection title="2 · Qaysi hisobdan olinsin">
            <AccountCards legend="Manba hisob" accounts={sources} value={src} onChange={setSrcId} afterDelta={-amount} />
          </FormSection>

          <FormSection title="3 · Qancha va qachon">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_190px]">
              <AmountInput label="Summa" value={amount} onChange={setAmount} large />
              <DateInput label="O'tkazma sanasi" value={date} onChange={setDate} />
            </div>
            <div className="flex flex-wrap gap-2">
              {[1_000_000, 5_000_000, 10_000_000].map((v) => (
                <Button key={v} size="md" variant="secondary" onClick={() => setAmount((a) => a + v)}>
                  +{formatSomShort(v)}
                </Button>
              ))}
              {destAcc?.avgMonthlySpend ? (
                <Button size="md" variant="secondary" onClick={() => setAmount(Math.round(destAcc.avgMonthlySpend!))}>
                  Oylik taxmin ({formatSomShort(destAcc.avgMonthlySpend)})
                </Button>
              ) : null}
            </div>
            <NoteInput label="Izoh (ixtiyoriy)" value={note} onChange={setNote} />
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
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">O'tkazmadan keyin</div>
            {srcAcc && (
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">{srcAcc.name_uz} — manba</span>
                <span className="tabular-nums text-slate-900 dark:text-slate-100">
                  {formatSomShort(srcAcc.balance)} → <b>{formatSomShort(srcAcc.balance - amount)}</b>
                </span>
              </div>
            )}
            {destAcc && (
              <div className="mt-1 flex justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">{destAcc.name_uz} — qabul</span>
                <span className="tabular-nums text-slate-900 dark:text-slate-100">
                  {formatSomShort(destAcc.balance)} → <b>{formatSomShort(destAcc.balance + amount)}</b>
                </span>
              </div>
            )}
            {srcAcc && srcAcc.balance - amount < 0 && <p className="mt-2 text-xs text-red-700 dark:text-red-400">⚠ Manba hisobda yetarli mablag' yo'q.</p>}
          </Card>
        </aside>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">So'nggi o'tkazmalar</h2>
        {transfers.length === 0 && <p className="text-sm text-slate-400">Hali o'tkazma yo'q.</p>}
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {transfers.slice(0, 15).map((t) => (
            <li key={t.id} className="p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-900 dark:text-slate-100">
                  {dayLabel(t.transfer_date)} · {accName.get(t.source_account_id)} → {accName.get(t.destination_account_id)}
                </span>
                <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatSom(t.amount)}</span>
              </div>
              <div className="mt-0.5 flex justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>{t.note ?? ''}</span>
                <button type="button" className="underline" onClick={() => setVoiding({ row: t, reason: '' })}>
                  Bekor qilish
                </button>
              </div>
              {voiding?.row.id === t.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    aria-label="Bekor qilish sababi"
                    placeholder="Sababi (majburiy)"
                    value={voiding.reason}
                    onChange={(ev) => setVoiding({ row: t, reason: ev.target.value })}
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
