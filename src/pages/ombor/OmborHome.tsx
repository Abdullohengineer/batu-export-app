import { RoleShell } from '../../components/RoleShell'

export function OmborHome() {
  return (
    <RoleShell title="Ombor menejeri">
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Ombor bo'limlari — tez orada.
        </p>
      </div>
    </RoleShell>
  )
}
