import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/formatDate'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useEffectiveQty } from '../../lib/effectiveQty'
import { pendingLabel } from '../../lib/weightAuthority'
import { useSettingsLimits } from '../../lib/useSettingsLimits'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { FormField, TextInput } from '../../components/ui/FormField'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'
import { StatusPill } from '../../components/ui/StatusPill'
import { SerialChip } from '../../components/ui/SerialChip'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'
import type { Tone } from '../../components/ui/tokens'
import { SerialPassportModal } from '../reports/SerialPassportModal'
import { ErrorBoundary } from '../../components/ErrorBoundary'

// kirim_orders.status has exactly these two values (confirmed against the
// live DB, not assumed) -- a plain display-label + tone map, no new status
// or transition introduced.
const STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  kutilmoqda: { label: 'Kutilmoqda', tone: 'pending' },
  qabul_qilindi: { label: 'Qabul qilindi', tone: 'ok' },
}

const FIELD_LABEL: Record<string, string> = {
  order_date: 'Sana',
  plate: 'Moshina raqami',
  driver: 'Haydovchi',
}

interface KirimLine {
  serial: string
  type_id: string
  declared_qty: number
  partiya_no: number | null
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

// §5.1/§5.4 "correcting mistaken entries" — Menejer may fix a wrong
// date/plate/driver on an order Qorovul hasn't touched at the gate yet.
// Locked as soon as ANY gate_weighings row exists for the order (stage 1 OR
// stage 2), not just once status flips to 'qabul_qilindi' (only stage 2
// flips that) -- dated/plated gate photos already exist the moment Qorovul
// touches this order at all, and the RLS policy (menejer_edits,
// 0038_kirim_chiqim_second_window_edits.sql) enforces the identical
// condition server-side. owner_id/declared_qty/type_id stay locked
// entirely -- confirmed with the user: they feed client-scoped reporting
// and effective_qty respectively, unlike date/plate/driver which nothing
// downstream reads for math.
interface EditDraft {
  order_date: string
  plate: string
  driver: string
}

export function KirimOrdersList({ refreshKey }: { refreshKey: number }) {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- resolves type/calibre names on historical
  // orders and lets the passport modal (below) resolve a deactivated
  // calibre on an old line correctly, same reasoning as every other
  // includeInactive=true call site that feeds a passport/history view.
  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)
  const [orders, setOrders] = useState<KirimOrder[]>([])
  const [gateStarted, setGateStarted] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // §3.2.5 passport drill-down — one link per LINE, not per order, since
  // the passport is per-serial and a multi-line order has one serial per
  // line (same reasoning stock-on-hand/Hisobot's own drill-down already
  // established, just reached from a different list here).
  const [passportSerial, setPassportSerial] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft>({ order_date: '', plate: '', driver: '' })
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    try {
      const [{ data }, { data: weighings }] = await Promise.all([
        supabase
          .from('kirim_orders')
          .select(
            'order_id, order_date, plate, driver, declared_total, status, kirim_lines(serial, type_id, declared_qty, partiya_no)',
          )
          .eq('created_by', profile.id)
          .order('created_at', { ascending: false }),
        // Same existence check the menejer_edits RLS policy enforces
        // server-side (0038) -- mirrored here only to hide/show the
        // Tahrirlash control correctly, not as the real gate.
        supabase.from('gate_weighings').select('order_id').eq('dir', 'kirim'),
      ])

      setOrders((data as KirimOrder[] | null) ?? [])
      setGateStarted(new Set((weighings ?? []).map((w) => w.order_id).filter((id): id is string => !!id)))
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  function startEdit(order: KirimOrder) {
    setEditingId(order.order_id)
    setEditDraft({ order_date: order.order_date, plate: order.plate, driver: order.driver })
    setEditError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditError(null)
  }

  async function saveEdit(order: KirimOrder) {
    const changes: Record<string, { before: unknown; after: unknown }> = {}
    if (editDraft.order_date !== order.order_date) changes.order_date = { before: order.order_date, after: editDraft.order_date }
    if (editDraft.plate !== order.plate) changes.plate = { before: order.plate, after: editDraft.plate }
    if (editDraft.driver !== order.driver) changes.driver = { before: order.driver, after: editDraft.driver }

    if (Object.keys(changes).length === 0) {
      setEditingId(null)
      return
    }

    setEditBusy(true)
    setEditError(null)
    try {
      const { error } = await supabase
        .from('kirim_orders')
        .update({ order_date: editDraft.order_date, plate: editDraft.plate, driver: editDraft.driver })
        .eq('order_id', order.order_id)
      if (error) throw error

      // Traceability (§2.7-style, this task's own requirement 4) — the
      // audit_log table has existed since Phase 0 with RLS already in
      // place (any signed-in INSERT, rahbar-only SELECT) but was unused by
      // any code path until now. A Qaydlar note is also posted so the
      // correction is visible in-app, not just queryable by Rahbar.
      const before = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.before]))
      const after = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.after]))
      await Promise.all([
        supabase.from('audit_log').insert({
          table_name: 'kirim_orders',
          row_id: order.order_id,
          actor: profile?.id,
          action: 'edit',
          before,
          after,
        }),
        supabase.from('notes').insert({
          entity_type: 'kirim_orders',
          entity_id: order.order_id,
          author: profile?.id,
          body: `Tuzatildi: ${Object.entries(changes)
            .map(([k, v]) => `${FIELD_LABEL[k] ?? k} ${v.before} → ${v.after}`)
            .join(', ')}`,
        }),
      ])

      setEditingId(null)
      await load()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setEditBusy(false)
    }
  }

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
  function calibreLabel(calibreId: string) {
    return calibres.find((c) => c.id === calibreId)?.label ?? calibreId
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
            className="flex min-h-12 w-full items-center gap-3 text-left"
          >
            <SerialChip>{order.kirim_lines[0]?.serial ?? '—'}</SerialChip>
            <PartiyaBadge partiyaNo={order.kirim_lines[0]?.partiya_no ?? null} typeName={typeName(order.kirim_lines[0]?.type_id ?? '')} />
            <span className="min-w-0 flex-1">
              <span className="block text-base text-slate-900 dark:text-slate-100">
                {order.plate} · {order.driver}
              </span>
              <span className="block text-sm text-slate-500 dark:text-slate-400">
                {formatDate(order.order_date)} · {order.declared_total?.toLocaleString() ?? 0} kg
              </span>
            </span>
            <StatusPill tone={STATUS_LABEL[order.status]?.tone ?? 'neutral'}>
              {STATUS_LABEL[order.status]?.label ?? order.status}
            </StatusPill>
          </button>
          {expanded.has(order.order_id) && (
            <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 dark:border-slate-700">
              {order.kirim_lines.map((line) => {
                const eq = effectiveQty.get(line.serial)
                return (
                <div key={line.serial} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-mono text-slate-700 dark:text-slate-300">{line.serial}</span>
                      <PartiyaBadge partiyaNo={line.partiya_no} typeName={typeName(line.type_id)} />
                    </span>
                    <span className="text-slate-600 dark:text-slate-400">{typeName(line.type_id)}</span>
                    <span className="text-slate-600 dark:text-slate-400">
                      E'lon qilingan {line.declared_qty.toLocaleString()} kg
                      {eq && (
                        <>
                          {' · '}
                          {eq.provisional ? pendingLabel(eq.pendingOn) : `${eq.value.toLocaleString()} kg`}
                        </>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPassportSerial(line.serial)}
                      className="shrink-0 text-slate-500 underline decoration-dotted hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
                    >
                      Pasport →
                    </button>
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

              {/* Tahrirlash — only offered while no gate_weighings row
                  exists for this order (see menejer_edits RLS, 0038).
                  Once Qorovul touches this order at the gate, the button
                  simply stops rendering, matching FinishedChiqimList's own
                  void-button visibility pattern. */}
              {!gateStarted.has(order.order_id) && (
                <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
                  {editingId === order.order_id ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <FormField label="Sana">
                          <TextInput
                            type="date"
                            value={editDraft.order_date}
                            onChange={(e) => setEditDraft((d) => ({ ...d, order_date: e.target.value }))}
                          />
                        </FormField>
                        <FormField label="Moshina raqami">
                          <TextInput
                            type="text"
                            value={editDraft.plate}
                            onChange={(e) => setEditDraft((d) => ({ ...d, plate: e.target.value }))}
                          />
                        </FormField>
                        <FormField label="Haydovchi ismi">
                          <TextInput
                            type="text"
                            value={editDraft.driver}
                            onChange={(e) => setEditDraft((d) => ({ ...d, driver: e.target.value }))}
                          />
                        </FormField>
                      </div>
                      {editError && <StatusNote tone="problem">{editError}</StatusNote>}
                      <div className="flex gap-2">
                        <Button variant="primary" size="md" disabled={editBusy} onClick={() => saveEdit(order)}>
                          {editBusy ? 'Saqlanmoqda…' : 'Saqlash'}
                        </Button>
                        <Button variant="ghost" size="md" onClick={cancelEdit}>
                          Bekor qilish
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="secondary" size="md" onClick={() => startEdit(order)}>
                      Tahrirlash
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      ))}

      {passportSerial && (
        <ErrorBoundary label="Seriya pasporti">
          <SerialPassportModal
            serial={passportSerial}
            onClose={() => setPassportSerial(null)}
            typeName={typeName}
            calibreLabel={calibreLabel}
          />
        </ErrorBoundary>
      )}
    </div>
  )
}
