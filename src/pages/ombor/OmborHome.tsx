import { RoleShell } from '../../components/RoleShell'
import { OmborIntakeTab } from './OmborIntakeTab'

export function OmborHome() {
  return (
    <RoleShell title="Ombor menejeri">
      <div className="max-w-3xl">
        <OmborIntakeTab />
      </div>
    </RoleShell>
  )
}
