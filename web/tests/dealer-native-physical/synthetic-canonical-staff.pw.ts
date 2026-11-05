import {test,expect,type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'

/**
 * CI-only continuation of independently reviewed FICTIONAL canonical tenant.
 * Uses the live CarUp browser, PostgreSQL, real user_sessions and existing
 * Corporate tenant_users/organization_users, not mocked API responses.
 * No franchise, financial, owner or VIN-selling staff rights. Private
 * branch edits require a separate real original-owner delegation.
 */
type Actor={id:string;name:string;email:string;role:string;token:string}
type Fixture={actors:{claimant:Actor;staff:Actor};source_type:string;
  synthetic_legal_policy_provenance:string;source_population:number}
const file=process.env.DEALER_BROWSER_FIXTURE_JSON
if(!file)throw Error('STAFF_CI_FIXTURE_MISSING')
const f=JSON.parse(readFileSync(file,'utf8')) as Fixture
if(f.source_type!=='EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX'||
 f.synthetic_legal_policy_provenance!=='CI_ONLY_NOT_ACTUAL_ZIMBABWE_AUTHORITY'||
 f.source_population!==104||f.actors.claimant.id===f.actors.staff.id||
 f.actors.staff.role!=='member')throw Error('NON_SYNTHETIC_STAFF_GATE')
async function actorOn(page:Page,actor:Actor){
 await page.addInitScript(({user,token}:{user:Omit<Actor,'token'>;token:string})=>{
  localStorage.setItem('carup_user',JSON.stringify(user))
  localStorage.setItem('carup_token',token)
 },{user:{id:actor.id,name:actor.name,email:actor.email,role:actor.role},token:actor.token})
}
test('Fictional approved dealer invites, staff independently accepts, owner revokes, all survive refresh',async({browser},info)=>{
 test.setTimeout(480000)
 await new Promise<void>(r=>setTimeout(r,70_000))
 const ownerContext=await browser.newContext({viewport:{width:1280,height:900}})
 const owner=await ownerContext.newPage()
 await actorOn(owner,f.actors.claimant)
 await owner.goto('/dealers/staff')
 await expect(owner.getByRole('heading',{name:'Dealership staff and access'}))
  .toBeVisible({timeout:30000})
 await expect(owner.getByRole('heading',{name:'Canonical organization staff'}))
  .toBeVisible({timeout:30000})
 await expect(owner.getByText('Tenant role: dealer')).toBeVisible()
 await owner.locator('#staff-existing-user').fill(f.actors.staff.id)
 await owner.getByRole('button',{name:'Issue private staff invitation'}).click()
 await expect(owner.getByText('Private invitation ',{exact:false}))
  .toBeVisible({timeout:30000})
 await expect(owner.getByText('Status: PENDING; role: member'))
  .toBeVisible({timeout:30000})
 const invitationShot=info.outputPath('fictional-staff-invited-no-role.png')
 await owner.screenshot({path:invitationShot,fullPage:true})
 await info.attach('fictional-staff-invited-no-role',{
  path:invitationShot,contentType:'image/png'})

 const staffContext=await browser.newContext({viewport:{width:768,height:930}})
 const staff=await staffContext.newPage()
 await actorOn(staff,f.actors.staff)
 await staff.goto('/dealers/staff')
 await expect(staff.getByRole('heading',{name:'Invitations sent to your account'}))
  .toBeVisible({timeout:30000})
 await expect(staff.getByRole('button',{
  name:'Accept limited staff membership in canonical tenant',
 })).toBeVisible({timeout:30000})
 await staff.getByRole('button',{
  name:'Accept limited staff membership in canonical tenant',
 }).click()
 await expect(staff.getByText('Invitation accepted: canonical limited member role recorded.',{
  exact:false,
 })).toBeVisible({timeout:30000})
 await staff.reload()
 await expect(staff.getByText('Status: ACCEPTED; role: member'))
  .toBeVisible({timeout:30000})
 // Genuine canonical tenant membership is NOT an owner/dealer promotion.
 // Server authority must reject the staff member's direct owner, stock,
 // and private branch reads even when the UI has already accepted membership.
 const staffHeaders={'x-user-id':f.actors.staff.id,
  'x-session-token':f.actors.staff.token}
 for(const route of ['/dealer/operational-workspace',
   '/dealer/operational-inventory','/dealer/operational-inquiries']){
   const denied=await staff.request.get('http://127.0.0.1:3001/api'+route,{
    headers:staffHeaders,
   })
   expect([403,404],route).toContain(denied.status())
 }
 const staffShot=info.outputPath('fictional-distinct-staff-accepted-768px.png')
 await staff.screenshot({path:staffShot,fullPage:true})
 await info.attach('fictional-distinct-staff-accepted-768px',{
  path:staffShot,contentType:'image/png'})

 // The real shared-loopback global limiter (100/min) is not exempted
 // for CI. The claimant and recipient's genuine page/CSRF reads all count.
 // Let the first window clear before verifying the separate legal-owner grant.
 await owner.waitForTimeout(70_000)
 // Canonical membership alone grants NO branch operating rights.
 const readBefore=await staff.request.get(
  'http://127.0.0.1:3001/api/dealer/staff-branches/mine',
  {headers:staffHeaders})
 expect(readBefore.status()).toBe(200)
 expect((await readBefore.json() as {scopes:{branches:unknown[]}}).scopes.branches)
  .toHaveLength(0)
 await owner.reload()
 await expect(owner.locator('#staff-branch-scope-branch')).toBeVisible({timeout:30000})
 await owner.locator('#staff-branch-grant-reason').fill(
  'Only private operating hours at this fictional branch may be edited')
 await owner.getByRole('button',{name:'Grant limited branch edit access'}).click()
 await expect(owner.getByText('Explicit private branch-only operating access recorded.',{
  exact:false,
 })).toBeVisible({timeout:30000})
 const ownerGrantShot=info.outputPath('fictional-owner-private-branch-grant.png')
 await owner.screenshot({path:ownerGrantShot,fullPage:true})
 await info.attach('fictional-owner-private-branch-grant',
  {path:ownerGrantShot,contentType:'image/png'})
 await staff.reload()
 await expect(staff.getByText('Explicit scope: EDIT_BRANCH_DETAILS',{exact:false}))
  .toBeVisible({timeout:30000})
 const readGranted=await staff.request.get(
  'http://127.0.0.1:3001/api/dealer/staff-branches/mine',
  {headers:staffHeaders})
 expect(readGranted.status()).toBe(200)
 const scoped=(await readGranted.json()) as {scopes:{branches:Array<{
  scope_id:string;branch_id:string;permission:string;
  owner_rights:boolean;listing_rights:boolean;finance_rights:boolean}>}}
 expect(scoped.scopes.branches).toHaveLength(1)
 const delegated=scoped.scopes.branches[0]
 expect(delegated.permission).toBe('EDIT_BRANCH_DETAILS')
 expect([delegated.owner_rights,delegated.listing_rights,delegated.finance_rights])
  .toEqual([false,false,false])
 const staffDeclaredHours='Fictional Mon-Fri 07:30-18:00; no open-now assertion'
 await staff.getByLabel('Private opening hours for this branch').fill(staffDeclaredHours)
 await staff.getByRole('button',{name:'Save authorized branch operating details'}).click()
 await expect(staff.getByText('Authorized private branch operating hours saved.',{
  exact:false,
 })).toBeVisible({timeout:30000})
 await staff.reload()
 await expect(staff.getByLabel('Private opening hours for this branch'))
  .toHaveValue(staffDeclaredHours,{timeout:30000})
 const staffBranchShot=info.outputPath('fictional-staff-scoped-private-branch-saved.png')
 await staff.screenshot({path:staffBranchShot,fullPage:true})
 await info.attach('fictional-staff-scoped-private-branch-saved',
  {path:staffBranchShot,contentType:'image/png'})
 const ownerBranchRead=await owner.request.get(
  'http://127.0.0.1:3001/api/dealer/operational-workspace',
  {headers:{'x-user-id':f.actors.claimant.id,
    'x-session-token':f.actors.claimant.token}})
 expect(ownerBranchRead.status()).toBe(200)
 const ownerBranches=(await ownerBranchRead.json() as {workspace:{
  branches:Array<{id:string;opening_hours_text:string|null}>}}).workspace.branches
 expect(ownerBranches.some(b=>b.id===delegated.branch_id&&
  b.opening_hours_text===staffDeclaredHours)).toBe(true)

 // A separately signed-in accepted member (even with branch-only edit
 // access) cannot register any canonical VIN, or invent seller authority.
 const deniedCsrf=await staff.request.get(
  'http://127.0.0.1:3001/api/security/csrf-token',{headers:staffHeaders})
 expect(deniedCsrf.status()).toBe(200)
 const {csrfToken:staffCsrf}=await deniedCsrf.json() as {csrfToken:string}
 const deniedDraft=await staff.request.post(
  'http://127.0.0.1:3001/api/dealer/operational-inventory/private-drafts',{
   headers:{...staffHeaders,'x-csrf-token':staffCsrf},
   data:{vin:'TEST0000000000003',make:'FICTIONAL',model:'STAFF FORBIDDEN',
    year:2026,publication_status:'published',price:99999},
  })
 expect([403,404]).toContain(deniedDraft.status())

 // The same real owner session can read ONLY its tenant's canonical VIN
 // records and progress its CLEAR-risk Marketplace lead. These rows were
 // deliberately seeded in the isolated CI database and are NOT real stock
 // or real customers; no seller publish or payment authority is granted.
 await owner.goto('/dealers/stock')
 await expect(owner.getByRole('heading',{name:'Actual dealership vehicle inventory'}))
  .toBeVisible({timeout:30000})
 await expect(owner.getByText('TEST0000000000001')).toBeVisible({timeout:30000})
 await expect(owner.getByText('draft',{exact:true})).toBeVisible()
 await expect(owner.getByRole('heading',{name:'Structural listing precheck'}))
  .toBeVisible({timeout:30000})
 await expect(owner.getByText('fixture excluded')).toBeVisible()
 await expect(owner.getByText('Seller Authority and Vehicle Passport review: not evaluated.',{
  exact:false,
 })).toBeVisible()
 const stockPrecheck=await owner.request.get(
  'http://127.0.0.1:3001/api/dealer/operational-inventory',
  {headers:{'x-user-id':f.actors.claimant.id,
   'x-session-token':f.actors.claimant.token}})
 expect(stockPrecheck.status()).toBe(200)
 const read=await stockPrecheck.json() as {inventory:{entries:Array<{
  vin:string;listing_structural_precheck:{
   source:string;blocking_reason_codes:string[];
   seller_authority_check:string;human_publication_authorized:boolean;
   merchant_payment_authorized:boolean;
  }}>
 }}
 const v=read.inventory.entries.find(x=>x.vin==='TEST0000000000001')
 expect(v).toBeTruthy()
 expect(v?.listing_structural_precheck.source)
  .toBe('EXISTING_MARKETPLACE_LISTING_ELIGIBILITY_RULES')
 expect(v?.listing_structural_precheck.blocking_reason_codes)
  .toContain('fixture_excluded')
 expect(v?.listing_structural_precheck.seller_authority_check).toBe('NOT_EVALUATED')
 expect(v?.listing_structural_precheck.human_publication_authorized).toBe(false)
 expect(v?.listing_structural_precheck.merchant_payment_authorized).toBe(false)
 // A real owner now registers a second, explicitly FICTIONAL VIN through
  // the actual browser and authenticated canonical private draft endpoint.
  // It must survive refresh while never obtaining seller/listing rights.
  await owner.locator('#private-draft-vin').fill('TEST0000000000002')
  await owner.locator('#private-draft-make').fill('FICTIONAL')
  await owner.locator('#private-draft-model').fill('PRIVATE CI VEHICLE')
  await owner.locator('#private-draft-year').fill('2026')
  await owner.getByRole('button',{name:'Register private VIN draft'}).click()
  await expect(owner.getByText('Private VIN TEST0000000000002 saved',{exact:false}))
   .toBeVisible({timeout:30000})
  await owner.reload()
  await expect(owner.getByText('TEST0000000000002')).toBeVisible({timeout:30000})
  const afterDraft=await owner.request.get(
   'http://127.0.0.1:3001/api/dealer/operational-inventory',
   {headers:{'x-user-id':f.actors.claimant.id,
    'x-session-token':f.actors.claimant.token}})
  expect(afterDraft.status()).toBe(200)
  const privateInventory=await afterDraft.json() as {inventory:{entries:Array<{
   vin:string;recorded_lifecycle_state:string;
   recorded_marketplace_publication_state:string;
   seller_authority:string;public_listing_approved_by_this_read:boolean}>}}
  const newlyRegistered=privateInventory.inventory.entries.find(v=>
   v.vin==='TEST0000000000002')
  expect(newlyRegistered).toBeTruthy()
  expect(newlyRegistered?.recorded_lifecycle_state).toBe('Pending')
  expect(newlyRegistered?.recorded_marketplace_publication_state).toBe('draft')
  expect(newlyRegistered?.public_listing_approved_by_this_read).toBe(false)
  const createdShot=info.outputPath('fictional-owner-created-second-real-private-vin.png')
  await owner.screenshot({path:createdShot,fullPage:true})
  await info.attach('fictional-owner-created-second-real-private-vin',{
   path:createdShot,contentType:'image/png'})
  const stockShot=info.outputPath('fictional-canonical-draft-vin-not-published.png')
 await owner.screenshot({path:stockShot,fullPage:true})
 await info.attach('fictional-canonical-draft-vin-not-published',{
  path:stockShot,contentType:'image/png'})
 await owner.goto('/dealers/inquiries')
 await expect(owner.getByRole('heading',{name:'Marketplace buyer enquiries'}))
  .toBeVisible({timeout:30000})
 const ownerHeaders={'x-user-id':f.actors.claimant.id,
  'x-session-token':f.actors.claimant.token}
 // A real authenticated owner cannot tamper with another tenant's canonical
 // Marketplace enquiry even when they know its genuine UUID.
 const foreignId=(f as Fixture&{synthetic_operations?:{
   foreign_inquiry_id:string}}).synthetic_operations?.foreign_inquiry_id
 expect(foreignId).toBeTruthy()
 const foreignPath='http://127.0.0.1:3001/api/dealer/operational-inquiries/'+
  foreignId+'/follow-up'
 // Exercise both authorization boundaries. A raw state-changing request must
 // fail CSRF first; a genuinely authenticated, CSRF-bound request must then
 // reach the SQL tenant-isolation check and receive its canonical refusal.
 // Do not bypass middleware via NODE_ENV=test or x-verify-csrf toggles.
 // The new real VIN write and refreshes spend the genuine 100/min shared
 // loopback IP budget; wait out the production-equivalent window BEFORE
 // asserting the middleware's 403 and tenant SQL's 409, not an HTTP 429.
 await owner.waitForTimeout(70_000)
 const csrfRejected=await owner.request.patch(foreignPath,{
  headers:ownerHeaders,data:{next_status:'contacted'},
 })
 expect(csrfRejected.status()).toBe(403)
 expect((await csrfRejected.json() as {error:string}).error)
  .toBe('CSRF validation failed. Request untrusted.')
 const csrfResponse=await owner.request.get(
  'http://127.0.0.1:3001/api/security/csrf-token',{headers:ownerHeaders})
 expect(csrfResponse.status()).toBe(200)
 const {csrfToken}=await csrfResponse.json() as {csrfToken:string}
 expect(csrfToken).toMatch(/\.[0-9a-f]{64}$/)
 const deniedForeign=await owner.request.patch(foreignPath,{
  headers:{...ownerHeaders,'x-csrf-token':csrfToken},
  data:{next_status:'contacted'},
 })
 expect(deniedForeign.status()).toBe(409)
 expect((await deniedForeign.json() as {error:string}).error)
  .toBe('DEALER_INQUIRY_FOLLOWUP_REFUSED')
 await expect(owner.getByText('FICTIONAL TEST BUYER',{exact:false}))
  .toBeVisible({timeout:30000})
 await expect(owner.getByRole('button',{name:'Record dealer-reported contact'}))
  .toBeVisible({timeout:30000})
 await owner.getByRole('button',{name:'Record dealer-reported contact'}).click()
 await expect(owner.getByRole('button',{name:'Record dealer-reported qualified enquiry'}))
  .toBeVisible({timeout:30000})
 await owner.getByRole('button',{name:'Record dealer-reported qualified enquiry'}).click()
 await expect(owner.getByText('Dealer-reported follow-up saved to the canonical Marketplace inquiry.',{exact:false}))
  .toBeVisible({timeout:30000})
 // The genuine canonical NEW->CONTACTED->QUALIFIED writes were HTTP 200.
 // The previous browser failure was an immediate reload while the shared
 // 100/min loopback-IP request quota was exhausted by shell requests.
 // Respect the real window instead of bypassing security or deleting assertions.
 await owner.waitForTimeout(70_000)
 const leadReturn=await owner.request.get(
  'http://127.0.0.1:3001/api/dealer/operational-inquiries',
  {headers:ownerHeaders})
 expect(leadReturn.status()).toBe(200)
 const currentLead=await leadReturn.json() as {inquiries:{entries:Array<{
  inquiry_id:string;status:string;allowed_followup_status:string|null}>}}
 expect(currentLead.inquiries.entries.filter(x=>x.status==='qualified')).toHaveLength(1)
 expect(currentLead.inquiries.entries.find(x=>x.status==='qualified')?.allowed_followup_status)
  .toBeNull()
 await owner.reload()
 await expect(owner.getByText('qualified',{exact:true})).toBeVisible({timeout:30000})
 const leadShot=info.outputPath('fictional-real-marketplace-lead-qualified-no-sale.png')
 await owner.screenshot({path:leadShot,fullPage:true})
 await info.attach('fictional-real-marketplace-lead-qualified-no-sale',{
  path:leadShot,contentType:'image/png'})
 // A real sequence of authenticated owner + staff sessions shares one
 // loopback IP in CI. Earlier operations and the Vite shell legitimately
 // consume the production-equivalent 100/min global request budget.
 // Respect the window rather than disabling the limiter or masking HTTP 429.
 // This is ALSO a fresh authorized read after the committed lead transition.
 await owner.waitForTimeout(70_000)
 const staffReturn=await owner.goto('/dealers/staff')
 expect(staffReturn?.status()).toBe(200)
 const freshOwnerStaff=await owner.request.get(
  'http://127.0.0.1:3001/api/dealer/operational-staff',{
   headers:ownerHeaders,
  })
 expect(freshOwnerStaff.status()).toBe(200)
 const staffRead=await freshOwnerStaff.json() as {staff:{
  members:Array<{user_id:string;role:string}>}}
 expect(staffRead.staff.members.some(m=>
  m.user_id===f.actors.staff.id&&m.role==='member')).toBe(true)
 await owner.reload()
 await expect(owner.getByText(f.actors.staff.id,{exact:true}).first())
  .toBeVisible({timeout:30000})
 await expect(owner.getByText('Tenant role: member')).toBeVisible()
 await owner.getByRole('button',{name:'Revoke invitation or staff membership'}).click()
 await expect(owner.getByText('Invitation or canonical limited membership revoked and recorded.'))
  .toBeVisible({timeout:30000})
 await owner.reload()
 await expect(owner.getByText('Tenant role: member')).toHaveCount(0)
 await expect(owner.getByText('Status: REVOKED; role: member'))
  .toBeVisible({timeout:30000})
 await staff.reload()
 await expect(staff.getByText('Status: REVOKED; role: member'))
  .toBeVisible({timeout:30000})
 await expect(staff.getByText('No active branch-operating scope was delegated to this account.'))
  .toBeVisible({timeout:30000})
 const afterScope=await staff.request.get(
  'http://127.0.0.1:3001/api/dealer/staff-branches/mine',
  {headers:staffHeaders})
 expect(afterScope.status()).toBe(200)
 expect((await afterScope.json() as {scopes:{branches:unknown[]}}).scopes.branches)
  .toHaveLength(0)
 const ownerLedger=await owner.request.get(
  'http://127.0.0.1:3001/api/dealer/staff-branch-scopes/owner',
  {headers:ownerHeaders})
 expect(ownerLedger.status()).toBe(200)
 const scopes=(await ownerLedger.json() as {ledger:{
  scopes:Array<{scope_id:string;status:string}>}}).ledger.scopes
 expect(scopes.some(x=>x.scope_id===delegated.scope_id&&x.status==='REVOKED'))
  .toBe(true)
 const revokedShot=info.outputPath('fictional-staff-access-revoked.png')
 await owner.screenshot({path:revokedShot,fullPage:true})
 await info.attach('fictional-staff-access-revoked',{
  path:revokedShot,contentType:'image/png'})
 await staffContext.close()
 await ownerContext.close()
 console.log('DEALER_SYNTHETIC_STAFF_PHYSICAL PASS: two true authenticated people, canonical tenant member role created only on acceptance, then scoped private branch edit, and original-owner revocation atomically removed the scoped permission; zero role escalation')
})
