import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { run } from './rpc'
import { queryClient, queryKeys } from './queryClient'

// "Qo'shimcha hujjatlar" (docs/decisions/0243, migration 0161) -- any number
// of extra document photos per KIRIM order, beside (never replacing) the
// single nakladnoy in kirim_orders.doc_photo. Same storage mechanism as that
// nakladnoy: private `kirim-photos` bucket, row holds the object key,
// compressImage() runs before upload (the caller's job, same as KirimForm).
// Objects live under `qoshimcha/<order_id>/` -- the only prefix the
// kirim_photos_qoshimcha_delete storage policy lets Menejer remove, so a
// nakladnoy object can never be deleted through this path.
//
// Deliberately NOT gated on gate_weighings: Tahrirlash's lock (menejer_edits,
// 0038) is about date/plate/driver; documents attach to any load however old.
// Replace and delete are allowed (decided: attachments, not accounting
// records) and each is written to audit_log, same pattern as Tahrirlash.

export const KIRIM_PHOTOS_BUCKET = 'kirim-photos'

export interface KirimOrderDocument {
  id: string
  orderId: string
  photoPath: string
  uploadedAt: string
  replacedAt: string | null
}

interface DocumentRow {
  id: string
  order_id: string
  photo_path: string
  uploaded_at: string
  replaced_at: string | null
}

function toDocument(r: DocumentRow): KirimOrderDocument {
  return { id: r.id, orderId: r.order_id, photoPath: r.photo_path, uploadedAt: r.uploaded_at, replacedAt: r.replaced_at }
}

// Oldest first: attachment order is the order they were added in, so a
// replaced photo keeps its position (append-style list, not a history list
// -- the universal newest-first sort rule doesn't apply here).
export function useKirimOrderDocuments(orderId: string | null, enabled = true) {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.kirimOrderDocuments(orderId ?? ''),
    enabled: enabled && !!orderId,
    queryFn: async ({ signal }) => {
      const rows = await run(
        supabase
          .from('kirim_order_documents')
          .select('id, order_id, photo_path, uploaded_at, replaced_at')
          .eq('order_id', orderId as string)
          .order('uploaded_at', { ascending: true })
          .abortSignal(signal),
      )
      return ((rows as DocumentRow[] | null) ?? []).map(toDocument)
    },
  })
  return { documents: data ?? [], loading: enabled && !!orderId && isPending, error: error ? error.message : null }
}

function newPath(orderId: string): string {
  return `qoshimcha/${orderId}/${crypto.randomUUID()}.jpg`
}

async function uploadObject(path: string, file: File): Promise<void> {
  const { error } = await supabase.storage.from(KIRIM_PHOTOS_BUCKET).upload(path, file)
  if (error) throw new Error(error.message)
}

// Best-effort: the row change is what the app reads, so a failed object
// removal leaves an unreferenced file behind, never a broken document.
async function removeObject(path: string): Promise<void> {
  const { error } = await supabase.storage.from(KIRIM_PHOTOS_BUCKET).remove([path])
  if (error) console.error('kirimOrderDocuments: storage remove failed', path, error)
}

// RLS turns a forbidden UPDATE/DELETE into "0 rows affected", not an error --
// returning the touched ids makes that a visible failure instead of a silent
// no-op.
function requireOneRow(rows: unknown): void {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Hujjat topilmadi yoki ruxsat yo'q.")
}

function invalidate(orderId: string): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.kirimOrderDocuments(orderId) })
}

export async function addKirimOrderDocument(orderId: string, file: File, actorId: string | undefined): Promise<void> {
  const path = newPath(orderId)
  await uploadObject(path, file)
  try {
    await run(
      supabase.from('kirim_order_documents').insert({ order_id: orderId, photo_path: path, uploaded_by: actorId }),
    )
  } catch (err) {
    await removeObject(path)
    throw err
  }
  invalidate(orderId)
}

export async function replaceKirimOrderDocument(
  doc: KirimOrderDocument,
  file: File,
  actorId: string | undefined,
): Promise<void> {
  const path = newPath(doc.orderId)
  await uploadObject(path, file)
  try {
    requireOneRow(
      await run(
        supabase
          .from('kirim_order_documents')
          .update({ photo_path: path, replaced_at: new Date().toISOString() })
          .eq('id', doc.id)
          .select('id'),
      ),
    )
  } catch (err) {
    await removeObject(path)
    throw err
  }
  await run(
    supabase.from('audit_log').insert({
      table_name: 'kirim_order_documents',
      row_id: doc.id,
      actor: actorId,
      action: 'replace',
      before: { photo_path: doc.photoPath },
      after: { photo_path: path },
    }),
  )
  await removeObject(doc.photoPath)
  invalidate(doc.orderId)
}

export async function deleteKirimOrderDocument(doc: KirimOrderDocument, actorId: string | undefined): Promise<void> {
  requireOneRow(await run(supabase.from('kirim_order_documents').delete().eq('id', doc.id).select('id')))
  await run(
    supabase.from('audit_log').insert({
      table_name: 'kirim_order_documents',
      row_id: doc.id,
      actor: actorId,
      action: 'delete',
      before: { order_id: doc.orderId, photo_path: doc.photoPath },
      after: null,
    }),
  )
  await removeObject(doc.photoPath)
  invalidate(doc.orderId)
}
