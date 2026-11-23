/**
 * RX06-LR06 (Owner decision N2) — the unified dealer workspace when its status check could not be done.
 *
 * It shows no dealer data and grants nothing (fail-closed, exactly like "unavailable"), but it says what actually
 * happened, so an approved dealership is never told it is unapproved because its status request failed. The server's
 * real "no approved dealership" answer keeps the existing "Dealership operating access unavailable" page.
 * Unified presentation only; the legacy layout is unchanged.
 */
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { OFFLINE_TEXT, THROTTLED_TEXT } from '@/components/trade/core/readFailure'
import type { DealerStatusCheckFailure } from './useDealerOperationalWorkspace'

const COPY: Record<DealerStatusCheckFailure, { title: string; body: string; action: 'retry' | 'sign-in' | 'none' }> = {
  unavailable: {
    title: 'Your dealership status could not be checked',
    body: 'CarUp could not check your dealership’s operating status just now. This is not a decision about your dealership, and nothing has changed. Try again in a moment.',
    action: 'retry',
  },
  throttled: {
    title: 'Your dealership status could not be checked yet',
    body: `${THROTTLED_TEXT} This is not a decision about your dealership.`,
    action: 'retry',
  },
  offline: {
    title: 'CarUp could not be reached',
    body: `${OFFLINE_TEXT} This is not a decision about your dealership.`,
    action: 'retry',
  },
  session: {
    title: 'Your session has ended',
    body: 'Sign in again to open your dealer workspace. Nothing new was loaded or changed with the old session.',
    action: 'sign-in',
  },
  denied: {
    title: 'This account cannot open the dealer workspace',
    body: 'CarUp refused this account access to the dealer workspace. This is not a review decision about the dealership. If you believe it is wrong, contact CarUp support.',
    action: 'retry',
  },
  multiple: {
    title: 'More than one dealership is linked to this account',
    body: 'CarUp cannot choose which dealership to open for you. Contact CarUp support to choose the dealership for this account. Nothing has changed.',
    action: 'none',
  },
}

export function DealerStatusCheckFailed({ failure, onRetry, signInHref }: { failure: DealerStatusCheckFailure; onRetry?: () => void; signInHref: string }) {
  const copy = COPY[failure]
  return (
    <main className="mx-auto max-w-3xl px-5 py-12" data-testid="dealer-workspace-check-failed" data-failure={failure}>
      <h1 className="text-2xl font-semibold">{copy.title}</h1>
      <p className="mt-4 text-carup-text-2" role="status">{copy.body}</p>
      {copy.action === 'retry' && onRetry && (
        <Button type="button" variant="outline" className="mt-6" onClick={onRetry} data-testid="dealer-workspace-check-retry">Try again</Button>
      )}
      {copy.action === 'sign-in' && (
        <Button asChild className="mt-6"><Link to={signInHref} data-testid="dealer-workspace-check-signin">Sign in again</Link></Button>
      )}
    </main>
  )
}
