import { useState, type FormEvent } from 'react'
import { PhotoField } from '../../components/PhotoField'
import type { AwaitingCycle } from '../../lib/useLaboratorChiqim'
import { Button } from '../../components/ui/Button'
import { FormField, TextInput } from '../../components/ui/FormField'
import { StatusNote } from '../../components/ui/StatusNote'
import { StatusPill } from '../../components/ui/StatusPill'

export interface ChiqimTahlilValues {
  sampleDate: string
  sampledPallet: string
  moisturePct: number
  photoFile: File | null
  note: string
  verdict: 'o_tdi' | 'qayta_yuvish' | null
}

// §5.5.3 CHIQIM Tahlil form. Unlike KIRIM, a real pallet dropdown makes
// sense here — Barcode #2 pallets exist by this stage (§5.3 output), unlike
// KIRIM's raw-serial-only intake. Client target shown next to the moisture
// input, greyed, soft-warn only (never blocks) if the reading exceeds it —
// "misses the target" read as exceeding the client's maximum, the standard
// quality-spec direction for both moisture and sulfur in this context.
//
// `requireVerdict` controls whether this save is also the FINAL save for
// this line: a natural product (no SO2 target) has nothing left to capture
// after moisture, so its verdict happens right here; a sulfured product's
// verdict happens later, in the Sera kiritish step, once SO2 is in. No SO2
// field on this form either way — SO2 is only ever entered via Sera
// kiritish, matching the KIRIM form's identical choice (see DECISIONS.md).
//
// nav/visual-redesign pass (mockup "BATU-Laborator-Screens-v2.pdf" p5 —
// visual language only, see docs/DECISIONS.md for why that page's own
// dispatch-shaped kv block/explainer text is NOT what's built here):
// `cycle`/`ownerName`/`typeName` replace the old `targetMoisturePct`/
// `pallets`-only prop pair so the kv context block can show the v1.9
// wash-cycle fields SPEC §5.5.3 actually names (parent seriya, buyurtmachi,
// tur, pallet soni, jami kg, ishlab chiqarilgan sana, yuvish sikli) instead
// of the mockup's So'rov/Moshina/Tarkib dispatch fields — all read from
// `cycle`, already fetched in full by the parent tab, no new query.
export function ChiqimTahlilForm({
  cycle,
  ownerName,
  typeName,
  requireVerdict,
  onCancel,
  onSubmit,
}: {
  cycle: AwaitingCycle
  ownerName: string
  typeName: string
  requireVerdict: boolean
  onCancel: () => void
  onSubmit: (values: ChiqimTahlilValues) => Promise<void>
}) {
  const [sampleDate, setSampleDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [sampledPallet, setSampledPallet] = useState('')
  const [moisture, setMoisture] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targetMoisturePct = cycle.target_moisture_pct
  const jamiKg = cycle.pallets.reduce((sum, p) => sum + p.weight_kg, 0)
  const moisturePct = parseFloat(moisture)
  const missesTarget = targetMoisturePct !== null && !isNaN(moisturePct) && moisturePct > targetMoisturePct

  async function submit(verdict: 'o_tdi' | 'qayta_yuvish' | null) {
    setError(null)
    if (!sampledPallet) {
      setError('Namuna olingan palletni tanlang.')
      return
    }
    if (isNaN(moisturePct)) {
      setError('Namligi % ni kiriting.')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit({ sampleDate, sampledPallet, moisturePct, photoFile, note: note.trim(), verdict })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!requireVerdict) await submit(null)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-4 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900"
    >
      <div>
        <StatusPill tone="info">LABORATOR · CHIQIM TAHLILI</StatusPill>
        <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">Namuna tahlili</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">Bitta palletdan namuna — natija butun yuvish sikliga tegishli</p>
      </div>

      <div className="space-y-1.5 rounded-md bg-slate-100 p-3 dark:bg-slate-800/60">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Seriya</span>
          <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{cycle.serial}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Egasi</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">{ownerName}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Tur</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">{typeName}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Pallet soni · og'irlik</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {cycle.pallets.length} ta · {jamiKg.toLocaleString()} kg
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Ishlab chiqarilgan · sikl</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {cycle.producedDate ?? '—'} · {cycle.cycleNo}
          </span>
        </div>
      </div>

      <FormField label="Namuna olingan pallet">
        <select
          required
          value={sampledPallet}
          onChange={(e) => setSampledPallet(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 text-base min-h-12 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="" disabled>
            Tanlang…
          </option>
          {cycle.pallets.map((p) => (
            <option key={p.barcode2} value={p.barcode2}>
              {p.barcode2} · {p.weight_kg.toLocaleString()} kg
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Tahlil sanasi">
        <TextInput type="date" required value={sampleDate} onChange={(e) => setSampleDate(e.target.value)} />
      </FormField>

      {/* Not FormField here: the label carries a nested target-suffix span
          ("Namligi % (Talab: X%)"), and the e2e suite's own
          `label:text-is("Namligi %")` locator depends on "Namligi %" being
          reachable as an exact match distinct from that suffix -- confirmed
          against the live e2e contract before touching this, not assumed.
          FormField's `label` prop only accepts a plain string, so it can't
          reproduce this shape; TextInput alone (same input styling, same
          surrounding div this already had) applies the system without
          disturbing that structure. */}
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Namligi %{' '}
          <span className="font-normal text-slate-400 dark:text-slate-500">
            (Talab: {targetMoisturePct !== null ? `${targetMoisturePct}%` : "Talab yo'q"})
          </span>
        </label>
        <div className="relative mt-1">
          <TextInput
            type="number"
            min="0"
            step="0.1"
            required
            value={moisture}
            onChange={(e) => setMoisture(e.target.value)}
            className="!text-2xl font-bold pr-10"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">%</span>
        </div>
        {missesTarget && (
          <div className="mt-1">
            <StatusNote tone="pending">Talabdan yuqori ({targetMoisturePct}%) — baribir saqlash mumkin.</StatusNote>
          </div>
        )}
      </div>

      {cycle.target_so2_mg_kg !== null && (
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Oltingugurt (SO₂)</label>
          <div className="mt-1">
            <StatusNote tone="pending">Natija 1 kundan keyin — hozircha bo'sh qoldiring</StatusNote>
          </div>
        </div>
      )}

      <PhotoField label="Namuna rasmi · ixtiyoriy" onChange={setPhotoFile} />

      <FormField label="Nuqson/begona modda qaydi (ixtiyoriy)">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-base bg-white text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
      </FormField>

      {/* Reworded for v1.9 (nav/visual-redesign pass, per explicit
          instruction): the mockup's own text here says "shu jo'natmaning
          barcha palletlariga tegishli" (this dispatch's pallets) — CHIQIM
          isn't tied to a dispatch at all (§5.5.3/correction #1), so this
          says wash cycle instead. */}
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
        <p className="text-sm font-medium text-blue-700 dark:text-blue-400">Natija qayerga tegishli</p>
        <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">
          Bu natija <strong>{cycle.serial}</strong> seriyaning <strong>{cycle.cycleNo}-yuvish sikliga</strong> tegishli
          — shu sikldan chiqqan barcha palletlar (K4, K6, K8, Konditirskiy) namligi va serasini meros qilib oladi.
          Dispatch (so'rov)ga emas, sikldagi barcha palletlarga tegishli.
        </p>
      </div>

      {error && <StatusNote tone="problem">{error}</StatusNote>}

      {requireVerdict ? (
        // §5.5.3: verdict is an explicit click, never auto-derived — two
        // dedicated buttons, no generic "Saqlash" that could read as neutral.
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button type="button" variant="success" size="lg" className="flex-1" disabled={submitting} onClick={() => submit('o_tdi')}>
              {submitting ? '…' : "O'tdi"}
            </Button>
            <Button type="button" variant="danger" size="lg" className="flex-1" disabled={submitting} onClick={() => submit('qayta_yuvish')}>
              {submitting ? '…' : 'Qayta yuvish'}
            </Button>
          </div>
          <Button type="button" variant="ghost" size="md" fullWidth onClick={onCancel}>
            Bekor qilish
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Button type="submit" variant="primary" size="lg" fullWidth disabled={submitting}>
            {submitting ? 'Saqlanmoqda…' : 'Saqlash · sera keyin kiritiladi'}
          </Button>
          <Button type="button" variant="ghost" size="md" fullWidth onClick={onCancel}>
            Bekor qilish
          </Button>
        </div>
      )}
    </form>
  )
}
