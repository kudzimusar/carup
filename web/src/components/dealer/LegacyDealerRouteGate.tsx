import {useEffect,useState} from 'react'
import {Navigate,useLocation} from 'react-router-dom'
import {useAuth} from '@/context/AuthContext'
import DashboardLayout from '@/components/layout/DashboardLayout'
import {AuthBootstrapLoading} from '@/components/routing/RegistryRouteBoundary'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'
import {legacyDealerCanonicalTarget} from './legacyDealerRoutes'

/**
 * Dealership 1.0 R6 E — one coherent dealer journey.
 *
 * The legacy global-role dealer portal (/dealer, /dealer/inventory, /dealer/leads,
 * /dealer/promotions, /dealer/analytics, /dealer/evidence) used to run in PARALLEL with
 * the canonical claim-first operating workspace. A canonically activated owner who opens
 * an old bookmark is now sent to the canonical equivalent. Everyone else keeps exactly the
 * legacy route and its existing global-role boundary (DashboardLayout role="dealer"), so no
 * existing account loses access and no role is granted or widened here.
 *
 * Authority is the same server-enforced operational-workspace check the canonical layout
 * uses; a role, localStorage or a claim status is never trusted.
 */
type Workspace={actor_id:string;operational:boolean;owner_membership_confirmed:boolean;
  tenant_id:string;organization_id:string;dealer_profile_id:string}
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window==='undefined'?undefined:window.location.hostname)

export default function LegacyDealerRouteGate(){
  const {user,token,loading}=useAuth()
  const location=useLocation()
  const subject=user?.id&&token?user.id+':'+token+':'+location.pathname:null
  const [checked,setChecked]=useState<{subject:string;canonical:boolean}>({subject:'',canonical:false})
  useEffect(()=>{
    if(!user?.id||!token||!subject)return
    let live=true
    const authHeaders:AuthHeaders={'x-session-token':token,'x-user-id':user.id}
    apiRequest<{workspace:Workspace}>({baseUrl:API,path:'/dealer/operational-workspace',authHeaders})
      .then(result=>{
        if(!live)return
        const w=result.workspace
        setChecked({subject,canonical:w?.operational===true&&w.owner_membership_confirmed===true&&
          w.actor_id===user.id&&Boolean(w.tenant_id&&w.organization_id&&w.dealer_profile_id)})
      })
      .catch(()=>{if(live)setChecked({subject,canonical:false})})
    return()=>{live=false}
  },[subject,user?.id,token])

  // Signed-out visitors: the legacy layout keeps handling sign-in exactly as before.
  if(loading)return <AuthBootstrapLoading />
  if(!user||!token)return <DashboardLayout role="dealer" />
  if(checked.subject!==subject)return <AuthBootstrapLoading />
  const target=legacyDealerCanonicalTarget(location.pathname)
  if(checked.canonical&&target)return <Navigate to={target+location.search} replace />
  return <DashboardLayout role="dealer" />
}
