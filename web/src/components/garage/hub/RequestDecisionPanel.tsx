import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { isAllowed } from '@/lib/garageWorkspace'
import { HubSection, INPUT_CLASS, ScopedError, type HubPanelProps } from './hubUi'

type Site = { id: string; name: string | null; is_active: boolean }

/**
 * A new request: accept it or decline it. Offered only when the backend says so.
 *
 * Accepting also records WHICH SITE does the job, because the customer cannot book a time without one and a
 * site cannot be added afterwards. So for the administrator:
 *   - two or more active sites: they must choose (nothing is guessed);
 *   - exactly one: it is shown, already selected — the only honest answer, and still visible;
 *   - none set up: the job is accepted without a site and the panel says so;
 *   - the site list failed to load: accepting is held back (with a retry) rather than recording a job with no site.
 * A mechanic who may accept cannot read the site list, so for them nothing changes.
 */
export function RequestDecisionPanel({ hub, busy, run, error }: HubPanelProps) {
  const { acceptServiceCase, declineServiceCase, listGarageSites } = useCarUpApi()
  const canAccept = isAllowed(hub, 'accept_case')
  const canDecline = isAllowed(hub, 'decline_case')
  const wantsSite = canAccept && hub.viewer.is_admin

  const [sites, setSites] = useState<Site[]>([])
  const [siteState, setSiteState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [siteId, setSiteId] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!wantsSite) return undefined
    let mounted = true
    setSiteState('loading')
    listGarageSites()
      .then((res) => {
        if (!mounted) return
        const active = ((res?.sites ?? []) as Site[]).filter((s) => s.is_active !== false)
        setSites(active)
        setSiteId(active.length === 1 ? active[0].id : '')
        setSiteState('ready')
      })
      .catch(() => { if (mounted) { setSites([]); setSiteState('error') } })
    return () => { mounted = false }
  }, [wantsSite, listGarageSites, reload])

  if (!canAccept && !canDecline) return null
  const caseId = hub.case.id
  const mustChoose = wantsSite && siteState === 'ready' && sites.length >= 2 && !siteId
  const acceptHeldBack = wantsSite && (siteState === 'loading' || siteState === 'error' || mustChoose)

  return (
    <HubSection id="request" title="Can you take this job?" testId="request-decision">
      <p className="text-sm text-gray-600">
        Accepting tells the customer you will look at the car. It does not commit you to a price — you prepare an
        estimate next, and the customer decides on it before any work starts.
      </p>

      {wantsSite && siteState === 'loading' && (
        <p className="text-sm text-gray-600" role="status" data-testid="sites-loading">Loading your sites…</p>
      )}
      {wantsSite && siteState === 'error' && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 space-y-2" role="alert" data-testid="sites-error">
          <p>
            Your sites could not be loaded, so this job cannot be accepted yet — the site is recorded when you accept and
            cannot be added afterwards. This is a loading problem, not a statement that you have no sites.
          </p>
          <Button variant="outline" className="min-h-11" onClick={() => setReload((n) => n + 1)} data-testid="retry-sites">Try again</Button>
        </div>
      )}
      {wantsSite && siteState === 'ready' && sites.length > 0 && (
        <div>
          <label htmlFor="accept-site" className="block text-sm font-medium mb-1">Which site will do this job?</label>
          <select
            id="accept-site" data-testid="accept-site" value={siteId} disabled={busy} className={INPUT_CLASS}
            onChange={(e) => setSiteId(e.target.value)}
          >
            {sites.length >= 2 && <option value="">Choose a site</option>}
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name || 'Unnamed site'}</option>)}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            The customer needs a site to book a time. It is recorded on the job when you accept.
          </p>
          {mustChoose && <p className="text-sm text-amber-800 mt-2" data-testid="site-required">Choose the site before you accept.</p>}
        </div>
      )}
      {wantsSite && siteState === 'ready' && sites.length === 0 && (
        <p className="text-xs text-gray-500" data-testid="no-sites">
          You have not set up any sites yet, so this job is accepted without one. Customers cannot book a time for a job with no site.
        </p>
      )}

      <ScopedError scope="request" error={error} />
      <div className="flex flex-wrap gap-2">
        {canAccept && (
          <Button
            className="min-h-11 bg-orange-500 hover:bg-orange-600" disabled={busy || acceptHeldBack} data-testid="accept-case"
            onClick={() => run('request', () => acceptServiceCase(caseId, siteId ? { branch_id: siteId } : undefined), 'Accepted. The customer can see this.')}
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
