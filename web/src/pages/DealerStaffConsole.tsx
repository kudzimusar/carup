import {useCallback,useEffect,useState} from 'react'
import { dealerDateTime } from '@/lib/dealerDates'
import { DEALER_WRAP_BUTTON, DEALER_WRAP_BUTTON_SM } from '@/components/dealer/dealerButtonWrap'
import {Link} from 'react-router-dom'
import {Card,CardContent} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {useAuth} from '@/context/AuthContext'
import {apiRequest,resolveApiBaseUrl,type AuthHeaders} from '@/lib/apiClient'
type Invitation={invite_id:string;invited_user_id?:string;organization_id?:string;
 requested_role:string;status:'PENDING'|'ACCEPTED'|'REVOKED';
 created_at:string;expires_at:string}
type Member={user_id:string;role:string;joined_at:string;
  belongs_to_canonical_tenant:true}
type Staff={tenant_id:string;members:Member[];invitations:Invitation[];
 branch_role_scope_not_configured:true;staff_listing_authority:false}
type ScopedBranch={scope_id:string;branch_id:string;permission:'VIEW_BRANCH'|'EDIT_BRANCH_DETAILS';
 name:string;address:string;latitude:number|null;longitude:number|null;
 opening_hours_text:string|null;owner_rights:false;listing_rights:false;finance_rights:false}
type OwnerScope={scope_id:string;invite_id:string;branch_id:string;
 permission:string;status:'ACTIVE'|'REVOKED'}
type SourceBranch={id:string;name:string|null}
const API=resolveApiBaseUrl(import.meta.env.VITE_API_URL,
 typeof window==='undefined'?undefined:window.location.hostname)
const auth=(id:string,token:string):AuthHeaders=>({'x-session-token':token,'x-user-id':id})
/**
 * The approved legal owner is authoritative for invitations, not a claimed
 * research identity. Staff activation writes canonical tenant_users with
 * limited member role; it never issues dealer, seller or reviewer privileges.
 */
export default function DealerStaffConsole(){
 const {user,token}=useAuth()
 const [staff,setStaff]=useState<Staff|null>(null)
 const [mine,setMine]=useState<Invitation[]>([])
 const [recipient,setRecipient]=useState('')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [loaded,setLoaded]=useState(false)
 const [myBranches,setMyBranches]=useState<ScopedBranch[]>([])
 const [ownerScopes,setOwnerScopes]=useState<OwnerScope[]>([])
 const [ownerBranches,setOwnerBranches]=useState<SourceBranch[]>([])
 const [scopeBranchId,setScopeBranchId]=useState('')
 const [scopeReason,setScopeReason]=useState('')
 const [staffHours,setStaffHours]=useState<Record<string,string>>({})
 const reload=useCallback(async()=>{
  if(!user||!token){setLoaded(true);return}
  const context=auth(user.id,token)
  const result=await Promise.allSettled([
    apiRequest<{staff:Staff}>({baseUrl:API,path:'/dealer/operational-staff',
      authHeaders:context}),
    apiRequest<{invitations:Invitation[]}>({
      baseUrl:API,path:'/dealer/staff-invitations/mine',authHeaders:context}),
    apiRequest<{scopes:{branches:ScopedBranch[]}}>({
      baseUrl:API,path:'/dealer/staff-branches/mine',authHeaders:context}),
    apiRequest<{ledger:{scopes:OwnerScope[]}}>({
      baseUrl:API,path:'/dealer/staff-branch-scopes/owner',authHeaders:context}),
    apiRequest<{workspace:{branches:SourceBranch[]}}>({
      baseUrl:API,path:'/dealer/operational-workspace',authHeaders:context}),
  ])
  setStaff(result[0].status==='fulfilled'?result[0].value.staff:null)
  setMine(result[1].status==='fulfilled'?result[1].value.invitations||[]:[])
  setMyBranches(result[2].status==='fulfilled'?result[2].value.scopes.branches||[]:[])
  setOwnerScopes(result[3].status==='fulfilled'?result[3].value.ledger.scopes||[]:[])
  const approvedBranches=result[4].status==='fulfilled'?
    result[4].value.workspace.branches||[]:[]
  setOwnerBranches(approvedBranches)
  setScopeBranchId(current=>current&&approvedBranches.some(b=>b.id===current)?
    current:approvedBranches[0]?.id||'')
  if(result.every(x=>x.status==='rejected'))
    setError('No active authorized dealer owner or received invitation is available')
  setLoaded(true)
 },[user,token])
 useEffect(()=>{
    // Defer request-driven state to the async phase, avoiding a redundant
    // synchronous render caused by setting loading state in an effect.
    let mounted=true
    void Promise.resolve().then(()=>{if(mounted)void reload()})
    return()=>{mounted=false}
  },[reload])
 async function invite(){
  if(!user||!token||!staff||busy||recipient.trim().length<2)return
  setBusy(true);setError('');setNotice('')
  try{
   const result=await apiRequest<{receipt:{invite_id:string;status:string}}>({
    baseUrl:API,path:'/dealer/staff-invitations',
    options:{method:'POST',body:JSON.stringify({
      invited_user_id:recipient.trim(),role:'member',
    })},authHeaders:auth(user.id,token),
   })
   setNotice('Private invitation '+result.receipt.invite_id+' created. The recipient must accept through their own CarUp account before any tenant membership exists.')
   setRecipient('');await reload()
  }catch(problem){
   setError(problem instanceof Error?problem.message:'Could not invite existing CarUp account')
  }finally{setBusy(false)}
 }
 async function action(inviteId:string,operation:'accept'|'revoke'){
  if(!user||!token||busy)return
  setBusy(true);setError('');setNotice('')
  try{
   const result=await apiRequest<{receipt:{status:string;canonical_member_created?:boolean}}>({
    baseUrl:API,path:'/dealer/staff-invitations/'+encodeURIComponent(inviteId)+'/'+operation,
    options:{method:'POST'},authHeaders:auth(user.id,token),
   })
   setNotice(operation==='accept'?
    'Invitation accepted: canonical limited member role recorded. No dealer-owner, vehicle seller, financial or branch-specific permissions were granted.':
    'Invitation or canonical limited membership revoked and recorded.')
   await reload()
   if(!result.receipt.status)throw new Error('Missing canonical invitation outcome')
  }catch(problem){
   setError(problem instanceof Error?problem.message:'Could not complete independent account-scoped staff operation')
  }finally{setBusy(false)}
 }
 async function grantScope(inviteId:string){
  if(!user||!token||busy||!scopeBranchId||scopeReason.trim().length<16)return
  setBusy(true);setError('');setNotice('')
  try{
   const result=await apiRequest<{receipt:{status:string;scope_id:string}}>({
    baseUrl:API,path:'/dealer/staff-branch-scopes',
    options:{method:'POST',body:JSON.stringify({
     invite_id:inviteId,branch_id:scopeBranchId,permission:'EDIT_BRANCH_DETAILS',
     reason:scopeReason.trim(),
    })},authHeaders:auth(user.id,token),
   })
   if(result.receipt.status!=='ACTIVE')throw Error('Branch scope grant was not recorded')
   setNotice('Explicit private branch-only operating access recorded. No vehicle selling or financial rights granted.')
   setScopeReason('');await reload()
  }catch(problem){
   setError(problem instanceof Error?problem.message:'Branch permission not recorded')
  }finally{setBusy(false)}
 }
 async function revokeScope(scopeId:string){
  if(!user||!token||busy)return
  setBusy(true);setError('');setNotice('')
  try{
   const result=await apiRequest<{receipt:{status:string}}>({
    baseUrl:API,path:'/dealer/staff-branch-scopes/'+encodeURIComponent(scopeId)+'/revoke',
    options:{method:'POST'},authHeaders:auth(user.id,token),
   })
   if(result.receipt.status!=='REVOKED')throw Error('Branch scope revocation not recorded')
   setNotice('Canonical branch scope revoked without altering platform or tenant membership.')
   await reload()
  }catch(problem){
   setError(problem instanceof Error?problem.message:'Branch scope revocation unavailable')
  }finally{setBusy(false)}
 }
 async function saveScopedHours(branch:ScopedBranch){
  if(!user||!token||busy||branch.permission!=='EDIT_BRANCH_DETAILS')return
  setBusy(true);setError('');setNotice('')
  try{
   const result=await apiRequest<{receipt:{private_declaration_only:boolean;
    public_snapshot_unchanged:boolean}}>({
    baseUrl:API,path:'/dealer/staff-branches/'+encodeURIComponent(branch.scope_id),
    options:{method:'PATCH',body:JSON.stringify({
     name:branch.name,address:branch.address,latitude:branch.latitude,
     longitude:branch.longitude,
     opening_hours_text:staffHours[branch.scope_id]??branch.opening_hours_text??'',
    })},authHeaders:auth(user.id,token),
   })
   if(result.receipt.private_declaration_only!==true||
      result.receipt.public_snapshot_unchanged!==true)
    throw Error('Canonical private branch receipt unavailable')
   setNotice('Authorized private branch operating hours saved. Public approved storefront remains unchanged.')
   await reload()
  }catch(problem){
   setError(problem instanceof Error?problem.message:'Branch edit unavailable')
  }finally{setBusy(false)}
 }
 return <main className="min-h-screen bg-slate-50 px-4 py-10">
  <div className="max-w-6xl mx-auto">
   <Link to="/dealers/operating-details" className="text-sm text-blue-700 underline">
    Dealership operating details
   </Link>
   <h1 className="text-3xl font-bold mt-5">Dealership staff and access</h1>
   <p className="max-w-4xl text-slate-600 mt-2">
    Existing verified CarUp accounts can be invited as limited staff in the
    actual Corporate organization and tenant. An invitation does not create a
    user, activate a company, change global roles or grant vehicle listing rights.
    The recipient must accept using their own account.
   </p>
   {!user&&<p role="alert" className="mt-6">Sign in to manage or accept an invitation.</p>}
   {!loaded&&<p className="mt-7" role="status">Reading actual account membership and invitations…</p>}
   <div className="grid lg:grid-cols-2 gap-6 mt-8">
    {staff&&<Card><CardContent className="p-6 space-y-4">
     <h2 className="font-semibold text-lg">Canonical organization staff</h2>
     <p className="text-sm text-slate-600">
      These entries come from existing tenant memberships, not an illustrative
      headcount or local permission toggle.
     </p>
     {staff.members.map(m=><div key={m.user_id} className="border-t py-3 text-sm">
      <p className="font-medium break-words">{m.user_id}</p>
      <p className="text-slate-600">Tenant role: {m.role}</p>
     </div>)}
     {staff.members.length===0&&<p className="text-sm text-slate-500">No tenant memberships recorded.</p>}
     <div className="border-t pt-4 space-y-3">
      <h3 className="font-semibold">Invite existing verified CarUp account</h3>
      <label htmlFor="staff-existing-user" className="block text-sm">
       Recipient's existing CarUp account ID
      </label>
      <Input id="staff-existing-user" value={recipient} maxLength={255}
       onChange={e=>setRecipient(e.target.value)}
       placeholder="Exact registered user account ID"/>
      <p className="text-xs text-slate-500">
       Limited staff member only. Owner, management, financial, branch-scoped
       and VIN seller grants are not delegated by this invitation.
      </p>
      <Button className={DEALER_WRAP_BUTTON} disabled={busy||recipient.trim().length<2}
       onClick={()=>{void invite()}}>Issue private staff invitation</Button>
     </div>
     {ownerBranches.length>0&&<div className="border-t pt-4 space-y-2">
      <h3 className="font-semibold">Approve branch-specific staff operations</h3>
      <p className="text-xs text-slate-600">
       Explicit legal-owner grant only after the recipient accepted canonical
       membership. Branch edit never grants inventory, payment or public publication rights.
      </p>
      <label className="block text-sm" htmlFor="staff-branch-scope-branch">
       Branch to delegate
      </label>
      <select id="staff-branch-scope-branch" className="w-full border rounded p-2"
       value={scopeBranchId} onChange={e=>setScopeBranchId(e.target.value)}>
       {ownerBranches.map(b=><option key={b.id} value={b.id}>
        {b.name||b.id}
       </option>)}
      </select>
      <label className="block text-sm" htmlFor="staff-branch-grant-reason">
       Record the operating delegation reason
      </label>
      <Input id="staff-branch-grant-reason" value={scopeReason}
       maxLength={1000} onChange={e=>setScopeReason(e.target.value)}
       placeholder="Why this staff member may maintain these branch details"/>
     </div>}
     <h3 className="font-semibold border-t pt-4">Recorded invitations</h3>
     {staff.invitations.map(i=><div key={i.invite_id}
       className="border rounded-lg p-3 text-sm">
      <p className="font-medium break-words">{i.invited_user_id}</p>
      <p>Status: {i.status}; role: {i.requested_role}</p>
      <p className="text-xs text-slate-500">Expires: {dealerDateTime(i.expires_at)}</p>
      {i.status==='ACCEPTED'&&ownerBranches.length>0&&
       <Button className={DEALER_WRAP_BUTTON_SM} size="sm" disabled={busy||scopeReason.trim().length<16}
        onClick={()=>{void grantScope(i.invite_id)}}>
        Grant limited branch edit access
       </Button>}
      {i.status!=='REVOKED'&&<Button className={DEALER_WRAP_BUTTON_SM} size="sm" variant="outline"
       disabled={busy} onClick={()=>{void action(i.invite_id,'revoke')}}>
       Revoke invitation or staff membership
      </Button>}
     </div>)}
     {staff.invitations.length===0&&<p className="text-sm text-slate-500">
      No invitations for this dealer.</p>}
     {ownerScopes.length>0&&<section className="space-y-2 border-t pt-3">
      <h3 className="font-semibold">Branch scope authorization ledger</h3>
      {ownerScopes.map(s=><div key={s.scope_id} className="border rounded p-2 text-xs">
       <p className="break-all">{s.branch_id} — {s.permission} — {s.status}</p>
       {s.status==='ACTIVE'&&<Button size="sm" variant="outline"
        disabled={busy} onClick={()=>{void revokeScope(s.scope_id)}}>
        Revoke branch operating scope
       </Button>}
      </div>)}
     </section>}
    </CardContent></Card>}
    <Card><CardContent className="p-6 space-y-4">
     <h2 className="font-semibold text-lg">Invitations sent to your account</h2>
     {!user?<p className="text-sm text-slate-600">Sign in to view your own invitations.</p>:
      mine.length===0?<p className="text-sm text-slate-600">
       No invitations are currently assigned to your authenticated account.
      </p>:mine.map(i=><div key={i.invite_id} className="border rounded-lg p-4 text-sm">
       <p className="font-medium">Organization: {i.organization_id}</p>
       <p>Status: {i.status}; role: {i.requested_role}</p>
       <p className="text-xs text-slate-500">
        Invitation expires: {dealerDateTime(i.expires_at)}
       </p>
       {i.status==='PENDING'&&<Button className={DEALER_WRAP_BUTTON_SM} size="sm" disabled={busy}
        onClick={()=>{void action(i.invite_id,'accept')}}>
        Accept limited staff membership in canonical tenant
       </Button>}
      </div>)}
     <p className="text-xs text-slate-600 mt-4">
      This is not role-based access to dealer finances or vehicle selling.
      Branch-specific operating details can only be changed with a separate
      current-owner grant, and never include seller, financial or compliance powers.
     </p>
    </CardContent></Card>
   </div>
   <section className="mt-8 border rounded-lg p-5 space-y-4 bg-white">
    <h2 className="font-semibold text-lg">Branch operations assigned to your account</h2>
    <p className="text-sm text-slate-600">
     These are your explicitly authorized canonical branches, checked against
     the current legal owner, tenant and organization membership on every request.
    </p>
    {myBranches.length===0&&<p className="text-sm text-slate-600">
     No active branch-operating scope was delegated to this account.
    </p>}
    {myBranches.map(b=><div key={b.scope_id} className="border rounded p-3 space-y-2">
     <p className="font-medium">{b.name}</p>
     <p className="text-sm">{b.address}</p>
     <p className="text-xs">Explicit scope: {b.permission}; never seller or payment rights.</p>
     {b.permission==='EDIT_BRANCH_DETAILS'&&<>
      <label className="block text-sm" htmlFor={'staff-branch-hours-'+b.scope_id}>
       Private opening hours for this branch
      </label>
      <Input id={'staff-branch-hours-'+b.scope_id}
       value={staffHours[b.scope_id]??b.opening_hours_text??''}
       onChange={e=>setStaffHours(current=>({...current,[b.scope_id]:e.target.value}))}
       maxLength={350}/>
      <Button className={DEALER_WRAP_BUTTON} disabled={busy} onClick={()=>{void saveScopedHours(b)}}>
       Save authorized branch operating details
      </Button>
     </>}
    </div>)}
   </section>
   {notice&&<p className="mt-6 p-4 bg-blue-50 text-blue-900 rounded-lg" role="status">{notice}</p>}
   {error&&<p className="mt-6 p-4 bg-red-50 text-red-800 rounded-lg" role="alert">{error}</p>}
  </div>
 </main>
}
