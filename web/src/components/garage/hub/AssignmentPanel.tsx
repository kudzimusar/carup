import { useEffect, useState } from 'react'
import { UserCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { isAllowed, mechanicLabel } from '@/lib/garageWorkspace'
import { HubSection, ScopedError, type HubPanelProps } from './hubUi'

type Mechanic = { user_id: string; display_name: string | null; role: string | null }

/**
 * Who is doing the work. Assigning (and un-assigning) is offered only when `assign_mechanic` is allowed; the
 * team list is fetched only in that case, so a mechanic's page makes no admin-only call.
 */
export function AssignmentPanel({ hub, busy, run, error }: HubPanelProps) {
  const { fetchGarageMechanics, assignMechanicToWorkOrder, unassignMechanicFromWorkOrder } = useCarUpApi()
  const { user } = useAuth()
  const workOrder = hub.work_order
  const canAssign = isAllowed(hub, 'assign_mechanic')
  const canUnassign = isAllowed(hub, 'unassign_mechanic')
  const assignedId = workOrder?.assigned_mechanic_user_id ?? null

  const [mechanics, setMechanics] = useState<Mechanic[]>([])
  const [teamState, setTeamState] = useState<'idle' | 'ready' | 'error'>('idle')
  // The picker is controlled so a refused assignment leaves it back on "Choose a mechanic", not on a name
  // that looks assigned.
  const [pick, setPick] = useState('')

  useEffect(() => {
    if (!canAssign) return undefined
    let mounted = true
    fetchGarageMechanics()
      .then((res) => { if (mounted) { setMechanics((res?.mechanics || []) as Mechanic[]); setTeamState('ready') } })
      .catch(() => { if (mounted) { setMechanics([]); setTeamState('error') } })
    return () => { mounted = false }
  }, [canAssign, fetchGarageMechanics])

  if (!workOrder || (!canAssign && !assignedId)) return null

  // The assigned person's name: the team list when we have it, else the hub's own list; never an invented one.
  const known = mechanics.find((m) => m.user_id === assignedId)
    ?? (hub.mechanics as Array<Partial<Mechanic>>).find((m) => m.user_id === assignedId)
  // A mechanic cannot load the team list; if the assignee is the person looking, say so instead of "a team member".
  const assignedName = assignedId && user?.id && user.id === assignedId
    ? 'You'
    : assignedId
    ? (known && known.user_id ? mechanicLabel({ user_id: known.user_id, display_name: known.display_name ?? null }) : 'A team member')
    : null

  return (
    <HubSection id="assignment" title="Who is doing the work" testId="assignment-panel">
      <ScopedError scope="assignment" error={error} />
      {assignedId ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm flex items-center gap-2" data-testid="assigned-mechanic">
            <UserCog className="w-4 h-4 text-gray-400" aria-hidden="true" />
            {assignedName}
          </p>
          {canUnassign && (
            <Button
              variant="outline" className="min-h-11" disabled={busy} data-testid="unassign-mechanic"
              onClick={() => run('assignment', () => unassignMechanicFromWorkOrder(workOrder.id), 'Unassigned.')}
            >
              Unassign
            </Button>
          )}
        </div>
      ) : teamState === 'error' ? (
        <p className="text-sm text-gray-700 rounded-lg bg-gray-50 p-3" data-testid="mechanics-error">
          Your team list could not be loaded, so nobody can be picked right now. This is a loading problem, not a
          statement that you have no team.
        </p>
      ) : teamState === 'ready' && mechanics.length === 0 ? (
        <p className="text-sm text-gray-600" data-testid="no-mechanics">
          Nobody else is on your garage’s CarUp account yet, so there is no one to assign this to. A mechanic has to be
          assigned before the work can start.
        </p>
      ) : teamState === 'ready' ? (
        <div className="flex flex-wrap gap-2">
          <select
            className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm flex-1 min-w-[12rem] bg-white"
            data-testid="mechanic-select" value={pick} disabled={busy}
            onChange={(e) => {
              const id = e.target.value
              if (!id) return
              setPick(id)
              void run('assignment', () => assignMechanicToWorkOrder(workOrder.id, id), 'Assigned.').finally(() => setPick(''))
            }}
            aria-label="Assign a mechanic"
          >
            <option value="">Choose a mechanic</option>
            {mechanics.map((m) => (
              <option key={m.user_id} value={m.user_id}>{mechanicLabel(m)}</option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-sm text-gray-600" role="status" data-testid="mechanics-loading">Loading your team…</p>
      )}
    </HubSection>
  )
}
