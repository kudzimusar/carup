import {useCallback,useEffect,useState} from 'react'
import {Navigate,useLocation} from 'react-router-dom'
import {useAuth} from '@/context/AuthContext'
import DashboardLayout from '@/components/layout/DashboardLayout'
import {AuthBootstrapLoading} from '@/components/routing/RegistryRouteBoundary'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'
import {isUnifiedUiEnabled} from '@/components/shell/unifiedFlag'
import {loginWithReturnTo} from '@/lib/routeAccess'
import {legacyDealerCanonicalTarget} from './legacyDealerRoutes'
import {classifyDealerStatusFailure,type DealerStatusCheckFailure} from './useDealerOperationalWorkspace'
import {DealerStatusCheckFailed} from './DealerStatusCheckFailed'

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
  // RX06-LR06 (Owner decision N2): in the unified presentation a check that could not be done is said so (with a
  // retry) instead of quietly treating an approved owner as a non-dealer. The legacy presentation is unchanged.
  const [attempt,setAttempt]=useState(0)
  const retry=useCallback(()=>setAttempt(a=>a+1),[])
  const subject=user?.id&&token?user.id+':'+token+':'+location.pathname+'#'+attempt:null
  const [checked,setChecked]=useState<{subject:string;canonical:boolean;failure:DealerStatusCheckFailure|null}>({subject:'',canonical:false,failure:null})
  useEffect(()=>{
    if(!user?.id||!token||!subject)return
    let live=true
    const authHeaders:AuthHeaders={'x-session-token':token,'x-user-id':user.id}
    apiRequest<{workspace:Workspace}>({baseUrl:API,path:'/dealer/operational-workspace',authHeaders})
      .then(result=>{
        if(!live)return
        const w=result.workspace
        setChecked({subject,canonical:w?.operational===true&&w.owner_membership_confirmed===true&&
          w.actor_id===user.id&&Boolean(w.tenant_id&&w.organization_id&&w.dealer_profile_id),failure:null})
      })
      .catch(err=>{if(live)setChecked({subject,canonical:false,
        failure:isUnifiedUiEnabled()?classifyDealerStatusFailure(err):null})})
    return()=>{live=false}
  },[subject,user?.id,token])

  // Signed-out visitors: the legacy layout keeps handling sign-in exactly as before.
  if(loading)return <AuthBootstrapLoading />
  if(!user||!token)return <DashboardLayout role="dealer" />
  if(checked.subject!==subject)return <AuthBootstrapLoading />
  if(checked.failure)return <DealerStatusCheckFailed failure={checked.failure} onRetry={retry}
    signInHref={loginWithReturnTo(location.pathname)} />
  const target=legacyDealerCanonicalTarget(location.pathname)
  if(checked.canonical&&target)return <Navigate to={target+location.search} replace />
  return <DashboardLayout role="dealer" />
}
