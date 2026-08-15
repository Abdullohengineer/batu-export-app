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
  const { serials: awaitingTugallash, refresh: refreshMoykaOutput } = useMoykaOutput()
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

  // "Items waiting" per section = that section's own Window 1 (the queue
  // Ombor still has to act on), same predicate its tab already renders:
  // OmborIntakeTab.tsx's `!l.intake`, OmborMoykaTab.tsx's `hasRawRemainder`
  // toSend filter, useMoykaOutput's own pre-filtered `serials` (= Tayyor
  // Mahsulot's "chiqishi kutilmoqda" window), useOmborChiqimRequests' own
  // pre-filtered `open`. Hisobotlar has no queue concept (confirmed during
  // investigation) — no `count`, so OmborIconNav renders no badge there.
  const items: OmborNavItem[] = [
    {
      to: '/ombor',
      label: 'Skladga KIRIM',
      end: true,
      icon: <KirimIcon />,
      tone: 'kirim',
      count: intakeLines.filter((l) => !l.intake).length,
    },
    {
      to: '/ombor/moyka',
      label: 'Moykaga Chiqarish',
      icon: <MoykaIcon />,
      tone: 'moyka',
      count: moykaSerials.filter((s) => hasRawRemainder(s.inputKg, s.sent)).length,
    },
    {
      to: '/ombor/tayyor',
      label: 'Tayyor Mahsulot',
      icon: <TayyorIcon />,
      tone: 'moyka',
      count: awaitingTugallash.length,
    },
    {
      to: '/ombor/chiqim',
      label: 'Skladdan CHIQIM',
      icon: <ChiqimIcon />,
      tone: 'chiqim',
      count: openChiqim.length,
    },
    {
      to: '/ombor/hisobotlar',
      label: 'Hisobotlar',
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
