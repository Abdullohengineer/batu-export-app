import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthProvider'

// FIRST implementation of the append-only Qaydlar/notes pattern (SPEC §2.5).
// The `notes` table (0005) + its RLS (0007: INSERT + SELECT policies, NO
// update/delete for anyone) has existed since Phase 0 but was unused in the
// UI until now. Reusable for any entity: pass an entity_type + entity_id.
export interface Note {
  id: string
  author: string | null
  body: string
  created_at: string
}

export function useNotes(entityType: string, entityId: string) {
  const { profile } = useAuth()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('notes')
        .select('id, author, body, created_at')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .order('created_at', { ascending: true })
      setNotes(data ?? [])
    } finally {
      setLoading(false)
    }
  }, [entityType, entityId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Insert-only. There is deliberately no editNote/deleteNote — append-only
  // is enforced at the DB (no update/delete RLS policy), and the UI matches.
  const addNote = useCallback(
    async (body: string) => {
      const trimmed = body.trim()
      if (!trimmed) return
      const { error } = await supabase.from('notes').insert({
        entity_type: entityType,
        entity_id: entityId,
        author: profile?.id,
        body: trimmed,
      })
      if (error) throw error
      await refresh()
    },
    [entityType, entityId, profile?.id, refresh],
  )

  return { notes, loading, addNote, refresh }
}
