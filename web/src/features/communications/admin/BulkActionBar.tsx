// Bulk action bar for the Command Center inbox (Phase 6/7 / docs §7).
// Appears when threads are multi-selected; actions fan out per-thread with partial-failure
// reporting (the backend has no bulk endpoint, so the page loops and reports N ok / M failed).

import { CheckCircle2, Loader2, UserCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface BulkActionBarProps {
  count: number
  busy?: boolean
  resultNote?: string | null
  onAssignToMe?: () => void
  onResolve?: () => void
  onClear: () => void
}

export function BulkActionBar({ count, busy = false, resultNote, onAssignToMe, onResolve, onClear }: BulkActionBarProps) {
  if (count <= 0) return null
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border-b text-sm flex-wrap" role="region" aria-label="Bulk actions">
      <span className="font-medium">{count} selected</span>
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" aria-hidden />}
      {onAssignToMe && (
        <Button size="sm" variant="outline" className="h-7 gap-1" disabled={busy} onClick={onAssignToMe}>
          <UserCheck className="w-3.5 h-3.5" aria-hidden /> Assign to me
        </Button>
      )}
      {onResolve && (
        <Button size="sm" variant="secondary" className="h-7 gap-1" disabled={busy} onClick={onResolve}>
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> Resolve
        </Button>
      )}
      {resultNote && <span className="text-xs text-gray-500">{resultNote}</span>}
      <Button size="sm" variant="ghost" className="h-7 gap-1 ml-auto" onClick={onClear}>
        <X className="w-3.5 h-3.5" aria-hidden /> Clear
      </Button>
    </div>
  )
}
