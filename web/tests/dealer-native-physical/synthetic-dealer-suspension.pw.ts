import {test,expect,type Page} from '@playwright/test'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {dirname} from 'node:path'

/**
 * CARUP-DEALER-ONB-001-LR01-R4 P0-2 — PHASE SEVEN (last): suspension/revocation removes seller and
 * public eligibility. The fictional dealership reviewer REVOKES the approved claim through the real
 * claim workbench (password step-up). The data layer must then have withdrawn the published VIN, and
 * every path back is closed: Marketplace search/detail, storefront stock, dealer workspace, canonical
 * republish and new enquiries. EXPLICITLY FICTIONAL; disposable native PostgreSQL only.
 */
type Actor={id:string;name:string;email:string;role:string;token:string}
type Fixture={actors:{claimant:Actor;reviewer:Actor;vehicle_buyer:Actor;activator:Actor}
 reviewer_password:string;activator_password:string;public_slug:string;seed:string;listing_vin:string;source_type:string
 listing_phase_provenance:string}
const file=process.env.DEALER_BROWSER_FIXTURE_JSON
if(!file)throw Error('SUSPENSION_CI_FIXTURE_MISSING')
const f=JSON.parse(readFileSync(file,'utf8')) as Fixture
if(f.source_type!=='EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX'||
 f.listing_phase_provenance!=='CI_ONLY_FICTIONAL_DEALER_STOCK_NOT_A_REAL_VEHICLE')
 throw Error('NON_SYNTHETIC_SUSPENSION_GATE')
const API='http://127.0.0.1:3001/api'
const VIN=f.listing_vin
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))
async function actorOn(page:Page,actor:Actor){
 await page.addInitScript(({user,token}:{user:Omit<Actor,'token'>;token:string})=>{
  localStorage.setItem('carup_user',JSON.stringify(user))
  localStorage.setItem('carup_token',token)
 },{user:{id:actor.id,name:actor.name,email:actor.email,role:actor.role},token:actor.token})
}
function writeReceipt(name:string,receipt:Record<string,unknown>){
 const out='test-results/'+name
 mkdirSync(dirname(out),{recursive:true})
 writeFileSync(out,JSON.stringify(receipt,null,2)+'\n',{mode:0o600})
}
const ids=(a:Actor,extra:Record<string,string>={})=>({'x-user-id':a.id,'x-session-token':a.token,...extra})
async function unsafe(page:Page,a:Actor,method:'POST'|'PATCH',path:string,data:unknown,extra:Record<string,string>={}){
 const t=await page.request.get(API+'/security/csrf-token',{headers:ids(a,extra)})
 const j=await t.json() as {csrfToken?:string;token?:string;csrf_token?:string}
 return page.request.fetch(API+path,{method,data,headers:{...ids(a,extra),
  'x-csrf-token':j.csrfToken||j.token||j.csrf_token||'','content-type':'application/json'}})
}

// R6 E (C12): the lifecycle reviewer WORKBENCH, physically. Suspension withdraws stock and every
// canonical write is a documented 409; the suspending reviewer cannot reinstate (dual control);
// a different reviewer reinstates; nothing is republished until the owner deliberately republishes.
test('FICTIONAL C12 workbench: suspend withdraws stock, dual-control reinstate, deliberate republish',async({browser},info)=>{
 test.setTimeout(900_000)
 await pause(70_000)
 const ownerContext=await browser.newContext({viewport:{width:1280,height:900}})
 const owner=await ownerContext.newPage()
 const before=await owner.request.get(API+'/dealer/operational-inventory',{headers:ids(f.actors.claimant)})
 expect(before.status()).toBe(200)
 const tenantId=(await before.json() as {inventory:{owner_tenant_id:string}}).inventory.owner_tenant_id
 const tenantCtx={'x-tenant-id':tenantId,'x-stakeholder-role':'dealer'}
 expect((await owner.request.get(API+'/marketplace/listings/'+VIN)).status()).toBe(200)
 const decide=async(page:Page,action:string,password:string,why:string)=>{
  await page.locator('#lifecycle-action').selectOption(action)
  await page.locator('#lifecycle-reason').fill(why)
  await page.locator('#lifecycle-password').fill(password)
  await page.getByRole('button',{name:'Record immutable lifecycle decision'}).click()
 }
 // ── Reviewer A suspends through the workbench (its own queue of activated dealerships) ──
 const aContext=await browser.newContext({viewport:{width:1280,height:900}})
 const a=await aContext.newPage()
 await actorOn(a,f.actors.reviewer)
 await a.goto('/admin/dealer-operating-lifecycle')
 await expect(a.getByRole('heading',{name:'Dealership operating lifecycle'})).toBeVisible({timeout:30000})
 await a.getByRole('button',{name:new RegExp(f.seed+'.*ACTIVE')}).click()
 await expect(a.getByTestId('lifecycle-status')).toHaveText('ACTIVE',{timeout:30000})
 await decide(a,'SUSPEND',f.reviewer_password,
  'Fictional CI C12 suspension: proves the workbench removes public dealer stock immediately. No real business.')
 await expect(a.getByText(/Lifecycle decision recorded: SUSPEND → SUSPENDED\. Public listings withdrawn: 1\./)).toBeVisible({timeout:40000})
 await expect(a.getByTestId('lifecycle-status')).toHaveText('SUSPENDED',{timeout:30000})
 const suspendShot=info.outputPath('r6-c12-workbench-suspended-1280.png')
 await a.screenshot({path:suspendShot,fullPage:true})
 await info.attach('r6-c12-workbench-suspended-1280',{path:suspendShot,contentType:'image/png'})
 // Dual control: the reviewer who suspended cannot reinstate.
 await decide(a,'REINSTATE',f.reviewer_password,
  'Fictional CI C12: the suspending reviewer attempts reinstatement, which dual control must refuse.')
 await expect(a.getByText(/^Not recorded:.*REINSTATEMENT_REQUIRES_DIFFERENT_REVIEWER/)).toBeVisible({timeout:40000})
 await expect(a.getByTestId('lifecycle-status')).toHaveText('SUSPENDED')
 await aContext.close()
 await pause(70_000)

 // ── While suspended: no public detail; canonical republish and new enquiry are documented 409s ──
 expect((await owner.request.get(API+'/marketplace/listings/'+VIN)).status()).toBe(404)
 const suspendedPublish=await unsafe(owner,f.actors.claimant,'POST','/vehicles/'+VIN+'/publish',{},tenantCtx)
 expect(suspendedPublish.status()).toBe(409)
 expect((await suspendedPublish.json() as {error:{code:string}}).error.code).toBe('DEALER_LISTING_AUTHORITY_NOT_CURRENT')
 // The suspended owner is TOLD what happened and what the way back is (R6 functional).
 await actorOn(owner,f.actors.claimant)
 await owner.goto('/dealers/claims')
 await expect(owner.getByTestId('dealer-authority-status'))
  .toContainText('An independent CarUp reviewer suspended your dealership operations.',{timeout:30000})
 await expect(owner.getByTestId('dealer-authority-status'))
  .toContainText('a different independent CarUp reviewer must review and reinstate')
 const ownerSuspendedShot=info.outputPath('r6-owner-sees-suspension-and-next-step-1280.png')
 await owner.screenshot({path:ownerSuspendedShot,fullPage:true})
 await info.attach('r6-owner-sees-suspension-and-next-step-1280',{path:ownerSuspendedShot,contentType:'image/png'})
 const buyerContext=await browser.newContext({viewport:{width:390,height:844}})
 const buyer=await buyerContext.newPage()
 const suspendedEnquiry=await unsafe(buyer,f.actors.vehicle_buyer,'POST','/marketplace/inquiries',{
  listing_id:VIN,inquiry_type:'vehicle_purchase_interest',source_channel:'web',
  message:'FICTIONAL CI: enquiry to a suspended dealership must be refused'})
 expect(suspendedEnquiry.status()).toBe(409)
 await buyerContext.close()
 await pause(70_000)

 // ── A DIFFERENT reviewer reinstates; nothing is republished automatically ──
 const bContext=await browser.newContext({viewport:{width:1280,height:900}})
 const b=await bContext.newPage()
 await actorOn(b,f.actors.activator)
 await b.goto('/admin/dealer-operating-lifecycle')
 await b.getByRole('button',{name:new RegExp(f.seed+'.*SUSPENDED')}).click()
 await expect(b.getByTestId('lifecycle-status')).toHaveText('SUSPENDED',{timeout:30000})
 // The reinstating reviewer sees the recorded suspension reason before deciding.
 await expect(b.getByTestId('lifecycle-history')).toContainText('Reason: Fictional CI C12 suspension')
 await decide(b,'REINSTATE',f.activator_password,
  'Fictional CI C12 dual-control reinstatement by a different independent reviewer after the synthetic review.')
 await expect(b.getByText(/Lifecycle decision recorded: REINSTATE → ACTIVE\..*Nothing was republished\./)).toBeVisible({timeout:40000})
 await expect(b.getByTestId('lifecycle-history')).toContainText('SUSPEND')
 const reinstateShot=info.outputPath('r6-c12-workbench-dual-control-reinstated-1280.png')
 await b.screenshot({path:reinstateShot,fullPage:true})
 await info.attach('r6-c12-workbench-dual-control-reinstated-1280',{path:reinstateShot,contentType:'image/png'})
 await bContext.close()
 expect((await owner.request.get(API+'/marketplace/listings/'+VIN)).status()).toBe(404)
 await pause(70_000)

 // ── The owner deliberately republishes through the ONE canonical gate ──
 const republished=await unsafe(owner,f.actors.claimant,'POST','/vehicles/'+VIN+'/publish',{},tenantCtx)
 expect(republished.status()).toBe(200)
 expect((await republished.json() as {publication_status:string}).publication_status).toBe('published')
 expect((await owner.request.get(API+'/marketplace/listings/'+VIN)).status()).toBe(200)
 await ownerContext.close()
 writeReceipt('fictional-native-c12-workbench-browser-receipt.json',{fictional_only:true,vin:VIN,
  suspended_by:f.actors.reviewer.id,reinstated_by:f.actors.activator.id,
  suspending_reviewer_reinstate_refused:true,suspended_publish_status:409,suspended_enquiry_status:409,
  auto_republished_on_reinstatement:false,owner_deliberate_republish_status:200})
 await pause(70_000)
})

test('FICTIONAL revocation withdraws the dealer listing and closes every public, seller and enquiry path',async({browser},info)=>{
 test.setTimeout(900_000)
 await pause(70_000)
 // Owner tenant context is read BEFORE revocation (afterwards the workspace is correctly refused).
 const ownerContext=await browser.newContext({viewport:{width:1280,height:900}})
 const owner=await ownerContext.newPage()
 const before=await owner.request.get(API+'/dealer/operational-inventory',{headers:ids(f.actors.claimant)})
 expect(before.status()).toBe(200)
 const tenantId=(await before.json() as {inventory:{owner_tenant_id:string}}).inventory.owner_tenant_id
 const tenantCtx={'x-tenant-id':tenantId,'x-stakeholder-role':'dealer'}
 const publicBefore=await owner.request.get(API+'/marketplace/listings/'+VIN)
 expect(publicBefore.status()).toBe(200)

 // ── Independent reviewer revokes the approved claim through the real workbench ──
 const reviewerContext=await browser.newContext({viewport:{width:1280,height:900}})
 const reviewer=await reviewerContext.newPage()
 await actorOn(reviewer,f.actors.reviewer)
 await reviewer.goto('/admin/dealer-claims')
 await expect(reviewer.getByRole('heading',{name:'Independent dealership claim review'})).toBeVisible({timeout:30000})
 await reviewer.getByRole('button',{name:new RegExp(f.seed+'.*CLAIM APPROVED')}).first().click()
 await reviewer.locator('#claim-verdict').selectOption('CLAIM_REVOKED')
 await reviewer.locator('#claim-review-reason').fill(
  'Fictional CI revocation: the synthetic claimant authority is withdrawn to prove that dealer stock leaves the public surface immediately. No real business is affected.')
 await reviewer.locator('#claim-reviewer-password').fill(f.reviewer_password)
 await reviewer.getByRole('button',{name:'Record immutable review decision'}).click()
 await expect(reviewer.getByText('Independent claim decision recorded: CLAIM_REVOKED',{exact:false}))
  .toBeVisible({timeout:40000})
 const revokeShot=info.outputPath('r4-independent-claim-revocation-recorded-1280.png')
 await reviewer.screenshot({path:revokeShot,fullPage:true})
 await info.attach('r4-independent-claim-revocation-recorded-1280',{path:revokeShot,contentType:'image/png'})
 await reviewerContext.close()
 await pause(70_000)

 // ── Public surface: search, detail and storefront stock no longer show the VIN ──
 const guestContext=await browser.newContext({viewport:{width:390,height:844}})
 const guest=await guestContext.newPage()
 const search=await guest.request.get(API+'/marketplace/listings?limit=24')
 expect(search.status()).toBe(200)
 expect((await search.json() as {listings:Array<{vin:string}>}).listings.map(x=>x.vin)).not.toContain(VIN)
 const detail=await guest.request.get(API+'/marketplace/listings/'+VIN)
 expect(detail.status()).toBe(404)
 const stock=await guest.request.get(API+'/dealership/research/'+f.seed+'/inventory')
 expect(stock.status()).toBe(200)
 expect((await stock.json() as {inventory:{entries:unknown[]}}).inventory.entries).toHaveLength(0)
 const mediaAfter=await guest.request.get(API+'/dealership/research/'+f.seed+'/media')
 expect(mediaAfter.status()).toBe(200)
 expect((await mediaAfter.json() as {media:{items:unknown[]}}).media.items).toHaveLength(0)
 await guest.goto('/dealers/'+f.public_slug)
 await expect(guest.getByTestId('dealer-storefront-inventory')).toHaveCount(0,{timeout:30000})
 await expect(guest.getByTestId('dealer-storefront-media-gallery')).toHaveCount(0)
 await expect(guest.getByText(VIN)).toHaveCount(0)
 const publicShot=info.outputPath('r4-revoked-dealer-storefront-no-stock-390.png')
 await guest.screenshot({path:publicShot,fullPage:true})
 await info.attach('r4-revoked-dealer-storefront-no-stock-390',{path:publicShot,contentType:'image/png'})
 await guestContext.close()

 // ── Seller paths: dealer workspace refused; canonical republish refused by the data layer ──
 const workspace=await owner.request.get(API+'/dealer/operational-inventory',{headers:ids(f.actors.claimant)})
 expect([403,404]).toContain(workspace.status())
 const republish=await unsafe(owner,f.actors.claimant,'POST','/vehicles/'+VIN+'/publish',{},tenantCtx)
 // R6 B: a data-layer refusal is a documented 409 with a stable code — never a 500.
 expect(republish.status()).toBe(409)
 const republishBody=await republish.json() as {error:{code:string;message:string}}
 expect(republishBody.error.code).toBe('DEALER_LISTING_AUTHORITY_NOT_CURRENT')
 expect(republishBody.error.message).toBe('This dealership is not currently authorised to list vehicles on CarUp.')
 // Replay of the same publication is refused identically and changes nothing.
 const replay=await unsafe(owner,f.actors.claimant,'POST','/vehicles/'+VIN+'/publish',{},tenantCtx)
 expect(replay.status()).toBe(409)
 expect((await replay.json() as {error:{code:string}}).error.code).toBe('DEALER_LISTING_AUTHORITY_NOT_CURRENT')
 await actorOn(owner,f.actors.claimant)
 await owner.goto('/dealers/stock')
 await expect(owner.getByText(VIN)).toHaveCount(0,{timeout:30000})
 await ownerContext.close()

 // ── Enquiry path: a buyer cannot reach the withdrawn dealer ──
 const buyerContext=await browser.newContext({viewport:{width:768,height:1024}})
 const buyer=await buyerContext.newPage()
 const enquiry=await unsafe(buyer,f.actors.vehicle_buyer,'POST','/marketplace/inquiries',{
  listing_id:VIN,inquiry_type:'vehicle_purchase_interest',source_channel:'web',
  message:'FICTIONAL CI: enquiry after revocation must be refused'})
 expect(enquiry.status()).toBe(409)
 const enquiryBody=await enquiry.json() as {error:{code:string}}
 expect(['DEALER_INQUIRY_AUTHORITY_NOT_CURRENT','DEALER_LISTING_AUTHORITY_NOT_CURRENT'])
  .toContain(enquiryBody.error.code)
 await buyerContext.close()
 await pause(70_000)

 // ── R5 S08, T42 & S09: Multi-record directory filtering, source takedown review, and duplicate canonical redirect ──
 const r5ReviewerCtx=await browser.newContext({viewport:{width:1280,height:900}})
 const r5Reviewer=await r5ReviewerCtx.newPage()
 await actorOn(r5Reviewer,f.actors.reviewer)
 for(const seedId of ['ZW-DEAL-0002','ZW-DEAL-0003','ZW-DEAL-0004']){
  const pub=await unsafe(r5Reviewer,f.actors.reviewer,'POST','/admin/dealership/research/'+seedId+'/review',{
   decision:'PRELISTED_UNCLAIMED',
   reason:'Synthetic CI independent publication review for '+seedId+' to exercise S08 directory filtering, T42 correction/takedown, and S09 duplicate canonical redirect.',
   reviewer_password:f.reviewer_password,
  })
  expect(pub.status()).toBe(201)
 }

 // S08: Guest browses and filters multiple reviewed fictional prelistings on /dealers
 const dirGuestCtx=await browser.newContext({viewport:{width:1280,height:900}})
 const dirGuest=await dirGuestCtx.newPage()
 const dirApi=await dirGuest.request.get(API+'/dealership/research?limit=24')
 expect(dirApi.status()).toBe(200)
 const dirJson=await dirApi.json() as {total:number;real_104_records_published_claim:boolean;entries:Array<{seed_dealer_id:string;category:string}>}
 expect(dirJson.total).toBe(4)
 expect(dirJson.real_104_records_published_claim).toBe(false)
 await dirGuest.goto('/dealers')
 await expect(dirGuest.getByRole('heading',{name:'Zimbabwe Dealership Directory'})).toBeVisible({timeout:30000})
 await expect(dirGuest.getByTestId('dealer-directory-count')).toContainText('4 reviewed public results',{timeout:30000})
 await dirGuest.locator('#dealer-tier-filter').selectOption('PRELISTED_UNCLAIMED')
 await expect(dirGuest.getByTestId('dealer-directory-count')).toContainText('4 reviewed public results',{timeout:20000})
 await dirGuest.locator('#dealer-tier-filter').selectOption('FULL_DEALER_APPROVED')
 await expect(dirGuest.getByTestId('dealer-directory-empty')).toBeVisible({timeout:20000})
 await dirGuest.getByTestId('dealer-directory-clear-filters').click()
 await expect(dirGuest.getByTestId('dealer-directory-count')).toContainText('4 reviewed public results',{timeout:20000})
 const firstCategory=dirJson.entries[0].category
 await dirGuest.locator('#dealer-category-filter').selectOption(firstCategory)
 await expect(dirGuest.getByTestId('dealer-directory-card-'+dirJson.entries[0].seed_dealer_id)).toBeVisible({timeout:20000})
 const s08Shot=info.outputPath('r5-s08-directory-multi-prelisting-filters-1280.png')
 await dirGuest.screenshot({path:s08Shot,fullPage:true})
 await info.attach('r5-s08-directory-multi-prelisting-filters-1280',{path:s08Shot,contentType:'image/png'})

 // T42: Guest submits a removal/takedown request on /dealers/zw-deal-0003/correction
 await dirGuest.goto('/dealers/zw-deal-0003/correction')
 await expect(dirGuest.getByRole('heading',{name:'Correct or request removal of a researched listing'})).toBeVisible({timeout:30000})
 await dirGuest.locator('#research-correction-kind').selectOption('REMOVAL')
 await dirGuest.locator('#research-correction-summary').fill(
  'Fictional CI takedown request for ZW-DEAL-0003: requesting suppression of this prelisted research profile pending source verification.')
 await dirGuest.locator('#research-correction-email').fill('rep@example.invalid')
 await dirGuest.getByRole('button',{name:'Submit private review request'}).click({timeout:15000})
 await expect(dirGuest.getByText('Your request is recorded for private human review',{exact:false})).toBeVisible({timeout:30000})
 // Unreviewed complaint never auto-suppresses the public profile
 const stillPublic=await dirGuest.request.get(API+'/dealership/research/ZW-DEAL-0003')
 expect(stillPublic.status()).toBe(200)

 // T42 negative: non-reviewer claimant cannot review the correction request
 const corrListResp=await r5Reviewer.request.get(API+'/admin/dealership/research/corrections',{headers:ids(f.actors.reviewer)})
 expect(corrListResp.status()).toBe(200)
 const corrRequests=(await corrListResp.json() as {requests:Array<{request_id:string;seed_dealer_id:string;status:string}>}).requests
 const targetCorr=corrRequests.find(r=>r.seed_dealer_id==='ZW-DEAL-0003'&&r.status==='PENDING_HUMAN_REVIEW')
 expect(targetCorr).toBeTruthy()
 const unauthCorrReview=await unsafe(dirGuest,f.actors.claimant,'POST',
  '/admin/dealership/research/corrections/'+targetCorr!.request_id+'/review',{
   decision:'RESOLVED_SUPPRESSED',
   reason:'Unauthorized non-reviewer attempt to suppress a competitor listing must fail.',
   reviewer_password:f.reviewer_password,
  })
 expect(unauthCorrReview.status()).toBe(403)

 // T42 positive: independent reviewer resolves the takedown request as RESOLVED_SUPPRESSED in the UI
 await r5Reviewer.goto('/admin/dealer-research-review')
 const corrPanel=r5Reviewer.getByTestId('dealer-correction-review-panel')
 await expect(corrPanel).toBeVisible({timeout:30000})
 await corrPanel.locator('#correction-request-select').selectOption(targetCorr!.request_id)
 await corrPanel.locator('#correction-disposition').selectOption('RESOLVED_SUPPRESSED')
 await corrPanel.locator('#correction-review-reason').fill(
  'Independent fictional reviewer verified the takedown request for ZW-DEAL-0003 and suppressed the public research profile.')
 await r5Reviewer.locator('#source-reviewer-password').fill(f.reviewer_password)
 const corrBtn=corrPanel.getByRole('button',{name:'Record correction/takedown disposition'})
 await expect(corrBtn).toBeEnabled({timeout:15000})
 await corrBtn.click({timeout:15000})
 await expect(r5Reviewer.getByText('Correction/takedown request resolved for ZW-DEAL-0003: RESOLVED_SUPPRESSED',{exact:false}))
  .toBeVisible({timeout:30000})
 const afterSuppression=await dirGuest.request.get(API+'/dealership/research/ZW-DEAL-0003')
 expect(afterSuppression.status()).toBe(404)

 // S09 negative: attempting to redirect ZW-DEAL-0001 (which has claim/legal custody history) is refused with 409
 const hostileRedirect=await unsafe(r5Reviewer,f.actors.reviewer,'POST',
  '/admin/dealership/research/ZW-DEAL-0001/duplicate-redirect',{
   canonical_seed_dealer_id:'ZW-DEAL-0002',
   reason:'Attempting to redirect a seed with existing claim and legal custody history must fail closed.',
   reviewer_password:f.reviewer_password,
  })
 expect(hostileRedirect.status()).toBe(409)

 // S09 positive: independent reviewer reconciles duplicate ZW-DEAL-0004 -> canonical ZW-DEAL-0002 in the UI
 const seed4QueueBtn=r5Reviewer.getByTestId('research-queue-item-ZW-DEAL-0004')
 await expect(seed4QueueBtn).toBeVisible({timeout:15000})
 await seed4QueueBtn.click({timeout:15000})
 const dupPanel=r5Reviewer.getByTestId('dealer-duplicate-reconcile-panel')
 await expect(dupPanel).toBeVisible({timeout:30000})
 await expect(dupPanel).toContainText('ZW-DEAL-0004',{timeout:15000})
 await dupPanel.locator('#duplicate-canonical-seed').fill('ZW-DEAL-0002')
 await dupPanel.locator('#duplicate-reconcile-reason').fill(
  'Independent fictional reviewer confirmed ZW-DEAL-0004 is a duplicate research entry of canonical ZW-DEAL-0002; source custody preserved.')
 await r5Reviewer.locator('#source-reviewer-password').fill(f.reviewer_password)
 const dupBtn=dupPanel.getByRole('button',{name:'Reconcile duplicate & activate canonical redirect'})
 await expect(dupBtn).toBeEnabled({timeout:15000})
 await dupBtn.click({timeout:15000})
 await expect(r5Reviewer.getByText('Reconciled duplicate research seed ZW-DEAL-0004 -> canonical ZW-DEAL-0002',{exact:false})).toBeVisible({timeout:30000})
 await r5ReviewerCtx.close()

 // Guest visits /dealers/zw-deal-0004 and is automatically redirected to canonical /dealers/zw-deal-0002?redirected_from=ZW-DEAL-0004
 await dirGuest.goto('/dealers/zw-deal-0004')
 await expect(dirGuest).toHaveURL(/\/dealers\/zw-deal-0002\?redirected_from=ZW-DEAL-0004$/,{timeout:30000})
 await expect(dirGuest.getByTestId('dealer-duplicate-redirect-banner')).toBeVisible({timeout:20000})
 const s09Shot=info.outputPath('r5-s09-duplicate-canonical-redirect-1280.png')
 await dirGuest.screenshot({path:s09Shot,fullPage:true})
 await info.attach('r5-s09-duplicate-canonical-redirect-1280',{path:s09Shot,contentType:'image/png'})

 // S09 negative: claiming a reconciled duplicate seed is refused with 409 DUPLICATE_SEED_REDIRECTED_TO_CANONICAL
 const dupClaimRefusal=await unsafe(dirGuest,f.actors.claimant,'POST','/dealership/research/ZW-DEAL-0004/claim',{
  claimed_scope:'BRANCH',
  representative_relationship:'LEGAL_OWNER',
  asserted_legal_business_name:'Fictional Duplicate Claimant',
  claim_statement:'Attempting to claim a duplicate research seed that has been redirected to ZW-DEAL-0002.',
 })
 expect(dupClaimRefusal.status()).toBe(409)
 await dirGuestCtx.close()

 const receipt={fictional_only:true,vin:VIN,revocation:'CLAIM_REVOKED via independent claim workbench',
  public_detail_after:detail.status(),storefront_stock_after:0,storefront_media_after:0,workspace_after:workspace.status(),
  canonical_republish_after:republish.status(),canonical_republish_replay:replay.status(),enquiry_refusal_code:enquiryBody.error.code,republish_refusal_layer:'DATA_LAYER_DEALER_LISTING_AUTHORITY_NOT_CURRENT',
  enquiry_after:enquiry.status(),s08_multi_prelisting_filtered:true,
  t42_unauth_review_status:unauthCorrReview.status(),t42_suppressed_profile_status:afterSuppression.status(),
  s09_hostile_redirect_status:hostileRedirect.status(),s09_canonical_redirect:'ZW-DEAL-0004->zw-deal-0002',
  s09_duplicate_claim_status:dupClaimRefusal.status()}
 const out='test-results/fictional-native-dealer-suspension-browser-receipt.json'
 mkdirSync(dirname(out),{recursive:true})
 writeFileSync(out,JSON.stringify(receipt,null,2)+'\n',{mode:0o600})
 console.log('DEALER_NATIVE_SYNTHETIC_SUSPENSION_BROWSER PASS: independent revocation → VIN + media withdrawn from search/detail/storefront; workspace, canonical republish and new enquiries refused; R5 S08 multi-record directory filter, T42 takedown suppression, and S09 canonical duplicate redirect verified')
})
