/**
 * CARUP-DEALER-UX-PROFILE-IMAGES-01-R1 — reviewer storefront-media ticket expiry UX.
 *
 * Media review tickets are single-use and expire after 10 minutes. The API refuses a spent, expired or
 * otherwise invalid ticket with 403 STOREFRONT_MEDIA_REVIEW_TICKET_INVALID. The page must say so in plain
 * language next to the action, offer an accessible refresh, never present a ticket a second time, and use
 * only the newly issued tickets after the refresh. The fake API below applies the same ticket rules as
 * backend/services/dealer/dealerStorefrontMediaService.js: a presented ticket is consumed BEFORE the
 * reviewer password is checked, and an expired or consumed ticket is refused.
 */
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import DealerFullStorefrontReview from './DealerFullStorefrontReview'

const SEED='ZW-DEAL-0901'
const MEDIA_ID='0a5a7a5d-1111-4aaa-8bbb-222222222222'
const PASSWORD='Correct-reviewer-pass-1'
const ALT='Wide navy banner labelled UAT Fictional Motors'
const EXPIRED='This review session has expired or is no longer valid. Refresh the review queue and try again.'
const REASON='Dealer-owned cover photograph; no OEM or third-party logo; alt text and caption are accurate.'

const api=vi.hoisted(()=>({
 generation:0,
 expired:new Set<string>(),
 consumed:new Set<string>(),
 presented:[] as string[],
 calls:[] as Array<{method:string;path:string}>,
 deferNextQueue:false,
 decided:false,
}))

function refusal(code:string,status=403){
 // What apiRequest throws for a dealer-route refusal body {error:code,code}.
 return Object.assign(new Error(code),{status,code,data:{error:code,code}})
}

// Stable references, as AuthContext provides: a new user object per render would re-run the page's
// queue load on every render (and issue new tickets each time), which the real app never does.
const auth=vi.hoisted(()=>({
 user:{id:'fictional-media-reviewer',role:'reviewer',email:'media-reviewer@example.invalid'},
 token:'synthetic-session',
}))
vi.mock('@/context/AuthContext',()=>({useAuth:()=>auth}))
vi.mock('@/lib/apiClient',()=>({
 resolveApiBaseUrl:()=>'http://127.0.0.1:3201/api',
 apiRequest:async({path,options}:{path:string;options?:{method?:string;body?:string}})=>{
  const method=options?.method||'GET'
  api.calls.push({method,path})
  if(method==='GET'&&path==='/admin/dealership/full-storefronts/queue')
   return {cases:[{seed_dealer_id:SEED,operating_status:'OPERATIONAL',independent_reviewer_required:true}]}
  if(method==='GET'&&path==='/admin/dealership/storefront-media/queue'){
   const deferred=api.deferNextQueue
   const generation=++api.generation
   return {items:[{
    media_id:MEDIA_ID,seed_dealer_id:SEED,branch_id:null,mime_type:'image/png',file_bytes:30822,
    media_category:'COMPANY_COVER_IMAGE',caption:'UAT fictional cover image',alt_text:ALT,
    rights_attestation:'DEALER_OWNED_PHOTOGRAPH_NO_OEM_OR_THIRD_PARTY_LOGO',
    review_status:api.decided?'APPROVED_PUBLIC_DISPLAY':'PENDING_INDEPENDENT_REVIEW',
    created_at:'2026-11-08T07:30:24.000Z',updated_at:'2026-11-08T07:30:24.000Z',
    independent_reviewer_required:true,conflict_of_interest:false,
    ticket_issuance_deferred:deferred,
    preview_ticket:deferred?null:'rt1.preview.gen'+generation,
    decision_ticket:deferred?null:'rt1.decision.gen'+generation,
    ticket_expires_at:deferred?null:'2026-11-08T10:40:00.000Z',
    logo_rights_approved:false,
   }]}
  }
  const body=JSON.parse(options?.body||'{}') as {review_ticket?:string;reviewer_password?:string;decision?:string}
  const ticket=String(body.review_ticket)
  const present=(operation:'preview'|'decision')=>{
   api.presented.push(ticket)
   if(!ticket.startsWith('rt1.'+operation+'.')||api.expired.has(ticket)||api.consumed.has(ticket))
    throw refusal('STOREFRONT_MEDIA_REVIEW_TICKET_INVALID')
   api.consumed.add(ticket)
   if(body.reviewer_password!==PASSWORD)throw refusal('REAUTHENTICATION_FAILED')
  }
  if(method==='POST'&&path==='/admin/dealership/storefront-media/'+SEED+'/preview'){
   present('preview')
   return {preview:{
    media_id:MEDIA_ID,seed_dealer_id:SEED,mime_type:'image/png',media_category:'COMPANY_COVER_IMAGE',
    caption:'UAT fictional cover image',alt_text:ALT,
    rights_attestation:'DEALER_OWNED_PHOTOGRAPH_NO_OEM_OR_THIRD_PARTY_LOGO',
    review_status:'PENDING_INDEPENDENT_REVIEW',sha256:'a'.repeat(64),expires_seconds:60,
    signed_url:'data:image/png;base64,iVBORw0KGgo=',logo_rights_approved:false,
   }}
  }
  if(method==='POST'&&path==='/admin/dealership/storefront-media/'+SEED+'/review'){
   present('decision')
   api.decided=true
   return {review:{
    event_id:'7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e5f',media_id:MEDIA_ID,seed_dealer_id:SEED,
    decision:body.decision,public_display_approved:body.decision==='APPROVED_PUBLIC_DISPLAY',
    logo_rights_approved:false,
   }}
  }
  throw new Error('Unexpected request '+method+' '+path)
 },
}))

beforeEach(()=>{
 api.generation=0;api.expired.clear();api.consumed.clear();api.presented.length=0
 api.calls.length=0;api.deferNextQueue=false;api.decided=false
})

const password=()=>document.querySelector<HTMLInputElement>('#storefront-password')!
const typePassword=(value=PASSWORD)=>fireEvent.change(password(),{target:{value}})
const posts=(suffix:string)=>api.calls.filter(c=>c.method==='POST'&&c.path.endsWith(suffix)).length
const queueReads=()=>api.calls.filter(c=>c.method==='GET'&&c.path==='/admin/dealership/storefront-media/queue').length

async function openMediaReview(){
 render(<MemoryRouter><DealerFullStorefrontReview/></MemoryRouter>)
 const section=await screen.findByTestId('dealer-media-review-section')
 await within(section).findByTestId('dealer-media-review-caption')
 return {
  section,
  previewButton:()=>within(section).getByRole('button',{name:'Preview private media binary'}),
  recordButton:()=>within(section).getByRole('button',{name:'Record storefront media decision'}),
 }
}

describe('storefront media review — expired or invalid review ticket',()=>{
 it('explains an expired preview ticket next to the action, focuses a refresh action and does not send the ticket again',async()=>{
  api.expired.add('rt1.preview.gen1')
  const {section,previewButton}=await openMediaReview()
  typePassword()
  fireEvent.click(previewButton())

  const panel=await within(section).findByTestId('dealer-media-review-refusal')
  expect(within(panel).getByRole('alert').textContent).toBe(EXPIRED)
  const refresh=within(panel).getByRole('button',{name:'Refresh review queue'})
  await waitFor(()=>expect(refresh).toHaveFocus())
  expect(screen.queryByText('STOREFRONT_MEDIA_REVIEW_TICKET_INVALID')).toBeNull()
  expect(within(section).queryByRole('img')).toBeNull()
  expect(password().value).toBe('')
  // The presented ticket cannot be presented again from this page — only a refresh unlocks the action.
  typePassword()
  expect(previewButton()).toBeDisabled()
  expect(posts('/preview')).toBe(1)
  expect(api.presented).toEqual(['rt1.preview.gen1'])
 })

 it('refreshes the queue on request, then the retried preview and decision present only the new tickets and succeed',async()=>{
  api.expired.add('rt1.preview.gen1')
  const {section,previewButton,recordButton}=await openMediaReview()
  typePassword()
  fireEvent.click(previewButton())
  const panel=await within(section).findByTestId('dealer-media-review-refusal')

  fireEvent.click(within(panel).getByRole('button',{name:'Refresh review queue'}))
  await waitFor(()=>expect(within(section).queryByTestId('dealer-media-review-refusal')).toBeNull())
  expect(queueReads()).toBe(2)
  expect(posts('/preview')).toBe(1) // refreshing re-sent nothing
  expect((await screen.findByRole('status')).textContent).toMatch(/new single-use review tickets/)
  await waitFor(()=>expect(password()).toHaveFocus())

  typePassword()
  fireEvent.click(previewButton())
  expect(await within(section).findByRole('img',{name:ALT})).toBeInTheDocument()
  typePassword()
  fireEvent.change(document.querySelector('#storefront-media-reason')!,{target:{value:REASON}})
  fireEvent.click(recordButton())
  expect(await screen.findByText(/Recorded storefront media decision APPROVED_PUBLIC_DISPLAY/)).toBeInTheDocument()
  expect(api.presented).toEqual(['rt1.preview.gen1','rt1.preview.gen2','rt1.decision.gen2'])
 })

 it('refuses an expired decision ticket once, reports nothing as recorded and does not retry the decision',async()=>{
  api.expired.add('rt1.decision.gen1')
  const {section,recordButton}=await openMediaReview()
  typePassword()
  fireEvent.change(document.querySelector('#storefront-media-reason')!,{target:{value:REASON}})
  fireEvent.click(recordButton())

  const panel=await within(section).findByTestId('dealer-media-review-refusal')
  expect(within(panel).getByRole('alert').textContent).toBe(EXPIRED)
  expect(screen.queryByText(/Recorded storefront media decision/)).toBeNull()
  typePassword()
  expect(recordButton()).toBeDisabled()
  expect(posts('/review')).toBe(1)
  expect(api.decided).toBe(false)
 })

 it('reports a wrong password as a wrong password and asks for a refresh because that attempt used the ticket',async()=>{
  const {section,previewButton}=await openMediaReview()
  typePassword('Not-the-reviewer-password-9')
  fireEvent.click(previewButton())

  const panel=await within(section).findByTestId('dealer-media-review-refusal')
  expect(within(panel).getByRole('alert').textContent).toMatch(/^That password is not correct, so nothing was recorded\./)
  expect(panel.textContent).not.toContain('has expired')
  expect(panel.textContent).toContain('Each review ticket works once. Refresh the review queue before you try again.')
  expect(within(panel).getByRole('button',{name:'Refresh review queue'})).toBeInTheDocument()
  typePassword()
  expect(previewButton()).toBeDisabled()
  expect(posts('/preview')).toBe(1)
 })

 it('says when new tickets could not be issued instead of silently leaving the actions disabled',async()=>{
  api.expired.add('rt1.preview.gen1')
  const {section,previewButton}=await openMediaReview()
  typePassword()
  fireEvent.click(previewButton())
  const panel=await within(section).findByTestId('dealer-media-review-refusal')
  api.deferNextQueue=true
  fireEvent.click(within(panel).getByRole('button',{name:'Refresh review queue'}))

  expect(await within(section).findByText(
   'New review tickets could not be issued for this item just now. Wait a few minutes, then refresh the review queue.',
  )).toBeInTheDocument()
  typePassword()
  expect(previewButton()).toBeDisabled()
  expect(posts('/preview')).toBe(1)
 })
})
