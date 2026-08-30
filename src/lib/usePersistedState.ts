import { useState } from 'react'

// Filter persistence (Prompt 3, 2026-08-30 — see DECISIONS.md "Filter
// persistence across tab switches"). Every affected screen (HisobotTab,
// OmborHisobotlar, StockOnHandTab, ClientReportTab, RahbarHome) is mounted
// as a sibling <Route> element under a role layout's <Outlet/> — switching
// tabs is a route change, which unmounts the previous screen's component
// tree and destroys its useState. This is a drop-in useState replacement
// backed by a module-scope Map instead of React's per-instance fiber state,
// so the value outlives any single mount and is still there when the same
// screen (same key) mounts again later in the session. Explicitly in-memory
// only, per the user's own choice — NOT sessionStorage/localStorage: a full
// page reload re-executes this module and clears the store, same as any
// other in-memory app state.
const store = new Map<string, unknown>()

export function usePersistedState<T>(key: string, initialValue: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    if (store.has(key)) return store.get(key) as T
    const value = typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue
    store.set(key, value)
    return value
  })

  function setPersisted(value: T | ((prev: T) => T)) {
    setState((prev) => {
      const next = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value
      store.set(key, next)
      return next
    })
  }

  return [state, setPersisted]
}
