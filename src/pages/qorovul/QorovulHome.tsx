import { RoleShell } from '../../components/RoleShell'
import { QorovulKirimTab } from './QorovulKirimTab'

export function QorovulHome() {
  return (
    <RoleShell title="Qorovul">
      <div className="max-w-3xl">
        <QorovulKirimTab />
      </div>
    </RoleShell>
  )
}
