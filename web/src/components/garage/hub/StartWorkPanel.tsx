import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { isAllowed, startBlockedReason } from '@/lib/garageWorkspace'
import { HubSection, ScopedError, type HubPanelProps } from './hubUi'

/**
 * Starting the work. The button exists only when `start_work` is allowed. When it is not, the panel says WHY
 * from the recorded facts (the customer has not authorized, nobody is assigned) — and still shows no button,
 * so nobody is handed a control that will come back refused.
 */
export function StartWorkPanel({ hub, busy, run, error }: HubPanelProps) {
  const { startServiceCase } = useCarUpApi()
  if (String(hub.case.status).toLowerCase() !== 'accepted') return null
  const canStart = isAllowed(hub, 'start_work')
  const reason = startBlockedReason(hub)
  if (!canStart && !reason) return null

  return (
    <HubSection id="start" title="Start the work" testId="start-work-panel">
      {canStart ? (
        <>
          <p className="text-sm text-gray-600">
            The customer has authorized the work and a mechanic is assigned. Start when the car is in the workshop.
          </p>
          <ScopedError scope="start" error={error} />
          <Button
            className="min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy} data-testid="start-work"
            onClick={() => run('start', () => startServiceCase(hub.case.id), 'Started. The customer can see the car is being worked on.')}
          >
            Start work
          </Button>
        </>
      ) : (
        <p className="text-sm text-gray-700 rounded-lg bg-gray-50 p-3" data-testid="start-blocked">
          {reason}
        </p>
      )}
    </HubSection>
  )
}
