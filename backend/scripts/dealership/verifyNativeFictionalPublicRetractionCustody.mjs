/**
 * Synthetic-only native PostgreSQL readback after separate public reviewer
 * retraction. Public-display withdrawal cannot destroy the approved claimant,
 * original stable URL or canonical private corporate/tenant membership.
 */
import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {dirname} from 'node:path'
import pg from 'pg'
import {assertLocalDatabase} from './importResearchSeed.mjs'
const connection=assertLocalDatabase(process.env.DEALER_ISOLATED_POSTGRES_URL)
const url=new URL(connection)
assert.equal(url.pathname,'/carup_dealer_isolated_ci')
assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname))
assert.equal(url.search,'')
assert.equal(url.hash,'')
assert.equal(process.env.CARUP_DEALER_RESEARCH_XLSX,undefined)
const f=JSON.parse(readFileSync(process.env.DEALER_BROWSER_FIXTURE_JSON,'utf8'))
assert.equal(f.source_type,'EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX')
assert.equal(f.synthetic_legal_policy_provenance,'CI_ONLY_NOT_ACTUAL_ZIMBABWE_AUTHORITY')
assert.equal(f.source_population,104)
const db=new pg.Client({connectionString:connection,ssl:false,
 application_name:'carup-synthetic-independent-display-retraction-custody'})
await db.connect()
try{
 const result=await db.query(
  'SELECT disposition,reviewer_user_id,approved_branch_snapshot,dealer_declared_sections FROM dealer_full_storefront_review_events WHERE seed_dealer_id=$1 ORDER BY publication_reviewed_at,event_id',
  [f.seed])
 assert.equal(result.rowCount,2,
  'exactly one approved full display and one separate immutable retraction expected')
 assert.deepEqual(result.rows.map(r=>r.disposition),['PUBLISHED_FULL','RETRACTED'])
 assert.equal(result.rows[0].reviewer_user_id,f.actors.reviewer.id)
 assert.equal(result.rows[1].reviewer_user_id,f.actors.reviewer.id)
 assert.deepEqual(result.rows[1].approved_branch_snapshot,[])
 assert.deepEqual(result.rows[1].dealer_declared_sections,{})
 const full=await db.query(
  'SELECT seed_dealer_id FROM dealer_full_storefront_current WHERE seed_dealer_id=$1',
  [f.seed])
 assert.equal(full.rowCount,0,'retracted full public profile must vanish immediately')
 const research=await db.query(
  'SELECT seed_dealer_id,public_slug,publication_status FROM dealer_research_public_profiles WHERE seed_dealer_id=$1',
  [f.seed])
 assert.equal(research.rowCount,1,'research identity and stable URL are preserved')
 assert.equal(research.rows[0].public_slug,f.public_slug)
 assert.equal(research.rows[0].publication_status,'PRELISTED_UNCLAIMED',
  'research-publication status is independent of canonical corporate claim ownership')
 const owner=await db.query(
  'SELECT c.claim_status,c.claimant_user_id,l.operating_status,l.tenant_id,l.organization_id,d.id AS dealer_profile_id,d.identity_status,d.active_state FROM dealer_approved_seed_links l JOIN dealer_research_claim_requests c ON c.claim_id=l.claim_id JOIN dealer_profiles d ON d.id=l.dealer_profile_id WHERE l.seed_dealer_id=$1',
  [f.seed])
 assert.equal(owner.rowCount,1)
 assert.equal(owner.rows[0].claim_status,'CLAIM_APPROVED')
 assert.equal(owner.rows[0].claimant_user_id,f.actors.claimant.id)
 assert.equal(owner.rows[0].operating_status,'ACTIVE')
 assert.equal(owner.rows[0].identity_status,'verified')
 assert.equal(owner.rows[0].active_state,'active')
 const members=await db.query(
  'SELECT role FROM tenant_users WHERE tenant_id=$1 AND user_id=$2',
  [owner.rows[0].tenant_id,f.actors.claimant.id])
 assert.deepEqual(members.rows,[{role:'dealer'}])
 // Public display retraction MUST NOT silently delete or publish the
 // legal dealer's separately stored PRIVATE inventory. Both physically
 // created CI VIN records remain draft-only in the canonical tenant.
 const tenantVins=await db.query(
  'SELECT vin,status,publication_status,price,owner_id,current_seller_type FROM vehicles WHERE tenant_id=$1 ORDER BY vin',
  [owner.rows[0].tenant_id])
 assert.deepEqual(tenantVins.rows.map(v=>v.vin),
  ['TEST0000000000001','TEST0000000000002'])
 assert.ok(tenantVins.rows.every(v=>
  v.publication_status==='draft'&&Number(v.price)===0))
 const added=tenantVins.rows.find(v=>v.vin==='TEST0000000000002')
 assert.equal(added.status,'Pending')
 assert.equal(added.owner_id,null)
 assert.equal(added.current_seller_type,null)
 assert.equal((await db.query(
  "SELECT count(*)::int AS n FROM vehicles WHERE tenant_id=$1 AND publication_status='published'",
  [owner.rows[0].tenant_id])).rows[0].n,0)
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM dealer_research_seed_records')).rows[0].n,104)
 const receipt={
  fictional_only:true,prior_public_full_review_events:1,
  subsequent_immutable_public_retraction_events:1,
  public_full_projection_after_retraction:0,
  original_public_slug_unchanged:true,
  canonical_prior_claim_status:'CLAIM_APPROVED',
  canonical_approved_claimant_unchanged:true,
  owner_tenant_membership_preserved:true,
  original_and_ui_created_private_vins_preserved:2,
  zero_public_vin_listings_after_retraction:true,
  current_public_legal_verification_not_approved:true,
  new_unclaimed_takeover_advertised:false,
  source_original_checksum_import_certified:false,
  real_dealer_publication:false,real_money_or_paynow_operations:false,
 }
 const file='web/test-results/fictional-native-public-retraction-custody.json'
 mkdirSync(dirname(file),{recursive:true})
 writeFileSync(file,JSON.stringify(receipt,null,2)+'\n',{mode:0o600})
 console.log('DEALER_NATIVE_FICTIONAL_PUBLIC_RETRACTION_CUSTODY PASS: reviewed full storefront removed, same slug + approved claimant and canonical dealer tenant preserved; no third-party takeover CTA or real business')
}finally{await db.end()}
