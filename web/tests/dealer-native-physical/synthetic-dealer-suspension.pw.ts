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
type Fixture={actors:{claimant:Actor;reviewer:Actor;vehicle_buyer:Actor}
 reviewer_password:string;public_slug:string;seed:string;listing_vin:string;source_type:string
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
const ids=(a:Actor,extra:Record<string,string>={})=>({'x-user-id':a.id,'x-session-token':a.token,...extra})
async function unsafe(page:Page,a:Actor,method:'POST'|'PATCH',path:string,data:unknown,extra:Record<string,string>={}){
 const t=await page.request.get(API+'/security/csrf-token',{headers:ids(a,extra)})
 const j=await t.json() as {csrfToken?:string;token?:string;csrf_token?:string}
 return page.request.fetch(API+path,{method,data,headers:{...ids(a,extra),
  'x-csrf-token':j.csrfToken||j.token||j.csrf_token||'','content-type':'application/json'}})
}

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
 await guest.goto('/dealers/'+f.public_slug)
 await expect(guest.getByTestId('dealer-storefront-inventory')).toHaveCount(0,{timeout:30000})
 await expect(guest.getByText(VIN)).toHaveCount(0)
 const publicShot=info.outputPath('r4-revoked-dealer-storefront-no-stock-390.png')
 await guest.screenshot({path:publicShot,fullPage:true})
 await info.attach('r4-revoked-dealer-storefront-no-stock-390',{path:publicShot,contentType:'image/png'})
 await guestContext.close()

 // ── Seller paths: dealer workspace refused; canonical republish refused by the data layer ──
 const workspace=await owner.request.get(API+'/dealer/operational-inventory',{headers:ids(f.actors.claimant)})
 expect([403,404]).toContain(workspace.status())
 const republish=await unsafe(owner,f.actors.claimant,'POST','/vehicles/'+VIN+'/publish',{},tenantCtx)
 expect(republish.status()).toBeGreaterThanOrEqual(400)
 const republishBody=await republish.text()
 expect(republishBody).toContain('DEALER_LISTING_AUTHORITY_NOT_CURRENT')
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
 expect(enquiry.status()).toBeGreaterThanOrEqual(400)
 await buyerContext.close()

 const receipt={fictional_only:true,vin:VIN,revocation:'CLAIM_REVOKED via independent claim workbench',
  public_detail_after:detail.status(),storefront_stock_after:0,workspace_after:workspace.status(),
  canonical_republish_after:republish.status(),republish_refusal_layer:'DATA_LAYER_DEALER_LISTING_AUTHORITY_NOT_CURRENT',
  enquiry_after:enquiry.status()}
 const out='test-results/fictional-native-dealer-suspension-browser-receipt.json'
 mkdirSync(dirname(out),{recursive:true})
 writeFileSync(out,JSON.stringify(receipt,null,2)+'\n',{mode:0o600})
 console.log('DEALER_NATIVE_SYNTHETIC_SUSPENSION_BROWSER PASS: independent revocation → VIN withdrawn from search/detail/storefront; workspace, canonical republish and new enquiries refused')
})
