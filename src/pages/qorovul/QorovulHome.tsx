import { RoleShell } from '../../components/RoleShell'

export function QorovulHome() {
  return (
    <RoleShell title="Qorovul">
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Darvoza tarozi oynasi — tez orada.
        </p>
      </div>
    </RoleShell>
  )
}
