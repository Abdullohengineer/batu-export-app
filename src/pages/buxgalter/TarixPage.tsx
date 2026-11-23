import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import ExcelJS from 'exceljs'
import { todayInTashkent } from '../../lib/dateRange'
import {
  SERVICE_TYPE_LABEL,
  useCashIns,
  useCategories,
  useCounterparties,
  useExpenses,
  usePeriodStatuses,
  useTransfers,
} from '../../lib/useFinance'
import { useAccountBalances } from '../../lib/useAccountBalances'
import { dayLabel, formatSom, formatSomShort, monthEnd, monthLabel, monthLabelShort, monthOf, monthOptions } from '../../lib/financeFormat'
import { toExcelDate, EXCEL_DATE_FORMAT } from '../../lib/formatDate'
import { PeriodAuditModal } from '../../components/finance/PeriodAuditModal'
import { IconButton } from '../../components/ui/IconButton'
import { EditRowModal, VoidRowModal, type TarixSource } from './TarixRowModals'

// Tarix (mockup artboard "History", decision 0250): every expense, cash-in
// and transfer for one period, filterable by kind, category and account.
// Expenses/cash-ins filter by period_month ("qaysi oy uchun"); transfers have
// no period and filter by their date. The accountant gets ✎ / 🗑 per row
// (TarixRowModals, decision 0253); the copies mounted for rahbar/menejer
// under /…/moliya/tarix stay read-only.

type Kind = 'all' | 'expense' | 'cash_in' | 'transfer'

interface LogRow {
  key: string
  date: string
  kind: 'expense' | 'cash_in' | 'transfer'
  who: string
  purpose: string
  period: string | null
  amount: number // signed: − expense, + cash-in, unsigned transfer
  account: string
  accountIds: string[]
  categoryId: string | null
  pending: boolean
  source: TarixSource
}

const KIND_LABEL = { expense: '↓ Xarajat', cash_in: '↑ Tushum', transfer: '⇄ O‘tkazma' } as const

const selectClass =
  'min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

export function TarixPage() {
  const currentMonth = monthOf(todayInTashkent())
  const [month, setMonth] = useState(currentMonth)
  const [kind, setKind] = useState<Kind>('all')
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [showAudit, setShowAudit] = useState(false)
  const [editing, setEditing] = useState<TarixSource | null>(null)
  const [voiding, setVoiding] = useState<TarixSource | null>(null)
  // Row actions are the accountant's only; the Rahbar/Menejer copies stay read-only.
  const canEdit = useLocation().pathname.startsWith('/buxgalter')
  const statuses = usePeriodStatuses()

  const { expenses, loading: l1 } = useExpenses(month)
  const { cashIns, loading: l2 } = useCashIns(month)
  const { transfers, loading: l3 } = useTransfers(month)
  const { categories } = useCategories()
  const { counterparties: receivers } = useCounterparties('receiver')
  const { counterparties: customers } = useCounterparties('customer')
  const { accounts } = useAccountBalances()

  const rows = useMemo<LogRow[]>(() => {
    const cp = new Map([...receivers, ...customers].map((c) => [c.id, c.name]))
    const cat = new Map(categories.map((c) => [c.id, c.name_uz]))
    const acc = new Map(accounts.map((a) => [a.id, a.name_uz]))
    const out: LogRow[] = []
    for (const e of expenses) {
      if (e.period_month !== month) continue
      out.push({
        key: `e-${e.id}`,
        date: e.payment_date,
        kind: 'expense',
        who: e.counterparty_id ? cp.get(e.counterparty_id) ?? '—' : '—',
        purpose: e.category_id ? cat.get(e.category_id) ?? '—' : 'Kategoriyasiz',
        period: e.period_month,
        amount: -e.amount,
        account: acc.get(e.source_account_id) ?? '—',
        accountIds: [e.source_account_id],
        categoryId: e.category_id,
        pending: e.status === 'pending',
        source: { kind: 'expense', row: e },
      })
    }
    for (const c of cashIns) {
      if (c.period_month !== month) continue
      out.push({
        key: `c-${c.id}`,
        date: c.received_date,
        kind: 'cash_in',
        who: cp.get(c.customer_id) ?? '—',
        purpose: `${SERVICE_TYPE_LABEL[c.service_type]} tushumi`,
        period: c.period_month,
        amount: c.amount,
        account: acc.get(c.destination_account_id) ?? '—',
        accountIds: [c.destination_account_id],
        categoryId: null,
        pending: false,
        source: { kind: 'cash_in', row: c },
      })
    }
    for (const t of transfers) {
      if (t.transfer_date > monthEnd(month)) continue
      const route = `${acc.get(t.source_account_id) ?? '—'} → ${acc.get(t.destination_account_id) ?? '—'}`
      out.push({
        key: `t-${t.id}`,
        date: t.transfer_date,
        kind: 'transfer',
        who: route,
        purpose: t.note ?? "Hisoblar o'rtasida",
        period: null,
        amount: t.amount,
        account: route,
        accountIds: [t.source_account_id, t.destination_account_id],
        categoryId: null,
        pending: false,
        source: { kind: 'transfer', row: t },
      })
    }
    return out
      .filter((r) => kind === 'all' || r.kind === kind)
      .filter((r) => !categoryId || r.categoryId === categoryId)
      .filter((r) => !accountId || r.accountIds.includes(accountId))
      .sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : b.date.localeCompare(a.date)))
  }, [expenses, cashIns, transfers, month, kind, categoryId, accountId, receivers, customers, categories, accounts])

  const outTotal = rows.filter((r) => r.kind === 'expense' && !r.pending).reduce((s, r) => s - r.amount, 0)
  const inTotal = rows.filter((r) => r.kind === 'cash_in').reduce((s, r) => s + r.amount, 0)
  const loading = l1 || l2 || l3

  async function exportXlsx() {
    const wb = new ExcelJS.Workbook()
    const sh = wb.addWorksheet('Tarix')
    const head = sh.addRow(['Sana', 'Turi', 'Kim / qayerga', 'Maqsad', 'Davr', 'Summa', 'Hisob', 'Holat'])
    head.font = { bold: true }
    for (const r of rows) {
      const row = sh.addRow([
        toExcelDate(r.date),
        KIND_LABEL[r.kind],
        r.who,
        r.purpose,
        r.period ? monthLabel(r.period) : '—',
        r.amount,
        r.account,
        r.pending ? 'Tasdiqlanmagan' : '',
      ])
      row.getCell(1).numFmt = EXCEL_DATE_FORMAT
      row.getCell(6).numFmt = '#,##0'
    }
    sh.columns.forEach((c, i) => (c.width = [12, 14, 30, 22, 14, 16, 28, 14][i]))
    const buf = await wb.xlsx.writeBuffer()
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `tarix-${month.slice(0, 7)}.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Tarix</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Barcha kirim-chiqim va o'tkazma yozuvlari</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowAudit(true)}
            className="min-h-11 rounded-full border border-slate-300 px-4 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
          >
            Davr tarixi
          </button>
          <button
            type="button"
            onClick={() => void exportXlsx()}
            disabled={rows.length === 0}
            className="min-h-11 rounded-full border border-emerald-300 bg-emerald-50 px-4 text-sm font-medium text-emerald-700 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          >
            ⬇ Eksport
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="tarix-month">
          Davr
        </label>
        <select id="tarix-month" value={month} onChange={(e) => setMonth(e.target.value)} className={selectClass}>
          {monthOptions(currentMonth, 12, 0).map((m) => (
            <option key={m} value={m}>
              Davr: {monthLabel(m)}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Turi">
          {(['all', 'expense', 'cash_in', 'transfer'] as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`min-h-11 rounded-full border px-3 text-sm ${
                kind === k
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                  : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'
              }`}
            >
              {k === 'all' ? 'Barchasi' : k === 'expense' ? 'Xarajat' : k === 'cash_in' ? 'Tushum' : "O'tkazma"}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="tarix-cat">
          Maqsad
        </label>
        <select id="tarix-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={selectClass}>
          <option value="">Maqsad: Barchasi</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name_uz}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="tarix-acc">
          Hisob
        </label>
        <select id="tarix-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={selectClass}>
          <option value="">Hisob: Barchasi</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name_uz}
            </option>
          ))}
        </select>
      </div>

      <div className="text-sm text-slate-600 dark:text-slate-400">
        {rows.length} yozuv · Jami: <span className="tabular-nums">−{formatSomShort(outTotal)}</span> / <span className="tabular-nums">+{formatSomShort(inTotal)}</span>
      </div>

      {loading && <p className="text-sm text-slate-400">Yuklanmoqda…</p>}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <th className="px-3 py-2">Sana</th>
              <th className="px-3 py-2">Turi</th>
              <th className="px-3 py-2">Kim / qayerga</th>
              <th className="px-3 py-2">Maqsad</th>
              <th className="px-3 py-2">Davr</th>
              <th className="px-3 py-2 text-right">Summa</th>
              <th className="px-3 py-2">Hisob</th>
              {canEdit && <th className="sticky right-0 bg-slate-50 px-3 py-2 text-right shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.15)] dark:bg-slate-900">Amallar</th>}
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 8 : 7} className="px-3 py-6 text-center text-slate-400">
                  Bu davrda yozuv yo'q.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 whitespace-nowrap">{dayLabel(r.date)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {KIND_LABEL[r.kind]}
                  {r.pending && <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">(tasdiqlanmagan)</span>}
                </td>
                <td className="px-3 py-2 text-slate-900 dark:text-slate-100">{r.who}</td>
                <td className="px-3 py-2">{r.purpose}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.period ? monthLabelShort(r.period) : '—'}</td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${
                    r.kind === 'cash_in' ? 'text-teal-700 dark:text-teal-400' : r.kind === 'expense' ? 'text-slate-900 dark:text-slate-100' : ''
                  }`}
                >
                  {r.kind === 'expense' ? '−' : r.kind === 'cash_in' ? '+' : ''}
                  {formatSom(Math.abs(r.amount))}
                </td>
                <td className="px-3 py-2">{r.account}</td>
                {canEdit && (
                  <td className="sticky right-0 bg-white px-1 py-0.5 text-right whitespace-nowrap shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.15)] dark:bg-slate-950">
                    {r.period && statuses.get(r.period) === 'closed' ? (
                      <span className="px-2 text-slate-400" title="Davr yopilgan — o'zgartirish uchun avval qayta oching" aria-label="Davr yopilgan">
                        🔒
                      </span>
                    ) : (
                      <>
                        <IconButton label="Tahrirlash" onClick={() => setEditing(r.source)}>
                          <PencilIcon />
                        </IconButton>
                        <IconButton label="O'chirish" tone="danger" onClick={() => setVoiding(r.source)}>
                          <TrashIcon />
                        </IconButton>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">Xarajat va tushum "qaysi oy uchun" belgisi bo'yicha filtrlanadi; o'tkazmalar sanasi bo'yicha.</p>
      {showAudit && <PeriodAuditModal month={month} onClose={() => setShowAudit(false)} />}
      {editing && <EditRowModal source={editing} onClose={() => setEditing(null)} />}
      {voiding && <VoidRowModal source={voiding} onClose={() => setVoiding(null)} />}
    </div>
  )
}

function PencilIcon() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}
