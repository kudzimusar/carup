/**
 * CARUP-DEALER-ONB-001-R3: real-browser 42171995160 showed a committed
 * canonical private VIN PATCH (200) followed by a rate-limited GET (429).
 * The UI must preserve the server's verified write receipt without treating
 * an unnecessary second network read as a failed write or reusing an old
 * listing eligibility result after changed inventory details.
 */
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import DealerTenantInventory from './DealerTenantInventory'

const fixture=vi.hoisted(()=>({
 requests:[] as Array<{path:string;method:string}>,
 unsafeReceipt:false,
 failCorrection:false,
}))
const VIN='TEST0000000000002'
vi.mock('@/context/AuthContext',()=>({
 useAuth:()=>({user:{id:'fictional-owner',role:'member'},token:'synthetic-session'}),
}))
vi.mock('@/lib/apiClient',()=>({
 resolveApiBaseUrl:()=> 'http://127.0.0.1:3001/api',
 apiRequest:async(request:{
  path:string;options?:{method?:string};
 })=>{
  const method=request.options?.method||'GET'
  fixture.requests.push({path:request.path,method})
  if(request.path==='/dealer/operational-inventory'&&method==='GET'){
   return {inventory:{
    owner_tenant_id:'fictional-tenant',returned_count:1,entries:[{
     vin:VIN,make:'FICTIONAL',model:'OLD CI MODEL',year:2026,
     recorded_mileage:123456,recorded_lifecycle_state:'Pending',
     recorded_marketplace_publication_state:'draft',
     seller_authority:'NOT_DETERMINED_BY_TENANT_INVENTORY_READ',
     legal_title_certified:false,import_duty_verified:false,
     branch_attribution:'NOT_VERIFIED_IN_CANONICAL_STOCK',
     public_listing_approved_by_this_read:false,
     listing_structural_precheck:{
      source:'EXISTING_MARKETPLACE_LISTING_ELIGIBILITY_RULES',
      blocking_reason_codes:[],result:'DATA_PRECHECK_ONLY',
      seller_authority_check:'NOT_EVALUATED',
      vehicle_passport_review:'NOT_EVALUATED',
      human_publication_authorized:false,merchant_payment_authorized:false,
     },
    }],
   }}
  }
  if(request.path==='/dealer/operational-inventory/private-drafts/'+VIN&&
     method==='PATCH'){
   if(fixture.failCorrection)throw Object.assign(new Error('Server refused update'),{status:409})
   return {draft:{
    vin:VIN,make:'FICTIONAL',model:'MODEL Y',year:2026,mileage:123999,
    recorded_marketplace_publication_state:'draft',
    private_tenant_draft_only:true,
    seller_publish_action_enabled:fixture.unsafeReceipt,
   }}
  }
  throw Error('Unexpected request '+method+' '+request.path)
 },
}))
function mount(){
 return render(<MemoryRouter><DealerTenantInventory/></MemoryRouter>)
}
async function edit(){
 await screen.findByRole('button',{name:'Edit private draft '+VIN})
 fireEvent.click(screen.getByRole('button',{name:'Edit private draft '+VIN}))
 fireEvent.change(document.querySelector('#edit-private-model')!,{
  target:{value:'MODEL Y'},
 })
 fireEvent.change(document.querySelector('#edit-private-mileage')!,{
  target:{value:'123999'},
 })
 fireEvent.click(screen.getByRole('button',{name:'Save private draft correction'}))
}
beforeEach(()=>{
 fixture.requests=[]
 fixture.unsafeReceipt=false
 fixture.failCorrection=false
})
describe('private VIN correction receipt under shared-IP rate limits',()=>{
 it('uses the DB-confirmed PATCH receipt and does not issue redundant inventory GET',async()=>{
  mount()
  await edit()
  expect(await screen.findByText(/Private VIN TEST0000000000002 corrected and persisted/))
   .toBeInTheDocument()
  expect(await screen.findByRole('heading',{name:'2026 FICTIONAL MODEL Y'}))
   .toBeInTheDocument()
  expect(screen.getByText(/Structural listing eligibility has not been rechecked since the edit/))
   .toBeInTheDocument()
  expect(screen.queryByText(/Recorded fields pass the existing Marketplace data-shape precheck/))
   .toBeNull()
  await waitFor(()=>expect(fixture.requests.filter(r=>r.method==='PATCH')).toHaveLength(1))
  expect(fixture.requests.filter(r=>r.method==='GET')).toHaveLength(1)
  expect(screen.getByText(/It remains a private draft, not approved for listing, sale or payment/))
   .toBeInTheDocument()
 })
 it('rejects a malicious publish-enabled write receipt instead of displaying success',async()=>{
  fixture.unsafeReceipt=true
  mount()
  await edit()
  expect(await screen.findByText('Private VIN correction receipt unavailable'))
   .toBeInTheDocument()
  expect(screen.queryByText(/corrected and persisted/)).toBeNull()
  expect(screen.queryByRole('heading',{name:'2026 FICTIONAL MODEL Y'})).toBeNull()
 })
 it('does not report success when the canonical PATCH is rejected',async()=>{
  fixture.failCorrection=true
  mount()
  await edit()
  expect(await screen.findByText('Server refused update')).toBeInTheDocument()
  expect(screen.queryByText(/corrected and persisted/)).toBeNull()
 })
})
