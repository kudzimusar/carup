import {test,expect,type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'
import ExcelJS from 'exceljs'
type Actor={id:string;name:string;email:string;role:string;token:string}
type Fixture={
 actors:{claimant:Actor;reviewer:Actor};reviewer_password:string;
 seed:string;public_slug:string;source_population:104;source_type:string;
}
const file=process.env.DEALER_BROWSER_FIXTURE_JSON
if(!file)throw Error('DEALER_BROWSER_FIXTURE_REQUIRED')
const fixture=JSON.parse(readFileSync(file,'utf8')) as Fixture
if(fixture.source_type!=='EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX'||fixture.source_population!==104)
 throw Error('NON_SYNTHETIC_OR_NON_NATIVE_BROWSER_TEST_REFUSED')
const API='http://127.0.0.1:3001/api'

// Every synthetic browser scenario uses the same loopback address. Let the
// authentic CarUp per-IP rate window advance between isolated browser cases;
// unlike raising the server limit, this does NOT weaken the production policy.
// The pause also runs after a failed case so later cases remain diagnostically
// independent rather than inheriting a synthetic burst's HTTP 429.
test.afterEach(async({browser},testInfo)=>{
  void browser
  // Only pause between scenarios; after the final storage/XLSX case there
  // is no subsequent browser user for whom the shared loopback budget matters.
  if(testInfo.title.includes('Native PG + private Storage'))return
  await new Promise<void>(resolve=>setTimeout(resolve,42_000))
})

async function loginAs(page:Page,actor:Actor){
  await page.addInitScript(({user,token}:{user:Omit<Actor,'token'>;token:string})=>{
    localStorage.setItem('carup_user',JSON.stringify(user))
    localStorage.setItem('carup_token',token)
  },{user:{id:actor.id,name:actor.name,email:actor.email,role:actor.role},token:actor.token})
}

for(const width of [390,768,1280,1920]){
  test('Native PG physical browser · '+width+'px · guest reviewed unclaimed directory and stable URL',
    async({browser},info)=>{
      test.setTimeout(90_000)
      const context=await browser.newContext({viewport:{width,height:880}})
      const page=await context.newPage()
      const failures:string[]=[]
      page.on('pageerror',error=>failures.push(error.message))
      await page.goto('/dealers',{waitUntil:'domcontentloaded'})
      await expect(page.getByRole('heading',{name:'Zimbabwe Dealership Directory'}))
        .toBeVisible()
      // Owner UAT: the deferred S24 new-business path is labelled for unlisted businesses.
      await expect(page.getByTestId('dealer-unavailable-new-business')).toContainText('not available yet')
      await expect(page.getByRole('heading',{name:'SYNTHETIC FICTIONAL CAR DEALER 1'}))
        .toBeVisible({timeout:25000})
      await expect(page.getByText('Unclaimed — Not independently business-verified'))
        .toBeVisible()
      await expect(page.getByText('SYNTHETIC FICTIONAL CAR DEALER 2')).toHaveCount(0)
      const directoryPath=info.outputPath('native-directory-'+width+'px.png')
      await page.screenshot({path:directoryPath,fullPage:true})
      await info.attach('native-directory-'+width+'px',{path:directoryPath,contentType:'image/png'})
      const published=page.getByRole('link',{name:'View researched profile'})
      await published.click()
      await expect(page).toHaveURL(new RegExp('/dealers/zw-deal-0001$'))
      await expect(page.getByRole('heading',{name:'SYNTHETIC FICTIONAL CAR DEALER 1'}))
        .toBeVisible()
      await expect(page.getByRole('link',{name:'Claim this dealership'})).toBeVisible()
      await expect(page).toHaveTitle(/Unclaimed research/)
      await expect(page.locator('meta[name="description"][data-carup-dealer-seo="true"]'))
       .toHaveAttribute('content',/Research listing only/)
      await expect(page.locator('meta[name="robots"][data-carup-dealer-seo="true"]'))
       .toHaveAttribute('content','index,follow')
      await expect(page.locator('link[rel="canonical"][data-carup-dealer-seo="true"]'))
       .toHaveAttribute('href',/\/dealers\/zw-deal-0001$/)
      // Real DOM text, not a mocked response. A false claim of official
      // licensing must never appear on the unclaimed public profile.
      await expect.poll(async()=>page.locator('main').last().textContent())
        .toContain('No CarUp-verified licence')
      const widthOverrun=await page.evaluate(()=>Math.max(0,
        document.documentElement.scrollWidth-document.documentElement.clientWidth))
      expect(widthOverrun).toBeLessThanOrEqual(3)
      const path=info.outputPath('native-unclaimed-'+width+'px.png')
      await page.screenshot({path,fullPage:true})
      await info.attach('native-unclaimed-'+width+'px',{path,contentType:'image/png'})
      if(width===1280){
        // R6 S11: a guest who wants to claim is sent to sign in and RETURNED to this claim page.
        await page.goto('/dealers/zw-deal-0001/claim',{waitUntil:'domcontentloaded'})
        await expect(page.getByTestId('dealer-claim-sign-in'))
          .toHaveAttribute('href','/login?returnTo='+encodeURIComponent('/dealers/zw-deal-0001/claim'),{timeout:25000})
      }
      expect(failures).toEqual([])
      await context.close()
    })
}

test('Native PG physical browser · claimant submits real claim, sees evidence-required state',
 async({browser},info)=>{
  const context=await browser.newContext({viewport:{width:1280,height:900}})
  const page=await context.newPage()
  await loginAs(page,fixture.actors.claimant)
  const me=await page.request.get(API+'/auth/me',{headers:{
    'x-session-token':fixture.actors.claimant.token,
    'x-user-id':fixture.actors.claimant.id,
  }})
  expect(me.status()).toBe(200)
  const session=await me.json() as {user:{id:string}}
  expect(session.user.id).toBe(fixture.actors.claimant.id)
  await page.goto('/dealers/zw-deal-0001/claim',{waitUntil:'domcontentloaded'})
  await expect(page.getByRole('heading',{name:'Request to claim this business'}))
    .toBeVisible({timeout:25000})
  // Owner UAT: the deferred S14 capability is labelled, not implied.
  await expect(page.getByTestId('dealer-unavailable-multi-branch-parent')).toContainText('Not available yet')
  // R6 E: the public blank registration workbook is reachable from the claim page.
  const template=page.getByTestId('dealer-blank-intake-template')
  await expect(template).toBeVisible()
  const templateResponse=await page.request.get((await template.getAttribute('href'))!)
  expect(templateResponse.status()).toBe(200)
  expect(templateResponse.headers()['content-type']).toContain('spreadsheetml')
  const blank=new ExcelJS.Workbook()
  await blank.xlsx.load(await templateResponse.body())
  expect(blank.worksheets.length).toBe(12)
  await page.locator('#dealer-claim-legal-name').fill('Fictional Car Dealer Ltd — Test Only')
  await page.locator('#dealer-claim-statement').fill(
    'I am a synthetic representative in an isolated integration test. This request grants no real ownership rights.')
  await page.getByRole('button',{name:'Submit evidence-required claim request'}).click()
  await expect(page.getByText('Request recorded, awaiting documentary proof', {exact:false}))
    .toBeVisible({timeout:30000})
  const path=info.outputPath('native-claim-submitted-1280px.png')
  await page.screenshot({path,fullPage:true})
  await info.attach('native-claim-submitted-1280px',{path,contentType:'image/png'})
  await page.goto('/dealers/claims')
  await expect(page.getByRole('heading',{name:'My dealership claim applications'}))
    .toBeVisible()
  await expect(page.getByText('ZW-DEAL-0001').first()).toBeVisible({timeout:20000})
  // Physical negative-path: submitting an ownership claim does NOT unlock
  // source-sensitive workbook export or application authorizations.
  await expect(page.getByRole('button',{name:'Download my prefilled Excel workbook'}))
    .toHaveCount(0)
  const claimsResponse=await page.request.get(API+'/dealership/claims/mine',{
    headers:{'x-session-token':fixture.actors.claimant.token,
      'x-user-id':fixture.actors.claimant.id},
  })
  expect(claimsResponse.status()).toBe(200)
  const mine=await claimsResponse.json() as {claims:Array<{
    claim_id:string;seed_dealer_id:string;claim_status:string
  }>}
  const created=mine.claims.find(c=>c.seed_dealer_id==='ZW-DEAL-0001')
  expect(created?.claim_status).toBe('AWAITING_DOCUMENTARY_EVIDENCE')
  expect(created?.claim_id).toMatch(/^[0-9a-f-]{36}$/i)
  const workbookRead=await page.request.get(
    API+'/dealership/claims/'+encodeURIComponent(created!.claim_id)+'/workbook',{
    headers:{'x-session-token':fixture.actors.claimant.token,
      'x-user-id':fixture.actors.claimant.id},
  })
  expect(workbookRead.status()).toBe(403)
  await context.close()
 })

test('Native PG physical browser · separate session roles enforce reviewer queue',
 async({browser,request},info)=>{
  const claimant=await request.get(API+'/admin/dealership/claims/queue',{
    headers:{'x-session-token':fixture.actors.claimant.token,
      'x-user-id':fixture.actors.claimant.id},
  })
  expect(claimant.status()).toBe(403)
  const reviewer=await request.get(API+'/admin/dealership/claims/queue',{
    headers:{'x-session-token':fixture.actors.reviewer.token,
      'x-user-id':fixture.actors.reviewer.id},
  })
  expect(reviewer.status()).toBe(200)
  const queue=await reviewer.json() as {claims?:Array<{seed_dealer_id:string}>}
  expect(queue.claims?.some(x=>x.seed_dealer_id==='ZW-DEAL-0001'))
    .toBe(true)
  const context=await browser.newContext({viewport:{width:1280,height:900}})
  const page=await context.newPage()
  await loginAs(page,fixture.actors.reviewer)
  await page.goto('/admin/dealer-claims')
  await expect(page.getByRole('heading',{name:'Independent dealership claim review'}))
    .toBeVisible()
  // Queue button and selected detail both show the same seed ID.
  // Assert the actual selected review DETAIL, not ambiguous text.
  await expect(page.getByRole('heading',{name:'ZW-DEAL-0001',exact:true}))
    .toBeVisible({timeout:25000})
  const path=info.outputPath('native-independent-reviewer-queue.png')
  await page.screenshot({path,fullPage:true})
  await info.attach('native-independent-reviewer-queue',{path,contentType:'image/png'})
  await context.close()
})

/**
 * A syntactically real PDF with the visible legend FICTIONAL / NOT A LEGAL
 * CERTIFICATE. It exercises the actual browser file picker, ClamAV signatures,
 * private Supabase Storage API, database evidence custody and reviewer step-up.
 * Never use real customer or authority documents in the disposable CI suite.
 */
function fictionalEvidencePdf():Buffer {
  const stream=[
    'BT /F1 17 Tf 50 720 Td',
    '(FICTIONAL CI TEST DOCUMENT ONLY) Tj',
    '0 -27 Td (NOT A REAL COMPANY REGISTRATION) Tj',
    '0 -27 Td (NO LEGAL OR GOVERNMENT AUTHORITY) Tj',
    '0 -27 Td (SYNTHETIC CARUP DEALER - ISOLATED TEST) Tj',
    'ET',
  ].join('\n')
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length '+Buffer.byteLength(stream,'ascii')+' >>\nstream\n'+stream+'\nendstream',
  ]
  let output='%PDF-1.4\n'
  const offsets=[0]
  for(let i=0;i<objects.length;i++){
    offsets.push(Buffer.byteLength(output,'ascii'))
    output+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n'
  }
  const start=Buffer.byteLength(output,'ascii')
  output+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'
  for(const offset of offsets.slice(1))
    output+=String(offset).padStart(10,'0')+' 00000 n \n'
  output+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\n'
  output+='startxref\n'+start+'\n%%EOF\n'
  return Buffer.from(output,'ascii')
}

function setWorkbookField(book:ExcelJS.Workbook,tab:string,label:string,value:string,row=2){
  const sheet=book.getWorksheet(tab)
  if(!sheet)throw Error('MISSING_CANONICAL_CUSTOMER_SHEET_'+tab)
  const header=sheet.getRow(1)
  let column=0
  for(let i=1;i<=header.cellCount;i++){
    if(header.getCell(i).text===label){column=i;break}
  }
  if(!column)throw Error('MISSING_CANONICAL_CUSTOMER_FIELD_'+tab+'_'+label)
  sheet.getRow(row).getCell(column).value=value
}

// Unlike a service-only test, this exercises actual claimant and reviewer UI
// interactions on the real Express application. The isolated Storage API owns
// file bytes in a disposable Docker volume and Postgres owns document metadata.
test('Native PG + private Storage · evidence, separate approval, claim-specific Excel and frozen application',
 async({browser},info)=>{
  test.setTimeout(360_000)
  expect(fixture.reviewer_password).toMatch(/^EXPLICITLY_FAKE_DEALER_CI_REVIEWER_STEPUP_/)
  const headers=(actor:Actor)=>({
    'x-session-token':actor.token,'x-user-id':actor.id,
  })
  let claimantContext=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true})
  let claimantPage=await claimantContext.newPage()
  await loginAs(claimantPage,fixture.actors.claimant)
  const claimsResult=await claimantPage.request.get(API+'/dealership/claims/mine',{
    headers:headers(fixture.actors.claimant),
  })
  expect(claimsResult.status()).toBe(200)
  const mine=await claimsResult.json() as {claims:Array<{
    claim_id:string;seed_dealer_id:string;claim_status:string
  }>}
  const claim=mine.claims.find(c=>c.seed_dealer_id==='ZW-DEAL-0001')
  expect(claim?.claim_status).toBe('AWAITING_DOCUMENTARY_EVIDENCE')
  const claimId=claim!.claim_id
  await claimantPage.goto('/dealers/claims')
  await expect(claimantPage.getByRole('heading',{name:'My dealership claim applications'}))
    .toBeVisible({timeout:25000})
  const pdf=fictionalEvidencePdf()
  // Owner UAT-R1 P0: no document type is preselected and nothing uploads until the applicant both
  // chooses the type and confirms what the file is (a showroom photo was once filed as a certificate).
  await expect(claimantPage.locator('#claim-document-class')).toHaveValue('')
  await claimantPage.locator('#claim-document-file').setInputFiles({
    name:'EXPLICITLY_FICTIONAL_NO_LEGAL_AUTHORITY.pdf',
    mimeType:'application/pdf',buffer:pdf,
  })
  const uploadEvidence=claimantPage.getByRole('button',{name:'Upload private evidence'})
  await expect(uploadEvidence).toBeDisabled()
  await claimantPage.locator('#claim-document-class').selectOption('COMPANY_REGISTRATION')
  await expect(uploadEvidence).toBeDisabled()
  await claimantPage.locator('#claim-document-class-confirmed').check()
  await uploadEvidence.click()
  await expect(claimantPage.getByText('Original document stored privately.',{exact:false}))
    .toBeVisible({timeout:55000})
  await expect(claimantPage.getByText('1 private evidence record(s)')).toBeVisible()
  const uploadShot=info.outputPath('real-private-clamav-storage-evidence-upload.png')
  await claimantPage.screenshot({path:uploadShot,fullPage:true})
  await info.attach('real-private-clamav-storage-evidence-upload',{
    path:uploadShot,contentType:'image/png'})
  const reviewerContext=await browser.newContext({viewport:{width:1280,height:900}})
  const reviewerPage=await reviewerContext.newPage()
  await loginAs(reviewerPage,fixture.actors.reviewer)
  const foreignIntake=await reviewerPage.request.get(
    API+'/dealership/claims/'+encodeURIComponent(claimId)+'/intake',{
      headers:headers(fixture.actors.reviewer),
    })
  expect(foreignIntake.status()).toBe(404)
  await reviewerPage.goto('/admin/dealer-claims')
  await expect(reviewerPage.getByRole('heading',{name:'Independent dealership claim review'}))
    .toBeVisible({timeout:25000})
  await expect(reviewerPage.locator('#dealer-evidence-selection option')).toHaveCount(2,{
    timeout:25000,
  })
  await reviewerPage.locator('#claim-reviewer-password').fill(fixture.reviewer_password)
  await reviewerPage.getByRole('button',{name:'View selected original securely'}).click()
  const signedLink=reviewerPage.getByRole('link',{name:/Open private original/})
  await expect(signedLink).toBeVisible({timeout:20000})
  const signedHref=await signedLink.getAttribute('href')
  expect(signedHref).toMatch(/storage\/v1\/object\/sign\//)
  const original=await reviewerPage.request.get(signedHref!)
  expect(original.status()).toBe(200)
  const originalBytes=await original.body()
  expect(originalBytes.equals(pdf)).toBe(true)
  const originalDigest=await reviewerPage.request.get(
    'http://127.0.0.1:54321/storage/v1/object/public/ocr-documents/'+
      'FICTIONAL_UNAUTHORIZED_PUBLIC_PATH')
  expect(originalDigest.status()).not.toBe(200)
  await reviewerPage.locator('#claim-verdict').selectOption('CLAIM_APPROVED')
  // UAT-R1: the reviewer confirms the OPENED original is what it was filed as (enabled only after preview).
  await expect(reviewerPage.getByTestId('reviewer-step-up-explanation'))
    .toHaveText('Enter your account password again to confirm this sensitive independent decision. It is not stored.')
  await reviewerPage.locator('#claim-document-confirmed').check()
  await reviewerPage.locator('#claim-issuer').fill('EXPLICITLY FICTIONAL CI DOCUMENT ISSUER')
  await reviewerPage.locator('#claim-review-reason').fill(
    'Synthetic engineering review only. The company and document are explicitly fictional, do not constitute legal registration, and do not authorize any real dealership or national regulator.')
  await reviewerPage.locator('#claim-reviewer-password').fill(fixture.reviewer_password)
  await reviewerPage.getByRole('button',{name:'Record immutable review decision'}).click()
  await expect(reviewerPage.getByText('Independent claim decision recorded: CLAIM_APPROVED',{exact:false}))
    .toBeVisible({timeout:35000})
  const reviewShot=info.outputPath('synthetic-independent-claim-review-with-step-up.png')
  await reviewerPage.screenshot({path:reviewShot,fullPage:true})
  await info.attach('synthetic-independent-claim-review-with-step-up',{
    path:reviewShot,contentType:'image/png'})
  await claimantPage.reload()
  await expect(claimantPage.getByRole('heading',{name:'Prefilled Excel and application'}))
    .toBeVisible({timeout:25000})
  // Owner UAT D1: the approved workspace (long workbook/CSV action labels) must not scroll sideways
  // on a 390px phone; it was 61px wider than the viewport before the labels could wrap.
  await claimantPage.setViewportSize({width:390,height:844})
  await expect.poll(()=>claimantPage.evaluate(()=>
    Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-window.innerWidth),
    {timeout:10000}).toBeLessThanOrEqual(1)
  await claimantPage.setViewportSize({width:1280,height:900})
  const [download]=await Promise.all([
    claimantPage.waitForEvent('download',{timeout:35000}),
    claimantPage.getByRole('button',{name:'Download my prefilled Excel workbook'}).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/prefilled\.xlsx$/)
  const exported=info.outputPath('FICTIONAL-claim-specific-prefilled.xlsx')
  await download.saveAs(exported)
  const book=new ExcelJS.Workbook()
  await book.xlsx.load(readFileSync(exported))
  expect(book.worksheets.length).toBe(12)
  expect(book.getWorksheet('BUSINESS')?.getRow(2).getCell(1).text).toBe(claimId)
  setWorkbookField(book,'BUSINESS','Registered legal name',
    'SYNTHETIC CARUP DEALERSHIP LTD - TEST ONLY')
  setWorkbookField(book,'BUSINESS','Confirmed trading name',
    'SYNTHETIC FICTIONAL CAR DEALER 1')
  setWorkbookField(book,'BUSINESS','Company registration number',
    'SYNTHETIC-REG-001')
  setWorkbookField(book,'BUSINESS','Company registration issuer',
    'FICTIONAL CI REGISTRY - NOT A REAL GOVERNMENT OFFICE')
  setWorkbookField(book,'BUSINESS','Confirm researched facts: YES / CORRECT / UNKNOWN','CORRECT')
  setWorkbookField(book,'BUSINESS','Accountable authorized signatory','Fictional Test Signatory')
  setWorkbookField(book,'BRANCHES','City/town','FICTIONAL HARARE CORRECTED')
  setWorkbookField(book,'BRANCHES','Latitude -90 to 90','-17.829')
  setWorkbookField(book,'BRANCHES','Longitude -180 to 180','31.052')
  setWorkbookField(book,'BRANCHES','Visitor opening hours','Mon-Fri 09:00-16:00 (FICTIONAL)')
  setWorkbookField(book,'BRANCHES','Confirm researched branch: YES / CORRECT / UNKNOWN','CORRECT')
  setWorkbookField(book,'BUYER_PROTECTION','Deposits/lay-by policy',
    'NO REAL DEPOSITS OR MONEY COLLECTED IN THIS FICTIONAL SCENARIO')
  // R6 C02: a second branch and dealer-level buyer/finance terms are declared ONCE
  // here; the legal phase proves activation carries them without retyping.
  for(const [label,value] of [
    ['Branch reference — stable key','BR-FICTIONAL-SECOND'],
    ['Branch/trading location name','FICTIONAL CARRIED SECOND YARD - PRIVATE ONLY'],
    ['Branch physical address','TEST CARRIED STREET 2 - NOT A REAL PUBLIC ADDRESS'],
    ['City/town','FICTIONAL BULAWAYO'],
    ['Country code (ISO alpha-2)','ZW'],
    ['Latitude -90 to 90','-20.15'],
    ['Longitude -180 to 180','28.58'],
    ['Visitor opening hours','Sat 08:00-13:00 (FICTIONAL)'],
  ])setWorkbookField(book,'BRANCHES',label,value,3)
  setWorkbookField(book,'FINANCE_PAYMENTS','Deposit return conditions',
    'FICTIONAL CI: no actual deposits collected. All test orders are void and refunds are not real.')
  setWorkbookField(book,'FINANCE_PAYMENTS','Customer payment methods (declaration)',
    'FICTIONAL CI: no real payment method is offered')
  setWorkbookField(book,'BUYER_PROTECTION','Buyer complaint/dispute contact',
    'FICTIONAL CI: contact CarUp test reviewers. No customer claim is adjudicated here.')
  setWorkbookField(book,'CONSENTS_DECLARATIONS','Authorized signatory name',
    'Fictional Test Signatory')
  setWorkbookField(book,'CONSENTS_DECLARATIONS','Signatory legal role',
    'Fictional Applicant - No Authority Outside CI')
  setWorkbookField(book,'CONSENTS_DECLARATIONS','Privacy notice read YES / NO','YES')
  setWorkbookField(book,'CONSENTS_DECLARATIONS','Declaration draft — not a legal signature',
    'Synthetic-only review of fictional details. No legal signature or authorization.')
  // Owner UAT D2: a contradictory workbook (impossible latitude) is refused right under the upload
  // control, naming the tab and row to fix, and nothing is saved.
  const malformed=new ExcelJS.Workbook()
  await malformed.xlsx.load(readFileSync(exported))
  setWorkbookField(malformed,'BRANCHES','Latitude -90 to 90','123.5')
  setWorkbookField(malformed,'BRANCHES','Longitude -180 to 180','31.052')
  await claimantPage.locator('#claim-workbook-file').setInputFiles({
    name:'EXPLICITLY_FICTIONAL_MALFORMED_LATITUDE.xlsx',
    mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer:Buffer.from(await malformed.xlsx.writeBuffer()),
  })
  await claimantPage.getByRole('button',{name:'Upload completed workbook and populate application'}).click()
  await expect(claimantPage.getByTestId('dealer-workbook-refusal')).toContainText(
    'BRANCHES tab, row 2: latitude must be a number between -90 and 90',{timeout:35000})
  await expect(claimantPage.getByTestId('dealer-workbook-refusal')).toContainText('Nothing was saved')
  const notSaved=await claimantPage.request.get(
    API+'/dealership/claims/'+encodeURIComponent(claimId)+'/intake',{headers:headers(fixture.actors.claimant)})
  expect(notSaved.status()).toBe(404)
  const edited=Buffer.from(await book.xlsx.writeBuffer())
  await claimantPage.locator('#claim-workbook-file').setInputFiles({
    name:'EXPLICITLY_FICTIONAL_CARUP_DEALER_COMPLETED.xlsx',
    mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer:edited,
  })
  await claimantPage.getByRole('button',{
    name:'Upload completed workbook and populate application',
  }).click()
  await expect(claimantPage.getByText('Application draft saved (version 1)',{exact:false}))
    .toBeVisible({timeout:35000})
  // Owner UAT D4: before freezing, the applicant reviews what CarUp read, research corrections called out.
  const review=claimantPage.getByTestId('dealer-draft-review')
  await expect(review).toContainText('SYNTHETIC CARUP DEALERSHIP LTD - TEST ONLY',{timeout:30000})
  await expect(review).toContainText('FICTIONAL CARRIED SECOND YARD - PRIVATE ONLY')
  await expect(review).toContainText('Changed from research: “Harare”')
  const draftResponse=await claimantPage.request.get(
    API+'/dealership/claims/'+encodeURIComponent(claimId)+'/intake',{
      headers:headers(fixture.actors.claimant),
    })
  expect(draftResponse.status()).toBe(200)
  const intake=await draftResponse.json() as {intake:{submission_version:number;
    content:{tab_rows:Record<string,Array<Record<string,string>>>}}}
  expect(intake.intake.submission_version).toBe(1)
  expect(intake.intake.content.tab_rows.BUSINESS[0].legal_name)
    .toBe('SYNTHETIC CARUP DEALERSHIP LTD - TEST ONLY')
  expect(intake.intake.content.tab_rows.BRANCHES[0].city)
    .toBe('FICTIONAL HARARE CORRECTED')
  const authority=await claimantPage.request.get(
    API+'/dealership/claims/'+encodeURIComponent(claimId)+'/operational-authority',{
      headers:headers(fixture.actors.claimant),
    })
  expect(authority.status()).toBe(200)
  const authBody=await authority.json() as {authority:{operational:boolean}}
  expect(authBody.authority.operational).toBe(false)
  // Real Vite pages and private session flows are intentionally noisy on the
  // same loopback IP. Respect CarUp's unchanged 100-request/minute throttle
  // before opening the anonymous public projection; never raise/disable it.
  await claimantPage.waitForTimeout(65_000)
  const publicContext=await browser.newContext()
  const publicPage=await publicContext.newPage()
  await publicPage.goto('/dealers/zw-deal-0001')
  // Claim approval already exists, while legal/storefront approval does not:
  // no unclaimed takeover invitation and no premature public verification.
  await expect(publicPage.getByText(
    'Existing approved claim — No current independently verified storefront'))
    .toBeVisible({timeout:20000})
  await expect(publicPage.locator('meta[name="robots"][data-carup-dealer-seo="true"]'))
    .toHaveAttribute('content','noindex,follow')
  await expect(publicPage.locator('link[rel="canonical"][data-carup-dealer-seo="true"]'))
    .toHaveAttribute('href',/\/dealers\/zw-deal-0001$/)
  await expect(publicPage.getByRole('heading',{name:'Reviewed dealership branches'}))
    .toHaveCount(0)
  await expect(publicPage.getByRole('link',{name:'Claim this dealership'}))
    .toHaveCount(0)
  await publicContext.close()
  // T10: the claimant CLOSES the browser (the whole context: page, memory,
  // in-flight state) and comes back in a brand-new one carrying only the
  // stored sign-in. The saved version must come from the server, not the tab.
  const resumeUrl=claimantPage.url()
  await claimantContext.close()
  claimantContext=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true})
  claimantPage=await claimantContext.newPage()
  await loginAs(claimantPage,fixture.actors.claimant)
  await claimantPage.goto(resumeUrl,{waitUntil:'domcontentloaded'})
  await expect(claimantPage.getByRole('heading',{name:'Saved application version 1'}))
    .toBeVisible({timeout:25000})
  // The true CarUp per-IP limit applies across seven synthetic journeys sharing
  // 127.0.0.1; the final write must not inherit earlier windows. Preserve
  // production security controls instead of disabling or raising their limit.
  await claimantPage.waitForTimeout(70_000)
  const section=claimantPage.getByRole('heading',{
    name:'Submit version 1 for preliminary review',
  }).locator('..')
  await section.locator('input[type="checkbox"]').check()
  await section.getByRole('button',{
    name:'Submit frozen application for independent review',
  }).click()
  await expect(claimantPage.getByText('submitted for independent preliminary review',{
    exact:false,
  })).toBeVisible({timeout:35000})
  const applicationShot=info.outputPath('real-xlsx-reimport-persisted-and-frozen-application.png')
  await claimantPage.screenshot({path:applicationShot,fullPage:true})
  await info.attach('real-xlsx-reimport-persisted-and-frozen-application',{
    path:applicationShot,contentType:'image/png'})
  await claimantContext.close()
  await reviewerContext.close()
  console.log('DEALER_SYNTHETIC_GOLDEN_CLAIM_XLSX_SUBMISSION PASS: isolated storage, separate step-up reviewer, 12-tab edited workbook persisted and applicant declaration frozen; legal and tenant activation remain DISABLED')
})
