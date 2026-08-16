import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useSettingsLimits } from '../../lib/useSettingsLimits'
import { useIntakeLines, type IntakeLine, type IntakeRecord } from '../../lib/useIntakeLines'
import { useMoykaSerials } from '../../lib/useMoykaSerials'
import { useEffectiveQty } from '../../lib/effectiveQty'
import { pendingLabel } from '../../lib/weightAuthority'
import { sortByDateDesc } from '../../lib/sortByDate'
import { hasRawRemainder } from '../../lib/stageMembership'
import { IntakeAcceptForm, type IntakeAcceptValues } from './IntakeAcceptForm'
import { IntakeDetailView } from './IntakeDetailView'
import { Barcode1Display } from './Barcode1Display'
import { formatDate } from '../../lib/formatDate'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'
import { SerialChip } from '../../components/ui/SerialChip'
import { FormField, TextInput } from '../../components/ui/FormField'

// Tara correction (2026-08-15) -- tara is the only figure Ombor enters
// himself (declared/gate/lab figures are read-only here, per this task's
// own scope); everything correct_kirim_line_tara returns, mapped from the
// RPC's snake_case row shape (see supabase/migrations/
// 0073_correct_kirim_line_tara_rpc.sql).
//
// 🔒 Shown as a page-level banner, NOT a per-card confirmation -- found
// live during testing: Window 2's own membership is hasRawRemainder
// (effective_qty - sent > 0, stageMembership.ts). A tara correction that
// pushes sent past the new effective_qty is exactly the allow-with-impact
// case this feature exists to surface -- and it ALSO makes the serial's
// own row disappear from this window the instant refresh() re-runs,
// taking a per-row confirmation down with it before the operator could
// ever read the warning it was supposed to show. A banner above both
// windows survives regardless of which window the serial ends up in.
interface TaraCorrectionResult {
  serial: string
  beforeBoxMassKg: number
  afterBoxMassKg: number
  beforeEffectiveQty: number
  afterEffectiveQty: number
  sentKg: number
  rawDispatchedKg: number
  newAvailableKg: number
}

async function uploadPilePhoto(file: File) {
  const path = `${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('intake-photos').upload(path, file)
  if (error) throw error
  return path
}

export function OmborIntakeTab() {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- resolves names on in-flight/historical rows.
  const { productTypes } = useProductTypes(true)
  const { owners } = useOwners(true)
  const { limits } = useSettingsLimits()
  const { lines, loading, refresh } = useIntakeLines()
  const { serials: moykaSerials, loading: moykaLoading } = useMoykaSerials()
  const [activeSerial, setActiveSerial] = useState<string | null>(null)
  const [expandedSerial, setExpandedSerial] = useState<string | null>(null)
  const [editingTaraSerial, setEditingTaraSerial] = useState<string | null>(null)
  const [taraDraft, setTaraDraft] = useState('')
  const [taraBusy, setTaraBusy] = useState(false)
  const [taraError, setTaraError] = useState<string | null>(null)
  const [lastTaraResult, setLastTaraResult] = useState<TaraCorrectionResult | null>(null)
  // Mirrors OmborTayyorTab.tsx's lastBarcode: which serial's Barcode #1 just
  // appeared, so Barcode1Display auto-prints once (native only) the same way
  // a freshly-saved Barcode #2 does — see Barcode1Display.tsx's `autoprint`.
  const [justAccepted, setJustAccepted] = useState<string | null>(null)

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
      box_mass_kg: values.boxMassKg,
      pile_photo: pilePath,
      komment: values.komment || null,
      barcode1: line.serial,
      confirmed_by: profile?.id,
    })
    if (error) throw error

    setActiveSerial((current) => (current === line.serial ? null : current))
    setJustAccepted(line.serial)
    refresh()
    // useEffectiveQty's own fetch is keyed by the SET of serials on the
    // page, not by their underlying intake/gate state — an accept within
    // the same mount doesn't change that set, so it must be told explicitly
    // (found live: the "received" list showed the stale pre-accept snapshot,
    // including a stale 0kg reconciliation sum, until this was added).
    refreshEffectiveQty()
  }

  function startTaraEdit(line: IntakeLine & { intake: IntakeRecord }) {
    setEditingTaraSerial(line.serial)
    setTaraDraft(String(line.intake.box_mass_kg))
    setTaraError(null)
  }

  function cancelTaraEdit() {
    setEditingTaraSerial(null)
    setTaraError(null)
  }

  // Tara-only correction (2026-08-15, DECISIONS.md "Ombor KIRIM tara-only
  // correction"): allow-with-impact, not block -- correct_kirim_line_tara
  // itself never rejects an over-committed result (sent/raw_dispatched
  // exceeding the corrected effective_qty), it just reports it, matching
  // this app's existing tolerance for the same state reachable via an
  // ordinary over-send (moyka_sends has no balance check at all). No
  // expiry -- the button stays available regardless of downstream state,
  // same as classify_kirim_line_sulfur.
  async function saveTara(serial: string) {
    const value = Number(taraDraft)
    if (!Number.isFinite(value) || value < 0) {
      setTaraError("Tara qiymati noto'g'ri.")
      return
    }
    setTaraBusy(true)
    setTaraError(null)
    try {
      const { data, error } = await supabase.rpc('correct_kirim_line_tara', {
        p_serial: serial,
        p_box_mass_kg: value,
      })
      if (error) throw error
      const row = data?.[0]
      if (row) {
        setLastTaraResult({
          serial,
          beforeBoxMassKg: Number(row.before_box_mass_kg),
          afterBoxMassKg: Number(row.after_box_mass_kg),
          beforeEffectiveQty: Number(row.before_effective_qty),
          afterEffectiveQty: Number(row.after_effective_qty),
          sentKg: Number(row.sent_kg),
          rawDispatchedKg: Number(row.raw_dispatched_kg),
          newAvailableKg: Number(row.new_available_kg),
        })
      }
      setEditingTaraSerial(null)
      refresh()
      refreshEffectiveQty()
    } catch (err) {
      setTaraError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setTaraBusy(false)
    }
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

  return (
    <div className="space-y-6">
      {lastTaraResult && (
        <Card padding="compact">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <StatusNote tone="ok">
                {lastTaraResult.serial}: Tara {lastTaraResult.beforeBoxMassKg.toLocaleString()} →{' '}
                {lastTaraResult.afterBoxMassKg.toLocaleString()} kg. Netto{' '}
                {lastTaraResult.beforeEffectiveQty.toLocaleString()} → {lastTaraResult.afterEffectiveQty.toLocaleString()} kg.
              </StatusNote>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Yuborilgan {lastTaraResult.sentKg.toLocaleString()} kg · Xom jo'natilgan{' '}
                {lastTaraResult.rawDispatchedKg.toLocaleString()} kg · Yangi qoldiq{' '}
                {lastTaraResult.newAvailableKg.toLocaleString()} kg
              </p>
              {lastTaraResult.sentKg + lastTaraResult.rawDispatchedKg > lastTaraResult.afterEffectiveQty && (
                <StatusNote tone="problem">
                  Diqqat: yuborilgan/jo'natilgan miqdor yangi netadan ortiq — qoldiq 0 sifatida ko'rsatiladi.
                </StatusNote>
              )}
            </div>
            <IconButton label="Yopish" onClick={() => setLastTaraResult(null)}>
              ✕
            </IconButton>
          </div>
        </Card>
      )}

      <div>
        <SectionHeading>1 · Qabul kutilmoqda</SectionHeading>
        <div className="mt-2 space-y-2">
          {pending.length === 0 && <p className="text-sm text-slate-400">Kutilayotgan reys yo'q.</p>}
          {pending.map((line) => {
            const acceptable = line.gruzheny_kg !== null
            const isActive = activeSerial === line.serial

            return (
              <Card key={line.serial}>
                <div className="flex items-center gap-2">
                  <SerialChip>{line.serial}</SerialChip>
                  <span className="min-w-0 flex-1 truncate font-semibold text-slate-900 dark:text-slate-100">
                    {ownerName(line.owner_id)} · {typeName(line.type_id)}
                  </span>
                </div>
                <div className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">
                  {line.plate} · {line.driver} · {formatDate(line.order_date)}
                </div>

                {!acceptable && (
                  <div className="mt-2">
                    <StatusNote tone="pending">
                      ⏳ Tarozi kutilmoqda — hozircha e'lon qilingan miqdor ko'rsatilmoqda
                    </StatusNote>
                  </div>
                )}

                <div className="mt-2 space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">E'lon qilingan</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {line.declared_qty.toLocaleString()} kg
                    </span>
                  </div>
                  {acceptable && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Darvoza (yuk bilan)</span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {line.gruzheny_kg!.toLocaleString()} kg
                      </span>
                    </div>
                  )}
                </div>

                {acceptable && !isActive && (
                  <div className="mt-3">
                    <Button variant="primary" size="lg" fullWidth onClick={() => setActiveSerial(line.serial)}>
                      Qabul qilish
                    </Button>
                  </div>
                )}

                {isActive && (
                  <IntakeAcceptForm
                    line={line}
                    typeName={typeName(line.type_id)}
                    ownerName={ownerName(line.owner_id)}
                    kamChiqdiPct={kamChiqdiPct}
                    onCancel={() => setActiveSerial(null)}
                    onSubmit={(values) => handleAccept(line, values)}
                  />
                )}
              </Card>
            )
          })}
        </div>
      </div>

      <div>
        <SectionHeading>2 · Qabul qilingan</SectionHeading>
        <div className="mt-2 space-y-2">
          {received.length === 0 && <p className="text-sm text-slate-400">Hali qabul qilingan yo'q.</p>}
          {received.map((line) => {
            const eq = effectiveQty.get(line.serial)
            const eqValue = eq?.value ?? line.intake.actual_qty
            const remaining = Math.max(0, eqValue - (sentBySerial.get(line.serial) ?? 0))
            return (
            <Card key={line.serial} padding="compact">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <SerialChip variant="emphasized">{line.serial}</SerialChip>
                    <span className="min-w-0 flex-1 truncate font-semibold text-slate-900 dark:text-slate-100">
                      {ownerName(line.owner_id)} · {typeName(line.type_id)}
                    </span>
                  </div>
                  <div className="truncate text-sm text-slate-500 dark:text-slate-400">
                    {eq?.provisional ? (
                      pendingLabel(eq.pendingOn)
                    ) : (
                      <span className="font-bold text-slate-900 dark:text-slate-100">Netto {eqValue.toLocaleString()} kg</span>
                    )}{' '}
                    · Qoldiq {remaining.toLocaleString()} kg
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {line.intake.barcode1 && (
                    <Barcode1Display
                      defaultOpen={justAccepted === line.serial}
                      data={{
                        serial: line.intake.barcode1,
                        type: typeName(line.type_id),
                        owner: ownerName(line.owner_id),
                        weightKg: line.intake.actual_qty,
                        date: line.order_date,
                      }}
                    />
                  )}
                  <IconButton label="Tahrirlash" onClick={() => startTaraEdit(line)}>
                    ✎
                  </IconButton>
                  <IconButton label="Batafsil" onClick={() => setExpandedSerial(expandedSerial === line.serial ? null : line.serial)}>
                    ⋯
                  </IconButton>
                </div>
              </div>
              {/* Tara-only Tahrirlash (2026-08-15) -- tara is the only figure
                  Ombor enters himself; declared/gate/lab figures stay
                  read-only here. No expiry, allow-with-impact rather than
                  block -- see DECISIONS.md "Ombor KIRIM tara-only
                  correction." */}
              {editingTaraSerial === line.serial ? (
                <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 dark:border-slate-700">
                  <FormField label="Tara (quti massasi), kg">
                    <TextInput
                      type="number"
                      min={0}
                      step="0.1"
                      value={taraDraft}
                      onChange={(e) => setTaraDraft(e.target.value)}
                    />
                  </FormField>
                  {taraError && <StatusNote tone="problem">{taraError}</StatusNote>}
                  <div className="flex gap-2">
                    <Button variant="primary" size="md" disabled={taraBusy} onClick={() => saveTara(line.serial)}>
                      {taraBusy ? 'Saqlanmoqda…' : 'Saqlash'}
                    </Button>
                    <Button variant="ghost" size="md" onClick={cancelTaraEdit}>
                      Bekor qilish
                    </Button>
                  </div>
                </div>
              ) : null}
              {/* §5.1 amend: gate-vs-declared variance, shown once gate stage 2 is known.
                  Ombor card-polish pass: deliberately NOT a StatusNote here (unlike the
                  identical line on OmborMoykaTab's card, which the same pass removes
                  entirely) -- softened to quiet ordinary text instead of a status/warning
                  tone, per-card override, StatusNote itself untouched. */}
              {eq?.truckVariance && Math.abs(eq.truckVariance.diffKg) > 0 && (
                <p className="mt-1 text-sm italic text-slate-900 dark:text-slate-100">
                  Darvoza neta reys bo'yicha e'lon qilingandan {eq.truckVariance.diffKg >= 0 ? '+' : ''}
                  {eq.truckVariance.diffKg.toLocaleString()} kg ({eq.truckVariance.diffPct >= 0 ? '+' : ''}
                  {eq.truckVariance.diffPct.toFixed(1)}%) farq qiladi.
                </p>
              )}
              {eq?.lineReconciliation && Math.abs(eq.lineReconciliation.diffKg) > 0 && (
                <div className="mt-1">
                  <StatusNote tone="pending">
                    Qatorlar yig'indisi darvoza netasidan {eq.lineReconciliation.diffKg >= 0 ? '+' : ''}
                    {eq.lineReconciliation.diffKg.toLocaleString()} kg farq qiladi (bir necha turdagi reys).
                  </StatusNote>
                </div>
              )}
              {eq?.provisionalVarianceFlag && (
                <div className="mt-1">
                  <StatusNote tone="problem">
                    Diqqat: tarozi kutilayotganda yuborilgan, keyin darvoza netasi sezilarli farq qildi.
                  </StatusNote>
                </div>
              )}
              {expandedSerial === line.serial && (
                <IntakeDetailView line={line} ownerName={ownerName(line.owner_id)} typeName={typeName(line.type_id)} />
              )}
            </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
