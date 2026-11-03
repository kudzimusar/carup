import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Car, MapPin, ShieldCheck, Users, AlertTriangle, ArrowRight } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { apiRequest, resolveApiBaseUrl, type AuthHeaders } from '@/lib/apiClient'
import { SellerInquiriesCard } from '@/components/marketplace/SellerInquiriesCard'
import DealerIntelligence from '@/components/intelligence/DealerIntelligence'
import type { Vehicle } from '@/types'

type DealerProfile={
  id:string;legal_name:string|null;trading_name:string|null;tenant_id:string|null
  identity_status:string;compliance_review_state:string
  active_state:string;restriction_state:string;suspension_state:string
  investigation_state:string;expiry_date:string|null
}
type Branch={id:string;dealer_id:string;name:string|null;address:string|null}
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window==='undefined'?undefined:window.location.hostname)
function authHeaders(userId:string,token:string):AuthHeaders{
  return {'x-session-token':token,'x-user-id':userId}
}

/**
 * Dealer workspace 1.0 — real owner-scoped reads, no invented business metrics,
 * no fake Harare/Bulawayo branches, no local-only permission toggles.
 * A research claim never unlocks this workspace; canonical dealer role remains required.
 */
export default function DealerDashboard(){
  const {user,token}=useAuth()
  const {fetchDealerInventory}=useCarUpApi()
  const [profile,setProfile]=useState<DealerProfile|null>(null)
  const [branches,setBranches]=useState<Branch[]>([])
  const [profileStatus,setProfileStatus]=useState<'loading'|'ready'|'missing'|'error'>('loading')
  const [inventory,setInventory]=useState<Vehicle[]>([])
  const [inventoryStatus,setInventoryStatus]=useState<'loading'|'ready'|'error'>('loading')
  const [membershipCount,setMembershipCount]=useState<number|null>(null)
  const [membershipState,setMembershipState]=useState<'loading'|'ready'|'unavailable'>('loading')
  useEffect(()=>{
    let active=true
    if(!user||!token){setProfileStatus('missing');return}
    const hdr=authHeaders(user.id,token)
    apiRequest<{profile:DealerProfile}>({
      baseUrl:API,path:'/dealer/profile',authHeaders:hdr,
    }).then(result=>{
      if(!active)return
      setProfile(result.profile)
      setProfileStatus('ready')
      return apiRequest<{branches:Branch[]}>({
        baseUrl:API,path:'/dealer/branches',authHeaders:hdr,
      }).then(branchResult=>{
        if(active)setBranches(branchResult.branches||[])
      }).catch(()=>{if(active)setBranches([])})
    }).catch(problem=>{
      if(!active)return
      const status=(problem as {status?:number})?.status
      setProfileStatus(status===404?'missing':'error')
    })
    return()=>{active=false}
  },[user,token])
  useEffect(()=>{
    let active=true
    fetchDealerInventory().then(rows=>{
      if(!active)return
      setInventory(Array.isArray(rows)?rows:[])
      setInventoryStatus('ready')
    }).catch(()=>{
      if(!active)return
      setInventory([])
      setInventoryStatus('error')
    })
    return()=>{active=false}
  },[fetchDealerInventory])
  useEffect(()=>{
    let active=true
    if(!user||!token||profileStatus!=='ready'||!profile?.tenant_id){
      setMembershipCount(null);setMembershipState('unavailable')
      return()=>{active=false}
    }
    setMembershipState('loading')
    apiRequest<{summary:{recorded_tenant_member_count:number;state:string}}>({
      baseUrl:API,path:'/dealer/operations/membership-summary',
      authHeaders:authHeaders(user.id,token),
    }).then(result=>{
      if(!active)return
      const n=result.summary?.recorded_tenant_member_count
      if(result.summary?.state==='CANONICAL_MEMBERSHIP_OBSERVED'&&
        Number.isInteger(n)&&n>=1){
        setMembershipCount(n);setMembershipState('ready')
      }else{setMembershipCount(null);setMembershipState('unavailable')}
    }).catch(()=>{
      if(active){setMembershipCount(null);setMembershipState('unavailable')}
    })
    return()=>{active=false}
  },[user,token,profileStatus,profile?.tenant_id])
  const allowedToOperate=Boolean(profile?.tenant_id&&profile.active_state==='active'&&
    profile.identity_status==='verified'&&profile.compliance_review_state==='passed'&&
    profile.restriction_state!=='restricted'&&profile.suspension_state!=='suspended'&&
    profile.investigation_state!=='under_investigation'&&
    (!profile.expiry_date||new Date(profile.expiry_date).getTime()>=Date.now()))
  return <main className="max-w-7xl mx-auto space-y-6" data-testid="real-dealer-dashboard">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">Dealer Dashboard</h1>
        <p className="text-gray-600 mt-1">Real dealership profile, branches, governed inventory and compliance status.</p>
      </div>
      <Link to="/dealers/claims" className="text-sm text-blue-700 underline underline-offset-4">
        My dealership claim applications
      </Link>
    </div>
    {profileStatus==='loading'&&<p role="status">Loading your dealer authority…</p>}
    {profileStatus==='missing'&&<div role="alert" className="rounded-xl border p-5 bg-amber-50 text-amber-900">
      No approved operational dealership is linked to this signed-in account.
      A research ownership claim alone does not grant dealership controls.
    </div>}
    {profileStatus==='error'&&<div role="alert" className="rounded-xl border p-5 bg-red-50 text-red-800">
      Dealership authority could not be loaded. No privileged operation is assumed available.
    </div>}
    {profileStatus==='ready'&&profile&&<>
      <Card><CardContent className="p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-6 h-6 text-slate-600 shrink-0" aria-hidden="true"/>
          <div>
            <h2 className="text-lg font-semibold">{profile.trading_name||profile.legal_name||'Dealer business identity incomplete'}</h2>
            <p className="text-sm text-gray-600 mt-1">
              {allowedToOperate?'Operational conditions currently recorded as satisfied':
                'Not authorized for full dealer operations on the current evidence'}
            </p>
            <dl className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {[
                ['Identity',profile.identity_status],['Compliance',profile.compliance_review_state],
                ['Operating',profile.active_state],['Restrictions',profile.restriction_state],
                ['Suspension',profile.suspension_state],['Investigation',profile.investigation_state],
                ['Tenant membership',profile.tenant_id?'Recorded':'Not recorded'],
                ['Expiry',profile.expiry_date?new Date(profile.expiry_date).toLocaleDateString():'Not recorded'],
              ].map(([key,value])=><div key={key}>
                <dt className="text-gray-500">{key}</dt>
                <dd className="font-semibold text-gray-800 mt-1 break-words">{value}</dd>
              </div>)}
            </dl>
          </div>
        </div>
      </CardContent></Card>
      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-5">
          <Car className="w-5 h-5 text-blue-600 mb-2" aria-hidden="true"/>
          <p className="text-sm text-gray-600">Canonical dealer inventory</p>
          <strong className="text-2xl">{inventoryStatus==='ready'?inventory.length:'Not available'}</strong>
          {inventoryStatus==='error'&&<p className="text-xs text-red-700 mt-2">The inventory read failed; this is not zero.</p>}
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <MapPin className="w-5 h-5 text-slate-700 mb-2" aria-hidden="true"/>
          <p className="text-sm text-gray-600">Recorded branches</p>
          <strong className="text-2xl">{branches.length}</strong>
          <p className="text-xs text-gray-500 mt-2">Branch count reflects own private dealer profile only.</p>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <Users className="w-5 h-5 text-slate-700 mb-2" aria-hidden="true"/>
          <p className="text-sm text-gray-600">Canonical recorded tenant members</p>
          <strong className="text-lg">{membershipState==='ready' && membershipCount!==null
            ?membershipCount:'Not available'}</strong>
          <p className="text-xs text-gray-500 mt-2">
            Only existing tenant membership rows are counted. Active staff headcount,
            sales and revenue are not measured.
          </p>
        </CardContent></Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <SellerInquiriesCard ownedListings={inventoryStatus==='ready'?inventory:undefined}/>
          <Card><CardHeader><CardTitle className="text-lg">My recorded branches</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {branches.length===0&&<p className="text-gray-600 text-sm">No branches are currently recorded for this dealer account.</p>}
              {branches.map(branch=><div key={branch.id} className="border rounded-lg p-4">
                <h3 className="font-semibold">{branch.name||'Unnamed recorded branch'}</h3>
                <p className="text-sm text-gray-600">{branch.address||'Address not recorded'}</p>
              </div>)}
              <p className="text-xs text-gray-500">
                Geographic branch selection is not inferred from VIN city strings.
                Per-VIN branch attribution requires a governed branch-reference mapping.
              </p>
            </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-lg">Canonical dealer inventory</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {inventoryStatus==='error'&&<p role="alert">Scoped inventory could not be loaded.</p>}
              {inventoryStatus==='ready'&&inventory.length===0&&<p className="text-sm text-gray-600">
                No dealer-owned inventory is recorded. No placeholder vehicle stock has been introduced.
              </p>}
              {inventoryStatus==='ready'&&inventory.slice(0,8).map(vehicle=><div key={vehicle.vin} className="border rounded-lg p-3 flex justify-between gap-3">
                <div>
                  <p className="font-semibold">{vehicle.make} {vehicle.model}</p>
                  <p className="text-xs text-gray-600 mt-1">VIN {vehicle.vin} · {vehicle.status||'Status unrecorded'}</p>
                </div>
                <p className="text-sm font-semibold text-right">
                  {Number.isFinite(vehicle.price as number)&&vehicle.currency
                    ?`${vehicle.currency} ${(vehicle.price as number).toLocaleString()}`:'Price not recorded'}
                </p>
              </div>)}
            </CardContent></Card>
          <Card><CardContent className="p-5 text-sm text-slate-600 flex gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true"/>
            No local permission toggles are offered. Staff roles and powers must be changed only
            through actual Corporate/AUTH tenant membership authority.
          </CardContent></Card>
        </div>
        <aside className="space-y-5">
          <DealerIntelligence windowDays={30}/>
          <Card><CardHeader><CardTitle className="text-lg">Dealer workspace</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {[
                ['Manage real business, buyer and warranty terms','/dealers/operating-details'],
                ['Plan and billing readiness','/dealers/billing'],
                ['Staff membership and invitations','/dealers/staff'],
                ['Manage canonical inventory','/dealer/inventory'],['Buyer inquiries','/dealer/leads'],
                ['Dealer intelligence','/dealer/analytics'],['Document review','/dealer/evidence'],
              ].map(([label,url])=><Link key={url} className="flex items-center gap-2 text-blue-700 font-medium text-sm hover:underline" to={url}>
                <ArrowRight className="w-4 h-4" aria-hidden="true"/>{label}
              </Link>)}
              <p className="pt-3 border-t text-xs text-gray-500">
                Dealer subscriptions remain unpriced/blocked until approved CarUp merchant,
                product tariffs, finance controls and provider certification.
              </p>
            </CardContent></Card>
        </aside>
      </div>
    </>}
  </main>
}
