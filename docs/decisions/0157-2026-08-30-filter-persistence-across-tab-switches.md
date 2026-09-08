## 2026-08-30 — Filter persistence across tab switches

**Cause, and it is a single one.** Every role's tabs are react-router `<Route>` elements
navigated by `NavLink` (`RoleTabs.tsx` / `App.tsx`), so switching tabs **unmounts** the route
component. Filter state lived in plain `useState` inside those components, so it was destroyed
on the way out and re-initialised from defaults on return. Not a refetching hook, not stale
state — pure unmount. One cause meant one mechanism, not nine.

**Nine screens affected, not the three reported:** `HisobotTab` (filters + column picker),
`RahbarHome` (scope, preset, custom from/to, type multi-select), `OmborHisobotlar`,
`YieldTab`, `StockOnHandTab`, `ClientReportTab`, `LaboratorTarixTab`, `QorovulHisobotlar`,
`ClientHisobotTab`. All nine converted.

**Mechanism: a context provider above the routes** (`src/lib/FilterState.tsx`), holding a
ref'd `Map` that outlives any route unmount, with `usePersistentState(key, initial)` as a
drop-in `useState` replacement — same signature, same lazy-initialiser support, so each screen
changed by one line per piece of state. `useRef` not `useState` for the map, so writing a
filter does not re-render the provider and every route beneath it. Values are held by
reference, no serialization, so Hisobot's column-picker `Set` round-trips as itself. Falls
back to plain component state when no provider is mounted.

🔒 **No `localStorage` or `sessionStorage`** — chosen explicitly, per instruction. State dies
on page reload, which is the intended scope: reload persistence is a larger separate ask
nobody has made, and storage carries a real hazard, a date range saved days ago silently
re-applying while the user reads stale results with no indication why.

**Verified in a real browser**, not by reasoning: a temporary harness (deleted immediately
after, per CLAUDE.md) mounted the provider in Chromium, applied a date range, a column `Set`
and a multi-select, unmounted the screen entirely, and remounted it —

```
2. filters applied  {"text":"2026-08-01→2026-08-31","cols":"a,driver,plate","multi":"subxon,isfara"}
3. switched away    Screen unmounted: true | Screen gone: true
4. switched back    {"text":"2026-08-01→2026-08-31","cols":"a,driver,plate","multi":"subxon,isfara"}
5. after reload     {"text":"default","cols":"a","multi":"NULL"}   (by design)
```

Zero page errors. The reload row is the designed behaviour, not a defect.

⚠️ **Not verified in the real app.** This clone has no `.env` at all (only `.env.example`), so
the app cannot bootstrap against Supabase — the login screen throws `Missing VITE_SUPABASE_URL`
before React renders. Together with the still-missing `.env.test`, that means the nine screens
were not driven end to end by a human or by Playwright; the mechanism was verified in
isolation instead, and each screen's conversion is a one-line substitution checked by the
compiler. Flagged rather than glossed.

`FilterState.tsx` raises the same `react(only-export-components)` fast-refresh lint warning
`AuthProvider.tsx` already does — a dev-only warning, same accepted pattern.
