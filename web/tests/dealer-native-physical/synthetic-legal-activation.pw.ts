import {test,expect,type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'

/**
 * Follow-on physical browser phase. Only an explicitly fictional policy,
 * formally injected into a GUARDED disposable PostgreSQL database after the
 * initial real-document/intake journey, can reach this test.
 * NO actual Zimbabwe legal authorization, business licence, merchant activation,
 * live inventory sales or real dealership publication is represented here.
 */
type Actor={id:string;name:string;email:string;role:string;token:string}
type Fixture={
  actors:{claimant:Actor;reviewer:Actor;legalReviewer:Actor;activator:Actor}
  reviewer_password:string;legal_reviewer_password:string;activator_password:string
  seed:string;public_slug:string;source_population:number;source_type:string
  synthetic_legal_policy_version:string;synthetic_legal_policy_provenance:string
}
const file=process.env.DEALER_BROWSER_FIXTURE_JSON
if(!file)throw Error('SYNTHETIC_LEGAL_BROWSER_FIXTURE_MISSING')
const fixture=JSON.parse(readFileSync(file,'utf8')) as Fixture
if(fixture.source_type!=='EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX'||
 fixture.source_population!==104||
 fixture.synthetic_legal_policy_provenance!=='CI_ONLY_NOT_ACTUAL_ZIMBABWE_AUTHORITY'||
 !fixture.synthetic_legal_policy_version.startsWith('CARUP_SYNTHETIC_CI_'))
 throw Error('NON_SYNTHETIC_LEGAL_POLICY_BROWSER_TEST_REFUSED')
const API='http://127.0.0.1:3001/api'
const headers=(actor:Actor)=>({
  'x-session-token':actor.token,'x-user-id':actor.id,
})
async function login(page:Page,actor:Actor){
  await page.addInitScript(({user,token}:{user:Omit<Actor,'token'>;token:string})=>{
    localStorage.setItem('carup_user',JSON.stringify(user))
    localStorage.setItem('carup_token',token)
  },{user:{id:actor.id,name:actor.name,email:actor.email,role:actor.role},token:actor.token})
}
function fictionalSignatoryPdf():Buffer {
 const lines=[
  'BT /F1 16 Tf 50 720 Td',
  '(FICTIONAL CI SIGNATORY MANDATE TEST ONLY) Tj',
  '0 -27 Td (NOT A REGISTERED LEGAL COMPANY OR DIRECTOR) Tj',
  '0 -27 Td (NOT A REAL GOVERNMENT DOCUMENT) Tj',
  '0 -27 Td (CANNOT AUTHORIZE A REAL DEALERSHIP) Tj',
  'ET',
 ].join('\n')
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Length '+Buffer.byteLength(lines,'ascii')+' >>\nstream\n'+lines+'\nendstream',
 ]
 let out='%PDF-1.4\n'
 const offsets=[0]
 for(let i=0;i<objects.length;i++){
  offsets.push(Buffer.byteLength(out,'ascii'))
  out+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n'
 }
 const offset=Buffer.byteLength(out,'ascii')
 out+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'
 for(const item of offsets.slice(1))out+=String(item).padStart(10,'0')+' 00000 n \n'
 out+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\n'
 out+='startxref\n'+offset+'\n%%EOF\n'
 return Buffer.from(out,'ascii')
}

test('FICTIONAL only · preliminary → separate legal review → canonical tenant → full same-slug storefront',async({browser},info)=>{
 test.setTimeout(900_000)
 // The 7 preceding Chromium cases shared one localhost IP. Keep the actual
 // CarUp rate limiter intact instead of raising a test-only bypass.
 await new Promise<void>(resolve=>setTimeout(resolve,70_000))
 const claimantContext=await browser.newContext({viewport:{width:1280,height:900}})
 const claimant=await claimantContext.newPage()
 await login(claimant,fixture.actors.claimant)
 await claimant.goto('/dealers/claims')
 await expect(claimant.getByRole('heading',{
  name:'Additional original documents for separate compliance review',
 })).toBeVisible({timeout:30000})
 const mine=await claimant.request.get(API+'/dealership/claims/mine',{
  headers:headers(fixture.actors.claimant),
 })
 expect(mine.status()).toBe(200)
 const cases=await mine.json() as {claims:Array<{claim_id:string;claim_status:string;seed_dealer_id:string}>}
 const claim=cases.claims.find(c=>c.seed_dealer_id===fixture.seed)
 expect(claim?.claim_status).toBe('CLAIM_APPROVED')
 const claimId=claim!.claim_id
 await claimant.locator('#claim-document-class').selectOption('SIGNATORY_MANDATE')
 await claimant.locator('#claim-document-file').setInputFiles({
  name:'FICTIONAL_SIGNATORY_MANDATE_NOT_LEGAL.pdf',
  mimeType:'application/pdf',buffer:fictionalSignatoryPdf(),
 })
 await claimant.getByRole('button',{name:'Upload private evidence'}).click()
 await expect(claimant.getByText('Original document stored privately.',{exact:false}))
  .toBeVisible({timeout:60000})
 await expect(claimant.getByText('2 private evidence record(s)'))
  .toBeVisible({timeout:20000})
 const evidenceResponse=await claimant.request.get(
  API+'/dealership/claims/'+claimId+'/evidence',{
    headers:headers(fixture.actors.claimant),
  })
 expect(evidenceResponse.status()).toBe(200)
 const evidences=await evidenceResponse.json() as {evidence:Array<{evidence_id:string;document_class:string}>}
 const company=evidences.evidence.find(e=>e.document_class==='COMPANY_REGISTRATION')
 const signatory=evidences.evidence.find(e=>e.document_class==='SIGNATORY_MANDATE')
 expect(company?.evidence_id).toBeTruthy()
 expect(signatory?.evidence_id).toBeTruthy()
 expect(signatory!.evidence_id).not.toBe(company!.evidence_id)
 const privateShot=info.outputPath('fictional-post-claim-compliance-document.png')
 await claimant.screenshot({path:privateShot,fullPage:true})
 await info.attach('fictional-post-claim-compliance-document',{
  path:privateShot,contentType:'image/png',
 })

 const reviewContext=await browser.newContext({viewport:{width:1280,height:900}})
 const reviewer=await reviewContext.newPage()
 await login(reviewer,fixture.actors.reviewer)
 await reviewer.goto('/admin/dealer-compliance-submissions')
 await expect(reviewer.getByRole('heading',{name:'Independent dealer application review'}))
  .toBeVisible({timeout:25000})
 await expect(reviewer.getByText('Application version 1')).toBeVisible({timeout:25000})
 await reviewer.locator('#case-password').fill(fixture.reviewer_password)
 await reviewer.getByRole('button',{name:'Inspect private frozen application'}).click()
 await expect(reviewer.getByRole('heading',{name:'Declared legal identity — not verified'}))
  .toBeVisible({timeout:25000})
 await reviewer.locator('#finding').selectOption('READY_FOR_REGULATORY_REVIEW')
 await reviewer.locator('#finding-reason').fill(
  'Fictional test only: the original mandate and registered company identity were examined for branch-scoped CI contract verification. No real statutory approval is inferred.')
 await reviewer.locator('#finding-password').fill(fixture.reviewer_password)
 await reviewer.getByRole('button',{name:'Record immutable preliminary finding'}).click()
 await expect(reviewer.getByText('Preliminary finding recorded: READY_FOR_REGULATORY_REVIEW',{
  exact:false,
 })).toBeVisible({timeout:35000})
 const preliminaryShot=info.outputPath('fictional-independent-preliminary-compliance.png')
 await reviewer.screenshot({path:preliminaryShot,fullPage:true})
 await info.attach('fictional-independent-preliminary-compliance',{
  path:preliminaryShot,contentType:'image/png',
 })

 const legalContext=await browser.newContext({viewport:{width:1280,height:900}})
 const legal=await legalContext.newPage()
 await login(legal,fixture.actors.legalReviewer)
 await legal.goto('/admin/dealer-claims')
 await expect(legal.getByRole('heading',{name:'Independent dealership claim review'}))
  .toBeVisible({timeout:30000})
 await expect(legal.locator('#dealer-evidence-selection option')).toHaveCount(3,{
  timeout:30000,
 })
 await legal.locator('#dealer-evidence-selection').selectOption(signatory!.evidence_id)
 await legal.locator('#claim-reviewer-password').fill(fixture.legal_reviewer_password)
 await legal.getByRole('button',{name:'View selected original securely'}).click()
 const mandateLink=legal.getByRole('link',{name:/Open private original/})
 await expect(mandateLink).toBeVisible({timeout:20000})
 const originalUrl=await mandateLink.getAttribute('href')
 expect(originalUrl).toMatch(/storage\/v1\/object\/sign\//)
 const storedMandate=await legal.request.get(originalUrl!)
 expect(storedMandate.status()).toBe(200)
 expect((await storedMandate.body()).equals(fictionalSignatoryPdf())).toBe(true)
 await legal.goto('/admin/dealer-legal-activation')
 await expect(legal.getByRole('heading',{name:'Dealer legal authorization & canonical activation'}))
  .toBeVisible({timeout:30000})
 const policy=legal.locator('#legal-policy')
 await expect(policy.locator('option',{hasText:fixture.synthetic_legal_policy_version}))
  .toHaveCount(1,{timeout:25000})
 await policy.selectOption(fixture.synthetic_legal_policy_version)
 await expect(legal.locator('#legal-case option')).toHaveCount(1,{timeout:20000})
 await legal.getByLabel('Company registration evidence ID').fill(company!.evidence_id)
 await legal.getByLabel('Independent signatory mandate evidence ID').fill(signatory!.evidence_id)
 await legal.getByLabel('Verified issuing authority').fill('FICTIONAL CI DOCUMENT ISSUER - NOT REAL')
 await legal.getByLabel('Reviewed company registration number').fill('SYNTHETIC-REG-001')
 await legal.locator('#legal-scope').selectOption('BRANCH')
 await legal.locator('#legal-expiry').fill(new Date(Date.now()+10*86400000).toISOString())
 await legal.locator('#legal-reason').fill(
  'Synthetic-only legal authority demonstration in an isolated database, based on two fake scanned documents and an explicitly fictional CI country-policy fixture. No actual regulator approved this company.')
 await legal.locator('#legal-password').fill(fixture.legal_reviewer_password)
 await legal.getByRole('button',{name:/Record independent legal approval/}).click()
 await expect(legal.getByText('Independent legal review recorded:',{exact:false}))
  .toBeVisible({timeout:40000})
 const legalShot=info.outputPath('fictional-separate-legal-review.png')
 await legal.screenshot({path:legalShot,fullPage:true})
 await info.attach('fictional-separate-legal-review',{path:legalShot,contentType:'image/png'})

 const activationContext=await browser.newContext({viewport:{width:1280,height:900}})
 const activation=await activationContext.newPage()
 await login(activation,fixture.actors.activator)
 await activation.goto('/admin/dealer-legal-activation')
 await expect(activation.getByRole('heading',{
  name:'Dealer legal authorization & canonical activation',
 })).toBeVisible({timeout:25000})
 await expect(activation.locator('#activation-case option')).toHaveCount(1,{
  timeout:30000,
 })
 await activation.locator('#activation-reason').fill(
  'Fictional CI-only activation by a distinct authenticated approver after a separate legal reviewer and artificial country policy. This tenant is not connected to any real dealer.')
 await activation.locator('#final-password').fill(fixture.activator_password)
 await activation.getByRole('button',{
  name:'Activate canonical organization, tenant & owner membership',
 }).click()
 await expect(activation.getByText('Canonical activation was accepted',{exact:false}))
  .toBeVisible({timeout:40000})
 const activateShot=info.outputPath('fictional-canonical-tenant-activation.png')
 await activation.screenshot({path:activateShot,fullPage:true})
 await info.attach('fictional-canonical-tenant-activation',{
  path:activateShot,contentType:'image/png',
 })

 // The claimant still has global member role. Only actual SQL-linked
 // organization/tenant/member authority may unlock the physical workspace.
 await claimant.goto('/dealer/dashboard')
 await expect(claimant.getByRole('heading',{name:'Dealership operations'}))
  .toBeVisible({timeout:30000})
 await expect(claimant.getByText('SYNTHETIC CARUP DEALERSHIP LTD - TEST ONLY').first())
  .toBeVisible({timeout:20000})
 await expect(claimant.getByText('Recorded company branches')).toBeVisible()
 await claimant.locator('#dealer-new-branch-name')
  .fill('FICTIONAL SECOND YARD - PRIVATE ONLY')
 await claimant.locator('#dealer-new-branch-address')
  .fill('TEST STREET 2 - NOT A REAL PUBLIC ADDRESS')
 await claimant.locator('#dealer-branch-latitude').fill('-17.829')
 await claimant.locator('#dealer-branch-longitude').fill('31.052')
 await claimant.locator('#dealer-branch-hours').fill('Monday-Friday 09:00-16:00 (FICTIONAL)')
 await claimant.getByRole('button',{name:'Save branch to canonical dealership profile'})
  .click()
 await expect(claimant.getByText('FICTIONAL SECOND YARD - PRIVATE ONLY'))
  .toBeVisible({timeout:30000})
 // Operational buyer policies must persist in the canonical versioned
 // dealer declaration ledger and survive a fresh browser page reload.
 await claimant.goto('/dealers/operating-details')
 await expect(claimant.getByRole('heading',{name:'Operate your verified dealership'}))
  .toBeVisible({timeout:30000})
 await claimant.getByRole('button',{name:/Buyer assurance/}).click()
 await claimant.locator('#dealer-refund_policy').fill(
  'FICTIONAL CI: no actual deposits collected. All test orders are void and refunds are not real.')
 await claimant.locator('#dealer-dispute_resolution').fill(
  'FICTIONAL CI: contact CarUp test reviewers. No customer claim is adjudicated here.')
 await claimant.getByRole('button',{name:'Save this section to CarUp'}).click()
 await expect(claimant.getByText('Saved private buyer assurance version 1.',{exact:false}))
  .toBeVisible({timeout:30000})
 await claimant.reload()
 await claimant.getByRole('button',{name:/Buyer assurance/}).click()
 await expect(claimant.locator('#dealer-refund_policy')).toHaveValue(
  'FICTIONAL CI: no actual deposits collected. All test orders are void and refunds are not real.',
  {timeout:30000})
 await claimant.goto('/dealer/dashboard')
 const dashboardShot=info.outputPath('fictional-dealer-live-canonical-dashboard-1280px.png')
 await claimant.screenshot({path:dashboardShot,fullPage:true})
 await info.attach('fictional-dealer-live-canonical-dashboard-1280px',{
  path:dashboardShot,contentType:'image/png',
 })

 const publicReviewerContext=await browser.newContext({viewport:{width:1280,height:900}})
 const publish=await publicReviewerContext.newPage()
 await login(publish,fixture.actors.reviewer)
 await publish.goto('/admin/dealer-full-storefront-review')
 await expect(publish.getByRole('heading',{name:'Full dealership publication'}))
  .toBeVisible({timeout:30000})
 await expect(publish.getByText(fixture.seed).first()).toBeVisible({timeout:25000})
 await publish.locator('#storefront-password').fill(fixture.reviewer_password)
 await publish.getByRole('button',{name:'Inspect review candidate'}).click()
 await expect(publish.getByRole('heading',{
  name:'Approve only verified branch display facts',
 })).toBeVisible({timeout:30000})
 await publish.getByRole('heading',{
  name:'Approve only verified branch display facts',
 }).locator('..').locator('input[type="checkbox"]').first().check()
 await expect(publish.getByRole('heading',{
  name:'Independently review dealer-declared sections',
 })).toBeVisible({timeout:30000})
 await publish.getByRole('heading',{
  name:'Independently review dealer-declared sections',
 }).locator('..').locator('input[type="checkbox"]').first().check()
 await publish.locator('#storefront-reason').fill(
  'Fictional CI public display approval only. The branch identity, local test policy and dealer-declared fields were reviewed under isolated synthetic sessions, with no real company publicity or merchant entitlement.')
 await publish.locator('#storefront-password').fill(fixture.reviewer_password)
 await publish.getByRole('button',{name:'Record immutable publication decision'}).click()
 await expect(publish.getByText(
  'Independent full storefront publication event recorded.',{exact:false},
 )).toBeVisible({timeout:40000})

 // Physical SAME URL upgraded, never a new slug or unauthorized preview.
 await new Promise<void>(resolve=>setTimeout(resolve,70_000))
 const publicContext=await browser.newContext({viewport:{width:1280,height:900}})
 const publicPage=await publicContext.newPage()
 await publicPage.goto('/dealers/'+fixture.public_slug)
 await expect(publicPage).toHaveURL(new RegExp('/dealers/'+fixture.public_slug+'$'))
 await expect(publicPage.getByRole('heading',{name:'Reviewed dealership branches'}))
  .toBeVisible({timeout:35000})
 await expect(publicPage.getByText(
  'Legal dealership and currently active operating authority were independently reviewed.',
  {exact:false},
 )).toBeVisible({timeout:30000})
 await expect(publicPage.getByText('No CarUp-verified licence',{exact:false}))
  .toHaveCount(0)
 await expect(publicPage.getByRole('heading',{name:'BUYER ASSURANCE'}))
  .toBeVisible({timeout:30000})
 await expect(publicPage.getByText('FICTIONAL CI: no actual deposits collected.',{exact:false}))
  .toBeVisible({timeout:30000})
 const publicShot=info.outputPath('fictional-stable-full-dealership-public-profile.png')
 await publicPage.screenshot({path:publicShot,fullPage:true})
 await info.attach('fictional-stable-full-dealership-public-profile',{
  path:publicShot,contentType:'image/png',
 })
 // The previously validated research/unclaimed URL must remain stable and
 // show the separately reviewed FULL profile at all four required widths.
 // Explicitly fictional approved branch display is a CI exercise only.
 for(const width of [390,768,1920]){
  const ctx=await browser.newContext({viewport:{width,height:900}})
  const page=await ctx.newPage()
  await page.goto('/dealers/'+fixture.public_slug)
  await expect(page).toHaveURL(new RegExp('/dealers/'+fixture.public_slug+'$'))
  await expect(page.getByRole('heading',{name:'Reviewed dealership branches'}))
   .toBeVisible({timeout:30000})
  await expect(page.getByRole('heading',{name:'BUYER ASSURANCE'}))
   .toBeVisible({timeout:30000})
  const shot=info.outputPath('fictional-approved-same-slug-'+width+'px.png')
  await page.screenshot({path:shot,fullPage:true})
  await info.attach('fictional-approved-same-slug-'+width+'px',{
   path:shot,contentType:'image/png'})
  await ctx.close()
 }
 for(const context of [claimantContext,reviewContext,legalContext,activationContext,
   publicReviewerContext,publicContext])await context.close()
 console.log('DEALER_FICTIONAL_COMPLETE_BROWSER_GOLDEN_RESULT PASS: separate authenticated reviewer/approver sessions; synthetic country policy only; real legal tenant and branch persisted; same public slug upgraded; zero real business/regulator authority')
})
