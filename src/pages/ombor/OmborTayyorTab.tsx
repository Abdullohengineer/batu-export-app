import { usePersistentState } from '../../lib/FilterState'
import { ProcessPill, type ProcessKind } from '../../components/ui/ProcessPill'
import { MoykaReceiveSection } from './MoykaReceiveSection'
import { RezkaReceiveSection } from './RezkaReceiveSection'

// Ombor section 3 (SPEC.md §5.3 / §5.R). Same pill as section 2, persisted
// separately; the Moyka body is MoykaReceiveSection, unchanged.
export function OmborTayyorTab() {
  const [process, setProcess] = usePersistentState<ProcessKind>('ombor.tayyor.process', 'moyka')
  return (
    <div className="space-y-4">
      <ProcessPill value={process} onChange={setProcess} />
      {process === 'moyka' ? <MoykaReceiveSection /> : <RezkaReceiveSection />}
    </div>
  )
}
