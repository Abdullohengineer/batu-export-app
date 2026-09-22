import { useCallback, useRef, useState } from 'react'

// Explicit-search trigger (2026-09-22, see docs/decisions/0218).
//
// THE RULE THIS ENFORCES: a screen with 2+ filter inputs over a query that
// costs more than ~300ms gets an explicit Qidirish button, not live filtering.
// Debounce alone does not fix it — a debounced request that has already FIRED
// keeps running on the database even after the browser aborts the HTTP call,
// because aborting an HTTP request does not cancel the statement behind it.
// Six rapid filter changes therefore left up to six real ~2s statements
// competing for PostgREST's 10-connection pool, and the next request queued
// until it died on statement_timeout. An explicit trigger means one request
// per intent, not one per keystroke.
//
// Deliberately NOT applied to dashboards or the Ombor/Qorovul/Laborator work
// tabs: those are single-purpose, cheap, and operators expect them live.
//
// Shape: the caller keeps its existing filter state exactly as it is — that
// becomes the DRAFT, edited freely with no fetching. `applied` is what the
// data hook reads, and only moves when search() is called.
export interface SearchTrigger<T> {
  /** The committed filters. Feed THIS to the data hook, never the draft. */
  applied: T
  /**
   * Bumped on every search(), including one that commits identical filters.
   * Thread it into the data hook's key so pressing Enter mid-flight aborts
   * the in-flight request and re-runs, rather than being a no-op because the
   * filters happen to compare equal.
   */
  reloadToken: number
  /** Draft differs from applied — show the "filters changed" hint. */
  isDirty: boolean
  search: () => void
}

export function useSearchTrigger<T>(draft: T): SearchTrigger<T> {
  // Seeded FROM the draft, so the first render already has the screen's
  // default filters applied and the initial load happens without the user
  // having to press Qidirish to see anything.
  const [applied, setApplied] = useState<T>(draft)
  const [reloadToken, setReloadToken] = useState(0)

  // Ref, not a dependency: search() must stay referentially stable (it is
  // passed to a memoised button and to an onKeyDown handler) while still
  // committing the LATEST draft rather than the one captured at mount.
  const draftRef = useRef(draft)
  draftRef.current = draft

  const search = useCallback(() => {
    setApplied(draftRef.current)
    setReloadToken((t) => t + 1)
  }, [])

  return {
    applied,
    reloadToken,
    isDirty: JSON.stringify(draft) !== JSON.stringify(applied),
    search,
  }
}
