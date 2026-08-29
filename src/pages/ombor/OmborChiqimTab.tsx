import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useOmborChiqimRequests, type ChiqimRequest, type ChiqimLine } from '../../lib/useOmborChiqimRequests'
import { useDispatchManifestLines } from '../../lib/useDispatchManifestLines'
import { useRawDispatchLinesByRequest } from '../../lib/useRawDispatchLinesByRequest'
import { useOldKnCollectionsByRequest } from '../../lib/useOldKnCollectionsByRequest'
import { useMoykaSerials } from '../../lib/useMoykaSerials'
import { useStockOnHand } from '../../lib/useStockOnHand'
import { useFinishedCalibreAvailability } from '../../lib/useAvailableFinishedStock'
import { lineStatus, shortfallLines as computeShortfallLines } from '../../lib/chiqimLineStatus'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'
import { Stat } from '../../components/ui/Stat'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'
import { StatusPill } from '../../components/ui/StatusPill'
import { TextInput } from '../../components/ui/FormField'
import type { Tone } from '../../components/ui/tokens'
import { formatDate, formatDateTime } from '../../lib/formatDate'

// Opening stock, Stage 2 (2026-08-02, see DECISIONS.md "Opening stock") —
// old-stock lines get a shared amber treatment wherever they render
// (requirement: "All old-stock lines colour-coded"), layered onto the
// existing finished/raw rendering rather than a parallel set of sections
// for every kind — old_raw folds into the raw-draw composer (same
// pool/draw mechanism as raw); only old_kn has no existing shape to fold
// into and gets its own section below. Each site below checks its own
// line_kind directly (no shared kind-set constant — every call site's
// "old" flag is already scoped to the one kind it cares about).
// Reuses the design system's own 'pending' tone (amber) for the card
// border/background rather than inventing a new color — toneStyles.ts's own
// header comment: "Colors are NAMED, not invented."
const oldStockBadge = (
  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/50 dark:text-amber-400">
    Eski zaxira
  </span>
)

// Raw dispatch pool rework (2026-08-01, see DECISIONS.md "Raw dispatch
// serial pool") — a committed (added, not-yet-persisted-to-DB) draw
// against one specific serial. Multiple draws per line now hold real data
// (requirement 6: one raw_dispatch_lines row per serial drawn), replacing
// the old one-draft-per-line shape. `outOfPool`/`note` implement
// requirement 7 — a draw against a serial Menejer didn't pool needs a
// note, recorded via the existing generic `notes` table at commit time.
interface RawDraw {
  key: string
  serial: string
  weightKg: string
  boxMassKg: string
  outOfPool: boolean
  note: string
}

// The in-progress entry being composed for one line, before "Qo'shish"
// commits it into that line's RawDraw[] above.
interface RawComposerDraft {
  serial: string
  weightKg: string
  boxMassKg: string
  note: string
}

const EMPTY_COMPOSER: RawComposerDraft = { serial: '', weightKg: '', boxMassKg: '', note: '' }

// §5.4 FIFO dispatch (2026-08-28, see DECISIONS.md "CHIQIM quantity-based
// dispatch: FIFO cascade, consumption table" — reverses the 2026-07-26/27
// "Option B" pallet-reservation + scan-to-load design): a finished/
// old_washed line no longer names specific pallets in advance and Ombor no
// longer scans anything to load one. Ombor enters ONE number per line — the
// actual loaded kg — and attribute_chiqim_line_fifo (migrations 0087/0089)
// does the rest: cascades that kg across finished_pallets rows for the
// line's own type+calibre+isOldStock, oldest receipt first, hard-failing
// (aborting only this click, nothing partially written) if the line's
// number can't be fully covered by what's really available right now.
// raw/old_raw/old_kn stay exactly as they were — out of this change's scope,
// their own draw composers are unchanged below.
//
// Two windows, same collapsed-by-default / toggle-to-expand shape already
// established for S3W1/S3W2 (OmborTayyorTab): collapsed shows
// request_date · plate · driver · owner + a target-kg summary line; expand
// reveals the loaded-kg entry (W1) or the finalized detail (W2), never both
// fetched or rendered eagerly.
export function OmborChiqimTab() {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- resolves ids on in-flight/historical rows;
  // this screen has no creation dropdown of its own.
  const { owners } = useOwners(true)
  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)
  const { open, finished, loading, refresh } = useOmborChiqimRequests()
  // The SAME canonical availability Menejer's own feasibility hint reads
  // (finished_calibre_availability, migrations 0087/0089) — a soft warning
  // only; the real guard is attribute_chiqim_line_fifo's own hard-fail at
  // finalize time, not this hint.
  const { rows: availabilityRows } = useFinishedCalibreAvailability()

  const [expandedOpen, setExpandedOpen] = useState<string | null>(null)
  const [expandedFinished, setExpandedFinished] = useState<string | null>(null)
  // Keyed by request id, then chiqim_line_id -- the actual loaded kg Ombor
  // enters for a finished/old_washed line, held client-side until
  // "Yuklashni yakunlash" (same deferred-commit shape as the raw/old_kn
  // draws below): nothing is attributed until the finish click.
  const [loadedKgByRequest, setLoadedKgByRequest] = useState<Record<string, Record<string, string>>>({})
  const [confirming, setConfirming] = useState<string | null>(null)
  const [finishError, setFinishError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const { lines: manifestLines, loading: manifestLoading, refresh: refreshManifest } = useDispatchManifestLines(expandedFinished)
  const { lines: rawDispatchLines, loading: rawDispatchLoading } = useRawDispatchLinesByRequest(expandedFinished)
  const { collections: oldKnPastCollections, loading: oldKnPastLoading } = useOldKnCollectionsByRequest(expandedFinished)
  // Opening stock, Stage 2 — old_kn's own balance source, the SAME
  // stock_on_hand_rows old_kn bucket qoldig'i itself reads (never a second
  // source of truth for "how much is left"). rowKey on that bucket IS the
  // pool's own id (old_kn_pools.id), used directly as old_kn_collections.pool_id.
  const { rows: stockRows } = useStockOnHand()
  // Over-collection warning (2026-07-31, see DECISIONS.md "Raw dispatch") —
  // the SAME hook the picker/available-balance figure already reads
  // everywhere else, so this warning can never disagree with what the
  // serial actually has left. Non-blocking, matching this app's warn-never-
  // block convention: a typed weight beyond the serial's remaining balance
  // is still savable (Ombor may be correcting a stale balance), it's just
  // flagged rather than lost silently to the DB's floor-at-zero elsewhere.
  const { serials: rawSerials } = useMoykaSerials()
  // Raw dispatch pool rework (2026-08-01) — every ADDED draw per line, held
  // client-side until "Yuklashni yakunlash" (same deferred-commit shape as
  // loadedKgByRequest above, for the same reason: append-only
  // raw_dispatch_lines needs a pre-commit undo path, and removing an added
  // draw here IS that undo — see DECISIONS.md "Raw dispatch serial pool").
  // Keyed by request id, then by chiqim_line_id, to an ARRAY (a line can
  // draw from several pooled serials, or the same serial more than once).
  const [rawDrawsByRequest, setRawDrawsByRequest] = useState<Record<string, Record<string, RawDraw[]>>>({})
  // The one entry currently being composed per line, before it's added to
  // the array above — separate state so an in-progress, not-yet-valid
  // entry (e.g. serial picked, weight not yet typed) doesn't pollute the
  // committed list.
  const [rawComposerByRequest, setRawComposerByRequest] = useState<Record<string, Record<string, RawComposerDraft>>>({})
  // Opening stock, Stage 2 — old_kn's own added-draws state, same deferred-
  // commit shape as rawDrawsByRequest/rawComposerByRequest above (committed
  // only at "Yuklashni yakunlash") but simpler: one number per draw, no
  // serial to pick (there's exactly one pool per type per owner) and no box
  // mass (a weight pool, not a per-item weigh-in).
  const [oldKnDrawsByRequest, setOldKnDrawsByRequest] = useState<Record<string, Record<string, { key: string; kg: string }[]>>>({})
  const [oldKnComposerByRequest, setOldKnComposerByRequest] = useState<Record<string, Record<string, string>>>({})

  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }
  // Raw dispatch pool rework (2026-08-01) — a line's own display label,
  // whichever kind it is. Kept separate from calibreLabel (which stays
  // finished-only, never called with null) rather than making calibreLabel
  // itself null-tolerant. Takes the minimal shape (not the full ChiqimLine)
  // so it also works on shortfallLines' returned {line, missingKg} pairs
  // (typed ChiqimLineLike). A raw line no longer names one pinned serial —
  // the dedicated raw section below shows the full pool with live detail,
  // so this terse label just says "Xom". Opening stock, Stage 2 — three
  // more kinds, same terse-label reasoning (each kind's own section below
  // shows the real detail).
  function lineLabel(line: { calibre_id: string | null; line_kind: ChiqimLine['line_kind'] }) {
    switch (line.line_kind) {
      case 'raw':
        return 'Xom'
      case 'old_washed':
        return `Eski (yuvilgan) ${calibreLabel(line.calibre_id ?? '')}`
      case 'old_kn':
        return 'Eski KN'
      case 'old_raw':
        return 'Eski xom'
      default:
        return calibreLabel(line.calibre_id ?? '')
    }
  }

  // A raw line's qty_kg is optional (2026-08-01 pool rework) — an
  // un-estimated raw line contributes 0 to "target," the least-wrong
  // choice now that qty_kg is fundamentally undefined for it, not a real
  // shortfall waiting to happen.
  function requestTarget(request: ChiqimRequest): number {
    return request.lines.reduce((sum, l) => sum + (l.qty_kg ?? 0), 0)
  }

  function loadedKgFor(requestId: string, lineId: string): string {
    return loadedKgByRequest[requestId]?.[lineId] ?? ''
  }
  function setLoadedKg(requestId: string, lineId: string, kg: string) {
    setLoadedKgByRequest((m) => ({ ...m, [requestId]: { ...m[requestId], [lineId]: kg } }))
  }
  // Total-by-calibre availability (finished_calibre_availability) for a
  // finished/old_washed line's own type+calibre+isOldStock — the same soft-
  // warning source Menejer's own form reads.
  function availableKgFor(line: ChiqimLine): number {
    if (!line.calibre_id) return 0
    const wantOldStock = line.line_kind === 'old_washed'
    const match = availabilityRows.find(
      (a) => a.type_id === line.type_id && a.calibre_id === line.calibre_id && a.is_old_stock === wantOldStock,
    )
    return match ? match.available_kg : 0
  }

  // A weight/box-mass pair's net, 0 until both hold a valid number — never
  // negative-displayed (floored), matching every other "not there yet"
  // figure in this app. Shared by the composer draft and by summing added
  // draws below.
  function netKgOf(weightKg: string, boxMassKg: string): number {
    const weight = parseFloat(weightKg)
    const boxMass = parseFloat(boxMassKg)
    if (!(weight > 0) || !(boxMass >= 0)) return 0
    return Math.max(0, weight - boxMass)
  }

  function rawDrawsFor(requestId: string, lineId: string): RawDraw[] {
    return rawDrawsByRequest[requestId]?.[lineId] ?? []
  }

  // A line's total net across every ADDED draw (requirement 6: multiple
  // draws per line, possibly the same serial twice) — replaces the old
  // single-draft net now that a raw line can draw from several serials.
  function rawDrawsNetKg(requestId: string, lineId: string): number {
    return rawDrawsFor(requestId, lineId).reduce((sum, d) => sum + netKgOf(d.weightKg, d.boxMassKg), 0)
  }

  function rawComposerFor(requestId: string, lineId: string): RawComposerDraft {
    return rawComposerByRequest[requestId]?.[lineId] ?? EMPTY_COMPOSER
  }

  function setRawComposerField(requestId: string, lineId: string, patch: Partial<RawComposerDraft>) {
    setRawComposerByRequest((m) => {
      const existing = rawComposerFor(requestId, lineId)
      return { ...m, [requestId]: { ...m[requestId], [lineId]: { ...existing, ...patch } } }
    })
  }

  // Commits the in-progress composer entry into the line's draw list, then
  // resets the composer for that line. Requires a serial, a positive net,
  // and — out-of-pool only (requirement 7) — a non-empty note; the "Qo'shish"
  // button's own disabled condition mirrors this exactly, so reaching here
  // with an invalid composer shouldn't normally happen, but the guard stays
  // as the real gate, not just a UI nicety.
  function addRawDraw(request: ChiqimRequest, line: ChiqimLine) {
    const composer = rawComposerFor(request.id, line.id)
    const net = netKgOf(composer.weightKg, composer.boxMassKg)
    const outOfPool = composer.serial !== '' && !line.rawSerialPool.includes(composer.serial)
    if (!composer.serial || net <= 0 || (outOfPool && !composer.note.trim())) return
    const draw: RawDraw = {
      key: crypto.randomUUID(),
      serial: composer.serial,
      weightKg: composer.weightKg,
      boxMassKg: composer.boxMassKg,
      outOfPool,
      note: outOfPool ? composer.note.trim() : '',
    }
    setRawDrawsByRequest((m) => ({
      ...m,
      [request.id]: { ...m[request.id], [line.id]: [...rawDrawsFor(request.id, line.id), draw] },
    }))
    setRawComposerByRequest((m) => ({ ...m, [request.id]: { ...m[request.id], [line.id]: EMPTY_COMPOSER } }))
  }

  function removeRawDraw(requestId: string, lineId: string, key: string) {
    setRawDrawsByRequest((m) => ({
      ...m,
      [requestId]: { ...m[requestId], [lineId]: rawDrawsFor(requestId, lineId).filter((d) => d.key !== key) },
    }))
  }

  // Opening stock, Stage 2 — old_kn's own added-draws helpers, mirroring
  // rawDrawsFor/addRawDraw/removeRawDraw above but simpler (one number, no
  // serial, no note).
  function oldKnDrawsFor(requestId: string, lineId: string): { key: string; kg: string }[] {
    return oldKnDrawsByRequest[requestId]?.[lineId] ?? []
  }
  function oldKnDrawsNetKg(requestId: string, lineId: string): number {
    return oldKnDrawsFor(requestId, lineId).reduce((sum, d) => sum + (parseFloat(d.kg) || 0), 0)
  }
  function oldKnComposerFor(requestId: string, lineId: string): string {
    return oldKnComposerByRequest[requestId]?.[lineId] ?? ''
  }
  function setOldKnComposer(requestId: string, lineId: string, kg: string) {
    setOldKnComposerByRequest((m) => ({ ...m, [requestId]: { ...m[requestId], [lineId]: kg } }))
  }
  function addOldKnDraw(requestId: string, lineId: string) {
    const kg = oldKnComposerFor(requestId, lineId)
    if (!(parseFloat(kg) > 0)) return
    setOldKnDrawsByRequest((m) => ({
      ...m,
      [requestId]: { ...m[requestId], [lineId]: [...oldKnDrawsFor(requestId, lineId), { key: crypto.randomUUID(), kg }] },
    }))
    setOldKnComposer(requestId, lineId, '')
  }
  function removeOldKnDraw(requestId: string, lineId: string, key: string) {
    setOldKnDrawsByRequest((m) => ({
      ...m,
      [requestId]: { ...m[requestId], [lineId]: oldKnDrawsFor(requestId, lineId).filter((d) => d.key !== key) },
    }))
  }

  // The progress figure a line shows, whichever kind it is — Ombor's own
  // entered loaded kg for a finished/old_washed line, sum of added draws for
  // a raw/old_raw line, sum of added draws for an old_kn line. Used
  // everywhere a per-line "how much so far" number is needed (progress
  // bars, shortfall, the aggregate tone) so those never need their own
  // kind branch.
  function lineProgressKg(request: ChiqimRequest, line: ChiqimLine): number {
    if (line.line_kind === 'raw' || line.line_kind === 'old_raw') return rawDrawsNetKg(request.id, line.id)
    if (line.line_kind === 'old_kn') return oldKnDrawsNetKg(request.id, line.id)
    return parseFloat(loadedKgFor(request.id, line.id)) || 0
  }

  function combinedTotalsByLine(request: ChiqimRequest): Record<string, number> {
    const totals: Record<string, number> = {}
    for (const line of request.lines) totals[line.id] = lineProgressKg(request, line)
    return totals
  }

  // Undo a chiqim_pallet_consumption row (post-finish, pre-gate-stage-2).
  // A real DELETE, not a void — these are Ombor's own in-progress FIFO
  // attributions, not finalized records, same reasoning as the old
  // dispatch_manifest undo it replaces. The RLS policy (ombor_deletes,
  // migration 0087) is the actual enforcement: once Qorovul's stage 2
  // completes, PostgREST doesn't raise 42501 for a DELETE's USING clause
  // the way it would for an INSERT's WITH CHECK — a row outside the
  // policy's visible set is just silently excluded from the delete,
  // returning success with zero rows affected. `.select()` after the
  // delete is what surfaces that: an empty array means "matched nothing"
  // (either already gone, or RLS-filtered), which for a row we can see in
  // the UI can only mean the latter.
  async function handleUndoScan(consumptionId: string) {
    setUndoError(null)
    setUndoingId(consumptionId)
    try {
      const { data, error } = await supabase.from('chiqim_pallet_consumption').delete().eq('id', consumptionId).select('id')
      if (error) {
        setUndoError(error.message)
        return
      }
      if (!data || data.length === 0) {
        setUndoError('Bu so\'rov allaqachon qorovul tomonidan yakunlangan — yuklashni bekor qilib bo\'lmaydi.')
        return
      }
      await refreshManifest()
    } finally {
      setUndoingId(null)
    }
  }

  // §5.4: `Yuklashni yakunlash` is always enabled and never blocks on a
  // shortfall (SPEC §5.4, §3.1's same "never blocks" philosophy) — this is
  // the acceptance click itself (placement-vs-acceptance, pattern 2).
  //
  // §5.4 FIFO dispatch (2026-08-28): each finished/old_washed line's loaded
  // kg is attributed FIRST, before any other write this click makes.
  // attribute_chiqim_line_fifo hard-fails (raising, not silently under-
  // filling) if the line's number can't be fully covered by what's
  // available right now — doing this before the raw/old_kn commits below
  // means a hard-fail leaves nothing else written this attempt, so a retry
  // is clean rather than partial.
  async function handleFinish(request: ChiqimRequest) {
    setFinishing(true)
    setFinishError(null)
    try {
      for (const line of request.lines.filter((l) => l.line_kind === 'finished' || l.line_kind === 'old_washed')) {
        const loadedKg = parseFloat(loadedKgFor(request.id, line.id))
        if (!(loadedKg > 0)) continue
        const { error: fifoErr } = await supabase.rpc('attribute_chiqim_line_fifo', {
          p_line_id: line.id,
          p_loaded_kg: loadedKg,
          p_actor: profile?.id,
        })
        if (fifoErr) throw new Error(fifoErr.message)
      }

      // Raw dispatch pool rework (2026-08-01, widened to old_raw in Stage 2
      // — same mechanism, same rawDrawsByRequest state) — committed here,
      // not at entry (see rawDrawsByRequest's own comment): only lines with
      // real, ADDED draws contribute rows. A line the operator left with
      // zero draws is simply not dispatched this trip, same as an un-
      // entered finished line above. Inserted SEQUENTIALLY, not batched —
      // mirrors ChiqimForm.tsx's own established discipline against
      // trusting batch-insert RETURNING order: each draw's own returned id
      // is what correctly ties an out-of-pool note to the right
      // raw_dispatch_lines row below.
      for (const line of request.lines.filter((l) => l.line_kind === 'raw' || l.line_kind === 'old_raw')) {
        for (const draw of rawDrawsFor(request.id, line.id)) {
          const weight = parseFloat(draw.weightKg)
          const boxMass = parseFloat(draw.boxMassKg)
          if (!(weight > 0) || !(boxMass >= 0)) continue
          const { data: inserted, error: rawErr } = await supabase
            .from('raw_dispatch_lines')
            .insert({ chiqim_line_id: line.id, serial: draw.serial, weight_kg: weight, box_mass_kg: boxMass, created_by: profile?.id })
            .select('id')
            .single()
          if (rawErr) throw rawErr
          // Requirement 7 — an out-of-pool draw's note, via the existing
          // generic notes mechanism (reused as instructed, not a new
          // feature): entity_type/entity_id point at the draw's own row.
          if (draw.outOfPool && draw.note) {
            const { error: noteErr } = await supabase.from('notes').insert({
              entity_type: 'raw_dispatch_lines',
              entity_id: inserted.id,
              author: profile?.id,
              body: `Pool tashqarisidagi xom olish (${draw.serial}): ${draw.note}`,
            })
            if (noteErr) throw noteErr
          }
        }
      }

      // Opening stock, Stage 2 — old_kn's own commit, same "only lines with
      // real added draws" rule. pool_id is resolved here from stockRows'
      // own old_kn bucket (rowKey === old_kn_pools.id) — the same balance
      // source the composer's own available-kg hint reads, so a resolved
      // pool can never disagree with what the UI showed. A line whose
      // pool has since gone to zero (raced by another request) has no
      // matching stockRows entry — its draws are skipped rather than
      // inserted against a stale/nonexistent pool.
      for (const line of request.lines.filter((l) => l.line_kind === 'old_kn')) {
        const pool = stockRows.find((r) => r.bucket === 'old_kn' && r.ownerId === request.owner_id && r.typeId === line.type_id)
        if (!pool) continue
        for (const draw of oldKnDrawsFor(request.id, line.id)) {
          const kg = parseFloat(draw.kg)
          if (!(kg > 0)) continue
          const { error: knErr } = await supabase
            .from('old_kn_collections')
            .insert({ chiqim_line_id: line.id, pool_id: pool.rowKey, collected_kg: kg, created_by: profile?.id })
          if (knErr) throw knErr
        }
      }

      const { error: reqErr } = await supabase
        .from('chiqim_requests')
        .update({ ombor_finished_at: new Date().toISOString(), ombor_finished_by: profile?.id })
        .eq('id', request.id)
      if (reqErr) throw reqErr

      setLoadedKgByRequest((m) => {
        const next = { ...m }
        delete next[request.id]
        return next
      })
      setRawDrawsByRequest((m) => {
        const next = { ...m }
        delete next[request.id]
        return next
      })
      setRawComposerByRequest((m) => {
        const next = { ...m }
        delete next[request.id]
        return next
      })
      setOldKnDrawsByRequest((m) => {
        const next = { ...m }
        delete next[request.id]
        return next
      })
      setOldKnComposerByRequest((m) => {
        const next = { ...m }
        delete next[request.id]
        return next
      })
      setConfirming(null)
      setExpandedOpen(null)
      refresh()
    } catch (err) {
      setFinishError(err instanceof Error ? err.message : 'Yakunlashda xatolik yuz berdi.')
    } finally {
      setFinishing(false)
    }
  }

  if (loading) return null

  return (
    <div className="space-y-6">
      <div>
        <SectionHeading>1 · Yuklashga tayyor — moshina keldi</SectionHeading>
        <div className="mt-2 space-y-2">
          {open.length === 0 && <p className="text-sm text-slate-400">Ochiq so'rov yo'q.</p>}
          {open.map((request) => {
            const isExpanded = expandedOpen === request.id
            const target = requestTarget(request)
            // Raw dispatch: the running total now includes every exit —
            // finished/old_washed's own loaded-kg entry AND raw draft nets
            // (combinedTotalsByLine covers both; summed here for the
            // aggregate Stat).
            const totalsByLine = combinedTotalsByLine(request)
            const scanned = Object.values(totalsByLine).reduce((sum, v) => sum + v, 0)
            const shortfalls = computeShortfallLines(request.lines, totalsByLine)
            // Aggregate glance-state for the running-total banner —
            // composed here from the SAME per-line lineStatus() every line
            // row below already uses, not a new decision. Mirrors the
            // existing per-line convention exactly: shortfall stays
            // neutral (still in progress, never a problem on its own),
            // overage on ANY line is the pending/amber signal, and emerald
            // only once every line is exact.
            // A raw line with no Menejer estimate (qty_kg null) has no
            // target to compare against — excluded here rather than
            // treated as a 0 kg target (an empty lineStatuses is fine:
            // .every() on [] is vacuously true, so an all-un-estimated-raw
            // request reads as "ok" the moment anything is drawn, which is
            // the right read — nothing to fall short of or exceed).
            const lineStatuses = request.lines
              .filter((l) => l.qty_kg !== null)
              .map((l) => lineStatus(l.qty_kg!, lineProgressKg(request, l)))
            const aggregateTone: Tone =
              scanned === 0
                ? 'neutral'
                : lineStatuses.some((s) => s === 'overage')
                  ? 'pending'
                  : lineStatuses.every((s) => s === 'exact')
                    ? 'ok'
                    : 'neutral'

            return (
              <Card key={request.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-900 dark:text-slate-100">
                      {ownerName(request.owner_id)}
                    </div>
                    <div className="truncate text-sm text-slate-500 dark:text-slate-400">
                      So'rov · {formatDate(request.request_date)} · {request.plate} · {request.driver}
                    </div>
                  </div>
                  <StatusPill tone="info">Nishon {target.toLocaleString()} kg</StatusPill>
                </div>

                <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  {request.lines
                    .map((l) => `${typeName(l.type_id)} ${lineLabel(l)} · ${l.qty_kg === null ? '—' : l.qty_kg.toLocaleString()}`)
                    .join('   ')}
                </div>

                {/* Gate-weighing status: informational only, never gates
                    "Yuklashni boshlash" below — matches this app's
                    consistent never-block philosophy (Kam chiqdi, Tugallash
                    warnings, this same screen's own shortfall note). Both
                    states shown explicitly so a not-yet-weighed request
                    reads as a real state, not a rendering gap. */}
                <div className="mt-2">
                  {request.gateStage1CompletedAt ? (
                    <StatusNote tone="ok">
                      ✓ Qorovul bo'sh vaznni oldi ({(request.gatePustoyKg ?? 0).toLocaleString()} kg) — yuklasa bo'ladi
                    </StatusNote>
                  ) : (
                    <StatusNote tone="pending">Qorovul hali bo'sh vaznni olmagan</StatusNote>
                  )}
                </div>

                {!isExpanded && (
                  <div className="mt-3">
                    <Button variant="primary" size="lg" fullWidth onClick={() => setExpandedOpen(request.id)}>
                      Yuklashni boshlash
                    </Button>
                  </div>
                )}

                {isExpanded && (
                  <div className="mt-3 space-y-4 border-t border-slate-200 pt-3 dark:border-slate-700">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 dark:text-slate-400">Buyurtmachi</span>
                          <span className="font-medium text-slate-900 dark:text-slate-100">{ownerName(request.owner_id)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 dark:text-slate-400">So'rov sanasi</span>
                          <span className="font-medium text-slate-900 dark:text-slate-100">{formatDate(request.request_date)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 dark:text-slate-400">Moshina · haydovchi</span>
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            {request.plate} · {request.driver}
                          </span>
                        </div>
                      </div>
                      <Button variant="ghost" size="md" onClick={() => setExpandedOpen(null)}>
                        Yopish
                      </Button>
                    </div>

                    {/* Nishon lines with live progress bars — same
                        lineStatus()/lineProgressKg() data as the running
                        total below, just visualised per line. */}
                    <div>
                      <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                        Nishon — tur va kalibr bo'yicha
                      </div>
                      <div className="space-y-2">
                        {request.lines.map((line) => {
                          const lineScanned = lineProgressKg(request, line)
                          // A raw line's qty_kg is optional (2026-08-01) —
                          // with no target, there's nothing to compare
                          // against: show the running total alone, no
                          // status color, no bar.
                          const hasTarget = line.qty_kg !== null
                          const status = hasTarget ? lineStatus(line.qty_kg!, lineScanned) : null
                          const pct = hasTarget && line.qty_kg! > 0 ? Math.min(100, (lineScanned / line.qty_kg!) * 100) : 0
                          return (
                            <div key={line.id}>
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-700 dark:text-slate-300">
                                  {typeName(line.type_id)} · {lineLabel(line)}
                                </span>
                                <span
                                  className={
                                    status === 'exact'
                                      ? 'font-medium text-emerald-600 dark:text-emerald-400'
                                      : status === 'overage'
                                        ? 'font-medium text-amber-600 dark:text-amber-400'
                                        : 'text-slate-500 dark:text-slate-400'
                                  }
                                >
                                  {hasTarget ? `${lineScanned.toLocaleString()} / ${line.qty_kg!.toLocaleString()}` : `${lineScanned.toLocaleString()} kg`}
                                  {status === 'exact' ? ' ✓' : ''}
                                </span>
                              </div>
                              {hasTarget && (
                                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                                  <div
                                    className={`h-full rounded-full ${
                                      status === 'exact'
                                        ? 'bg-emerald-500'
                                        : status === 'overage'
                                          ? 'bg-amber-500'
                                          : 'bg-slate-900 dark:bg-slate-100'
                                    }`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* §5.4 FIFO dispatch (2026-08-28) — a finished/
                        old_washed line has no pallets to gather any more:
                        Ombor enters the actual loaded kg directly, and FIFO
                        attributes it across finished_pallets at the finish
                        click (see this component's own header comment).
                        Declared net+tara (Menejer's own figures) are shown
                        as context, never overwritten by this entry. */}
                    {request.lines.some((l) => l.line_kind === 'finished' || l.line_kind === 'old_washed') && (
                      <div>
                        <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                          Yuklangan og'irlikni kiriting
                        </div>
                        <div className="space-y-2">
                          {request.lines
                            .filter((line) => line.line_kind === 'finished' || line.line_kind === 'old_washed')
                            .map((line) => {
                              const isOld = line.line_kind === 'old_washed'
                              const loaded = loadedKgFor(request.id, line.id)
                              const loadedNum = parseFloat(loaded) || 0
                              const available = availableKgFor(line)
                              const overAvailable = loadedNum > available
                              return (
                                <Card key={line.id} padding="compact" tone={isOld ? 'pending' : 'neutral'}>
                                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                    <span className="flex items-center gap-1.5">
                                      {typeName(line.type_id)} · {lineLabel(line)}
                                      {isOld && oldStockBadge}
                                    </span>
                                    <span>
                                      sof {line.qty_kg === null ? '—' : `${line.qty_kg.toLocaleString()} kg`}
                                      {line.declared_tara_kg !== null && ` + tara ${line.declared_tara_kg.toLocaleString()} kg`}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs text-slate-400">
                                    Omborda mavjud: {Math.round(available).toLocaleString()} kg
                                  </p>
                                  <div className="mt-1.5">
                                    <TextInput
                                      type="number"
                                      min="0"
                                      step="0.1"
                                      placeholder="Yuklangan og'irlik (kg)"
                                      value={loaded}
                                      onChange={(e) => setLoadedKg(request.id, line.id, e.target.value)}
                                      className="w-full"
                                    />
                                  </div>
                                  {overAvailable && (
                                    <div className="mt-1.5">
                                      <StatusNote tone="pending">
                                        Diqqat: omborda faqat {Math.round(available).toLocaleString()} kg mavjud — siz{' '}
                                        {loadedNum.toLocaleString()} kg kiritmoqdasiz. Yakunlashda yetarli bo'lmasa xatolik chiqadi.
                                      </StatusNote>
                                    </div>
                                  )}
                                </Card>
                              )
                            })}
                        </div>
                      </div>
                    )}

                    {/* Raw dispatch pool rework (2026-08-01, see DECISIONS.md
                        "Raw dispatch serial pool") — a structurally different
                        branch, not a forced-generic line renderer: per-serial
                        weight + box-mass draws. Only rendered when this
                        request actually has a raw line. Ombor picks ONE
                        serial per draw — from the pool Menejer named, or
                        types any other real serial (out-of-pool, requirement
                        7, warned + requires a note) — enters weight+box mass,
                        and adds it; a line can hold several draws (requirement
                        6), even against the same serial twice. Nothing is
                        written until "Yuklashni yakunlash" (see
                        rawDrawsByRequest's own comment for why). */}
                    {request.lines.some((l) => l.line_kind === 'raw' || l.line_kind === 'old_raw') && (
                      <div>
                        <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                          Xom yuklash — manba seriyadan tanlab, vazn kiritish
                        </div>
                        <div className="space-y-2">
                          {request.lines
                            .filter((line) => line.line_kind === 'raw' || line.line_kind === 'old_raw')
                            .map((line) => {
                              const isOld = line.line_kind === 'old_raw'
                              const draws = rawDrawsFor(request.id, line.id)
                              const composer = rawComposerFor(request.id, line.id)
                              const composerNet = netKgOf(composer.weightKg, composer.boxMassKg)
                              const composerAvailable = composer.serial
                                ? (rawSerials.find((s) => s.serial === composer.serial)?.available ?? null)
                                : null
                              const composerOverCollected = composerAvailable !== null && composerNet > composerAvailable
                              const composerOutOfPool = composer.serial !== '' && !line.rawSerialPool.includes(composer.serial)
                              const canAdd = composer.serial !== '' && composerNet > 0 && (!composerOutOfPool || composer.note.trim() !== '')
                              return (
                                <Card key={line.id} padding="compact" tone={isOld ? 'pending' : 'neutral'}>
                                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                    <span className="flex items-center gap-1.5">
                                      {typeName(line.type_id)} · {lineLabel(line)}
                                      {isOld && oldStockBadge}
                                    </span>
                                    <span>{line.qty_kg === null ? 'taxminiy miqdor kiritilmagan' : `taxminiy ${line.qty_kg.toLocaleString()} kg`}</span>
                                  </div>

                                  {/* The pool -- Menejer's named sources, each with its live available balance. */}
                                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {line.rawSerialPool.length === 0 ? (
                                      <p className="text-xs text-slate-400">Manba seriya belgilanmagan.</p>
                                    ) : (
                                      line.rawSerialPool.map((serial) => {
                                        const poolSerial = rawSerials.find((s) => s.serial === serial) ?? null
                                        const available = poolSerial?.available ?? null
                                        const selected = composer.serial === serial
                                        return (
                                          <button
                                            key={serial}
                                            type="button"
                                            onClick={() => setRawComposerField(request.id, line.id, { serial, note: '' })}
                                            className={`rounded-md border px-2 py-1 text-left text-xs ${
                                              selected
                                                ? 'border-blue-400 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                                                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                                            }`}
                                          >
                                            <span className="font-mono">{selected ? '✓ ' : ''}{serial}</span>
                                            <PartiyaBadge partiyaNo={poolSerial?.partiyaNo ?? null} />
                                            <span className="ml-1.5">{available === null ? '—' : `${Math.round(available).toLocaleString()} kg mavjud`}</span>
                                          </button>
                                        )
                                      })
                                    )}
                                  </div>

                                  {/* Out-of-pool entry (requirement 7) -- any other real serial. */}
                                  <div className="mt-1.5">
                                    <TextInput
                                      placeholder="...yoki boshqa seriya (pool tashqarisida)"
                                      value={composer.serial}
                                      onChange={(e) => setRawComposerField(request.id, line.id, { serial: e.target.value.trim(), note: '' })}
                                      className="w-full"
                                    />
                                  </div>
                                  {composerOutOfPool && (
                                    <div className="mt-1.5 space-y-1">
                                      <StatusNote tone="pending">
                                        Diqqat: {composer.serial} bu qator uchun belgilangan manbalar orasida yo'q.
                                      </StatusNote>
                                      <TextInput
                                        placeholder="Sabab (majburiy)"
                                        value={composer.note}
                                        onChange={(e) => setRawComposerField(request.id, line.id, { note: e.target.value })}
                                        className="w-full"
                                      />
                                    </div>
                                  )}

                                  <div className="mt-1.5 flex items-center gap-2">
                                    <TextInput
                                      type="number"
                                      min="0"
                                      step="0.1"
                                      placeholder="Vazn (kg)"
                                      value={composer.weightKg}
                                      onChange={(e) => setRawComposerField(request.id, line.id, { weightKg: e.target.value })}
                                      className="flex-1"
                                    />
                                    <TextInput
                                      type="number"
                                      min="0"
                                      step="0.1"
                                      placeholder="Quti massasi (kg)"
                                      value={composer.boxMassKg}
                                      onChange={(e) => setRawComposerField(request.id, line.id, { boxMassKg: e.target.value })}
                                      className="flex-1"
                                    />
                                    <Button variant="secondary" size="md" disabled={!canAdd} onClick={() => addRawDraw(request, line)}>
                                      + Qo'shish
                                    </Button>
                                  </div>
                                  {/* Warn-never-block (established convention, see DECISIONS.md "Raw
                                      dispatch"): entering more than the serial has left is still
                                      addable (Ombor may be correcting a stale balance) -- just
                                      flagged, not silently floored away downstream. */}
                                  {composerOverCollected && (
                                    <div className="mt-1">
                                      <StatusNote tone="pending">
                                        Diqqat: bu seriyada faqat {composerAvailable!.toLocaleString()} kg qolgan — siz{' '}
                                        {composerNet.toLocaleString()} kg kiritmoqdasiz.
                                      </StatusNote>
                                    </div>
                                  )}

                                  {/* Added draws for this line. */}
                                  {draws.length > 0 && (
                                    <ul className="mt-2 space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700">
                                      {draws.map((d) => (
                                        <li key={d.key} className="flex items-center justify-between gap-2 text-xs">
                                          <span className="min-w-0 flex-1 truncate">
                                            <span className="font-mono text-slate-700 dark:text-slate-300">{d.serial}</span>
                                            <PartiyaBadge partiyaNo={rawSerials.find((s) => s.serial === d.serial)?.partiyaNo ?? null} />
                                            {d.outOfPool && (
                                              <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">⚠ pool tashqarisida</span>
                                            )}
                                            <span className="ml-1.5 text-slate-500 dark:text-slate-400">
                                              {parseFloat(d.weightKg).toLocaleString()} kg − {parseFloat(d.boxMassKg).toLocaleString()} kg tara
                                            </span>
                                            {d.note && <span className="ml-1.5 italic text-slate-400">"{d.note}"</span>}
                                          </span>
                                          <IconButton label="O'chirish" tone="danger" onClick={() => removeRawDraw(request.id, line.id, d.key)}>
                                            ✕
                                          </IconButton>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  <div className="mt-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                                    Jami: {rawDrawsNetKg(request.id, line.id).toLocaleString()} kg
                                  </div>
                                </Card>
                              )
                            })}
                        </div>
                      </div>
                    )}

                    {/* Opening stock, Stage 2 — old_kn has no existing
                        shape to fold into (no calibre, no serial pool, no
                        scan): Ombor enters the real measured kg collected
                        against the one pool this type/owner has, possibly
                        in several draws. Nothing written until "Yuklashni
                        yakunlash" — same deferred-commit shape as raw. */}
                    {request.lines.some((l) => l.line_kind === 'old_kn') && (
                      <div>
                        <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                          Eski KN yig'ish — o'lchangan og'irlikni kiriting
                        </div>
                        <div className="space-y-2">
                          {request.lines
                            .filter((line) => line.line_kind === 'old_kn')
                            .map((line) => {
                              const pool = stockRows.find(
                                (r) => r.bucket === 'old_kn' && r.ownerId === request.owner_id && r.typeId === line.type_id,
                              )
                              const draws = oldKnDrawsFor(request.id, line.id)
                              const composerKg = oldKnComposerFor(request.id, line.id)
                              const composerVal = parseFloat(composerKg)
                              const composerOverCollected = pool !== undefined && composerVal > pool.qtyKg
                              const canAdd = composerVal > 0
                              return (
                                <Card key={line.id} padding="compact" tone="pending">
                                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                    <span className="flex items-center gap-1.5">
                                      {typeName(line.type_id)} · Eski KN
                                      {oldStockBadge}
                                    </span>
                                    <span>{line.qty_kg === null ? 'taxminiy miqdor kiritilmagan' : `taxminiy ${line.qty_kg.toLocaleString()} kg`}</span>
                                  </div>
                                  <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-400">
                                    {pool ? `Havzada mavjud: ${Math.round(pool.qtyKg).toLocaleString()} kg` : "Bu turda eski KN havzasi qolmagan."}
                                  </p>

                                  <div className="mt-1.5 flex items-center gap-2">
                                    <TextInput
                                      type="number"
                                      min="0"
                                      step="0.1"
                                      placeholder="O'lchangan og'irlik (kg)"
                                      value={composerKg}
                                      onChange={(e) => setOldKnComposer(request.id, line.id, e.target.value)}
                                      className="flex-1"
                                    />
                                    <Button
                                      variant="secondary"
                                      size="md"
                                      disabled={!canAdd}
                                      onClick={() => addOldKnDraw(request.id, line.id)}
                                    >
                                      + Qo'shish
                                    </Button>
                                  </div>
                                  {composerOverCollected && pool && (
                                    <div className="mt-1">
                                      <StatusNote tone="pending">
                                        Diqqat: havzada faqat {Math.round(pool.qtyKg).toLocaleString()} kg qolgan — siz{' '}
                                        {composerVal.toLocaleString()} kg kiritmoqdasiz.
                                      </StatusNote>
                                    </div>
                                  )}

                                  {draws.length > 0 && (
                                    <ul className="mt-2 space-y-1 border-t border-amber-200 pt-2 dark:border-amber-900">
                                      {draws.map((d) => (
                                        <li key={d.key} className="flex items-center justify-between gap-2 text-xs">
                                          <span className="text-slate-700 dark:text-slate-300">{parseFloat(d.kg).toLocaleString()} kg</span>
                                          <IconButton label="O'chirish" tone="danger" onClick={() => removeOldKnDraw(request.id, line.id, d.key)}>
                                            ✕
                                          </IconButton>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  <div className="mt-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                                    Jami: {oldKnDrawsNetKg(request.id, line.id).toLocaleString()} kg
                                  </div>
                                </Card>
                              )
                            })}
                        </div>
                      </div>
                    )}

                    {/* Total footer + finish — kept together at the bottom,
                        thumb-reachable without scrolling, never blocked by a
                        shortfall (§5.4/§3.1). The shortfall note is live
                        during entry (not just at confirm), same missingKg
                        computation as before. */}
                    <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                      <Stat
                        value={`${scanned.toLocaleString()} / ${target.toLocaleString()} kg`}
                        label="Umumiy yuklangan"
                        tone={aggregateTone}
                      />
                      {shortfalls.length > 0 && (
                        <StatusNote tone="pending">
                          Yetarli emas: {shortfalls
                            .map((s) => `${typeName(s.line.type_id)} ${lineLabel(s.line)} — ${s.missingKg.toLocaleString()} kg kam`)
                            .join(' · ')}
                          . Baribir yakunlash mumkin — sabab qayd sifatida yoziladi.
                        </StatusNote>
                      )}

                      {confirming === request.id ? (
                        <div className="space-y-2">
                          <p className="text-sm text-slate-700 dark:text-slate-300">Jami {scanned.toLocaleString()} kg yuklanadi.</p>
                          {finishError && <StatusNote tone="problem">{finishError}</StatusNote>}
                          <div className="flex gap-2">
                            <Button variant="primary" size="lg" onClick={() => handleFinish(request)} disabled={finishing}>
                              {finishing ? 'Yakunlanmoqda…' : 'Ha, yakunlash'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="md"
                              onClick={() => {
                                setConfirming(null)
                                setFinishError(null)
                              }}
                            >
                              Bekor qilish
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button variant="primary" size="lg" fullWidth onClick={() => setConfirming(request.id)}>
                          Yuklashni yakunlash
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      </div>

      {/* Ombor's own Window 2 — finished loading (ombor_finished_at set),
          independent of Qorovul's gate weighing (CHIQIM per-role
          finalization). Same collapsed-by-default pattern as S3W2. */}
      <div>
        <SectionHeading>2 · Yuklandi · qorovulga topshirildi</SectionHeading>
        <div className="mt-2 space-y-2">
          {finished.length === 0 && <p className="text-sm text-slate-400">Hali yuklangan so'rov yo'q.</p>}
          {finished.map((request) => (
            <Card key={request.id} padding="compact">
              <button
                type="button"
                onClick={() => {
                  setExpandedFinished(expandedFinished === request.id ? null : request.id)
                  setUndoError(null)
                }}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {ownerName(request.owner_id)}
                    {request.lines.length > 0 &&
                      ` · ${[...new Set(request.lines.map((l) => typeName(l.type_id)))].join(' + ')}`}
                  </div>
                  <div className="truncate text-sm text-slate-500 dark:text-slate-400">
                    {request.plate} · {request.driver} · maqsad {requestTarget(request).toLocaleString()} kg · yuklangan{' '}
                    {request.ombor_finished_at ? formatDateTime(request.ombor_finished_at) : ''}
                  </div>
                </div>
                <span className="shrink-0 text-slate-500 dark:text-slate-400">⋯</span>
              </button>
              {expandedFinished === request.id && (
                <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700">
                  {request.lines.map((line) => (
                    <div key={line.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600 dark:text-slate-400">
                        {typeName(line.type_id)} · {lineLabel(line)}
                      </span>
                      <span className="text-slate-600 dark:text-slate-400">{line.qty_kg === null ? '—' : `${line.qty_kg.toLocaleString()} kg`}</span>
                    </div>
                  ))}

                  {/* FIFO-attributed pallet portions, flat (not regrouped by
                      line) — see useDispatchManifestLines: chiqim_pallet_
                      consumption doesn't group by line at the read layer
                      any differently than this. Undo here is a real DELETE,
                      enforced server-side by the ombor_deletes RLS policy
                      (migration 0087) up to gate stage 2. */}
                  <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
                    <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                      <span>Yuklangan palletlar</span>
                      <span>
                        {manifestLines.reduce((sum, l) => sum + l.weight_kg, 0).toLocaleString()} kg
                      </span>
                    </div>
                    {manifestLoading && <p className="mt-1 text-xs text-slate-400">Yuklanmoqda…</p>}
                    {!manifestLoading && manifestLines.length === 0 && (
                      <p className="mt-1 text-xs text-slate-400">Yuklangan pallet yo'q.</p>
                    )}
                    {manifestLines.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {manifestLines.map((m) => (
                          <li key={m.id} className="flex items-center justify-between text-xs">
                            <span className="font-mono text-slate-600 dark:text-slate-400">
                              {m.barcode2} · {typeName(m.type_id)} · {calibreLabel(m.calibre_id)} · {m.weight_kg.toLocaleString()} kg
                            </span>
                            <IconButton
                              label="Bekor qilish"
                              tone="danger"
                              disabled={undoingId === m.id}
                              onClick={() => handleUndoScan(m.id)}
                            >
                              ✕
                            </IconButton>
                          </li>
                        ))}
                      </ul>
                    )}
                    {undoError && <StatusNote tone="problem">{undoError}</StatusNote>}
                  </div>

                  {/* Raw dispatch's own W2 record — no undo here (unlike
                      the pallet portions above): raw_dispatch_lines is
                      append-only, committed only at the finish click that
                      put this request in Window 2 to begin with (see
                      rawDrawsByRequest's own comment). Each row is one
                      committed draw against one serial — unaffected by the
                      pool rework, since raw_dispatch_lines.serial was
                      always the actual draw, never the pool. */}
                  {rawDispatchLines.length > 0 && (
                    <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
                      <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                        <span>Xom yuklangan</span>
                        <span>{rawDispatchLines.reduce((sum, r) => sum + r.net_kg, 0).toLocaleString()} kg</span>
                      </div>
                      {rawDispatchLoading && <p className="mt-1 text-xs text-slate-400">Yuklanmoqda…</p>}
                      <ul className="mt-1 space-y-0.5">
                        {rawDispatchLines.map((r) => (
                          <li key={r.id} className="flex items-center justify-between text-xs">
                            <span className="font-mono text-slate-600 dark:text-slate-400">{r.serial}</span>
                            <span className="text-slate-600 dark:text-slate-400">
                              {r.weight_kg.toLocaleString()} kg − {r.box_mass_kg.toLocaleString()} kg tara = {r.net_kg.toLocaleString()} kg
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Opening stock, Stage 2 — old_kn's own W2 record, same
                      append-only/no-undo reasoning as raw dispatch above:
                      committed only at the finish click. No serial to show
                      (a pool draw, not an item), just the measured kg. */}
                  {oldKnPastCollections.length > 0 && (
                    <div className="mt-2 border-t border-amber-200 pt-2 dark:border-amber-900">
                      <div className="flex items-center justify-between text-xs font-medium text-amber-800 dark:text-amber-400">
                        <span>Eski KN yig'ildi</span>
                        <span>{oldKnPastCollections.reduce((sum, c) => sum + c.collected_kg, 0).toLocaleString()} kg</span>
                      </div>
                      {oldKnPastLoading && <p className="mt-1 text-xs text-slate-400">Yuklanmoqda…</p>}
                      <ul className="mt-1 space-y-0.5">
                        {oldKnPastCollections.map((c) => (
                          <li key={c.id} className="flex items-center justify-between text-xs">
                            <span className="text-slate-600 dark:text-slate-400">{formatDateTime(c.collected_at)}</span>
                            <span className="text-slate-600 dark:text-slate-400">{c.collected_kg.toLocaleString()} kg</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
