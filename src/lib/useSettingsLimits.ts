import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// SPEC §2.14: configurable exception thresholds, editable in Administration
// (§3.3, Rahbar-only). practical_capacity_kg_per_month is the one key that
// can genuinely be null (unset) — every consumer must treat null the same
// as "not configured", never as 0.
export function useSettingsLimits() {
  const [limits, setLimits] = useState<Record<string, number | null>>({})
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase.from('settings_limits').select('key, value')
      const map: Record<string, number | null> = {}
      for (const row of data ?? []) map[row.key] = row.value
      setLimits(map)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { limits, loading, refetch }
}
