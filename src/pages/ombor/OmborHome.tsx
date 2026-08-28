import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { RoleShell } from '../../components/RoleShell'
import { OmborIconNav, type OmborNavItem } from './OmborIconNav'
import { KirimIcon, ChiqimIcon, MoykaIcon, TayyorIcon, HisobotlarIcon } from './omborNavIcons'
import { useIntakeLines } from '../../lib/useIntakeLines'
import { useMoykaSerials } from '../../lib/useMoykaSerials'
import { useMoykaOutput } from '../../lib/useMoykaOutput'
import { useOmborChiqimRequests } from '../../lib/useOmborChiqimRequests'
import { hasRawRemainder } from '../../lib/stageMembership'

const SECTIONS = [
  { to: '/ombor', label: 'Skladga KIRIM', end: true },
  { to: '/ombor/moyka', label: 'Moykaga Chiqarish', end: false },
  { to: '/ombor/tayyor', label: 'Tayyor Mahsulot', end: false },
  { to: '/ombor/chiqim', label: 'Skladdan CHIQIM', end: false },
  { to: '/ombor/hisobotlar', label: 'Hisobotlar', end: false },
] as const

// Layout for Ombor's screens: bottom icon bar (2026-08-15 — replaced the
// horizontally-scrolling RoleTabs bar; see DECISIONS.md "Ombor bottom icon
// nav" and OmborIconNav.tsx) + the active tab via <Outlet/>. Adding a future
// tab is one more SECTIONS entry + icon + one nested <Route> in App.tsx — no
// restructure.
export function OmborHome() {
  const location = useLocation()

  // Badge counts (2026-08-15) — each reuses the SAME hook + filter its own
  // section already uses for its own list (useIntakeLines/useMoykaSerials/
  // useMoykaOutput/useOmborChiqimRequests, hasRawRemainder from
  // stageMembership.ts): no new query, per this task's explicit constraint.
  // Tradeoff, stated in DECISIONS.md: these 4 hooks now run here in the nav
  // shell IN ADDITION TO whichever one the active section's own tab
  // component separately mounts for itself — the only way to badge every
  // tab (including the 3 the operator isn't currently looking at) without
  // touching any section's internals ("Section content and behaviour
  // unchanged" is this task's own requirement).
  const { lines: intakeLines, refresh: refreshIntake } = useIntakeLines()
  const { serials: moykaSerials, refresh: refreshMoykaSerials } = useMoykaSerials()
  const { serials: inMoyka, refresh: refreshMoykaOutput } = useMoykaOutput()
  const { open: openChiqim, refresh: refreshChiqim } = useOmborChiqimRequests()

  // None of these 4 hooks re-fetch on their own after mount (no realtime
  // subscription, confirmed reading each one) — and OmborHome itself never
  // remounts as the operator moves between tabs (same layout route, only
  // the <Outlet/> child swaps). Without this, a badge would go stale the
  // moment an action changes its section's own count until a full page
  // reload. Re-running each section's existing refresh() on every
  // navigation is the natural, cheap moment to catch up — not a new query,
  // not a poll.
  const hasMountedRef = useRef(false)
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }
    refreshIntake()
    refreshMoykaSerials()
    refreshMoykaOutput()
    refreshChiqim()
    // Intentionally keyed on the route only — the refresh callbacks are
    // stable (useCallback with an empty dep array in each hook).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // Periodic refresh (2026-08-15) — the effect above only catches up when
  // the operator switches tabs. Someone who stays on one screen the whole
  // time (e.g. camped on Skladga KIRIM at the scale) would otherwise see
  // the other three sections' badge counts quietly drift wrong for as long
  // as they stay put — a badge that lies is worse than no badge. Same 4
  // refresh() calls as above, just time-triggered instead of
  // route-triggered; 60s (the "lightest" end of the requested 30-60s
  // window) since a badge is an ambient heads-up, not a real-time counter.
  // Mount-once interval, not tied to location, so it keeps running
  // regardless of which section is active.
  useEffect(() => {
    const id = setInterval(() => {
      refreshIntake()
      refreshMoykaSerials()
      refreshMoykaOutput()
      refreshChiqim()
    }, 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // "Items waiting" per section = that section's own Window 1 (the queue
  // Ombor still has to act on), same predicate its tab already renders:
  // OmborIntakeTab.tsx's `!l.intake`, OmborMoykaTab.tsx's `hasRawRemainder`
  // toSend filter, useMoykaOutput's own pre-filtered `serials` (= Tayyor
  // Mahsulot's "chiqishi kutilmoqda" window), useOmborChiqimRequests' own
  // pre-filtered `open`. Hisobotlar has no queue concept (confirmed during
  // investigation) — no `count`, so OmborIconNav renders no badge there.
  // Nav-bar labels are one word each (2026-08-15) — the full section name
  // (SECTIONS' own `label`, below) already shows in the header; the nav
  // bar's job is thumb-sized icons in a single row, and vertical space is
  // the scarcest thing on a phone held by someone standing at a scale.
  // Two-word labels wrapped to a second line here before this change,
  // making the whole bar taller for no benefit. See DECISIONS.md "Ombor
  // bottom icon nav: one-word labels + periodic badge refresh."
  const items: OmborNavItem[] = [
    {
      to: '/ombor',
      label: 'KIRIM',
      end: true,
      icon: <KirimIcon />,
      tone: 'kirim',
      count: intakeLines.filter((l) => !l.intake).length,
    },
    {
      to: '/ombor/moyka',
      label: 'Moykaga',
      icon: <MoykaIcon />,
      tone: 'moyka',
      count: moykaSerials.filter((s) => hasRawRemainder(s.inputKg, s.sent)).length,
    },
    {
      to: '/ombor/tayyor',
      label: 'Tayyor',
      icon: <TayyorIcon />,
      tone: 'moyka',
      count: inMoyka.length,
    },
    {
      to: '/ombor/chiqim',
      label: 'CHIQIM',
      icon: <ChiqimIcon />,
      tone: 'chiqim',
      count: openChiqim.length,
    },
    {
      to: '/ombor/hisobotlar',
      label: 'Hisobot',
      icon: <HisobotlarIcon />,
      tone: 'neutral',
    },
  ]

  const activeSection =
    SECTIONS.find((s) => (s.end ? location.pathname === s.to : location.pathname.startsWith(s.to))) ?? SECTIONS[0]

  return (
    <RoleShell title={activeSection.label}>
      <div className="max-w-3xl pb-24">
        <Outlet />
      </div>
      <OmborIconNav items={items} />
    </RoleShell>
  )
}
