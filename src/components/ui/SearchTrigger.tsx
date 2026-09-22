import type { ReactNode } from 'react'
import { Button } from './Button'

// The Qidirish control that goes with useSearchTrigger (2026-09-22, see
// docs/decisions/0218). One component so all five surfaces that use it —
// Hisobot, the three client report tabs, and the Rahbar ledger period picker
// — say the same thing in the same words, rather than five near-copies.
export const FILTERS_CHANGED_HINT = "Filtrlar o'zgardi — Qidirish bosing"

// The client portal is a Russian-language surface (Период / Сбросить /
// Загрузка…, see clientLabels.ts) while Hisobot and the Rahbar dashboard are
// Uzbek. Same control, same behaviour, the screen's own language — dropping
// an Uzbek string into the client tabs would be the only Uzbek text there.
const COPY = {
  uz: { search: 'Qidirish', searching: 'Qidirilmoqda…', changed: FILTERS_CHANGED_HINT },
  ru: { search: 'Поиск', searching: 'Поиск…', changed: 'Фильтры изменены — нажмите «Поиск»' },
} as const

export interface SearchTriggerProps {
  /** From useSearchTrigger: draft differs from what is on screen. */
  isDirty: boolean
  /** True while the query is in flight. */
  loading: boolean
  onSearch: () => void
  /** Screen language. Defaults to Uzbek (Hisobot, Rahbar). */
  lang?: keyof typeof COPY
  children?: ReactNode
}

// The button is disabled while a search is in flight, so a second click
// cannot pile another statement onto the pool — that pile-up is the whole
// reason this control exists. Enter is deliberately NOT blocked (see
// useSearchTrigger's reloadToken): a user who presses Enter mid-flight gets
// the in-flight request aborted and re-run, which is a real intent to
// re-search rather than an accidental double-submit.
export function SearchTrigger({ isDirty, loading, onSearch, lang = 'uz', children }: SearchTriggerProps) {
  const copy = COPY[lang]
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" onClick={onSearch} disabled={loading} aria-keyshortcuts="Enter">
        {loading ? copy.searching : copy.search}
      </Button>
      {isDirty && !loading && (
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400" role="status">
          {copy.changed}
        </p>
      )}
      {children}
    </div>
  )
}

// Wraps the results while the on-screen filters no longer match what produced
// them. Deliberately dimmed rather than hidden or replaced with a spinner:
// the numbers on screen are still REAL numbers from a real query, and
// blanking them would repeat the exact failure Phase 1 fixed, where a
// superseded request rendered as a fabricated empty result. `aria-busy` tells
// a screen reader the content is stale without removing it.
export function StaleResults({ stale, children }: { stale: boolean; children: ReactNode }) {
  return (
    <div className={stale ? 'opacity-50 transition-opacity' : 'transition-opacity'} aria-busy={stale}>
      {children}
    </div>
  )
}
