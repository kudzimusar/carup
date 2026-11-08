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
 await claimant.locator('#claim-document-class-confirmed').check()
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
 // Owner UAT: the deferred T15 OCR-vs-workbook comparison is labelled as manual for the reviewer.
 await expect(reviewer.getByTestId('dealer-unavailable-ocr-comparison')).toContainText('Not available yet')
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
 // R6 functional: the reviewer PICKS the inspected originals (full ids shown) — no UUID typing.
 await expect(legal.locator('#legal-case option',{hasText:fixture.seed})).toHaveCount(1)
 await expect(legal.locator('#legal-company-evidence option',{hasText:company!.evidence_id}))
  .toContainText('COMPANY REGISTRATION')
 await legal.locator('#legal-company-evidence').selectOption(company!.evidence_id)
 await legal.locator('#legal-signatory-evidence').selectOption(signatory!.evidence_id)
 await legal.getByLabel('Verified issuing authority').fill('FICTIONAL CI DOCUMENT ISSUER - NOT REAL')
 // Owner UAT-R1: a browser once autofilled the reviewer's e-mail into the registration number. The field
 // opts out of autofill, a hidden username anchor sits right before the password, the step-up says why
 // the password is asked again, and an e-mail is refused in the form (and by the server).
 const registration=legal.getByLabel('Reviewed company registration number')
 await expect(registration).toHaveAttribute('autocomplete','off')
 await expect(legal.getByTestId('legal-password-username-anchor')).toHaveAttribute('autocomplete','username')
 await expect(legal.locator('#legal-password')).toHaveAttribute('autocomplete','current-password')
 await expect(legal.locator('#legal-password-help'))
  .toHaveText('Enter your account password again to confirm this sensitive independent decision. It is not stored.')
 await registration.fill('fictional-legal-reviewer@example.invalid')
 await expect(legal.locator('#legal-registration-help')).toContainText('cannot be an e-mail address')
 await registration.fill('SYNTHETIC-REG-001')
 await legal.locator('#legal-scope').selectOption('BRANCH')
 await legal.locator('#legal-expiry').fill(new Date(Date.now()+10*86400000).toISOString().slice(0,10))
 await legal.locator('#legal-reason').fill(
  'Synthetic-only legal authority demonstration in an isolated database, based on two fake scanned documents and an explicitly fictional CI country-policy fixture. No actual regulator approved this company.')
 await legal.locator('#legal-password').fill(fixture.legal_reviewer_password)
 const recordLegal=legal.getByRole('button',{name:/Record independent legal approval/})
 await expect(recordLegal).toBeDisabled()
 await legal.locator('#legal-documents-confirmed').check()
 await recordLegal.click()
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
 // Before showing the dashboard, read the actual backend tenant/identity
 // contract. A UI-only assertion is not sufficient proof of legal entity custody.
 const workspaceResponse=await claimant.request.get(
   API+'/dealer/operational-workspace',{
     headers:headers(fixture.actors.claimant),
   })
 expect(workspaceResponse.status()).toBe(200)
 const workspaceReceipt=await workspaceResponse.json() as {workspace:{
   operational:boolean;owner_membership_confirmed:boolean;
   tenant_id:string;organization_id:string;dealer_profile_id:string;
   profile:{legal_name:string;trading_name:string}
 }}
 expect(workspaceReceipt.workspace.operational).toBe(true)
 expect(workspaceReceipt.workspace.owner_membership_confirmed).toBe(true)
 expect(workspaceReceipt.workspace.profile.legal_name)
  .toBe('SYNTHETIC CARUP DEALERSHIP LTD - TEST ONLY')
 expect(workspaceReceipt.workspace.profile.trading_name)
  .toBe('SYNTHETIC FICTIONAL CAR DEALER 1')
 expect(workspaceReceipt.workspace.tenant_id).toBeTruthy()
 expect(workspaceReceipt.workspace.organization_id).toBeTruthy()
 expect(workspaceReceipt.workspace.dealer_profile_id).toBeTruthy()
 await claimant.goto('/dealer/dashboard')
 await expect(claimant.getByRole('heading',{name:'Dealership operations'}))
  .toBeVisible({timeout:30000})
 await expect(claimant.getByText('SYNTHETIC CARUP DEALERSHIP LTD - TEST ONLY').first())
  .toBeVisible({timeout:20000})
 await expect(claimant.getByText('Recorded company branches')).toBeVisible()
 // R6 C02: activation carried the approved workbook — the second branch, GPS,
 // hours and buyer/finance terms are already here BEFORE the owner types anything.
 const carried=claimant.getByTestId('dealer-activation-carryover')
 await expect(carried.getByText('Carried from your approved application')).toBeVisible({timeout:30000})
 await expect(carried.getByText('FICTIONAL CARRIED SECOND YARD - PRIVATE ONLY',{exact:false})).toBeVisible()
 await expect(carried.getByText(/Policy sections carried:.*Buyer assurance/)).toBeVisible()
 await expect(carried.getByText(/Policy sections carried:.*Finance terms/)).toBeVisible()
 // Honest about what had no operating field: retained privately, never claimed as carried.
 await expect(carried.getByTestId('dealer-carryover-retained')).toContainText('stay private in your approved application')
 await expect(claimant.getByText('Declared hours: Sat 08:00-13:00 (FICTIONAL)')).toBeVisible()
 await expect(claimant.getByText('Declared hours: Mon-Fri 09:00-16:00 (FICTIONAL)')).toBeVisible()
 const carryShot=info.outputPath('r6-c02-activation-carryover-no-retyping-1280px.png')
 await carried.screenshot({path:carryShot})
 await info.attach('r6-c02-activation-carryover-no-retyping',{path:carryShot,contentType:'image/png'})
 const carryResponse=await claimant.request.get(API+'/dealer/activation-carryover',{
  headers:headers(fixture.actors.claimant)})
 expect(carryResponse.status()).toBe(200)
 const carryBody=await carryResponse.json() as {carryover:{branches:Array<{branch_ref:string;has_gps:boolean;has_hours:boolean}>;
  sections:string[];independently_verified:boolean;publicly_approved:boolean}}
 expect(carryBody.carryover.branches.map(b=>b.branch_ref)).toContain('BR-FICTIONAL-SECOND')
 expect(carryBody.carryover.branches.every(b=>b.has_gps&&b.has_hours)).toBe(true)
 expect(carryBody.carryover.sections).toEqual(expect.arrayContaining(['BUYER_ASSURANCE','FINANCE_TERMS']))
 expect(carryBody.carryover.independently_verified).toBe(false)
 expect(carryBody.carryover.publicly_approved).toBe(false)
 // A genuinely NEW branch is still added through the canonical private editor (C14).
 // UAT-R1 redesign: the editor sits in a collapsible "Add or edit a branch" section.
 await claimant.getByRole('button',{name:'Add or edit a branch'}).click()
 await claimant.locator('#dealer-new-branch-name')
  .fill('FICTIONAL SECOND YARD - PRIVATE ONLY')
 await claimant.locator('#dealer-new-branch-address')
  .fill('TEST STREET 2 - NOT A REAL PUBLIC ADDRESS')
 await claimant.locator('#dealer-branch-latitude').fill('-17.829')
 await claimant.locator('#dealer-branch-longitude').fill('31.052')
 await claimant.locator('#dealer-branch-hours').fill('Monday-Friday 09:00-16:00 (FICTIONAL)')
 await claimant.getByRole('button',{name:'Save branch to canonical dealership profile'})
  .click()
 await expect(claimant.getByText('FICTIONAL SECOND YARD - PRIVATE ONLY',{exact:true}))
  .toBeVisible({timeout:30000})
 // Operational buyer policies must persist in the canonical versioned
 // dealer declaration ledger and survive a fresh browser page reload.
 // The R6 carry-over checks above are real page/API traffic from the shared loopback IP:
 // respect CarUp's unchanged 100-request/minute window before the next write (never raise it).
 await claimant.waitForTimeout(65_000)
 await claimant.goto('/dealers/operating-details')
 await expect(claimant.getByRole('heading',{name:'Operate your verified dealership'}))
  .toBeVisible({timeout:30000})
 await claimant.getByRole('button',{name:/Buyer assurance/}).click()
 // Carried values are pre-filled: the owner does NOT retype them.
 await expect(claimant.locator('#dealer-refund_policy')).toHaveValue(
  'FICTIONAL CI: no actual deposits collected. All test orders are void and refunds are not real.',
  {timeout:30000})
 await expect(claimant.locator('#dealer-dispute_resolution')).toHaveValue(
  'FICTIONAL CI: contact CarUp test reviewers. No customer claim is adjudicated here.')
 await claimant.locator('#dealer-inspection_rights').fill(
  'FICTIONAL CI: buyers may inspect any fictional vehicle before a (fictional) deposit.')
 await claimant.getByRole('button',{name:'Save this section to CarUp'}).click()
 await expect(claimant.getByText('Saved private buyer assurance version 2.',{exact:false}))
  .toBeVisible({timeout:30000})
 // The same local loopback IP is shared by many REAL browser navigation,
 // session, menu and feature calls. A valid policy save must survive refresh
 // without disabling or enlarging CarUp's fixed-window global rate limiter.
 // Respect the actual window before the separate full-document reload.
 await claimant.waitForTimeout(70_000)
 const firstReloadResponse=await claimant.reload()
 expect(firstReloadResponse?.status()).toBe(200)
 await expect(claimant.getByRole('button',{name:/Buyer assurance/}))
  .toBeVisible({timeout:30_000})
 const postRefreshAuthority=await claimant.request.get(
  API+'/dealer/operational-workspace',{
    headers:headers(fixture.actors.claimant),
  })
 expect(postRefreshAuthority.status()).toBe(200)
 await claimant.getByRole('button',{name:/Buyer assurance/}).click({timeout:30_000})
 await expect(claimant.locator('#dealer-refund_policy')).toHaveValue(
  'FICTIONAL CI: no actual deposits collected. All test orders are void and refunds are not real.',
  {timeout:30000})
 await claimant.goto('/dealer/dashboard')
 const dashboardShot=info.outputPath('fictional-dealer-live-canonical-dashboard-1280px.png')
 await claimant.screenshot({path:dashboardShot,fullPage:true})
 await info.attach('fictional-dealer-live-canonical-dashboard-1280px',{
  path:dashboardShot,contentType:'image/png',
 })
 // R6 E: one journey — an activated owner's legacy dealer-portal bookmarks land in the
 // canonical workspace instead of a parallel global-role portal.
 await claimant.waitForTimeout(65_000)
 await claimant.goto('/dealer/inventory')
 await expect(claimant).toHaveURL(/\/dealers\/stock$/,{timeout:30000})
 await claimant.goto('/dealer/leads?from=bookmark')
 await expect(claimant).toHaveURL(/\/dealers\/inquiries\?from=bookmark$/,{timeout:30000})
 // Billing is reachable from the canonical workspace navigation and stays fail-closed.
 await claimant.goto('/dealer/dashboard')
 await expect(claimant.getByRole('heading',{name:'Dealership operations'})).toBeVisible({timeout:30000})
 await claimant.getByRole('link',{name:'Billing readiness'}).click()
 await expect(claimant.getByRole('heading',{name:'Dealer subscriptions cannot be purchased yet'}))
  .toBeVisible({timeout:30000})
 await expect(claimant.getByText('No unapproved plan, amount or merchant connection is presented as available.',{exact:false})).toBeVisible()
 await expect(claimant.getByText('Not available — not zero').first()).toBeVisible()

 // Same reason: the legacy-bookmark and billing navigation shares the per-IP window.
 await claimant.waitForTimeout(65_000)
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
 // R6 C02: several sections are now carried; approve exactly the reviewed buyer assurance.
 await publish.getByRole('heading',{
  name:'Independently review dealer-declared sections',
 }).locator('..').locator('label',{hasText:/BUYER ASSURANCE · version 2/})
  .locator('input[type="checkbox"]').check()
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
 await expect(publicPage).toHaveTitle(/Reviewed dealer storefront/)
 await expect(publicPage.locator('meta[name="robots"][data-carup-dealer-seo="true"]'))
  .toHaveAttribute('content','index,follow')
 await expect(publicPage.locator('meta[name="description"][data-carup-dealer-seo="true"]'))
  .toHaveAttribute('content',/Independently reviewed dealership/)
 await expect(publicPage.locator('link[rel="canonical"][data-carup-dealer-seo="true"]'))
  .toHaveAttribute('href',new RegExp('/dealers/'+fixture.public_slug+'$'))
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
