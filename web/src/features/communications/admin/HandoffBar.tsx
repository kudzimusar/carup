// Handoff / assignment bar for the Command Center conversation (docs §8).
// Self-contained: owns the team picker + admin-id input; the page supplies the mutation callbacks.
// The team Select is a command control (controlled value reset after each pick) so re-selecting the
// same team fires again and it never shows a stale value across threads.

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, UserCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { titleCase } from '../communicationFormatting'

export interface HandoffBarProps {
  teams: readonly string[]
  busyAction?: string | null
  canAssignToMe?: boolean
  onAssignToMe: () => void
  onAssignTeam: (team: string) => Promise<void> | void
  onAssignAdminId: (adminId: string) => void
  onEscalate: () => void
  onResolve: () => void
  /**
   * Reopen is offered only on a terminal thread. Resolve is a one-click action, so without this an
   * operator who resolves the wrong conversation has no way back from the Command Center even
   * though the server supports it.
   */
  canReopen?: boolean
  onReopen?: () => void
}

export function HandoffBar({
  teams, busyAction, canAssignToMe = true,
  onAssignToMe, onAssignTeam, onAssignAdminId, onEscalate, onResolve,
  canReopen = false, onReopen,
}: HandoffBarProps) {
  const [teamPick, setTeamPick] = useState('')
  const [assignee, setAssignee] = useState('')
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Handoff</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" className="gap-1" onClick={onAssignToMe} disabled={busyAction === 'assign-me' || !canAssignToMe}>
          {busyAction === 'assign-me' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <UserCheck className="w-3.5 h-3.5" aria-hidden />} Assign to me
        </Button>
        <Select value={teamPick} onValueChange={(team) => { setTeamPick(team); Promise.resolve(onAssignTeam(team)).finally(() => setTeamPick('')) }}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Assign to team"><SelectValue placeholder="Assign to team…" /></SelectTrigger>
          <SelectContent>
            {teams.map((t) => <SelectItem key={t} value={t} className="capitalize">{titleCase(t)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="gap-1" onClick={onEscalate} disabled={busyAction === 'escalate'}>
          {busyAction === 'escalate' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <AlertTriangle className="w-3.5 h-3.5" aria-hidden />} Escalate
        </Button>
        <Button size="sm" variant="secondary" className="gap-1" onClick={onResolve} disabled={busyAction === 'resolve'}>
          {busyAction === 'resolve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />} Resolve
        </Button>
        {canReopen && onReopen && (
          <Button size="sm" variant="outline" className="gap-1" onClick={onReopen} disabled={busyAction === 'reopen'} data-testid="reopen-thread">
            {busyAction === 'reopen' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <RotateCcw className="w-3.5 h-3.5" aria-hidden />} Reopen
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Assign to admin user ID" aria-label="Assign to admin user ID" className="h-9" />
        <Button size="sm" variant="outline" onClick={() => onAssignAdminId(assignee.trim())} disabled={busyAction === 'assign-id' || !assignee.trim()}>Assign</Button>
      </div>
    </div>
  )
}
