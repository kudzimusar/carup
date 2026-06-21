/**
 * React route boundaries (Milestone 5).
 *
 * Thin wrappers over the pure `evaluateRouteAccess` decision so navigation
 * visibility and direct route access share one auditable rule. Backend
 * authorization is unaffected — these only decide what the SPA renders or where
 * it safely redirects.
 */
import { type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useFeatureEffectiveStates } from '@/context/FeatureGovernanceContext'
import { evaluateRouteAccess, loginWithReturnTo } from '@/lib/routeAccess'
import { Spinner } from '@/components/ui/spinner'
import {
  FeaturePlannedPage,
  FeatureDisabledPage,
  FeatureBetaNotice,
} from '@/components/routing/FeatureStatePages'
import type { UserRole } from '@shared/types'

/** Auth bootstrap loading state — shown while the session is restoring. */
export function AuthBootstrapLoading() {
  return (
    <div
      className="min-h-[50vh] flex items-center justify-center"
      data-testid="auth-bootstrap-loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Spinner className="size-6 text-orange-500" />
      <span className="sr-only">Loading…</span>
    </div>
  )
}

/**
 * Evaluate the current route and render children, a lifecycle state page, or a
 * safe redirect. `enforceAuth` is true for protected layouts and false for the
 * public layout (lifecycle-only gating).
 */
export function RegistryRouteBoundary({
  children,
  enforceAuth = true,
}: {
  children: ReactNode
  enforceAuth?: boolean
}) {
  const location = useLocation()
  const { user, loading } = useAuth()
  const effectiveStates = useFeatureEffectiveStates()

  const decision = evaluateRouteAccess({
    route: location.pathname,
    isBootstrapping: loading,
    isAuthenticated: !!user,
    role: (user?.role as UserRole) ?? null,
    effectiveStates,
    enforceAuth,
  })

  switch (decision.kind) {
    case 'loading':
      return <AuthBootstrapLoading />
    case 'redirect':
      return <Navigate to={decision.to} replace />
    case 'planned':
      return <FeaturePlannedPage />
    case 'disabled':
      return <FeatureDisabledPage />
    case 'render-beta':
      return (
        <>
          <FeatureBetaNotice message={decision.message} />
          {children}
        </>
      )
    case 'render':
    default:
      return <>{children}</>
  }
}

/** Require an authenticated user (loading-aware, sanitized return-to). */
export function RequireAuthenticatedUser({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { user, loading } = useAuth()
  if (loading) return <AuthBootstrapLoading />
  if (!user) return <Navigate to={loginWithReturnTo(location.pathname)} replace />
  return <>{children}</>
}

/** Require the current user to hold one of the given frontend roles. */
export function RequireFrontendRole({
  roles,
  children,
}: {
  roles: UserRole[]
  children: ReactNode
}) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <AuthBootstrapLoading />
  if (!user) return <Navigate to={loginWithReturnTo(location.pathname)} replace />
  if (!roles.includes(user.role as UserRole)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
