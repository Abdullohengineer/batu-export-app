import { useState, type FormEvent } from 'react'
import { PhotoField } from '../../components/PhotoField'
import type { AwaitingLine } from '../../lib/useLaboratorKirim'
import { Button } from '../../components/ui/Button'
import { FormField, TextInput } from '../../components/ui/FormField'
import { StatusNote } from '../../components/ui/StatusNote'
import { StatusPill } from '../../components/ui/StatusPill'

export interface TahlilValues {
  sampleDate: string
  moisturePct: number
  photoFile: File | null
  note: string
}

// §5.5.2 KIRIM Tahlil form: sana · Namligi % · optional photo · optional
// note. No SO2 field here regardless of whether the line has a sulfur
// target — SO2 is a separate later capture (Sera kiritish, W2), never
// entered at Tahlil time even for sulfured products (the ~1-day lab wait is
// real, SPEC.md §5.5.1). Whether this line's target exists at all only
// decides what happens to the row AFTER save (moves to W2 vs. straight to
// W3) — decided by the caller, not this form.
//
// nav/visual-redesign pass (mockup "BATU-Laborator-Screens-v2.pdf" p2):
// `line`/`ownerName`/`typeName` are new — the kv context block and the
// greyed target-moisture reference (SPEC §5.5.2: "displayed here for
// reference only, greyed, with no pass/fail treatment" — deliberately no
// comparison/warning logic, unlike ChiqimTahlilForm's soft-warn) both read
// from data the parent tab already fetches in full; no new query.
export function KirimTahlilForm({
  line,
  ownerName,
  typeName,
  onCancel,
  onSubmit,
}: {
  line: AwaitingLine
  ownerName: string
  typeName: string
  onCancel: () => void
  onSubmit: (values: TahlilValues) => Promise<void>
}) {
  const [sampleDate, setSampleDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [moisture, setMoisture] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSulfured = line.target_so2_mg_kg !== null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const moisturePct = parseFloat(moisture)
    if (!moisturePct && moisturePct !== 0) {
      setError('Namligi % ni kiriting.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({ sampleDate, moisturePct, photoFile, note: note.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-4 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900"
    >
      <div>
        <StatusPill tone="info">LABORATOR · KIRIM TAHLILI</StatusPill>
        <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">Namuna tahlili</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">Bitta palletdan namuna — natija butun seriyaga tegishli</p>
      </div>

      <div className="space-y-1.5 rounded-md bg-slate-100 p-3 dark:bg-slate-800/60">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Seriya (#1)</span>
          <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{line.serial}</span>
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
          <span className="text-slate-500 dark:text-slate-400">Massa</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">{line.actual_qty.toLocaleString()} kg</span>
        </div>
      </div>

      <FormField label="Tahlil sanasi">
        <TextInput type="date" required value={sampleDate} onChange={(e) => setSampleDate(e.target.value)} />
      </FormField>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Namligi %{' '}
          <span className="font-normal text-slate-400 dark:text-slate-500">
            (Talab: {line.target_moisture_pct !== null ? `${line.target_moisture_pct}%` : "Talab yo'q"})
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
          Bu natija <strong>{line.serial}</strong> seriyasiga yoziladi — moykadan chiqadigan barcha kalibrlar (K4, K6,
          K8, Konditirskiy) shu seriyaning namligi va serasini meros qilib oladi. Har bir kalibrni alohida tahlil
          qilish shart emas.
        </p>
      </div>

      {error && <StatusNote tone="problem">{error}</StatusNote>}

      <div className="space-y-2">
        <Button type="submit" variant="primary" size="lg" fullWidth disabled={submitting}>
          {submitting ? 'Saqlanmoqda…' : isSulfured ? 'Saqlash · sera keyin kiritiladi' : 'Saqlash'}
        </Button>
        <Button type="button" variant="ghost" size="md" fullWidth onClick={onCancel}>
          Bekor qilish
        </Button>
      </div>
    </form>
  )
}
