import { ShieldAlert } from 'lucide-react'

const DEFAULT_WARNINGS = [
  'Do not pay outside CarUp.',
  'Use the verified inquiry flow to contact the seller.',
  'An independent inspection is recommended before purchase.',
  'Report any listing that asks you to transact off-platform.',
]

/** Public safety/trust guidance. Accepts backend-supplied warnings, falling back to the defaults. */
export function SafetyWarnings({ warnings }: { warnings?: string[] }) {
  const list = warnings && warnings.length ? warnings : DEFAULT_WARNINGS
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4" data-testid="marketplace-safety-warnings">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
        <ShieldAlert className="h-4 w-4" /> Stay safe on CarUp
      </div>
      <ul className="space-y-1">
        {list.map((w, i) => (
          <li key={i} className="text-xs text-amber-800">• {w}</li>
        ))}
      </ul>
    </div>
  )
}
