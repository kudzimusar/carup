/**
 * CARUP-DEALER-ONB-001-LR01-R4 P0-2: the dealer listing panel never publishes through the dealership
 * domain. It prepares dealer-declared facts, sends documents to the CANONICAL evidence route and
 * calls the CANONICAL publish gate with the dealer's verified tenant context only when that gate
 * itself reports the vehicle publishable. Fictional data only.
 */
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import DealerVinListingPanel from './DealerVinListingPanel'

const VIN='SYNTHR4P02DLR0001'
const fx=vi.hoisted(()=>({
 requests:[] as Array<{path:string;method:string;headers:Record<string,string>;body:unknown}>,
 readiness:null as unknown,
 publishRefusal:false,
}))
const req=(r:{path:string;method:string})=>r
vi.mock('@/lib/apiClient',()=>({
 resolveApiBaseUrl:()=> 'http://127.0.0.1:3001/api',
 apiRequest:async(request:{path:string;options?:{method?:string;body?:string};authHeaders?:Record<string,string>})=>{
  const method=request.options?.method||'GET'
  fx.requests.push({path:request.path,method,headers:request.authHeaders||{},
   body:request.options?.body?JSON.parse(request.options.body):null})
  if(request.path.endsWith('/listing-readiness'))return {readiness:fx.readiness}
  if(request.path.endsWith('/publish')&&fx.publishRefusal){
   throw Object.assign(new Error('HTTP 400'),{status:400,data:{
    error:'Listing is not publishable yet. Resolve the blocking requirements first.',
    requirements:[{key:'seller_authority',label:'Seller authority to list this vehicle',status:'pending_review',blocking:true,who_must_act:'carup_review'}]}})
  }
  return {ok:true}
 },
}))
const readiness=(over:Record<string,unknown>={})=>({
 vin:VIN,dealer_operating_authority_current:true,governed_seller_is_approved_owner:false,
 listing_candidate_prepared:false,branch_id:null,recorded_marketplace_publication_state:'draft',
 canonical_gate:{is_publishable:false,completeness_percent:57,requirements:[
  {key:'seller_authority',label:'Seller authority to list this vehicle',status:'missing',blocking:true,who_must_act:'seller'}]},
 publish_route:null,dealer_domain_can_publish:false,...over,
})
const renderPanel=()=>render(<MemoryRouter><DealerVinListingPanel vin={VIN} tenantId="fictional-tenant"
 userId="fictional-owner" token="synthetic-session" branches={[{id:'11111111-2222-4333-8444-555555555555',name:'Fictional Branch'}]}
 onChanged={()=>{}}/></MemoryRouter>)

describe('DealerVinListingPanel',()=>{
 beforeEach(()=>{fx.requests=[];fx.publishRefusal=false})

 it('prepares dealer-declared facts through the dealership route only — never publication fields',async()=>{
  fx.readiness=readiness()
  renderPanel()
  await screen.findByRole('form',{name:`Prepare ${VIN} for Marketplace`})
  fireEvent.change(screen.getByLabelText('Asking price'),{target:{value:'18500'}})
  fireEvent.change(screen.getByLabelText('Chassis number'),{target:{value:'FICT-CHASSIS-1'}})
  fireEvent.change(screen.getByLabelText('Engine number'),{target:{value:'FICT-ENGINE-1'}})
  fireEvent.change(screen.getByLabelText('City shown to buyers'),{target:{value:'Harare'}})
  fireEvent.click(screen.getByRole('button',{name:'Save listing facts (stays private)'}))
  await waitFor(()=>expect(fx.requests.some(r=>r.path.endsWith('/listing-preparation'))).toBe(true))
  const prep=fx.requests.find(r=>r.path.endsWith('/listing-preparation'))!
  expect(prep.method).toBe('POST')
  expect(prep.headers['x-tenant-id']).toBeUndefined()
  expect(prep.body).toMatchObject({price:18500,currency:'USD',listing_city:'Harare',location_visibility:'public'})
  expect(Object.keys(prep.body as object)).not.toContain('publication_status')
 })

 it('keeps Publish disabled until the CANONICAL gate itself reports the vehicle publishable',async()=>{
  fx.readiness=readiness({listing_candidate_prepared:true,governed_seller_is_approved_owner:true,
   canonical_gate:{is_publishable:false,completeness_percent:86,requirements:[
    {key:'seller_authority',label:'Seller authority to list this vehicle',status:'pending_review',blocking:true,who_must_act:'carup_review'}]}})
  renderPanel()
  const button=await screen.findByRole('button',{name:'Publish (blocked until checks are met)'})
  expect((button as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText(/Awaiting independent CarUp review/)).toBeTruthy()
  expect(fx.requests.filter(r=>r.path.endsWith('/publish'))).toHaveLength(0)
 })

 it('publishes through the canonical route with the verified dealer tenant context, and shows a gate refusal',async()=>{
  fx.readiness=readiness({listing_candidate_prepared:true,governed_seller_is_approved_owner:true,
   canonical_gate:{is_publishable:true,completeness_percent:100,requirements:[]}})
  fx.publishRefusal=true
  renderPanel()
  fireEvent.click(await screen.findByRole('button',{name:'Publish on CarUp Marketplace'}))
  await screen.findByText(/Seller authority to list this vehicle — Awaiting independent CarUp review/)
  const publish=fx.requests.find(r=>r.path===`/vehicles/${VIN}/publish`)!
  expect(publish.method).toBe('POST')
  expect(publish.headers['x-tenant-id']).toBe('fictional-tenant')
  expect(publish.headers['x-stakeholder-role']).toBe('dealer')
  expect(req(publish).path).not.toContain('/dealer/')
 })

 it('fails closed when the dealer operating authority is not current',async()=>{
  fx.readiness=readiness({dealer_operating_authority_current:false})
  renderPanel()
  await screen.findByText('NOT current — listing disabled')
  expect(screen.queryByRole('form',{name:`Prepare ${VIN} for Marketplace`})).toBeNull()
  expect(screen.queryByRole('button',{name:/Publish/})).toBeNull()
 })
})
