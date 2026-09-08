## 2026-08-15 — Ombor bottom icon nav
**Context:** replace Ombor's horizontally-scrolling top-tab bar with a bottom icon bar — one-handed
phone use on a factory floor, so every section is reachable with the primary hand's thumb and all
5 fit without horizontal scroll. Frontend/nav-shell only; no query changes; section content and
behaviour must stay untouched.

**`RoleTabs`/`RoleShell` are shared with Qorovul and Laborator** (confirmed via their own header
comments before touching either) — editing them in place would reach both other roles' nav, out
of scope by the task's own "no changes to any other role." Built a new, Ombor-local component
(`OmborIconNav.tsx`) instead. `RoleShell`'s `nav` prop already no-ops when omitted
(`{nav && <div>...}`), so `OmborHome.tsx` simply stops passing one — no `RoleShell` edit needed at
all. The active section's name goes in `RoleShell`'s existing `title` prop instead, computed from
`useLocation()` against the same 5 routes, mirroring `NavLink`'s own `end`-vs-prefix matching —
this fully replaces the previous static "Ombor menejeri" title, per the task's literal wording
("the active section's name shows as a header").

**No icon library exists in this app** (checked before writing any icon: no `lucide-react`/
`@heroicons/react`/`react-icons`/etc. in `package.json`, zero icon-package imports anywhere in
`src/`). Every existing small glyph is either a bare Unicode character or, in exactly one place
(`AppNavShell.tsx`'s hamburger/close), a hand-written inline SVG — matched that style: 24×24
viewBox, `stroke="currentColor"`, no fill, so each icon inherits its `NavLink`'s tone colour
automatically (`src/pages/ombor/omborNavIcons.tsx`).

**Colour mapping — reused this app's existing tone families, not new shades:**
- Skladga KIRIM (entering) — emerald, this app's existing `ok`-tone family.
- Skladdan CHIQIM (departing) — red, this app's existing `problem`-tone family, and the same
  colour `RahbarHome.tsx`'s own palette already assigns to `departed` ("material that left the
  factory" — confirmed live, that file's own comment reads "black, not red" for `loss`, i.e. the
  *only* thing red means there is departure, nothing else).
- Moykaga Chiqarish + Tayyor Mahsulot (both still inside the factory, pre-dispatch) — blue,
  this app's existing `info` tone. Matches the task's explicit reasoning: "nothing has left the
  factory — matching why yo'qotish is black rather than red elsewhere," confirmed against
  `RahbarHome.tsx`'s real `loss: slate-700 // "black, not red"` precedent before choosing this.
- Hisobotlar — plain neutral slate. Not named in the task's 3-bucket colour rule (KIRIM/CHIQIM/
  Moyka) because it isn't material movement at all — a reports screen, not a queue. Judgment call,
  not blocked on: the two named rules cover material direction; Hisobotlar simply falls outside
  that axis, and slate is this app's existing catch-all for non-status numbers/screens.

**Count badges — reuse the section's own existing hook/filter, no new query, one accepted
tradeoff:** each movement icon's badge reads that section's own **Window 1** (the queue Ombor
still has to act on), via the identical hook + filter its own tab component already renders with:
`useIntakeLines()` + `!l.intake` (Skladga KIRIM), `useMoykaSerials()` + `hasRawRemainder`
(Moykaga Chiqarish "Yuborishga tayyor"), `useMoykaOutput()`'s own pre-filtered `serials`
(Tayyor Mahsulot "chiqishi kutilmoqda" — the hook already returns exactly this set), and
`useOmborChiqimRequests()`'s own pre-filtered `open`. Hisobotlar has no queue concept (confirmed
during investigation — its only hook, `useIntakeHistory`, returns a user-filtered history report,
not a pending-items list) — no `count`, so the bar renders no badge there; a genuine 0 also
renders no badge, matching the standard notification-badge convention (a "0" badge is noise, not
information).

Which window backs the badge for the two sections with two windows (Moyka, Tayyor) wasn't
specified by the task — chose Window 1 consistently across all four movement sections ("items
waiting" = work still ahead of Ombor), not Window 2 (informational/already-done), since that's
the literal reading of "items waiting in that section."

**Stated tradeoff, not hidden:** since each section's own hook only lives inside its own tab
component (mounted/unmounted as the `<Outlet/>` child swaps) and `OmborHome` itself never
unmounts as the operator moves between tabs, badging every icon (not just the active one) means
running all 4 of these hooks a second time, in the nav shell, permanently — in addition to
whichever one the active tab separately mounts for itself. This is the same query each section
already runs (nothing new, per the task's explicit constraint, "drawn from whatever each section
already queries"), not a leaner custom count query, and it's the only way to badge every tab
without lifting state into `OmborHome` and rewiring each section to read from context instead of
its own hook — which would touch section internals ("Section content and behaviour unchanged" is
the task's own requirement). None of these 4 hooks re-fetch on their own after mount (no realtime
subscription, confirmed reading each one) and `OmborHome` never remounts on a tab switch, so
without further work every badge would go stale the instant an action changed its own section's
count, until a full page reload — added one `useEffect` keyed on `location.pathname` that re-runs
all 4 hooks' own `refresh()` on every navigation (skipping the very first mount, via a ref, since
each hook already fetches once on its own mount) — the natural, cheap moment to catch up, not a
poll, not a new query.

**Testing:** at a real 375×812 viewport, logged in as the `TEST Ombor` account. Confirmed via
direct DOM measurement (not just visual inspection): `nav.scrollWidth === nav.clientWidth === 375`
and `document.documentElement.scrollWidth === 375` on every one of the 5 routes — no horizontal
scroll anywhere, on the bar or the page. **Found and fixed a real legibility bug during this
pass:** the first implementation used `truncate` (ellipsis) on the label — measured
`scrollWidth > clientWidth` (clipped) on 4 of 5 labels at 75px-wide columns (e.g. "Moykaga
Chiqarish" needs ~100px, had 75px). Fixed by letting labels wrap to two lines instead
(`break-words`, no `whitespace-nowrap`) — re-measured after the fix: `scrollWidth === clientWidth`
on all 5, zero clipping, bar height grew from ~53px to ~64px to fit, `pb-24` content clearance
still comfortably covers it. Confirmed badge counts against each section's own rendered list by
counting DOM elements directly: Skladga KIRIM badge 1 = 1 pending row; Moykaga Chiqarish badge 9 =
9 "+ Moykaga yuborish" buttons under "1 · Yuborishga tayyor"; Tayyor Mahsulot badge 8 = 8 serials
under "1 · Moykada — chiqishi kutilmoqda"; Skladdan CHIQIM showed no badge, and its Window 1
correctly read "Ochiq so'rov yo'q." (genuinely empty). Confirmed the header text updates to match
the active section on every one of the 5 routes ("Skladga KIRIM" → "Moykaga Chiqarish" →
"Tayyor Mahsulot" → "Skladdan CHIQIM" → "Hisobotlar"). Confirmed dark mode (after a reload, since
`prefers-color-scheme` is a load-time media query, same as this app's existing convention) renders
the correct dark-tinted active background and readable text colour. **Confirmed the existing
e2e suite's navigation locators still resolve**, since 11 assertions across `full-chain.spec.ts`,
`lab-packing-hard-gate.spec.ts`, `lab-relocation-loss-verification.spec.ts`, and
`chiqim-undo-scan.spec.ts` click these links via `page.getByRole('link', { name: '...' })`
(substring match, no `exact: true`) — the badge digit now renders inside the same link, ahead of
the label; ran a throwaway, read-only spec (deleted after, never committed) logging in as Ombor
and asserting `getByRole('link', { name })` resolves + navigates correctly for all 5 labels — all
passed, confirming the badge prefix doesn't break substring name matching. Confirmed no section's
own content changed: `OmborIntakeTab.tsx`/`OmborMoykaTab.tsx`/`OmborTayyorTab.tsx`/
`OmborChiqimTab.tsx`/`OmborHisobotlar.tsx` were not touched at all — every list, form, and action
inside each tab renders and reads identically to before this change, by construction (only
`OmborHome.tsx` and the two new nav files changed). `npx tsc -b --noEmit` and `npm run lint` clean.

**Also corrected in the same edit:** SPEC.md §5's `**Nav:**` line described "4 sections +
universal 'Skanerlash' lookup (scan any #1/#2 → read-only serial history)" — live code has 5
routed tabs (§5.1–§5.4 + Hisobotlar) and no separate "Skanerlash" nav entry exists or ever did in
what's live today. Pre-existing discrepancy, not something this task was asked to fix, but noted
and corrected here since this edit already touches that exact line (CLAUDE.md: update SPEC.md
inline when a build reveals it's wrong, log why here — not left silently side-by-side with
contradicting live behaviour).

**Out of scope, not touched:** Hisobot work, Rezka, anything behavioural inside any section — see
above, confirmed by construction (no section file touched).
