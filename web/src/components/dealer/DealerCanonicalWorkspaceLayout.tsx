import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { AuthBootstrapLoading } from '@/components/routing/RegistryRouteBoundary'
import { loginWithReturnTo } from '@/lib/routeAccess'
import { DEALER_OPERATION_LINKS, useDealerOperationalWorkspace } from './useDealerOperationalWorkspace'

/**
 * Dealership 1.0: verified organization/tenant owners keep their canonical
 * users.role (often "member"). The legacy global dealer portal role is NOT
 * their source of authority and must not block their first operating dashboard.
 *
 * This layout does NOT trust a role, localStorage, or unverified claim status.
 * It resolves the real session's canonical tenant, organization, compliance
 * and owner membership through the SHARED `useDealerOperationalWorkspace`
 * hook — the exact same server-enforced check the S1-4B unified shell uses —
 * so both presentations gate on one authority and cannot drift.
 *
 * No role promotion, seller listing, payments or public approval is performed.
 */
export default function DealerCanonicalWorkspaceLayout() {
  const { user, token } = useAuth()
  const location = useLocation()
  const { status, workspace } = useDealerOperationalWorkspace()

  if (status === 'bootstrapping') return <AuthBootstrapLoading />
  if (!user || !token) return <Navigate to={loginWithReturnTo(location.pathname)} replace />
  if (status === 'verifying') return <AuthBootstrapLoading />
  if (status === 'unauthorized' || !workspace)
    return <main className="mx-auto max-w-3xl px-5 py-12">
      <h1 className="text-2xl font-semibold">Dealership operating access unavailable</h1>
      <p className="mt-4 text-slate-700">
        Your session does not currently have an active, independently approved
        dealership organization and canonical owner membership. A submitted or
        approved research claim alone is not operating authorization.
      </p>
      <Link className="mt-5 inline-block text-blue-700 underline" to="/dealers/claims">
        Review my dealership claim and compliance status
      </Link>
    </main>

  return <div className="min-h-screen bg-slate-50">
    <header className="border-b bg-white">
      <div className="mx-auto max-w-7xl px-4 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link className="font-semibold text-blue-900" to="/dealer/dashboard">
            CarUp Dealer Workspace
          </Link>
          <p className="text-xs text-slate-600">
            {workspace.profile.trading_name || workspace.profile.legal_name || 'Approved dealer'}
            {' · '}Private tenant workspace
          </p>
        </div>
        <nav aria-label="Approved dealership operations"
          className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {DEALER_OPERATION_LINKS.map(link => (
            <Link key={link.id} to={link.href} className="text-blue-700 underline">{link.label}</Link>
          ))}
        </nav>
      </div>
    </header>
    <main id="verified-dealer-operations" className="mx-auto max-w-7xl px-4 py-6">
      <Outlet />
    </main>
  </div>
}
