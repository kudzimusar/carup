import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { ShieldCheck, LogOut, Store } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { AuthBootstrapLoading } from '@/components/routing/RegistryRouteBoundary'
import { loginWithReturnTo } from '@/lib/routeAccess'

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
const reviewLinks = [
  ['/admin/dealer-claims','Claims'],
  ['/admin/dealer-research-review','Source reviews'],
  ['/admin/dealer-compliance-submissions','Application evidence'],
  ['/admin/dealer-legal-activation','Legal activation'],
  ['/admin/dealer-full-storefront-review','Public storefront decisions'],
  ['/admin/dealer-buyer-feedback','Buyer complaints'],
  ['/admin/dealer-vehicle-evidence','Vehicle documents'],
  ['/admin/dealer-operating-lifecycle','Operating lifecycle'],
] as const

export default function DealerReviewerLayout() {
  const {user,token,loading,logout}=useAuth()
  const location=useLocation()
  if(loading)return <AuthBootstrapLoading />
  if(!user||!token)return <Navigate to={loginWithReturnTo(location.pathname)} replace />
  if(!REVIEW_ROLES.has(String(user.role)))return <Navigate to="/" replace />

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
