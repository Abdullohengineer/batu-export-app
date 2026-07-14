import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'

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
  const { productTypes } = useProductTypes()
  const [orders, setOrders] = useState<KirimOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!profile) return
    setLoading(true)
    supabase
      .from('kirim_orders')
      .select(
        'order_id, order_date, plate, driver, declared_total, status, kirim_lines(serial, type_id, declared_qty)',
      )
      .eq('created_by', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setOrders((data as KirimOrder[] | null) ?? [])
        setLoading(false)
      })
  }, [profile, refreshKey])

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
      <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Yuborilgan KIRIM buyurtmalari</h2>
      {orders.length === 0 && <p className="text-sm text-slate-400">Hali buyurtma yo'q.</p>}
      {orders.map((order) => (
        <div key={order.order_id} className="rounded-md border border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => toggle(order.order_id)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
          >
            <span className="text-slate-900 dark:text-slate-100">
              {order.order_date} · {order.plate} · {order.driver}
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {order.declared_total?.toLocaleString() ?? 0} kg · {order.status}
            </span>
          </button>
          {expanded.has(order.order_id) && (
            <div className="space-y-1 border-t border-slate-200 px-3 py-2 dark:border-slate-700">
              {order.kirim_lines.map((line) => (
                <div key={line.serial} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-slate-700 dark:text-slate-300">{line.serial}</span>
                  <span className="text-slate-600 dark:text-slate-400">{typeName(line.type_id)}</span>
                  <span className="text-slate-600 dark:text-slate-400">{line.declared_qty.toLocaleString()} kg</span>
                  <span className="text-slate-500 dark:text-slate-500">{order.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
