import { Card } from '../../components/ui/Card'

// Phase 1 scaffolding (decision 0249): each Buxgalteriya tab is routable
// now; its screen lands in the phase named here.
export function BuxgalteriyaPlaceholder({ title, phase }: { title: string; phase: 2 | 3 }) {
  return (
    <Card>
      <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Bu ekran {phase}-bosqichda quriladi.</p>
    </Card>
  )
}
