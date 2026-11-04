import {test,expect,type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'
type Actor={id:string;name:string;email:string;role:string;token:string}
type Fixture={
 actors:{claimant:Actor;reviewer:Actor};
 seed:string;public_slug:string;source_population:104;source_type:string;
}
const file=process.env.DEALER_BROWSER_FIXTURE_JSON
if(!file)throw Error('DEALER_BROWSER_FIXTURE_REQUIRED')
const fixture=JSON.parse(readFileSync(file,'utf8')) as Fixture
if(fixture.source_type!=='EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX'||fixture.source_population!==104)
 throw Error('NON_SYNTHETIC_OR_NON_NATIVE_BROWSER_TEST_REFUSED')
const API='http://127.0.0.1:3001/api'

async function loginAs(page:Page,actor:Actor){
  await page.addInitScript(({user,token}:{user:Omit<Actor,'token'>;token:string})=>{
    localStorage.setItem('carup_user',JSON.stringify(user))
    localStorage.setItem('carup_token',token)
  },{user:{id:actor.id,name:actor.name,email:actor.email,role:actor.role},token:actor.token})
}

for(const width of [390,768,1280,1920]){
  test('Native PG physical browser · '+width+'px · guest reviewed unclaimed directory and stable URL',
    async({browser},info)=>{
      const context=await browser.newContext({viewport:{width,height:880}})
      const page=await context.newPage()
      const failures:string[]=[]
      page.on('pageerror',error=>failures.push(error.message))
      await page.goto('/dealers',{waitUntil:'domcontentloaded'})
      await expect(page.getByRole('heading',{name:'Zimbabwe Dealership Directory'}))
        .toBeVisible()
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
      // Real DOM text, not a mocked response. A false claim of official
      // licensing must never appear on the unclaimed public profile.
      await expect.poll(async()=>page.locator('main').textContent())
        .toContain('No CarUp-verified licence')
      const widthOverrun=await page.evaluate(()=>Math.max(0,
        document.documentElement.scrollWidth-document.documentElement.clientWidth))
      expect(widthOverrun).toBeLessThanOrEqual(3)
      const path=info.outputPath('native-unclaimed-'+width+'px.png')
      await page.screenshot({path,fullPage:true})
      await info.attach('native-unclaimed-'+width+'px',{path,contentType:'image/png'})
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
  await expect(page.getByText('ZW-DEAL-0001')).toBeVisible({timeout:25000})
  const path=info.outputPath('native-independent-reviewer-queue.png')
  await page.screenshot({path,fullPage:true})
  await info.attach('native-independent-reviewer-queue',{path,contentType:'image/png'})
  await context.close()
})
