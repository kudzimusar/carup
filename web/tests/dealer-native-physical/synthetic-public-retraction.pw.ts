/**
 * Synthetic-only physical regression. Starts ONLY after the full fictional
 * prelisting -> claim -> workbook -> legal -> canonical organization/tenant
 * -> private staff -> buyer-case journey has passed. No real business is used.
 * Proves independent PUBLIC DISPLAY retraction at the SAME unchanged slug
 * does not misrepresent the already approved corporate claim as "unclaimed".
 */
import {test,expect,type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'
type Actor={id:string;name:string;email:string;role:string;token:string}
type Fixture={
 source_type:string;source_population:number;seed:string;public_slug:string
 synthetic_legal_policy_provenance:string;reviewer_password:string
 actors:{reviewer:Actor;claimant:Actor;staff:Actor}
}
const path=process.env.DEALER_BROWSER_FIXTURE_JSON
if(!path)throw Error('FICTIONAL_RETRACTION_FIXTURE_UNAVAILABLE')
const f=JSON.parse(readFileSync(path,'utf8')) as Fixture
if(f.source_type!=='EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX'||
 f.source_population!==104||
 f.synthetic_legal_policy_provenance!=='CI_ONLY_NOT_ACTUAL_ZIMBABWE_AUTHORITY'||
 !/^ZW-DEAL-\d{4}$/.test(f.seed)||
 !/^zw-deal-\d{4}$/.test(f.public_slug)||
 f.actors.reviewer.id===f.actors.claimant.id)
 throw Error('NON_FICTIONAL_PUBLIC_RETRACTION_REFUSED')
const API='http://127.0.0.1:3001/api'
const auth=(actor:Actor)=>({'x-session-token':actor.token,'x-user-id':actor.id})
async function login(page:Page,actor:Actor){
 await page.addInitScript(({user,token}:{user:Omit<Actor,'token'>;token:string})=>{
  localStorage.setItem('carup_user',JSON.stringify(user))
  localStorage.setItem('carup_token',token)
 },{user:{id:actor.id,name:actor.name,email:actor.email,role:actor.role},token:actor.token})
}
test('synthetic full public retraction preserves existing corporate claim and stable unverified URL',async({browser},info)=>{
 test.setTimeout(260_000)
 // The earlier physical phases share localhost. Keep the same 100/min
 // production-equivalent rate limit; do not invent a CI bypass.
 await new Promise<void>(resolve=>setTimeout(resolve,70_000))
 const originalSlug='/dealers/'+f.public_slug
 const publicContext=await browser.newContext({viewport:{width:1280,height:900}})
 const publicPage=await publicContext.newPage()
 await publicPage.goto(originalSlug)
 await expect(publicPage.getByRole('heading',{name:'Reviewed dealership branches'}))
  .toBeVisible({timeout:30000})
 await expect(publicPage.getByRole('heading',{name:'BUYER ASSURANCE'}))
  .toBeVisible({timeout:30000})
 const beforeShot=info.outputPath('fictional-retraction-before-full-storefront.png')
 await publicPage.screenshot({path:beforeShot,fullPage:true})
 await info.attach('fictional-retraction-before-full-storefront',{
  path:beforeShot,contentType:'image/png'})

 const reviewContext=await browser.newContext({viewport:{width:1280,height:900}})
 const reviewer=await reviewContext.newPage()
 await login(reviewer,f.actors.reviewer)
 await reviewer.goto('/admin/dealer-full-storefront-review')
 await expect(reviewer.getByRole('heading',{name:'Full dealership publication'}))
  .toBeVisible({timeout:30000})
 await expect(reviewer.getByText(f.seed).first()).toBeVisible({timeout:30000})
 await reviewer.locator('#storefront-decision').selectOption('RETRACTED')
 await reviewer.locator('#storefront-reason').fill(
  'FICTIONAL CI independent public-display retraction. Keep the canonical approved claimant intact, do not assert an active legal storefront, do not invite unaudited new company takeover, preserve private evidence and company tenant custody.')
 await reviewer.locator('#storefront-password').fill(f.reviewer_password)
 await reviewer.getByRole('button',{name:'Record immutable publication decision'}).click()
 await expect(reviewer.getByText('Independent full storefront retraction recorded.',{
  exact:false,
 })).toBeVisible({timeout:30000})
 const reviewerShot=info.outputPath('fictional-retraction-independent-reviewer.png')
 await reviewer.screenshot({path:reviewerShot,fullPage:true})
 await info.attach('fictional-retraction-independent-reviewer',{
  path:reviewerShot,contentType:'image/png'})

 await publicPage.reload()
 await expect(publicPage).toHaveURL(new RegExp('/dealers/'+f.public_slug+'$'))
 await expect(publicPage.getByText(
  'Existing approved claim — No current independently verified storefront',{
   exact:false,
  })).toBeVisible({timeout:30000})
 await expect(publicPage.getByRole('heading',{name:'Reviewed dealership branches'}))
  .toHaveCount(0)
 await expect(publicPage.getByRole('heading',{name:'BUYER ASSURANCE'}))
  .toHaveCount(0)
 await expect(publicPage.getByText('Request independent correction, dispute or ownership transfer'))
  .toBeVisible({timeout:30000})
 await expect(publicPage.getByRole('heading',{name:'Request to claim this business'}))
  .toHaveCount(0)
 const endpoint=await publicPage.request.get(API+'/dealership/research/'+f.seed)
 expect(endpoint.status()).toBe(200)
 const body=await endpoint.json() as {profile:{
  seed_dealer_id:string;tier:string;claimed:boolean;business_verified:boolean;
  approved_branches?:unknown[];dealer_declared_sections?:unknown;
 }}
 expect(body.profile.seed_dealer_id).toBe(f.seed)
 expect(body.profile.claimed).toBe(true)
 expect(body.profile.business_verified).toBe(false)
 expect(body.profile.tier).toBe('CLAIMED_PUBLIC_DISPLAY_UNAPPROVED')
 expect(body.profile.approved_branches).toBeUndefined()
 expect(body.profile.dealer_declared_sections).toBeUndefined()
 const apiSnapshot=info.outputPath('fictional-retracted-profile-1280px.png')
 await publicPage.screenshot({path:apiSnapshot,fullPage:true})
 await info.attach('fictional-retracted-profile-1280px',{
  path:apiSnapshot,contentType:'image/png'})
 // The directory is still truthful about the research listing, but it must
 // no longer suggest that the approved company has no claimant.
 const directory=await publicPage.request.get(API+'/dealership/research?page=1')
 expect(directory.status()).toBe(200)
 const dir=await directory.json() as {entries:Array<{
  seed_dealer_id:string;claimed:boolean;business_verified:boolean;tier:string}>}
 const record=dir.entries.find(x=>x.seed_dealer_id===f.seed)
 expect(record).toBeTruthy()
 expect(record?.claimed).toBe(true)
 expect(record?.business_verified).toBe(false)
 await publicPage.goto('/dealers')
 await expect(publicPage.getByText('Claim this dealership')).toHaveCount(0)
 // Even guessing the direct claim URL cannot open an unclaimed takeover.
 await publicPage.goto(originalSlug+'/claim')
 await expect(publicPage.getByRole('heading',{name:'Request to claim this business'}))
  .toHaveCount(0)
 await expect(publicPage.getByText('Request independent correction, dispute or ownership transfer'))
  .toBeVisible({timeout:30000})
 const mobile=await browser.newContext({viewport:{width:390,height:844}})
 const phone=await mobile.newPage()
 await phone.goto(originalSlug)
 await expect(phone.getByText('Existing approved claim — No current independently verified storefront',{
  exact:false,
 })).toBeVisible({timeout:30000})
 const mobileShot=info.outputPath('fictional-retraction-claimed-not-certified-390px.png')
 await phone.screenshot({path:mobileShot,fullPage:true})
 await info.attach('fictional-retraction-claimed-not-certified-390px',{
  path:mobileShot,contentType:'image/png'})
 await mobile.close()
 await reviewContext.close()
 await publicContext.close()
 console.log('DEALER_NATIVE_FICTIONAL_RETRACTION_BROWSER PASS: independent synthetic public review retracted full display, same URL safely downgraded to CLAIMED_NOT_CURRENTLY_APPROVED, no false unclaimed CTA, private claim intact')
})
