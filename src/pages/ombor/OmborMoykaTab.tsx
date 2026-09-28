import { usePersistentState } from '../../lib/FilterState'
import { ProcessPill, type ProcessKind } from '../../components/ui/ProcessPill'
import { MoykaSendSection } from './MoykaSendSection'
import { RezkaSendSection } from './RezkaSendSection'

// Ombor section 2 (SPEC.md §5.2 / §5.R). The Moyka|Rezka pill swaps the
// whole section body; the Moyka body is MoykaSendSection, unchanged and not
// threaded with a process flag (Rezka Prompt 2: separate components, not a
// flag). Choice persists per tab like other filters (FilterState).
export function OmborMoykaTab() {
  const [process, setProcess] = usePersistentState<ProcessKind>('ombor.moyka.process', 'moyka')
  return (
    <div className="space-y-4">
      <ProcessPill value={process} onChange={setProcess} />
      {process === 'moyka' ? <MoykaSendSection /> : <RezkaSendSection />}
    </div>
  )
}
