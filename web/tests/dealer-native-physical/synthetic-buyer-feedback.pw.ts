import {test,expect,type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'

/**
 * R3 C23: ONLY fictional buyer and escrow-trust SANDBOX intent, after the
 * real browser's independent synthetic country-policy and dealer activation.
 * Demonstrates the real UI, native Postgres transaction FK, distinct sessions
 * and password-protected immutable moderation. Never a verified sale/rating.
 */
type Actor={id:string;name:string;email:string;role:string;token:string}
type Fixture={source_type:string;source_population:number;seed:string;
 public_slug:string;synthetic_legal_policy_provenance:string;
 reviewer_password:string;actors:{claimant:Actor;buyer:Actor;reviewer:Actor};
 synthetic_operations:{feedback_transaction_id:string;tenant_id:string;
  fictional_only:true}}
const file=process.env.DEALER_BROWSER_FIXTURE_JSON
if(!file)throw Error('CANONICAL_BUYER_FEEDBACK_FIXTURE_MISSING')
const fixture=JSON.parse(readFileSync(file,'utf8')) as Fixture
if(fixture.source_type!=='EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX'||
 fixture.source_population!==104||fixture.seed!=='ZW-DEAL-0001'||
 fixture.synthetic_legal_policy_provenance!=='CI_ONLY_NOT_ACTUAL_ZIMBABWE_AUTHORITY'||
 fixture.synthetic_operations?.fictional_only!==true||
 !fixture.synthetic_operations.feedback_transaction_id||
 fixture.actors.buyer.id===fixture.actors.claimant.id||
 fixture.actors.buyer.id===fixture.actors.reviewer.id)
 throw Error('BUYER_FEEDBACK_TEST_REQUIRES_EXPLICITLY_SYNTHETIC_INDEPENDENT_ACTORS')

const API='http://127.0.0.1:3001/api'
const hdr=(actor:Actor)=>({'x-user-id':actor.id,'x-session-token':actor.token})
async function mutationHeaders(page:Page,actor:Actor){
 // Direct Playwright API requests do not pass through web/src/lib/apiClient.
 // Obtain the real signed token in the SAME browser session and identity.
 // A missing token yields a global CSRF 403, not the domain-specific denial
 // we intend to certify for a forged buyer or failed reviewer password.
 const tokenResponse=await page.request.get(API+'/security/csrf-token',{
  headers:hdr(actor),
 })
 expect(tokenResponse.status()).toBe(200)
 const {csrfToken}=await tokenResponse.json() as {csrfToken:string}
 expect(csrfToken).toMatch(/\.[0-9a-f]{64}$/)
 return {...hdr(actor),'x-csrf-token':csrfToken}
}
async function login(page:Page,actor:Actor){
 await page.addInitScript(({user,token}:{user:Omit<Actor,'token'>;token:string})=>{
  localStorage.setItem('carup_user',JSON.stringify(user))
  localStorage.setItem('carup_token',token)
 },{user:{id:actor.id,name:actor.name,email:actor.email,role:actor.role},
   token:actor.token})
}
test('FICTIONAL buyer private complaint → immutable canonical receipt → separate reviewer password finding; zero public stars/money',async({browser},info)=>{
 test.setTimeout(420000)
 await new Promise<void>(r=>setTimeout(r,70_000))
 const buyerCtx=await browser.newContext({viewport:{width:390,height:844}})
 const buyer=await buyerCtx.newPage()
 await login(buyer,fixture.actors.buyer)
 await buyer.goto('/dealers/feedback')
 await expect(buyer.getByRole('heading',{
  name:'Private buyer feedback and complaints',
 })).toBeVisible({timeout:30000})
 await expect(buyer.locator('#buyer-dealer-transaction option')).toHaveCount(1,{
  timeout:30000,
 })
 const selected=await buyer.locator('#buyer-dealer-transaction').inputValue()
 expect(selected).toBe(fixture.synthetic_operations.feedback_transaction_id)
 const text='FICTIONAL CI-only buyer complaint about a nonexistent vehicle and no actual payment. This case demonstrates canonical transaction matching, private content and independent moderation.'
 await buyer.locator('#buyer-case-description').fill(text)
 await buyer.getByRole('button',{name:'Submit private buyer case'}).click()
 await expect(buyer.getByText('Private buyer case recorded.',{exact:false}))
  .toBeVisible({timeout:30000})
 await expect(buyer.getByText('BUYER COMPLAINT',{exact:false}).first())
  .toBeVisible({timeout:30000})
 const buyerShot=info.outputPath('fictional-buyer-private-complaint-mobile-390px.png')
 await buyer.screenshot({path:buyerShot,fullPage:true})
 await info.attach('fictional-buyer-private-complaint-mobile-390px',{
  path:buyerShot,contentType:'image/png',
 })
 const own=await buyer.request.get(API+'/dealership/buyer-feedback/mine',{
  headers:hdr(fixture.actors.buyer),
 })
 expect(own.status()).toBe(200)
 const history=await own.json() as {entries:Array<{transaction_id:string}>;
  cases:Array<{case_id:string;case_type:string;transaction_intent_id:string}>;
  public_ratings_activated:boolean}
 expect(history.cases).toHaveLength(1)
 expect(history.entries).toHaveLength(1)
 expect(history.cases[0].transaction_intent_id)
  .toBe(fixture.synthetic_operations.feedback_transaction_id)
 expect(history.public_ratings_activated).toBe(false)

 // False buyers and claimants cannot copy an escrow ID to create reviews.
 const attackerCtx=await browser.newContext()
 const attacker=await attackerCtx.newPage()
 await login(attacker,fixture.actors.claimant)
 const crossRead=await attacker.request.get(API+'/dealership/buyer-feedback/mine',{
  headers:hdr(fixture.actors.claimant),
 })
 expect(crossRead.status()).toBe(200)
 const hidden=await crossRead.json() as {entries:unknown[];cases:unknown[]}
 expect(hidden.entries).toHaveLength(0)
 expect(hidden.cases).toHaveLength(0)
 const crossWrite=await attacker.request.post(API+'/dealership/buyer-feedback/cases',{
  headers:await mutationHeaders(attacker,fixture.actors.claimant),
  data:{seed_dealer_id:fixture.seed,
   transaction_id:fixture.synthetic_operations.feedback_transaction_id,
   case_type:'BUYER_COMPLAINT',
   statement:'FICTIONAL cross-buyer forged case must not be recorded or made public.'},
 })
 expect(crossWrite.status()).toBe(409)
 expect((await crossWrite.json() as {error:string}).error)
  .toBe('PRIVATE_BUYER_CASE_REJECTED_BY_CANONICAL_AUTHORITY')
 // Before a third authenticated browser identity enters, let the real
 // production-equivalent 100/min GLOBAL loopback IP budget reset. The buyer,
 // claimant, platform shell and CSRF requests are all genuine HTTP requests;
 // disabling the rate limiter would invalidate this physical evidence.
 await attacker.waitForTimeout(70_000)

 // Queue reveals metadata only; a separate reviewer must reauthenticate to
 // inspect the actual statement and reauthenticate again for the finding.
 const reviewCtx=await browser.newContext({viewport:{width:1280,height:900}})
 const review=await reviewCtx.newPage()
 await login(review,fixture.actors.reviewer)
 await review.goto('/admin/dealer-buyer-feedback')
 await expect(review.getByRole('heading',{
  name:'Independent buyer complaint review',
 })).toBeVisible({timeout:30000})
 await expect(review.getByText(fixture.seed,{exact:false}).first())
  .toBeVisible({timeout:30000})
 const selectedCase=history.cases[0].case_id
 const forbidden=await review.request.post(
  API+'/admin/dealership/buyer-feedback/'+selectedCase+'/preview',{
   headers:await mutationHeaders(review,fixture.actors.reviewer),
   data:{reviewer_password:'intentionally-wrong-reviewer-password'},
  })
 expect(forbidden.status()).toBe(403)
 await expect(review.getByText(text)).toHaveCount(0)
 await review.locator('#buyer-feedback-review-password')
  .fill(fixture.reviewer_password)
 await review.getByRole('button',{
  name:'Inspect private buyer statement',
 }).click()
 await expect(review.getByText(text,{exact:true}))
  .toBeVisible({timeout:25000})
 await review.locator('#buyer-case-finding')
  .selectOption('REFERRED_TO_CANONICAL_DISPUTE')
 await review.locator('#buyer-case-rationale')
  .fill('FICTIONAL CI-only independent reviewer confirms this is a privately recorded buyer complaint linked to a synthetic sandbox escrow intent. Any actual dispute remains with the canonical escrow/dispute authority.')
 await review.locator('#buyer-feedback-review-password')
  .fill(fixture.reviewer_password)
 await review.getByRole('button',{
  name:'Record immutable private finding',
 }).click()
 await expect(review.getByText('Independent private finding recorded.',{exact:false}))
  .toBeVisible({timeout:30000})
 const reviewShot=info.outputPath('fictional-independent-private-buyer-case-review.png')
 await review.screenshot({path:reviewShot,fullPage:true})
 await info.attach('fictional-independent-private-buyer-case-review',{
  path:reviewShot,contentType:'image/png',
 })
 const queue=await review.request.get(
  API+'/admin/dealership/buyer-feedback/queue',{
    headers:hdr(fixture.actors.reviewer),
  })
 expect(queue.status()).toBe(200)
 const queueData=await queue.json() as {cases:Array<{case_id:string}>}
 expect(queueData.cases.some(x=>x.case_id===selectedCase)).toBe(false)
 await Promise.all([reviewCtx.close(),attackerCtx.close(),buyerCtx.close()])
 console.log('DEALER_FICTIONAL_PRIVATE_BUYER_FEEDBACK_BROWSER PASS: 390px real buyer, different reviewer password, canonical escrow FK and SQL private finding; cross-buyer forbidden, no public verified review/payment')
})
