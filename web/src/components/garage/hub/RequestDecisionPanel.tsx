import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { isAllowed } from '@/lib/garageWorkspace'
import { HubSection, ScopedError, type HubPanelProps } from './hubUi'

/** A new request: accept it or decline it. Offered only when the backend says so. */
export function RequestDecisionPanel({ hub, busy, run, error }: HubPanelProps) {
  const { acceptServiceCase, declineServiceCase } = useCarUpApi()
  const canAccept = isAllowed(hub, 'accept_case')
  const canDecline = isAllowed(hub, 'decline_case')
  if (!canAccept && !canDecline) return null
  const caseId = hub.case.id

  return (
    <HubSection id="request" title="Can you take this job?" testId="request-decision">
      <p className="text-sm text-gray-600">
        Accepting tells the customer you will look at the car. It does not commit you to a price — you prepare an
        estimate next, and the customer decides on it before any work starts.
      </p>
      <ScopedError scope="request" error={error} />
      <div className="flex flex-wrap gap-2">
        {canAccept && (
          <Button
            className="min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy} data-testid="accept-case"
            onClick={() => run('request', () => acceptServiceCase(caseId), 'Accepted. The customer can see this.')}
          >
            Accept this job
          </Button>
        )}
        {canDecline && (
          <Button
            variant="outline" className="min-h-11" disabled={busy} data-testid="decline-case"
            onClick={() => run('request', () => declineServiceCase(caseId, 'garage_declined'), 'Declined. The customer can see this.')}
          >
            Decline
          </Button>
        )}
      </div>
    </HubSection>
  )
}
