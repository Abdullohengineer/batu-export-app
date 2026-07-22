import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { usePendingRewash } from '../../lib/usePendingRewash'
import { useEffectiveQty } from '../../lib/effectiveQty'
import { useSettingsLimits } from '../../lib/useSettingsLimits'
import { Card } from '../../components/ui/Card'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'
import { toneStyles } from '../../components/ui/tokens'

interface KirimLine {
  serial: string
  type_id: string
  declared_qty: number
}

interface KirimOrder {
  order_id: string
  order_date: string
  plate: string
  driver: string
  declared_total: number | null
  status: string
  kirim_lines: KirimLine[]
}

export function KirimOrdersList({ refreshKey }: { refreshKey: number }) {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- resolves type names on historical orders.
  const { productTypes } = useProductTypes(true)
  const [orders, setOrders] = useState<KirimOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!profile) return
    const profileId = profile.id

    async function load() {
      setLoading(true)
      try {
        const { data } = await supabase
          .from('kirim_orders')
          .select(
            'order_id, order_date, plate, driver, declared_total, status, kirim_lines(serial, type_id, declared_qty)',
          )
          .eq('created_by', profileId)
          .order('created_at', { ascending: false })

        setOrders((data as KirimOrder[] | null) ?? [])
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [profile, refreshKey])

  // §5.5.4: read-only flag — "Menejer sees it, Ombor acts on it" (no action
  // button here, deliberately). Same shared query Ombor's own flag uses, so
  // the two can never disagree.
  const { pending: pendingRewash } = usePendingRewash(orders.flatMap((o) => o.kirim_lines.map((l) => l.serial)))

  // §3.1 amend: quantity displayed against a serial is effective_qty
  // (§2.15.1), provisional until gate stage 2, then final — declared stays
  // visible and unmodified beside it (unchanged, still line.declared_qty).
  const { limits } = useSettingsLimits()
  const { effectiveQty } = useEffectiveQty(
    orders.flatMap((o) => o.kirim_lines.map((l) => l.serial)),
    limits.kam_chiqdi_pct ?? 5,
  )

  function toggle(orderId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  function typeName(typeId: string) {
    return productTypes.find((t) => t.id === typeId)?.name ?? typeId
  }

  if (loading) return null

  return (
    <div className="space-y-2">
      <SectionHeading>Yuborilgan KIRIM buyurtmalari</SectionHeading>
      {orders.length === 0 && <p className="text-sm text-slate-400">Hali buyurtma yo'q.</p>}
      {orders.map((order) => (
        <Card key={order.order_id} padding="compact">
          <button
            type="button"
            onClick={() => toggle(order.order_id)}
            className="flex min-h-12 w-full items-center justify-between text-left text-base"
          >
            <span className="text-slate-900 dark:text-slate-100">
              {order.order_date} · {order.plate} · {order.driver}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {order.declared_total?.toLocaleString() ?? 0} kg · {order.status}
            </span>
          </button>
          {expanded.has(order.order_id) && (
            <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 dark:border-slate-700">
              {order.kirim_lines.map((line) => {
                const eq = effectiveQty.get(line.serial)
                return (
                <div key={line.serial} className="text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-slate-700 dark:text-slate-300">{line.serial}</span>
                    <span className="text-slate-600 dark:text-slate-400">{typeName(line.type_id)}</span>
                    <span className="text-slate-600 dark:text-slate-400">
                      E'lon qilingan {line.declared_qty.toLocaleString()} kg
                      {eq && (
                        <>
                          {' · '}
                          {eq.provisional ? 'tarozi kutilmoqda' : `${eq.value.toLocaleString()} kg`}
                        </>
                      )}
                    </span>
                    <span className="text-slate-500 dark:text-slate-500">{order.status}</span>
                    {pendingRewash.has(line.serial) && (
                      <span className={`font-medium ${toneStyles.problem.text}`}>Qayta yuvish kerak</span>
                    )}
                  </div>
                  {/* §5.1 amend: gate-vs-declared variance, once gate stage 2 is known. */}
                  {eq?.truckVariance && Math.abs(eq.truckVariance.diffKg) > 0 && (
                    <StatusNote tone="pending">
                      Darvoza neta reys bo'yicha e'lon qilingandan {eq.truckVariance.diffKg >= 0 ? '+' : ''}
                      {eq.truckVariance.diffKg.toLocaleString()} kg ({eq.truckVariance.diffPct >= 0 ? '+' : ''}
                      {eq.truckVariance.diffPct.toFixed(1)}%) farq qiladi.
                    </StatusNote>
                  )}
                  {eq?.provisionalVarianceFlag && (
                    <StatusNote tone="problem">
                      Diqqat: tarozi kutilayotganda yuborilgan, keyin darvoza netasi sezilarli farq qildi.
                    </StatusNote>
                  )}
                </div>
                )
              })}
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}
