import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// SPEC §2.14: configurable exception thresholds, editable in Administration.
export function useSettingsLimits() {
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const { data } = await supabase.from('settings_limits').select('key, value')
        const map: Record<string, number> = {}
        for (const row of data ?? []) map[row.key] = row.value
        setLimits(map)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  return { limits, loading }
}
