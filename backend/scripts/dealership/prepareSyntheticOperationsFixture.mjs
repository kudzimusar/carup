/**
 * Physical operational UAT setup after a complete FICTIONAL browser legal and
 * storefront journey in native loopback PostgreSQL. Writes ONE fictitious
 * draft VIN and ONE fictitious buyer lead to CarUp's canonical table shapes.
 * No public listing, sale, finance, merchant grant or real dealer records.
 * Test-only: this script is NOT reachable from production app/routes.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {assertLocalDatabase} from './importResearchSeed.mjs';
const url=assertLocalDatabase(process.env.DEALER_ISOLATED_POSTGRES_URL);
const purl=new URL(url);
assert.ok(['127.0.0.1','localhost','[::1]'].includes(purl.hostname));
assert.equal(purl.pathname,'/carup_dealer_isolated_ci');
assert.equal(purl.search,'');
assert.equal(purl.hash,'');
for(const k of ['CARUP_DEALER_RESEARCH_XLSX','DEALER_SEED_DATABASE_URL','SUPABASE_URL'])
 assert.equal(process.env[k],undefined,'unsafe real data/DB environment');
const fpath=process.env.DEALER_BROWSER_FIXTURE_JSON;
assert.ok(fpath);
const f=JSON.parse(readFileSync(fpath,'utf8'));
assert.equal(f.source_type,'EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX');
assert.equal(f.source_population,104);
assert.equal(f.synthetic_legal_policy_provenance,'CI_ONLY_NOT_ACTUAL_ZIMBABWE_AUTHORITY');
const db=new pg.Client({connectionString:url,ssl:false,
 application_name:'CARUP_FICTIONAL_ONLY_PRIVATE_VIN_AND_INQUIRY_SEED'});
await db.connect();
try {
 const r=await db.query(`SELECT l.tenant_id,l.dealer_profile_id,l.claimant_user_id,
   p.policy_version,p.policy_state
   FROM dealer_approved_seed_links l
   JOIN dealer_legal_application_reviews legal ON legal.legal_review_id=l.legal_review_id
   JOIN dealer_country_legal_policy_authority p ON p.country_code=legal.country_code
     AND p.policy_version=legal.policy_version
   WHERE l.seed_dealer_id=$1 AND l.operating_status='ACTIVE'`,[f.seed]);
 assert.equal(r.rowCount,1);
 assert.equal(r.rows[0].claimant_user_id,f.actors.claimant.id);
 assert.equal(r.rows[0].policy_state,'APPROVED');
 assert.equal(r.rows[0].policy_version,f.synthetic_legal_policy_version);
 assert.ok(r.rows[0].policy_version.startsWith('CARUP_SYNTHETIC_CI_'));
 const tenant=r.rows[0].tenant_id;
 const vin='TEST0000000000001';
 assert.equal(vin.length,17);
 await db.query(`INSERT INTO vehicles(
   vin,tenant_id,make,model,year,mileage,price,status,publication_status
 )VALUES($1,$2,'FICTIONAL','CI-ONLY TEST VEHICLE',2026,0,0,'Available','draft')`,
  [vin,tenant]);
 const own=randomUUID();
 const outside=randomUUID();
 await db.query(`INSERT INTO marketplace_inquiries(
   id,listing_id,buyer_id,seller_tenant_id,inquiry_type,status,risk_status,
   source_channel,guest_name,guest_email,message
 )VALUES ($1,$2,NULL,$3,'vehicle_purchase_interest','new','clear','web',
   'FICTIONAL TEST BUYER','fictional-buyer@example.invalid',
   'CI-ONLY TEST INQUIRY, NO ACTUAL SALE OR CUSTOMER'),
  ($4,'OTHER-TENANT-FICTIONAL',NULL,$5,
   'vehicle_purchase_interest','new','clear','web','OTHER PRIVATE BUYER',
   'other-private@example.invalid','CROSS-TENANT PRIVATE TEST')`,
  [own,vin,String(tenant),outside,'00000000-0000-4000-8000-000000009999']);
 // A deliberately labelled sandbox escrow intent exercises the canonical
 // transaction foreign key. It does not represent a genuine vehicle transfer,
 // settlement, commercial entitlement or verified purchase.
 const feedbackTx=randomUUID();
 assert.equal(f.actors.buyer?.id,'notreviewer');
 await db.query(`INSERT INTO escrow_trust_sessions(id,buyer_id,tenant_id,status)
   VALUES($1,$2,$3,'released_sandbox')`,
   [feedbackTx,f.actors.buyer.id,String(tenant)]);
 const proof=await db.query(`SELECT
   (SELECT COUNT(*)::int FROM vehicles WHERE tenant_id=$1) AS private_vin_count,
   (SELECT COUNT(*)::int FROM marketplace_inquiries WHERE seller_tenant_id=$2)
     AS private_buyer_inquiries,
   (SELECT COUNT(*)::int FROM vehicles WHERE vin=$3 AND publication_status='published')
     AS public_vehicles`,[tenant,String(tenant),vin]);
 assert.deepEqual(proof.rows[0],{
   private_vin_count:1,private_buyer_inquiries:1,public_vehicles:0});
 f.synthetic_operations={vin,inquiry_id:own,foreign_inquiry_id:outside,
  feedback_transaction_id:feedbackTx,
  tenant_id:String(tenant),stock_publication:'draft',fictional_only:true};
 writeFileSync(fpath,JSON.stringify(f),{mode:0o600});
 console.log('DEALER_SYNTHETIC_CANONICAL_OPERATIONS_SEED PASS: one private draft FICTIONAL VIN and one tenant-scoped fictional inquiry; cross-tenant negative seeded, no published stock/sale/payment');
} finally {await db.end();}
