import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ShieldCheck, LogOut, Store } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { AuthBootstrapLoading } from '@/components/routing/RegistryRouteBoundary'
import { loginWithReturnTo } from '@/lib/routeAccess'
import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'
import { WorkspaceShell } from '@/components/shell/WorkspaceShell'
import { REVIEW_WORKBENCH_LINKS, projectReviewRail } from '@/components/shell/navProjection'

const INDEPENDENCE_NOTICE =
  'Independent, authenticated review only. Viewing a source, claim or application ' +
  'never grants legal status, merchant privileges, public publication or tenant membership. ' +
  'Reviewer password step-up is required for consequential decisions and private originals.'

/**
 * RX03-P2 — ReviewWorkbench presentation (register R131–R138) for an opted-in
 * NONPRODUCTION session. Rendered only AFTER this layout's own guard has
 * passed; it changes chrome, never access. Rail = exactly the eight reviewer
 * workbenches; no dealer, owner or admin menu is inherited.
 */
function ReviewWorkbenchChrome({ name, role, onSignOut }: { name: string; role: string; onSignOut: () => void }) {
  const location = useLocation()
  const current = REVIEW_WORKBENCH_LINKS.find(l => l.href === location.pathname)
  return (
    <WorkspaceShell
      family="review"
      identity={{ displayName: name, roleTitle: `${role.replaceAll('_', ' ')} session` }}
      currentPath={location.pathname}
      object={{
        title: current?.label ?? 'Dealership review',
        reference: 'Independent dealership review',
        statusLabel: 'Step-up for decisions',
        statusTone: 'info',
      }}
      railSections={projectReviewRail()}
      overviewHref="/admin/dealer-claims"
      onSignOut={onSignOut}
    >
      <div id="dealer-independent-review-workspace" data-testid="review-workbench">
        <p className="mb-4 max-w-4xl text-xs text-carup-text-2" data-testid="review-workbench-independence">
          {INDEPENDENCE_NOTICE}
        </p>
        <Outlet />
      </div>
    </WorkspaceShell>
  )
}

/**
 * CARUP-DEALER-ONB-001 D6-D8.
 *
 * The current canonical backend authorizes verified reviewers independently of
 * the claimant, including the dedicated "reviewer" platform role. The generic
 * /admin dashboard is reserved for administrators and must never be granted
 * wholesale to a reviewer just to expose five dealership review workbenches.
 *
 * This is a frontend-only scoped shell. It never grants backend permissions:
 * each real API action still requires a proven user_sessions token, the
 * independently verified role and password step-up where applicable.
 */
const REVIEW_ROLES = new Set(['reviewer','admin','platform_admin','super_admin'])
// Single source with the unified ReviewWorkbench rail (same eight workbenches, same order).
const reviewLinks = REVIEW_WORKBENCH_LINKS.map(l => [l.href, l.label] as const)

export default function DealerReviewerLayout() {
  const {user,token,loading,logout}=useAuth()
  const location=useLocation()
  const navigate=useNavigate()
  if(loading)return <AuthBootstrapLoading />
  if(!user||!token)return <Navigate to={loginWithReturnTo(location.pathname)} replace />
  if(!REVIEW_ROLES.has(String(user.role)))return <Navigate to="/" replace />
  // RX03-P2: presentation only, AFTER the unchanged guard above.
  if(isUnifiedUiEnabled())return (
    <ReviewWorkbenchChrome name={user.name ?? 'Reviewer'} role={String(user.role)}
      onSignOut={()=>{logout();navigate('/')}} />
  )

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center gap-4 justify-between">
          <Link to="/dealers" className="inline-flex items-center gap-2 font-semibold text-slate-900">
            <Store className="w-5 h-5 text-blue-700" aria-hidden="true"/>
            CarUp Dealership Review
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1 text-blue-900">
              <ShieldCheck className="w-4 h-4" aria-hidden="true"/>
              {String(user.role).replaceAll('_',' ')} session
            </span>
            <button type="button" onClick={logout}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-2 hover:bg-slate-50">
              <LogOut className="w-4 h-4" aria-hidden="true"/> Sign out
            </button>
          </div>
        </div>
        <nav aria-label="Dealership review workbenches"
          className="max-w-7xl mx-auto px-4 pb-3 flex gap-3 overflow-x-auto text-sm">
          {reviewLinks.map(([route,label])=>(
            <Link key={route} to={route} aria-current={location.pathname===route?'page':undefined}
              className={'whitespace-nowrap rounded-md px-3 py-2 '+
                (location.pathname===route?'bg-blue-900 text-white':'text-blue-900 hover:bg-blue-50')}>
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main id="dealer-independent-review-workspace" className="max-w-7xl mx-auto px-4 py-6">
        <p className="text-xs text-slate-600 max-w-4xl mb-4">
          Independent, authenticated review only. Viewing a source, claim or application
          never grants legal status, merchant privileges, public publication or tenant membership.
          Reviewer password step-up is required for consequential decisions and private originals.
        </p>
        <Outlet />
      </main>
    </div>
  )
}
