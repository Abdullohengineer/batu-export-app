import { NavLink } from 'react-router-dom'
import { touch } from './ui/tokens'

// Shared top-tab bar for a role's screens (SPEC §1.1 per-role screens).
// Same NavLink pattern RahbarLayout already uses, extracted so Qorovul and
// Ombor share it. Adding a future tab (Qorovul CHIQIM, Ombor Moyka/finished/
// dispatch) is one more entry in the `tabs` array passed by the layout — no
// restructure.
//
// Real touch-target sizing added alongside the Qorovul mobile-header fix
// (was plain text with no hit-area padding at all) — a shared, beneficial
// side effect for Ombor's own tabs too, not a content change to either role.
export interface RoleTab {
  to: string
  label: string
  end?: boolean // exact-match (for the index/operational tab)
}

function navClass({ isActive }: { isActive: boolean }) {
  return [
    'flex shrink-0 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors',
    touch.secondary,
    isActive
      ? 'text-slate-900 dark:text-slate-100'
      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300',
  ].join(' ')
}

export function RoleTabs({ tabs }: { tabs: RoleTab[] }) {
  return (
    <nav className="flex gap-1">
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={navClass}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
