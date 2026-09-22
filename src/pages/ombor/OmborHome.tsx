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
  // stageMembership.ts).
  //
  // 2026-09-21 (Phase 2 step 2) — these 4 hooks moved onto React Query
  // (see each hook's own header comment), keyed with no params, so this
  // mount and the active section's own tab component mounting the SAME
  // hook now share ONE cached query instead of firing two separate
  // requests for the same data — confirmed via the network tab: /ombor
  // fires each RPC once, not twice, whichever section is active. That also
  // replaces the two mechanisms this component used to hand-roll to keep
  // badges fresh: a route-change effect (a section's own refresh() now
  // updates the shared cache directly, so THIS mount just re-renders off
  // it, no separate call needed) and a raw 60s setInterval that fired
  // regardless of tab visibility. Both are gone — periodic refresh is now
  // each hook's own `refetchInterval: 60_000` /
  // `refetchIntervalInBackground: false`, which only polls while a tab
  // using that hook is actually visible.
  const { lines: intakeLines } = useIntakeLines()
  const { serials: moykaSerials } = useMoykaSerials()
  const { serials: inMoyka } = useMoykaOutput()
  const { open: openChiqim } = useOmborChiqimRequests()

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
