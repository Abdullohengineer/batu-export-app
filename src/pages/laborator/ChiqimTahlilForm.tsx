import { useState, type FormEvent } from 'react'
import { PhotoField } from '../../components/PhotoField'
import type { AwaitingSerial } from '../../lib/useLaboratorChiqim'
import { formatDate } from '../../lib/formatDate'
import { sulfurChoiceFromFlag, type SulfurChoice } from '../../lib/classifySulfur'
import { Button } from '../../components/ui/Button'
import { FormField, TextInput } from '../../components/ui/FormField'
import { StatusNote } from '../../components/ui/StatusNote'
import { StatusPill } from '../../components/ui/StatusPill'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'

export interface ChiqimTahlilValues {
  sampleDate: string
  sampledPallet: string
  moisturePct: number
  isSulfured: boolean
  photoFile: File | null
  note: string
  verdict: 'o_tdi' | 'qayta_yuvish' | null
}

// §5.5.3 CHIQIM Tahlil form.
//
// `requireVerdict` (derived internally from the live classification below,
// not a prop -- 2026-08-15) controls whether this save is also the FINAL
// save for this line: a natural product has nothing left to capture after
// moisture, so its verdict happens right here; a sulfured product's verdict
// happens later, in the Sera kiritish step, once SO2 is in. No SO2 field on
// this form either way — SO2 is only ever entered via Sera kiritish,
// matching the KIRIM form's identical choice (see DECISIONS.md).
//
// Classification moved here from Menejer's form, same reasoning and same
// fail-safe as KirimTahlilForm.tsx -- see DECISIONS.md "Natural/sulphured
// classification moved from Menejer to Laborator; audit trail". This is
// also the form that reaches CHIQIM-first serials with zero KIRIM history
// (opening-stock re-wash, `kirim_orders.origin = 'internal_reprocess'` --
// architecturally excluded from ever reaching KirimTahlilForm at all, see
// that DECISIONS.md entry) -- for those, this IS the only chance the lab
// ever gets to classify the line, which is why `requireVerdict` can no
// longer be computed by the caller before this form even mounts: the lab
// may change the classification WHILE filling this out, and the verdict-vs-
// defer branch below must react to that live, not to a stale snapshot.
//
// Laborator v2 (2026-07-28 — see DECISIONS.md "Lab moves inside Moyka,
// wash-cycle concept removed"): testing now happens BEFORE any pallet
// exists (the hard gate moved to packing), so there is no real pallet to
// sample from anymore. "Namuna olingan pallet" (a required dropdown of
// existing Barcode #2s) is now "Namuna manbai" — an optional free-text
// field (e.g. a tank/lot label) rather than a reference to a real row.
export function ChiqimTahlilForm({
  item,
  ownerName,
  typeName,
  onCancel,
  onSubmit,
}: {
  item: AwaitingSerial
  ownerName: string
  typeName: string
  onCancel: () => void
  onSubmit: (values: ChiqimTahlilValues) => Promise<void>
}) {
  const [sampleDate, setSampleDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [sampledPallet, setSampledPallet] = useState('')
  const [moisture, setMoisture] = useState('')
  const [classification, setClassification] = useState<SulfurChoice>(sulfurChoiceFromFlag(item.is_sulfured))
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const moisturePct = parseFloat(moisture)
  // `!== 'false'`, not `=== 'true'` -- see KirimTahlilForm.tsx's identical
  // comment. An unresolved '' selection must still read as sulfured.
  const isSulfured = classification !== 'false'
  const requireVerdict = classification === 'false'

  async function submit(verdict: 'o_tdi' | 'qayta_yuvish' | null) {
    setError(null)
    if (classification === '') {
      setError('Mahsulot turini tanlang.')
      return
    }
    if (isNaN(moisturePct)) {
      setError('Namligi % ni kiriting.')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit({
        sampleDate,
        sampledPallet: sampledPallet.trim(),
        moisturePct,
        isSulfured: classification === 'true',
        photoFile,
        note: note.trim(),
        verdict,
      })
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
        <p className="text-sm text-slate-500 dark:text-slate-400">Natija butun seriyaga tegishli</p>
      </div>

      <div className="space-y-1.5 rounded-md bg-slate-100 p-3 dark:bg-slate-800/60">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Seriya</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{item.serial}</span>
            <PartiyaBadge partiyaNo={item.partiyaNo} typeName={typeName} />
          </span>
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
          <span className="text-slate-500 dark:text-slate-400">Moykaga yuborilgan</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {item.sentKg.toLocaleString()} kg · {formatDate(item.sentDate)}
          </span>
        </div>
        {/* KIRIM-stage reading, inline (2026-08-29, Prompt 6) -- read-only,
            "—" (not "0") when this serial never had a KIRIM lab pass (e.g.
            an old-stock re-wash mint). */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Kirim natijasi</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {item.kirimMoisturePct !== null ? `${item.kirimMoisturePct}%` : '—'} · SO₂{' '}
            {item.kirimSo2MgKg !== null ? `${item.kirimSo2MgKg} ppm` : '—'}
          </span>
        </div>
      </div>

      {/* Classification, moved here from Menejer's form (2026-08-15) -- see
          KirimTahlilForm.tsx's identical block. Required. */}
      <FormField label="Mahsulot">
        <select
          required
          value={classification}
          onChange={(e) => setClassification(e.target.value as SulfurChoice)}
          className="w-full rounded-md border border-slate-300 px-3 text-base min-h-12 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="" disabled>
            Tanlang…
          </option>
          <option value="false">Naturel</option>
          <option value="true">Sulfatlangan</option>
        </select>
      </FormField>

      <FormField label="Namuna manbai (ixtiyoriy)">
        <TextInput
          type="text"
          placeholder="masalan: 3-tank"
          value={sampledPallet}
          onChange={(e) => setSampledPallet(e.target.value)}
        />
      </FormField>

      <FormField label="Tahlil sanasi">
        <TextInput type="date" required value={sampleDate} onChange={(e) => setSampleDate(e.target.value)} />
      </FormField>

      {/* No client target shown -- the lab enters and judges the reading
          itself; nothing here should anchor it before it's taken. See
          DECISIONS.md "Client quality targets removed from Menejer/
          Laborator; explicit natural/sulphured flag". Kept as a manual
          label + TextInput (not FormField) only to preserve the e2e suite's
          `label:text-is("Namligi %")` locator unchanged. */}
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Namligi %</label>
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
      </div>

      {isSulfured && (
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

      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
        <p className="text-sm font-medium text-blue-700 dark:text-blue-400">Natija qayerga tegishli</p>
        <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">
          Bu natija <strong>{item.serial}</strong> seriyaning butun moyka chiqishiga tegishli — namligi va serasini
          shu seriyadan chiqadigan barcha palletlar (K4, K6, K8, Konditerka) meros qilib oladi.{' '}
          <strong>O'tdi</strong> natijasisiz bu seriya uchun Barcode #2 chiqarib bo'lmaydi.
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
