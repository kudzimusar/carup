import {test,expect,type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {dirname} from 'node:path'

/**
 * CARUP-DEALER-ONB-001-LR01-R4 P0-2 — PHASE SIX (after the accepted retraction phase).
 * EXPLICITLY FICTIONAL dealer stock through CarUp's CANONICAL authority, in the real browser:
 *   approved dealer owner registers a private VIN draft → prepares dealer-declared listing facts on an
 *   owned branch → sends an ownership/registration document through the canonical evidence route →
 *   an independent fictional CarUp vehicle reviewer approves it in the canonical evidence workbench →
 *   the dealership reviewer independently re-publishes the full storefront on the SAME URL → the owner
 *   publishes through the canonical Marketplace gate → anonymous Marketplace search + vehicle detail +
 *   storefront association → a separate fictional buyer sends a canonical enquiry → the owner progresses
 *   it new → contacted → qualified, and the state survives a refresh.
 * Every write is the real app against the disposable native PostgreSQL; nothing is mocked or seeded.
 */
type Actor={id:string;name:string;email:string;role:string;token:string}
type Fixture={actors:{claimant:Actor;reviewer:Actor;vehicle_reviewer:Actor;vehicle_buyer:Actor}
 reviewer_password:string;vehicle_reviewer_password:string;public_slug:string;seed:string;listing_vin:string;source_type:string
 synthetic_legal_policy_provenance:string;listing_phase_provenance:string;source_population:number}
const file=process.env.DEALER_BROWSER_FIXTURE_JSON
if(!file)throw Error('LISTING_CI_FIXTURE_MISSING')
const f=JSON.parse(readFileSync(file,'utf8')) as Fixture
if(f.source_type!=='EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX'||f.source_population!==104||
 f.synthetic_legal_policy_provenance!=='CI_ONLY_NOT_ACTUAL_ZIMBABWE_AUTHORITY'||
 f.listing_phase_provenance!=='CI_ONLY_FICTIONAL_DEALER_STOCK_NOT_A_REAL_VEHICLE'||
 f.actors.vehicle_reviewer.role!=='admin'||f.actors.vehicle_buyer.role!=='member'||
 new Set([f.actors.claimant.id,f.actors.reviewer.id,f.actors.vehicle_reviewer.id,f.actors.vehicle_buyer.id]).size!==4)
 throw Error('NON_SYNTHETIC_LISTING_GATE')
const API='http://127.0.0.1:3001/api'
const VIN=f.listing_vin
const MODEL='Synthetic R4 Listing'
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))
// The real 100/min loopback limiter is kept; phases wait out its window instead of bypassing it.
const WINDOW=70_000
async function actorOn(page:Page,actor:Actor){
 await page.addInitScript(({user,token}:{user:Omit<Actor,'token'>;token:string})=>{
  localStorage.setItem('carup_user',JSON.stringify(user))
  localStorage.setItem('carup_token',token)
 },{user:{id:actor.id,name:actor.name,email:actor.email,role:actor.role},token:actor.token})
}
const ids=(a:Actor,extra:Record<string,string>={})=>({'x-user-id':a.id,'x-session-token':a.token,...extra})
async function unsafe(page:Page,a:Actor,method:'POST'|'PATCH',path:string,data:unknown,extra:Record<string,string>={}){
 const t=await page.request.get(API+'/security/csrf-token',{headers:ids(a,extra)})
 const j=await t.json() as {csrfToken?:string;token?:string;csrf_token?:string}
 return page.request.fetch(API+path,{method,data,headers:{...ids(a,extra),
  'x-csrf-token':j.csrfToken||j.token||j.csrf_token||'','content-type':'application/json'}})
}
function fictionalPdf(){
 return Buffer.from(['%PDF-1.4','1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 360 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
  '4 0 obj<</Length 74>>stream','BT /F1 11 Tf 12 100 Td (FICTIONAL CI REGISTRATION BOOK - NOT A REAL VEHICLE) Tj ET',
  'endstream endobj','5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  'trailer<</Root 1 0 R>>','%%EOF'].join('\n'))
}
type AxeSummary={label:string;scope:string;violations:Array<{id:string;impact:string|null;nodes:number;
 targets:Array<{target:string;message:string}>}>}
// T32: WCAG 2 A/AA automated scan, RECORDED (not asserted) so a finding never aborts the rest of
// the physical journey. The receipt counts critical/serious violations inside the R4 surfaces and on
// the full pages; T32 is classified from those recorded numbers, never assumed.
async function axeScan(page:Page,info:import('@playwright/test').TestInfo,label:string,include?:string){
 let builder=new AxeBuilder({page}).withTags(['wcag2a','wcag2aa'])
 if(include)builder=builder.include(include)
 const result=await builder.analyze()
 const summary:AxeSummary={label,scope:include||'full page',violations:result.violations.map(v=>
  ({id:v.id,impact:v.impact??null,nodes:v.nodes.length,
   // Selectors and the measured contrast message make a CI failure fixable without a rerun.
   targets:v.nodes.slice(0,12).map(n=>({target:n.target.join(' '),
    message:(n.any[0]?.message||n.failureSummary||'').slice(0,240)}))}))}
 await info.attach('axe-'+label,{body:JSON.stringify(summary,null,2),contentType:'application/json'})
 return summary
}
async function shot(page:Page,info:import('@playwright/test').TestInfo,name:string){
 const path=info.outputPath(name+'.png')
 await page.screenshot({path,fullPage:true})
 await info.attach(name,{path,contentType:'image/png'})
}

test('FICTIONAL dealer VIN: prepare → canonical document review → canonical publish → Marketplace + storefront → buyer enquiry → dealer follow-up',async({browser},info)=>{
 test.setTimeout(1_500_000)
 await pause(WINDOW)
 const receipt:Record<string,unknown>={fictional_only:true,vin:VIN}
 const axe:AxeSummary[]=[]

 // ── 1. Owner: private draft → dealer-declared listing facts → canonical document upload ──
 const ownerContext=await browser.newContext({viewport:{width:1280,height:900}})
 const owner=await ownerContext.newPage()
 await actorOn(owner,f.actors.claimant)
 await owner.goto('/dealers/stock')
 await owner.locator('#private-draft-vin').fill(VIN)
 await owner.locator('#private-draft-make').fill('Fictional Motors')
 await owner.locator('#private-draft-model').fill(MODEL)
 await owner.locator('#private-draft-year').fill('2022')
 await owner.locator('#private-draft-mileage').fill('48211')
 await owner.getByRole('button',{name:'Register private VIN draft'}).click()
 await expect(owner.getByText('Private VIN '+VIN+' saved',{exact:false})).toBeVisible({timeout:30000})
 await owner.getByRole('button',{name:'Marketplace listing for '+VIN}).click()
 const panel=owner.getByTestId('dealer-listing-panel-'+VIN)
 const form=panel.getByRole('form',{name:'Prepare '+VIN+' for Marketplace'})
 await expect(form).toBeVisible({timeout:30000})
 await form.getByLabel('Branch holding this vehicle').selectOption({index:1})
 await form.getByLabel('Asking price').fill('18500')
 await form.getByLabel('Chassis number').fill('FICT-CHASSIS-R4-0001')
 await form.getByLabel('Engine number').fill('FICT-ENGINE-R4-0001')
 await form.getByLabel('Registration stage').selectOption('customs_cleared_cvr_pending')
 await form.getByLabel('City shown to buyers').fill('Harare')
 await form.getByLabel('Province (optional)').fill('Harare Metropolitan')
 await form.getByRole('button',{name:'Save listing facts (stays private)'}).click()
 await expect(panel.getByText('Listing facts saved as dealer-declared',{exact:false})).toBeVisible({timeout:30000})
 await expect(panel.locator('[data-requirement="seller_authority"]')).toHaveAttribute('data-status','missing',{timeout:30000})
 await expect(panel.getByRole('button',{name:'Publish (blocked until checks are met)'})).toBeDisabled()
 await panel.getByTestId('dealer-listing-document').setInputFiles({
  name:'fictional-ci-registration-book.pdf',mimeType:'application/pdf',buffer:fictionalPdf()})
 await panel.getByRole('button',{name:'Send document for independent review'}).click()
 await expect(panel.getByText('Document received privately',{exact:false})).toBeVisible({timeout:40000})
 await expect(panel.locator('[data-requirement="seller_authority"]')).toHaveAttribute('data-status','pending_review',{timeout:30000})
 await shot(owner,info,'r4-owner-listing-prepared-awaiting-independent-review-1280')
 // Negatives with the dealer's REAL verified tenant context: the canonical gate refuses to publish
 // before independent review, and the dealer cannot certify its own document.
 const invRead=await owner.request.get(API+'/dealer/operational-inventory',{headers:ids(f.actors.claimant)})
 expect(invRead.status()).toBe(200)
 const tenantId=(await invRead.json() as {inventory:{owner_tenant_id:string}}).inventory.owner_tenant_id
 const tenantCtx={'x-tenant-id':tenantId,'x-stakeholder-role':'dealer'}
 const earlyPublish=await unsafe(owner,f.actors.claimant,'POST','/vehicles/'+VIN+'/publish',{},tenantCtx)
 expect(earlyPublish.status()).toBe(400)
 const refusal=await earlyPublish.json() as {requirements?:Array<{key:string;status:string}>}
 expect(refusal.requirements?.find(r=>r.key==='seller_authority')?.status).toBe('pending_review')
 const queue=await owner.request.get(API+'/evidence/review?status=pending',{headers:ids(f.actors.claimant,tenantCtx)})
 const pending=(await queue.json() as Array<{id:string;vin:string}>).filter(x=>x.vin===VIN)
 expect(pending).toHaveLength(1)
 const selfVerify=await unsafe(owner,f.actors.claimant,'PATCH','/vehicles/'+VIN+'/evidence/'+pending[0].id+'/verify',
  {notes:'self-certification attempt must fail'},tenantCtx)
 expect(selfVerify.status()).toBe(403)
 receipt.owner_publish_before_review_status=earlyPublish.status()
 receipt.owner_self_verify_status=selfVerify.status()

 // T22: Owner uploads a tenant-scoped showroom facility photo on /dealers/operating-details (and OEM logo claim is 422-refused)
 const pngBytes=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,120,156,99,248,207,80,15,0,3,134,1,128,90,52,125,107,0,0,0,0,73,69,78,68,174,66,96,130])
 const MEDIA_CAPTION='Harare fictional showroom forecourt'
 const MEDIA_ALT='Exterior view of fictional Harare dealership showroom'
 const logoRefusal=await unsafe(owner,f.actors.claimant,'POST','/dealer/operational-media',{
  media_category:'SHOWROOM_EXTERIOR',
  caption:MEDIA_CAPTION,
  alt_text:MEDIA_ALT,
  mime_type:'image/png',
  image_data_url:'data:image/png;base64,'+pngBytes.toString('base64'),
  rights_attestation:'DEALER_OWNED_PHOTOGRAPH_NO_OEM_OR_THIRD_PARTY_LOGO',
  oem_or_brand_logo_claimed:true,
 })
 expect(logoRefusal.status()).toBe(422)
 receipt.owner_media_oem_logo_refusal_status=logoRefusal.status()

 await owner.goto('/dealers/operating-details')
 const mediaSection=owner.getByTestId('dealer-owner-media-section')
 await expect(mediaSection).toBeVisible({timeout:30000})
 await mediaSection.locator('#dealer-media-category').selectOption('SHOWROOM_EXTERIOR')
 await mediaSection.locator('#dealer-media-caption').fill(MEDIA_CAPTION)
 await mediaSection.locator('#dealer-media-alt').fill(MEDIA_ALT)
 await mediaSection.locator('#dealer-media-file').setInputFiles({
  name:'fictional-harare-showroom.png',mimeType:'image/png',buffer:pngBytes})
 await expect(mediaSection.locator('#dealer-media-file')).toHaveAttribute('data-file-loaded','true',{timeout:15000})
 await mediaSection.locator('#dealer-media-rights-attestation').check()
 const uploadMediaBtn=mediaSection.getByTestId('dealer-media-upload-button')
 await expect(uploadMediaBtn).toHaveText('Upload dealership facility photo for independent review')
 await expect(uploadMediaBtn).toBeEnabled({timeout:15000})
 await uploadMediaBtn.click({timeout:15000})
 await expect(owner.getByText('Uploaded dealership facility photo',{exact:false})).toBeVisible({timeout:30000})
 await expect(mediaSection.getByText('PENDING_INDEPENDENT_REVIEW')).toBeVisible({timeout:30000})
 axe.push(await axeScan(owner,info,'owner-media-upload-section','[data-testid="dealer-owner-media-section"]'))
 await shot(owner,info,'r5-owner-facility-media-uploaded-1280')
 await ownerContext.close()
 await pause(WINDOW)

 // ── 2. Independent CarUp vehicle reviewer approves the document in the canonical workbench ──
 const reviewerContext=await browser.newContext({viewport:{width:1280,height:900}})
 const reviewer=await reviewerContext.newPage()
 await actorOn(reviewer,f.actors.vehicle_reviewer)
 await reviewer.goto('/admin/dealer-vehicle-evidence')
 const item=reviewer.locator('div.grid').filter({hasText:VIN}).filter({has:reviewer.getByRole('button',{name:'Approve'})}).first()
 await expect(item).toBeVisible({timeout:40000})
 await shot(reviewer,info,'r4-independent-vehicle-document-review-queue-1280')
 await item.getByRole('button',{name:'Approve'}).click()
 await expect(reviewer.getByText('Evidence approved')).toBeVisible({timeout:30000})
 await reviewerContext.close()

 // ── 3. A DIFFERENT independent reviewer re-publishes the full storefront on the SAME URL ──
 // R6 R2-1: phase 5's retraction was recorded by f.actors.reviewer; that reviewer may not undo it
 // alone, so the re-publication comes from another independent, non-member admin (dual control).
 const republishContext=await browser.newContext({viewport:{width:1280,height:900}})
 const republish=await republishContext.newPage()
 await actorOn(republish,f.actors.vehicle_reviewer)
 await republish.goto('/admin/dealer-full-storefront-review')
 await expect(republish.getByRole('heading',{name:'Full dealership publication'})).toBeVisible({timeout:30000})
 await expect(republish.getByText(f.seed).first()).toBeVisible({timeout:25000})
 await republish.locator('#storefront-password').fill(f.vehicle_reviewer_password)
 await republish.getByRole('button',{name:'Inspect review candidate'}).click()
 await expect(republish.getByRole('heading',{name:'Approve only verified branch display facts'})).toBeVisible({timeout:30000})
 await republish.getByRole('heading',{name:'Approve only verified branch display facts'})
  .locator('..').locator('input[type="checkbox"]').first().check()
 const sections=republish.getByRole('heading',{name:'Independently review dealer-declared sections'})
 if(await sections.count()){
  await sections.locator('..').locator('input[type="checkbox"]').first().check()
 }
 await republish.locator('#storefront-decision').selectOption('PUBLISHED_FULL')
 await republish.locator('#storefront-reason').fill(
  'Fictional CI re-publication after an earlier independent retraction, by a different independent reviewer. Branch identity, local test policy and dealer-declared fields were re-reviewed under isolated synthetic sessions; no real company publicity or merchant entitlement.')
 await republish.locator('#storefront-password').fill(f.vehicle_reviewer_password)
 await republish.getByRole('button',{name:'Record immutable publication decision'}).click()
 await expect(republish.getByText('Independent full storefront publication event recorded.',{exact:false}))
  .toBeVisible({timeout:40000})
 await republishContext.close()
 await pause(WINDOW)

 // ── 3b. The original dealership reviewer approves the T22 media via a scope-bound ticket ──
 const publicReviewerContext=await browser.newContext({viewport:{width:1280,height:900}})
 const publish=await publicReviewerContext.newPage()
 await actorOn(publish,f.actors.reviewer)
 await publish.goto('/admin/dealer-full-storefront-review')
 await expect(publish.getByRole('heading',{name:'Full dealership publication'})).toBeVisible({timeout:30000})

 // Issue #164 + T22 negative: raw UUID or fabricated ticket is refused with 403 STOREFRONT_MEDIA_REVIEW_TICKET_INVALID
 const rawUuidTicketRefusal=await unsafe(publish,f.actors.reviewer,'POST',
  '/admin/dealership/storefront-media/'+f.seed+'/preview',
  {review_ticket:'00000000-1111-4222-8333-444444444444',reviewer_password:f.reviewer_password})
 expect(rawUuidTicketRefusal.status()).toBe(403)
 expect((await rawUuidTicketRefusal.json() as {code?:string}).code).toBe('STOREFRONT_MEDIA_REVIEW_TICKET_INVALID')
 receipt.reviewer_raw_uuid_media_ticket_refusal_status=rawUuidTicketRefusal.status()

 // T22 positive: independent reviewer previews and approves the showroom photo via scope-bound ticket in the UI
 const mediaReviewSection=publish.getByTestId('dealer-media-review-section')
 await expect(mediaReviewSection).toBeVisible({timeout:30000})
 await expect(mediaReviewSection.getByTestId('dealer-media-review-caption')).toContainText(MEDIA_CAPTION,{timeout:30000})
 await publish.locator('#storefront-password').fill(f.reviewer_password)
 const previewMediaBtn=mediaReviewSection.getByRole('button',{name:'Preview private media binary'})
 await expect(previewMediaBtn).toBeEnabled({timeout:15000})
 await previewMediaBtn.click({timeout:15000})
 await expect(publish.getByText('Opened private storefront media preview',{exact:false})).toBeVisible({timeout:30000})
 await expect(mediaReviewSection.locator('img[alt="'+MEDIA_ALT+'"]')).toBeVisible({timeout:20000})
 await mediaReviewSection.locator('#storefront-media-decision').selectOption('APPROVED_PUBLIC_DISPLAY')
 await mediaReviewSection.locator('#storefront-media-reason').fill(
  'Fictional CI independent media review: verified descriptive alt text, accurate caption, and absence of OEM or brand logos.')
 await publish.locator('#storefront-password').fill(f.reviewer_password)
 const recordMediaBtn=mediaReviewSection.getByRole('button',{name:'Record storefront media decision'})
 await expect(recordMediaBtn).toBeEnabled({timeout:15000})
 await recordMediaBtn.click({timeout:15000})
 await expect(publish.getByText('Recorded storefront media decision APPROVED_PUBLIC_DISPLAY',{exact:false}))
  .toBeVisible({timeout:30000})
 axe.push(await axeScan(publish,info,'reviewer-media-review-section','[data-testid="dealer-media-review-section"]'))
 await shot(publish,info,'r5-independent-reviewer-media-approved-1280')
 await publicReviewerContext.close()
 await pause(WINDOW)

 // ── 4. Owner publishes through the CANONICAL Marketplace gate ──
 const ownerAgain=await browser.newContext({viewport:{width:1280,height:900}})
 const owner2=await ownerAgain.newPage()
 await actorOn(owner2,f.actors.claimant)
 await owner2.goto('/dealers/stock')
 // T32 keyboard: reach the per-VIN listing control with Tab only and open it with Enter.
 const listingButton=owner2.getByRole('button',{name:'Marketplace listing for '+VIN})
 await expect(listingButton).toBeVisible({timeout:30000})
 let reached=false
 for(let i=0;i<80&&!reached;i++){
  await owner2.keyboard.press('Tab')
  reached=await listingButton.evaluate(el=>el===document.activeElement)
 }
 expect(reached,'listing control reachable by keyboard').toBe(true)
 await owner2.keyboard.press('Enter')
 const panel2=owner2.getByTestId('dealer-listing-panel-'+VIN)
 await expect(panel2.locator('[data-requirement="seller_authority"]')).toHaveAttribute('data-status','verified',{timeout:30000})
 await expect(panel2.getByRole('button',{name:'Publish on CarUp Marketplace'})).toBeEnabled({timeout:30000})
 axe.push(await axeScan(owner2,info,'owner-listing-panel','[data-testid="dealer-listing-panel-'+VIN+'"]'))
 axe.push(await axeScan(owner2,info,'owner-inventory-page'))
 await panel2.getByRole('button',{name:'Publish on CarUp Marketplace'}).click()
 await expect(panel2.getByText('Published through the CarUp Marketplace publication checks.')).toBeVisible({timeout:40000})
 await expect(panel2.getByTestId('dealer-listing-publication-state')).toHaveText('published',{timeout:30000})
 await shot(owner2,info,'r4-owner-published-through-canonical-gate-1280')
 await ownerAgain.close()
 await pause(WINDOW)

 // ── 5. Anonymous: Marketplace search, canonical vehicle detail, storefront association & T22 media gallery ──
 const guestContext=await browser.newContext({viewport:{width:1280,height:900}})
 const guest=await guestContext.newPage()
 const search=await guest.request.get(API+'/marketplace/listings?limit=24')
 expect(search.status()).toBe(200)
 const searchBody=await search.json() as {listings:Array<{vin:string;make:string;model:string}>}
 expect(searchBody.listings.map(x=>x.vin)).toContain(VIN)
 await guest.goto('/marketplace')
 await expect(guest.getByText(MODEL).first()).toBeVisible({timeout:40000})
 await shot(guest,info,'r4-public-marketplace-search-shows-fictional-dealer-vin-1280')
 const inventory=await guest.request.get(API+'/dealership/research/'+f.seed+'/inventory')
 expect(inventory.status()).toBe(200)
 const inv=await inventory.json() as {inventory:{entries:Array<{vin:string}>;projection:string}}
 expect(inv.inventory.entries.map(x=>x.vin)).toEqual([VIN])
 expect(inv.inventory.projection).toBe('CANONICAL_MARKETPLACE_PUBLIC_DETAIL')
 const publicMediaResp=await guest.request.get(API+'/dealership/research/'+f.seed+'/media')
 expect(publicMediaResp.status()).toBe(200)
 const publicMediaJson=await publicMediaResp.json() as {media:{items:Array<{caption:string;alt_text:string;logo_rights_approved:boolean}>;oem_badges_or_logos_shown:boolean}}
 expect(publicMediaJson.media.items).toHaveLength(1)
 expect(publicMediaJson.media.items[0].caption).toBe(MEDIA_CAPTION)
 expect(publicMediaJson.media.items[0].alt_text).toBe(MEDIA_ALT)
 expect(publicMediaJson.media.items[0].logo_rights_approved).toBe(false)
 expect(publicMediaJson.media.oem_badges_or_logos_shown).toBe(false)
 await guestContext.close()
 for(const [width,height] of [[390,844],[768,1024]] as const){
  const ctx=await browser.newContext({viewport:{width,height}})
  const page=await ctx.newPage()
  await page.goto('/marketplace/listing/'+VIN)
  await expect(page.getByText(MODEL).first()).toBeVisible({timeout:40000})
  await shot(page,info,'r4-public-vehicle-detail-'+width)
  await page.goto('/dealers/'+f.public_slug)
  await expect(page.getByTestId('dealer-storefront-inventory').getByRole('link',{name:new RegExp(MODEL)}))
   .toBeVisible({timeout:40000})
  const gallery=page.getByTestId('dealer-storefront-media-gallery')
  await expect(gallery).toBeVisible({timeout:30000})
  await expect(gallery.locator('img[alt="'+MEDIA_ALT+'"]')).toBeVisible({timeout:30000})
  await shot(page,info,'r4-approved-storefront-lists-canonical-vin-'+width)
  await ctx.close()
 }
 await pause(WINDOW)
 for(const [width,height] of [[1280,900],[1920,1080]] as const){
  const ctx=await browser.newContext({viewport:{width,height}})
  const page=await ctx.newPage()
  await page.goto('/dealers/'+f.public_slug)
  await expect(page).toHaveURL(new RegExp('/dealers/'+f.public_slug+'$'))
  const link=page.getByTestId('dealer-storefront-inventory').getByRole('link',{name:new RegExp(MODEL)})
  await expect(link).toBeVisible({timeout:40000})
  const gallery=page.getByTestId('dealer-storefront-media-gallery')
  await expect(gallery).toBeVisible({timeout:30000})
  await expect(gallery.locator('img[alt="'+MEDIA_ALT+'"]')).toBeVisible({timeout:30000})
  await expect(gallery.getByText('No OEM/brand logo rights approved',{exact:false}).first()).toBeVisible({timeout:30000})
  await shot(page,info,'r4-approved-storefront-lists-canonical-vin-'+width)
  if(width===1280){
   axe.push(await axeScan(page,info,'storefront-stock-card','[data-testid="dealer-storefront-inventory"]'))
   axe.push(await axeScan(page,info,'storefront-media-gallery','[data-testid="dealer-storefront-media-gallery"]'))
   axe.push(await axeScan(page,info,'storefront-page'))
  }
  await link.click()
  await expect(page).toHaveURL(new RegExp('/marketplace/listing/'+VIN+'$'))
  await expect(page.getByText(MODEL).first()).toBeVisible({timeout:40000})
  await shot(page,info,'r4-public-vehicle-detail-'+width)
  if(width===1280)axe.push(await axeScan(page,info,'canonical-vehicle-detail-page'))
  await ctx.close()
 }
 await pause(WINDOW)

 // ── 6. A separate fictional buyer sends a canonical Marketplace enquiry ──
 const buyerContext=await browser.newContext({viewport:{width:390,height:844}})
 const buyer=await buyerContext.newPage()
 await actorOn(buyer,f.actors.vehicle_buyer)
 await buyer.goto('/marketplace/listing/'+VIN)
 await expect(buyer.getByText(MODEL).first()).toBeVisible({timeout:40000})
 await buyer.getByTestId('marketplace-inquiry-open').first().click()
 await expect(buyer.getByTestId('marketplace-inquiry-modal')).toBeVisible({timeout:20000})
 await buyer.getByTestId('marketplace-inquiry-message').fill(
  'FICTIONAL CI ENQUIRY: is this synthetic test vehicle still available? No real purchase intended.')
 await buyer.getByTestId('marketplace-inquiry-submit').click()
 await expect(buyer.getByText('Inquiry sent. Continue the conversation safely through CarUp.')).toBeVisible({timeout:30000})
 await shot(buyer,info,'r4-buyer-canonical-enquiry-sent-390')
 await buyerContext.close()
 await pause(WINDOW)

 // ── 7. Owner sees the enquiry in the tenant inbox and progresses it; state survives refresh ──
 const ownerInboxContext=await browser.newContext({viewport:{width:1280,height:900}})
 const inbox=await ownerInboxContext.newPage()
 await actorOn(inbox,f.actors.claimant)
 await inbox.goto('/dealers/inquiries')
 await expect(inbox.getByRole('heading',{name:'Marketplace buyer enquiries'})).toBeVisible({timeout:30000})
 const lead=inbox.locator('div.p-5').filter({has:inbox.locator('code',{hasText:VIN})})
 await expect(lead).toHaveCount(1,{timeout:30000})
 await lead.getByRole('button',{name:'Record dealer-reported contact'}).click()
 await expect(lead.getByRole('button',{name:'Record dealer-reported qualified enquiry'})).toBeVisible({timeout:30000})
 await lead.getByRole('button',{name:'Record dealer-reported qualified enquiry'}).click()
 await expect(inbox.getByText('Dealer-reported follow-up saved to the canonical Marketplace inquiry.',{exact:false}))
  .toBeVisible({timeout:30000})
 await pause(WINDOW)
 await inbox.reload()
 await expect(inbox.getByRole('heading',{name:'Marketplace buyer enquiries'})).toBeVisible({timeout:30000})
 const persisted=await inbox.request.get(API+'/dealer/operational-inquiries',{headers:ids(f.actors.claimant)})
 expect(persisted.status()).toBe(200)
 const leads=await persisted.json() as {inquiries:{entries:Array<{vin:string|null;status:string}>}}
 const mine=leads.inquiries.entries.filter(x=>x.vin===VIN)
 expect(mine.map(x=>x.status)).toEqual(['qualified'])
 await shot(inbox,info,'r4-owner-enquiry-qualified-after-refresh-1280')
 await ownerInboxContext.close()

 receipt.prepared_private_then_published_via_canonical_gate=true
 receipt.independent_vehicle_document_reviewer=f.actors.vehicle_reviewer.id
 receipt.storefront_republished_same_slug=f.public_slug
 receipt.storefront_media_approved_and_rendered=true
 receipt.buyer=f.actors.vehicle_buyer.id
 receipt.dealer_inquiry_final_status='qualified'
 receipt.viewports=[390,768,1280,1920]
 receipt.keyboard_listing_control_reachable=true
 receipt.axe=axe
 const severe=(xs:AxeSummary[])=>xs.reduce((n,x)=>n+x.violations.filter(v=>v.impact==='critical'||v.impact==='serious').length,0)
 receipt.axe_r4_surface_critical_or_serious=severe(axe.filter(x=>x.scope!=='full page'))
 receipt.axe_full_page_critical_or_serious=severe(axe.filter(x=>x.scope==='full page'))
 expect(receipt.axe_r4_surface_critical_or_serious,'T32 zero critical/serious axe violations on dealership surfaces').toBe(0)
 expect(receipt.axe_full_page_critical_or_serious,'T32 zero critical/serious axe violations on full pages').toBe(0)
 const out='test-results/fictional-native-vin-listing-browser-receipt.json'
 mkdirSync(dirname(out),{recursive:true})
 writeFileSync(out,JSON.stringify(receipt,null,2)+'\n',{mode:0o600})
 console.log('DEALER_NATIVE_SYNTHETIC_VIN_LISTING_BROWSER PASS: private draft → dealer-declared listing → canonical document review by independent admin → same-slug storefront re-publication → canonical publish → Marketplace search/detail/storefront at 390/768/1280/1920 → separate buyer enquiry → owner new→contacted→qualified after refresh')
})
