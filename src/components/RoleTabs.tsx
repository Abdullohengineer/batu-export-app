import { NavLink } from 'react-router-dom'

// Shared top-tab bar for a role's screens (SPEC §1.1 per-role screens).
// Same NavLink pattern RahbarLayout already uses, extracted so Qorovul and
// Ombor share it. Adding a future tab (Qorovul CHIQIM, Ombor Moyka/finished/
// dispatch) is one more entry in the `tabs` array passed by the layout — no
// restructure.
export interface RoleTab {
  to: string
  label: string
  end?: boolean // exact-match (for the index/operational tab)
}

function navClass({ isActive }: { isActive: boolean }) {
  return isActive
    ? 'font-medium text-slate-900 dark:text-slate-100'
    : 'text-slate-500 dark:text-slate-400'
}

export function RoleTabs({ tabs }: { tabs: RoleTab[] }) {
  return (
    <nav className="flex gap-4 text-sm">
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={navClass}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
