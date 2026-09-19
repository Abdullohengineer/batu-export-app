import { useEffect, useState } from 'react'

// Shared filter debounce (2026-09-19, Phase 1B). Hisobot already debounced
// its own filter changes inside useReportQuery (FILTER_DEBOUNCE_MS there);
// this is the same 300ms idea extracted for the screens that had none —
// client Расход and Производство re-fired their RPC on every single filter
// object change, including each keystroke/date-picker tick.
export const FILTER_DEBOUNCE_MS = 300

export function useDebouncedValue<T>(value: T, delayMs: number = FILTER_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  return debounced
}
