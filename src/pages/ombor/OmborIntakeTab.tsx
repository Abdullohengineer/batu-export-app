import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useSettingsLimits } from '../../lib/useSettingsLimits'
import { useIntakeLines, type IntakeLine, type IntakeRecord } from '../../lib/useIntakeLines'
import { useMoykaSerials } from '../../lib/useMoykaSerials'
import { useEffectiveQty } from '../../lib/effectiveQty'
import { sortByDateDesc } from '../../lib/sortByDate'
import { hasRawRemainder } from '../../lib/stageMembership'
import { IntakeAcceptForm, type IntakeAcceptValues } from './IntakeAcceptForm'
import { IntakeDetailView } from './IntakeDetailView'
import { Barcode1Display } from './Barcode1Display'

async function uploadPilePhoto(file: File) {
  const path = `${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('intake-photos').upload(path, file)
  if (error) throw error
  return path
}

export function OmborIntakeTab() {
  const { profile } = useAuth()
  const { productTypes } = useProductTypes()
  const { owners } = useOwners()
  const { limits } = useSettingsLimits()
  const { lines, loading, refresh } = useIntakeLines()
  const { serials: moykaSerials, loading: moykaLoading } = useMoykaSerials()
  const [activeSerial, setActiveSerial] = useState<string | null>(null)
  const [expandedSerial, setExpandedSerial] = useState<string | null>(null)

  const kamChiqdiPct = limits.kam_chiqdi_pct ?? 5
  // §2.15: the single derived source for the working quantity, used by both
  // this window's display and its "raw remainder" membership test — never
  // storage_intake.actual_qty directly (see DECISIONS.md "Weight authority
  // & effective quantity").
  const { effectiveQty, refresh: refreshEffectiveQty } = useEffectiveQty(
    lines.map((l) => l.serial),
    kamChiqdiPct,
  )

  function typeName(typeId: string) {
    return productTypes.find((t) => t.id === typeId)?.name ?? typeId
  }
  function ownerName(ownerId: string) {
    return owners.find((o) => o.id === ownerId)?.name ?? ownerId
  }

  // §5.1: generate-once. barcode1 is the serial itself (§2.2's ID format
  // for #1 is "—" — unlike #2, a serial is already a stable, unique,
  // human-readable identifier, so no separate ID needed). Stored explicitly
  // at accept time, never recomputed on later views.
  //
  // 🔒 Dropped-submit fix, part 1 of 2 (multi-line rapid accept, see
  // DECISIONS.md "IntakeAcceptForm dropped submit"): `activeSerial` names
  // which ONE row's form is expanded across the WHOLE tab. Accepting line A
  // kicks off an async upload+insert that can still be in flight when the
  // operator opens line B's form (a completely normal multi-line workflow,
  // not a rapid-click edge case) — `activeSerial` is now B. When A's accept
  // finally resolves, it must NOT blindly reset `activeSerial` to null: that
  // would close B's form out from under the operator. The functional
  // updater only clears the active row if it's STILL this accept's own row
  // — "close me only if I'm still the one open," not "close whatever is
  // open now." (Part 2 of the fix is the loading-flag change in
  // useIntakeLines.ts — this alone isn't sufficient, see that file's comment.)
  async function handleAccept(line: IntakeLine, values: IntakeAcceptValues) {
    const pilePath = await uploadPilePhoto(values.pilePhoto)

    const { error } = await supabase.from('storage_intake').insert({
      serial: line.serial,
      actual_qty: values.actualQty,
      pile_photo: pilePath,
      komment: values.komment || null,
      barcode1: line.serial,
      confirmed_by: profile?.id,
    })
    if (error) throw error

    setActiveSerial((current) => (current === line.serial ? null : current))
    refresh()
    // useEffectiveQty's own fetch is keyed by the SET of serials on the
    // page, not by their underlying intake/gate state — an accept within
    // the same mount doesn't change that set, so it must be told explicitly
    // (found live: the "received" list showed the stale pre-accept snapshot,
    // including a stale 0kg reconciliation sum, until this was added).
    refreshEffectiveQty()
  }

  if (loading || moykaLoading) return null

  const pending = lines.filter((l) => !l.intake)

  // §5.1 Window 2 = §5.2 Moyka's Window 1 (section mirroring, SPEC.md §5
  // intro; DECISIONS.md "Section mirroring / derived stage membership"):
  // a confirmed serial stays here only while it still has raw remainder —
  // hasRawRemainder is the SAME predicate useMoykaSerials' own "Yuborish
  // uchun" window filters by, via the same useMoykaSerials query (reused,
  // not reimplemented). Previously this filtered on `intake !== null` alone
  // — presence of a storage_intake row, forever — so a fully-sent serial
  // never left this window (the `skladda_turibdi` bug: its row kept showing
  // a status that was true the day it was accepted and never updated
  // since). Falls back to 0 (nothing sent) if a serial is somehow missing
  // from moykaSerials — defensive only, should not happen since
  // useMoykaSerials fetches every storage_intake row unfiltered.
  const sentBySerial = new Map(moykaSerials.map((s) => [s.serial, s.sent]))
  // Newest-first by confirmed_at (DECISIONS "History list ordering") — the
  // underlying lines aren't reliably ordered (useIntakeLines builds them by
  // mapping over kirim_lines, which has no .order(), not over the
  // already-sorted orders query), so this window needs its own sort rather
  // than trusting the source array's order.
  const received = sortByDateDesc(
    lines.filter((l): l is IntakeLine & { intake: IntakeRecord } => {
      if (l.intake === null) return false
      const eqValue = effectiveQty.get(l.serial)?.value ?? l.intake.actual_qty
      return hasRawRemainder(eqValue, sentBySerial.get(l.serial) ?? 0)
    }),
    (l) => l.intake.confirmed_at,
  )

  const pendingByOrder = new Map<string, IntakeLine[]>()
  for (const line of pending) {
    const group = pendingByOrder.get(line.order_id) ?? []
    group.push(line)
    pendingByOrder.set(line.order_id, group)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Kutilmoqda</h2>
        <div className="mt-2 space-y-3">
          {pendingByOrder.size === 0 && <p className="text-sm text-slate-400">Kutilayotgan reys yo'q.</p>}
          {[...pendingByOrder.entries()].map(([orderId, orderLines]) => (
            <div key={orderId} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {orderLines[0].plate} · {orderLines[0].driver} · {orderLines[0].order_date}
              </div>
              <div className="mt-2 space-y-2">
                {orderLines.map((line) => {
                  const acceptable = line.gruzheny_kg !== null
                  const isActive = activeSerial === line.serial

                  return (
                    <div
                      key={line.serial}
                      className={
                        acceptable
                          ? 'rounded-md border border-slate-300 p-2 text-sm dark:border-slate-600'
                          : 'rounded-md border border-slate-100 bg-slate-50 p-2 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900'
                      }
                    >
                      <div className="flex items-center justify-between">
                        <span className={acceptable ? 'text-slate-900 dark:text-slate-100' : ''}>
                          {line.serial} · {typeName(line.type_id)} · {line.declared_qty.toLocaleString()} kg
                        </span>
                        {acceptable ? (
                          !isActive && (
                            <button
                              onClick={() => setActiveSerial(line.serial)}
                              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              Qabul qilish
                            </button>
                          )
                        ) : (
                          <span className="text-xs italic">kutilmoqda (darvoza)</span>
                        )}
                      </div>

                      {isActive && (
                        <IntakeAcceptForm
                          line={line}
                          typeName={typeName(line.type_id)}
                          kamChiqdiPct={kamChiqdiPct}
                          onCancel={() => setActiveSerial(null)}
                          onSubmit={(values) => handleAccept(line, values)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Qabul qilingan mahsulotlar</h2>
        <div className="mt-2 space-y-2">
          {received.length === 0 && <p className="text-sm text-slate-400">Hali qabul qilingan yo'q.</p>}
          {received.map((line) => {
            const eq = effectiveQty.get(line.serial)
            const eqValue = eq?.value ?? line.intake.actual_qty
            const remaining = Math.max(0, eqValue - (sentBySerial.get(line.serial) ?? 0))
            return (
            <div key={line.serial} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-slate-900 dark:text-slate-100">
                  {line.serial} · {typeName(line.type_id)} ·{' '}
                  {eq?.provisional ? 'tarozi kutilmoqda' : `${eqValue.toLocaleString()} kg`} · Qoldiq:{' '}
                  {remaining.toLocaleString()} kg
                </span>
                <div className="flex items-center gap-2">
                  {line.intake.barcode1 && (
                    <Barcode1Display
                      data={{
                        serial: line.intake.barcode1,
                        type: typeName(line.type_id),
                        owner: ownerName(line.owner_id),
                        weightKg: line.intake.actual_qty,
                        date: line.order_date,
                      }}
                    />
                  )}
                  <button
                    onClick={() => setExpandedSerial(expandedSerial === line.serial ? null : line.serial)}
                    className="rounded-md px-2 py-1 text-slate-500 hover:text-slate-700 dark:text-slate-400"
                    aria-label="Batafsil"
                  >
                    ⋯
                  </button>
                </div>
              </div>
              {/* §5.1 amend: gate-vs-declared variance, shown once gate stage 2 is known. */}
              {eq?.truckVariance && Math.abs(eq.truckVariance.diffKg) > 0 && (
                <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Darvoza neta reys bo'yicha e'lon qilingandan {eq.truckVariance.diffKg >= 0 ? '+' : ''}
                  {eq.truckVariance.diffKg.toLocaleString()} kg ({eq.truckVariance.diffPct >= 0 ? '+' : ''}
                  {eq.truckVariance.diffPct.toFixed(1)}%) farq qiladi.
                </div>
              )}
              {eq?.lineReconciliation && Math.abs(eq.lineReconciliation.diffKg) > 0 && (
                <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Qatorlar yig'indisi darvoza netasidan {eq.lineReconciliation.diffKg >= 0 ? '+' : ''}
                  {eq.lineReconciliation.diffKg.toLocaleString()} kg farq qiladi (bir necha turdagi reys).
                </div>
              )}
              {eq?.provisionalVarianceFlag && (
                <div className="mt-1 text-xs font-medium text-red-600 dark:text-red-400" role="alert">
                  Diqqat: tarozi kutilayotganda yuborilgan, keyin darvoza netasi sezilarli farq qildi.
                </div>
              )}
              {expandedSerial === line.serial && (
                <IntakeDetailView line={line} ownerName={ownerName(line.owner_id)} typeName={typeName(line.type_id)} />
              )}
            </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
