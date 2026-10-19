import { useState } from 'react'
import { useAuth } from '../../lib/AuthProvider'
import { compressImage, formatBytes } from '../../lib/imageCompress'
import {
  KIRIM_PHOTOS_BUCKET,
  addKirimOrderDocument,
  deleteKirimOrderDocument,
  replaceKirimOrderDocument,
  useKirimOrderDocuments,
  type KirimOrderDocument,
} from '../../lib/kirimOrderDocuments'
import { GatePhoto } from '../../components/GatePhoto'
import { Lightbox } from '../../components/Lightbox'
import { Button } from '../../components/ui/Button'
import { StatusNote } from '../../components/ui/StatusNote'

// "Qo'shimcha hujjatlar" (docs/decisions/0243) -- Menejer's add/replace/
// delete panel for one KIRIM order's extra document photos. Its own control,
// separate from Tahrirlash: NOT hidden once the order reaches the gate.
//
// Compression is the nakladnoy's own (KirimForm.tsx handlePhotoChange):
// compressImage() first; on a compression failure the original file is kept
// and the user is told -- same fallback that form has, not a new policy.
async function prepare(file: File): Promise<{ file: File; note: string | null; failed: boolean }> {
  try {
    const { blob, originalSize, compressedSize } = await compressImage(file)
    return {
      file: new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }),
      note: `${formatBytes(originalSize)} → ${formatBytes(compressedSize)}`,
      failed: false,
    }
  } catch (err) {
    console.error('KirimOrderDocumentsPanel: compressImage failed', err)
    return { file, note: null, failed: true }
  }
}

const COMPRESS_FAILED = "Rasmni siqishda xatolik yuz berdi — asl fayl yuklandi."

// A <label> wrapping a hidden file input: opens the phone's camera/gallery
// picker directly, styled like the secondary Button.
function FilePickButton({
  label,
  disabled,
  multiple,
  onFiles,
}: {
  label: string
  disabled: boolean
  multiple?: boolean
  onFiles: (files: File[]) => void
}) {
  return (
    <label
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 ${
        disabled ? 'pointer-events-none opacity-50' : ''
      }`}
    >
      {label}
      <input
        type="file"
        accept="image/*"
        multiple={multiple}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length > 0) onFiles(files)
        }}
      />
    </label>
  )
}

export function KirimOrderDocumentsPanel({ orderId }: { orderId: string }) {
  const { profile } = useAuth()
  const { documents, loading, error } = useKirimOrderDocuments(orderId)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null)

  async function withBusy(key: string, fn: () => Promise<string[]>) {
    setBusy(key)
    setActionError(null)
    setNotes([])
    try {
      setNotes(await fn())
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setBusy(null)
    }
  }

  function handleAdd(files: File[]) {
    withBusy('add', async () => {
      const out: string[] = []
      for (const raw of files) {
        const { file, note, failed } = await prepare(raw)
        await addKirimOrderDocument(orderId, file, profile?.id)
        out.push(failed ? COMPRESS_FAILED : note ?? '')
      }
      return out.filter(Boolean)
    })
  }

  function handleReplace(doc: KirimOrderDocument, raw: File) {
    withBusy(doc.id, async () => {
      const { file, note, failed } = await prepare(raw)
      await replaceKirimOrderDocument(doc, file, profile?.id)
      return [failed ? COMPRESS_FAILED : note ?? ''].filter(Boolean)
    })
  }

  function handleDelete(doc: KirimOrderDocument) {
    setConfirmDeleteId(null)
    withBusy(doc.id, async () => {
      await deleteKirimOrderDocument(doc, profile?.id)
      return []
    })
  }

  return (
    <div className="space-y-2" data-testid="kirim-order-documents">
      {loading && <p className="text-xs text-slate-400">Yuklanmoqda…</p>}
      {error && <StatusNote tone="problem">{error}</StatusNote>}
      {!loading && !error && documents.length === 0 && (
        <p className="text-xs text-slate-400">Hali qo'shimcha hujjat yo'q.</p>
      )}

      {documents.length > 0 && (
        <ul className="space-y-2">
          {documents.map((doc, i) => (
            <li key={doc.id} className="flex flex-wrap items-center gap-2">
              <GatePhoto
                path={doc.photoPath}
                label={`Hujjat ${i + 1}`}
                bucket={KIRIM_PHOTOS_BUCKET}
                thumbnail
                onOpen={(url, label) => setLightbox({ url, label })}
              />
              <span className="min-w-0 flex-1 text-xs text-slate-500 dark:text-slate-400">Hujjat {i + 1}</span>
              {confirmDeleteId === doc.id ? (
                <>
                  <Button variant="danger" size="md" disabled={busy !== null} onClick={() => handleDelete(doc)}>
                    Ha, o'chirish
                  </Button>
                  <Button variant="ghost" size="md" onClick={() => setConfirmDeleteId(null)}>
                    Bekor qilish
                  </Button>
                </>
              ) : (
                <>
                  <FilePickButton
                    label={busy === doc.id ? 'Saqlanmoqda…' : 'Almashtirish'}
                    disabled={busy !== null}
                    onFiles={(files) => handleReplace(doc, files[0])}
                  />
                  <Button variant="ghost" size="md" disabled={busy !== null} onClick={() => setConfirmDeleteId(doc.id)}>
                    O'chirish
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <FilePickButton
        label={busy === 'add' ? 'Yuklanmoqda…' : "+ Hujjat qo'shish"}
        disabled={busy !== null}
        multiple
        onFiles={handleAdd}
      />

      {notes.map((n, i) => (
        <p key={i} className="text-xs text-slate-500 dark:text-slate-400">
          {n}
        </p>
      ))}
      {actionError && <StatusNote tone="problem">{actionError}</StatusNote>}

      {lightbox && <Lightbox url={lightbox.url} label={lightbox.label} onClose={() => setLightbox(null)} />}
    </div>
  )
}
