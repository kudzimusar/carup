import {test,expect,type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'

/**
 * CI-only continuation of independently reviewed FICTIONAL canonical tenant.
 * Uses the live CarUp browser, PostgreSQL, real user_sessions and existing
 * Corporate tenant_users/organization_users, not mocked API responses.
 * No franchise, financial, branch, owner or VIN-selling staff rights.
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
 test.setTimeout(360000)
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

 // The same real owner session can read ONLY its tenant's canonical VIN
 // records and progress its CLEAR-risk Marketplace lead. These rows were
 // deliberately seeded in the isolated CI database and are NOT real stock
 // or real customers; no seller publish or payment authority is granted.
 await owner.goto('/dealers/stock')
 await expect(owner.getByRole('heading',{name:'Actual dealership vehicle inventory'}))
  .toBeVisible({timeout:30000})
 await expect(owner.getByText('TEST0000000000001')).toBeVisible({timeout:30000})
 await expect(owner.getByText('draft',{exact:true})).toBeVisible()
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
 const deniedForeign=await owner.request.patch(
  'http://127.0.0.1:3001/api/dealer/operational-inquiries/'+foreignId+'/follow-up',{
   headers:ownerHeaders,data:{next_status:'contacted'},
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
 await owner.reload()
 await expect(owner.getByText('qualified',{exact:true})).toBeVisible({timeout:30000})
 const leadShot=info.outputPath('fictional-real-marketplace-lead-qualified-no-sale.png')
 await owner.screenshot({path:leadShot,fullPage:true})
 await info.attach('fictional-real-marketplace-lead-qualified-no-sale',{
  path:leadShot,contentType:'image/png'})
 await owner.goto('/dealers/staff')
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
 const revokedShot=info.outputPath('fictional-staff-access-revoked.png')
 await owner.screenshot({path:revokedShot,fullPage:true})
 await info.attach('fictional-staff-access-revoked',{
  path:revokedShot,contentType:'image/png'})
 await staffContext.close()
 await ownerContext.close()
 console.log('DEALER_SYNTHETIC_STAFF_PHYSICAL PASS: two true authenticated people, canonical tenant member role created only on acceptance, then independent original-owner revocation persisted; zero role escalation')
})
