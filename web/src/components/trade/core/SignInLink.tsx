import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { buildLoginRedirect } from '@/lib/returnTo'

/**
 * RX06-LR03: every Trade "sign in" / "sign in again" action returns the person to the exact page
 * they were on (path + query), instead of a bare /login that lands them on a role dashboard.
 */
export function SignInLink({ className, children, testId }: { className?: string; children: ReactNode; testId?: string }) {
  const location = useLocation()
  return (
    <Link to={buildLoginRedirect(`${location.pathname}${location.search}`)} className={className} data-testid={testId}>
      {children}
    </Link>
  )
}
