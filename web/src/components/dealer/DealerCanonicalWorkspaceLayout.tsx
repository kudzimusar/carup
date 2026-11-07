import { useEffect, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { AuthBootstrapLoading } from '@/components/routing/RegistryRouteBoundary'
import { apiRequest, resolveApiBaseUrl, type AuthHeaders } from '@/lib/apiClient'
import { loginWithReturnTo } from '@/lib/routeAccess'

/**
 * Dealership 1.0: verified organization/tenant owners keep their canonical
 * users.role (often "member"). The legacy global dealer portal role is NOT
 * their source of authority and must not block their first operating dashboard.
 *
 * This layout does NOT trust a role, localStorage, or unverified claim status.
 * It resolves the real session's canonical tenant, organization, compliance
 * and owner membership via the same server-enforced operational-workspace API
 * that the dealer dashboard and mutations use.
 *
 * No role promotion, seller listing, payments or public approval is performed.
 */
type Workspace={
  actor_id:string
  operational:boolean
  owner_membership_confirmed:boolean
  tenant_id:string
  organization_id:string
  dealer_profile_id:string
  profile:{legal_name?:string;trading_name?:string}
}
type Access={subject:string;workspace:Workspace|null}
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window==='undefined'?undefined:window.location.hostname)
export default function DealerCanonicalWorkspaceLayout() {
  const {user,token,loading}=useAuth()
  const location=useLocation()
  // Route changes must revalidate active legal/tenant authority. A previously
  // accepted session cannot reuse a prior URL's authorization result.
  const subject=user?.id&&token?user.id+':'+token+':'+location.pathname:null
  const [access,setAccess]=useState<Access>({subject:'',workspace:null})

  useEffect(()=>{
    if(!user?.id||!token||!subject)return
    let mounted=true
    const authHeaders:AuthHeaders={'x-session-token':token,'x-user-id':user.id}
    apiRequest<{workspace:Workspace}>({
      baseUrl:API,path:'/dealer/operational-workspace',authHeaders,
    }).then(result=>{
      if(!mounted)return
      const workspace=result.workspace
      const eligible=workspace?.operational===true &&
        workspace.owner_membership_confirmed===true &&
        workspace.actor_id===user.id &&
        Boolean(workspace.tenant_id&&workspace.organization_id&&workspace.dealer_profile_id)
      setAccess({subject,workspace:eligible?workspace:null})
    }).catch(()=>{
      if(mounted)setAccess({subject,workspace:null})
    })
    return()=>{mounted=false}
  },[subject,user?.id,token])

  if(loading)return <AuthBootstrapLoading />
  if(!user||!token)return <Navigate to={loginWithReturnTo(location.pathname)} replace />
  if(access.subject!==subject)return <AuthBootstrapLoading />
  if(!access.workspace)return <main className="mx-auto max-w-3xl px-5 py-12">
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
            {access.workspace.profile.trading_name||access.workspace.profile.legal_name||'Approved dealer'}
            {' · '}Private tenant workspace
          </p>
        </div>
        <nav aria-label="Approved dealership operations"
          className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <Link to="/dealer/dashboard" className="text-blue-700 underline">Dashboard</Link>
          <Link to="/dealers/operating-details" className="text-blue-700 underline">Operating details</Link>
          <Link to="/dealers/staff" className="text-blue-700 underline">Staff</Link>
          <Link to="/dealers/stock" className="text-blue-700 underline">Inventory</Link>
          <Link to="/dealers/inquiries" className="text-blue-700 underline">Buyer inquiries</Link>
          <Link to="/dealers/billing" className="text-blue-700 underline">Billing readiness</Link>
        </nav>
      </div>
    </header>
    <main id="verified-dealer-operations" className="mx-auto max-w-7xl px-4 py-6">
      <Outlet />
    </main>
  </div>
}
