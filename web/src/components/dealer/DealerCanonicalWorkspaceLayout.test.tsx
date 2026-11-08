// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
import {cleanup,render,screen} from '@testing-library/react'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import DealerCanonicalWorkspaceLayout from './DealerCanonicalWorkspaceLayout'

const state=vi.hoisted(()=>({
  auth:{
    user:null as null|{id:string;role:string},
    token:null as string|null,
    loading:false,
  },
  request:vi.fn(),
}))
vi.mock('@/context/AuthContext',()=>({useAuth:()=>state.auth}))
vi.mock('@/components/routing/RegistryRouteBoundary',()=>({
  AuthBootstrapLoading:()=> <p>DEALER_AUTHORITY_LOADING</p>,
}))
vi.mock('@/lib/apiClient',()=>({
  resolveApiBaseUrl:()=> 'http://localhost:3001/api',
  apiRequest:state.request,
}))
vi.mock('@/lib/routeAccess',()=>({
  loginWithReturnTo:()=>'/login',
}))

const verified=(id:string)=>({
  workspace:{
    actor_id:id,operational:true,owner_membership_confirmed:true,
    tenant_id:'fake-tenant-uuid',organization_id:'synthetic-legal-company',
    dealer_profile_id:'synthetic-profile-id',
    profile:{legal_name:'FICTIONAL VERIFIED DEALER — CI ONLY'},
  },
})
function open(){
  return render(<MemoryRouter initialEntries={['/dealer/dashboard']}>
    <Routes>
      <Route element={<DealerCanonicalWorkspaceLayout/>}>
        <Route path="/dealer/dashboard" element={<p>CANONICAL_DEALER_DASHBOARD</p>}/>
      </Route>
      <Route path="/login" element={<p>LOGIN_REQUIRED</p>}/>
    </Routes>
  </MemoryRouter>)
}
describe('C15 canonical dealer dashboard gateway, not global-role shortcut',()=>{
 beforeEach(()=>{
   state.auth={user:null,token:null,loading:false}
   state.request.mockReset()
 })
 afterEach(()=>cleanup())
 it('lets a globally ordinary member operate only after verified tenant response',async()=>{
   state.auth={user:{id:'fictional-member',role:'member'},token:'fake-db-session',loading:false}
   state.request.mockResolvedValue(verified('fictional-member'))
   open()
   expect(screen.getByText('DEALER_AUTHORITY_LOADING')).toBeTruthy()
   expect(await screen.findByText('CANONICAL_DEALER_DASHBOARD')).toBeTruthy()
   expect(screen.getByRole('navigation',{name:'Approved dealership operations'})).toBeTruthy()
   expect(state.request).toHaveBeenCalledWith(expect.objectContaining({
     path:'/dealer/operational-workspace',
     authHeaders:expect.objectContaining({
       'x-session-token':'fake-db-session','x-user-id':'fictional-member',
     }),
   }))
 })
 it('never displays operations to a claimant without a canonical approved tenant',async()=>{
   state.auth={user:{id:'fictional-member',role:'member'},token:'fake-db-session',loading:false}
   state.request.mockRejectedValue(new Error('NO_ACTIVE_CANONICAL_DEALER_MEMBERSHIP'))
   open()
   expect(await screen.findByText('Dealership operating access unavailable')).toBeTruthy()
   expect(screen.queryByText('CANONICAL_DEALER_DASHBOARD')).toBeNull()
 })
 it('rejects a forged owner response for another authenticated user',async()=>{
   state.auth={user:{id:'claimant1',role:'dealer'},token:'fake-db-session',loading:false}
   state.request.mockResolvedValue(verified('claimant2'))
   open()
   expect(await screen.findByText('Dealership operating access unavailable')).toBeTruthy()
   expect(screen.queryByText('CANONICAL_DEALER_DASHBOARD')).toBeNull()
 })
 it('rejects backend data missing active compliance or owner confirmation',async()=>{
   state.auth={user:{id:'claimant1',role:'dealer'},token:'fake-db-session',loading:false}
   const response=verified('claimant1')
   response.workspace.owner_membership_confirmed=false
   state.request.mockResolvedValue(response)
   open()
   expect(await screen.findByText('Dealership operating access unavailable')).toBeTruthy()
   expect(screen.queryByText('CANONICAL_DEALER_DASHBOARD')).toBeNull()
 })
 it('requires actual login and never reads a local user.role as authorization',()=>{
   state.auth={user:{id:'claimant1',role:'dealer'},token:null,loading:false}
   open()
   expect(screen.getByText('LOGIN_REQUIRED')).toBeTruthy()
   expect(state.request).not.toHaveBeenCalled()
 })
})
