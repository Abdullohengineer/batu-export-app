import { Link, useLocation } from 'react-router-dom'
import { useAccountBalances } from '../../lib/useAccountBalances'
import { Card } from '../../components/ui/Card'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'

// Moliyaviy ko'rsatkichlar (decision 0249) -- read-only, mounted under
// /buxgalter, /rahbar and /menejer. Phase 1 shows only the live account
// balances (the balance calculator, end to end against the seeded
// accounts); the full Umumiy ko'rinish dashboard is Phase 4.
function som(v: number): string {
  return `${Math.round(v).toLocaleString('en-US')} so'm`
}

export function MoliyaHome() {
  const { accounts, loading, error } = useAccountBalances()
  // Rahbar/Menejer reach the read-only Tarix from here; the buxgalter has it as an input tab.
  const { pathname } = useLocation()
  const tarixHref = pathname.startsWith('/buxgalter') ? '/buxgalter/kirim/tarix' : `${pathname.replace(/\/$/, '')}/tarix`

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Moliyaviy ko'rsatkichlar</div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Umumiy ko'rinish</h1>
      </div>

      <SectionHeading>Balanslar · joriy qoldiq</SectionHeading>
      {error && <StatusNote tone="problem">{error}</StatusNote>}
      {loading && <p className="text-sm text-slate-400">Yuklanmoqda…</p>}
      {!loading && !error && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {accounts.map((a) => (
            <Card key={a.id} padding="compact">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {a.name_uz}
                {a.supplier_name ? ` · ${a.supplier_name}` : ''}
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{som(a.balance)}</div>
            </Card>
          ))}
        </div>
      )}

      <Link to={tarixHref} className="inline-block text-sm font-medium text-slate-700 underline dark:text-slate-300">
        Barcha yozuvlar (Tarix) →
      </Link>
      <p className="text-xs text-slate-400">To'liq ko'rinish (grafiklar, xarajat tarkibi, prognoz) 4-bosqichda quriladi.</p>
    </div>
  )
}
