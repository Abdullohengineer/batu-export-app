import { createContext, useCallback, useContext, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

// Filter persistence across tab switches (2026-08-30, see DECISIONS.md
// "Filter persistence").
//
// The problem, precisely: every role's tabs are react-router <Route> elements
// navigated by NavLink (RoleTabs.tsx / App.tsx), so switching tabs UNMOUNTS the
// route component. Filter state lived in plain useState inside those
// components, so it was destroyed on the way out and re-initialised from
// defaults on the way back. Not a refetching hook and not stale state — pure
// unmount. One cause, so one mechanism fixes all nine affected screens.
//
// 🔒 Deliberately NOT localStorage/sessionStorage. This store lives in a
// provider mounted ABOVE the routes, so it outlives any tab switch and dies on
// page reload — which is the intended scope. Reload persistence is a larger,
// separate ask nobody has made, and storage would carry a real hazard: a date
// range saved days ago silently re-applying, with the user reading stale
// results and no indication why. Chosen explicitly over that.
//
// Values are held by reference in a ref'd Map — no serialization — so a Set
// (Hisobot's column picker) or a Date round-trips as itself.
type Store = Map<string, unknown>

const FilterStateContext = createContext<Store | null>(null)

export function FilterStateProvider({ children }: { children: ReactNode }) {
  // useRef, not useState: writing a filter must not re-render the provider (and
  // with it every route below it). Each consumer keeps its own useState mirror
  // and re-renders itself; the map is only the hand-off across unmounts.
  const store = useRef<Store>(new Map())
  return <FilterStateContext.Provider value={store.current}>{children}</FilterStateContext.Provider>
}

// Drop-in replacement for useState, keyed by a stable string. Same signature,
// same lazy-initialiser support, so converting a screen is a one-line change
// per piece of state and nothing else about the component moves.
//
// Falls back to plain component state when no provider is mounted, so a screen
// rendered in isolation (a test, a modal preview) still works.
export function usePersistentState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const store = useContext(FilterStateContext)

  const [value, setValue] = useState<T>(() => {
    if (store?.has(key)) return store.get(key) as T
    return typeof initial === 'function' ? (initial as () => T)() : initial
  })

  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        // Write through on every change, not on unmount: an unmount-time flush
        // would need an effect whose cleanup captures the latest value, which
        // is exactly the stale-closure bug this avoids having.
        store?.set(key, resolved)
        return resolved
      })
    },
    [key, store],
  )

  return [value, set]
}
