import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { ClientReport } from './clientReport'

// §3.2.7 -- thin client over get_client_report, one RPC round trip returning
// the whole nested document (same shape convention as get_serial_passport).
export function useClientReport(ownerId: string | null, from: string, to: string) {
  const [report, setReport] = useState<ClientReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ownerId) {
      setReport(null)
      setError(null)
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data, error: rpcError } = await supabase.rpc('get_client_report', {
          p_owner_id: ownerId,
          p_from: from,
          p_to: to,
        })
        if (rpcError) throw rpcError
        if (!cancelled) setReport(data as ClientReport)
      } catch (err) {
        if (!cancelled) {
          setReport(null)
          setError(err instanceof Error ? err.message : 'Hisobotni yuklashda xatolik yuz berdi.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [ownerId, from, to])

  return { report, loading, error }
}
