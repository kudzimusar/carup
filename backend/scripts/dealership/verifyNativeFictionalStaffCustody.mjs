/** Exact synthetic-only PostgreSQL readback after real-browser
 * owner invitation -> distinct staff acceptance -> owner revocation.
 * A claim alone, an invitation alone, and a global member user identity
 * NEVER confer dealership owner/seller/financial/branch review authority.
 */
import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {dirname} from 'node:path'
import pg from 'pg'
import {assertLocalDatabase} from './importResearchSeed.mjs'
const url=assertLocalDatabase(process.env.DEALER_ISOLATED_POSTGRES_URL)
const parsed=new URL(url)
assert.ok(['127.0.0.1','localhost','[::1]'].includes(parsed.hostname))
assert.equal(parsed.pathname,'/carup_dealer_isolated_ci')
assert.equal(parsed.search,'')
assert.equal(parsed.hash,'')
assert.equal(process.env.CARUP_DEALER_RESEARCH_XLSX,undefined)
const f=JSON.parse(readFileSync(process.env.DEALER_BROWSER_FIXTURE_JSON,'utf8'))
assert.equal(f.source_type,'EXPLICITLY_FICTIONAL_NATIVE_POSTGRES_XLSX')
assert.equal(f.synthetic_legal_policy_provenance,'CI_ONLY_NOT_ACTUAL_ZIMBABWE_AUTHORITY')
const db=new pg.Client({connectionString:url,ssl:false,
 application_name:'dealer-ci-real-chromium-canonical-staff-readback'})
await db.connect()
try{
 const invite=await db.query(`SELECT i.invite_id,i.dealer_profile_id,i.tenant_id,
  i.organization_id,i.invited_by,i.invited_user_id,i.requested_role,i.status,
  l.claimant_user_id,l.operating_status
  FROM dealer_staff_invitation_records i
  JOIN dealer_approved_seed_links l ON l.dealer_profile_id=i.dealer_profile_id
  WHERE i.invited_by=$1 AND i.invited_user_id=$2`,
  [f.actors.claimant.id,f.actors.staff.id])
 assert.equal(invite.rowCount,1)
 const record=invite.rows[0]
 assert.equal(record.status,'REVOKED')
 assert.equal(record.requested_role,'member')
 assert.equal(record.operating_status,'ACTIVE')
 assert.equal(record.claimant_user_id,f.actors.claimant.id)
 const events=await db.query(`SELECT action,actor_user_id,canonical_member_role
  FROM dealer_staff_invitation_events WHERE invite_id=$1
  ORDER BY occurred_at,event_id`,[record.invite_id])
 assert.deepEqual(events.rows.map(x=>x.action),['INVITED','ACCEPTED','REVOKED'])
 assert.deepEqual(events.rows.map(x=>x.actor_user_id),
  [f.actors.claimant.id,f.actors.staff.id,f.actors.claimant.id])
 assert.equal(events.rows[1].canonical_member_role,'member')
 const branchScope=await db.query(`SELECT s.scope_id,s.branch_id,
  s.permission,s.status,s.granted_by,i.invite_id
  FROM dealer_staff_branch_scopes s
  JOIN dealer_staff_invitation_records i ON i.invite_id=s.invite_id
  WHERE i.invited_user_id=$1 AND i.invited_by=$2`,
  [f.actors.staff.id,f.actors.claimant.id])
 assert.equal(branchScope.rowCount,1,
  'one real private branch scope must have been explicitly granted')
 assert.equal(branchScope.rows[0].permission,'EDIT_BRANCH_DETAILS')
 assert.equal(branchScope.rows[0].status,'REVOKED',
  'real staff membership revocation must revoke branch scope in same SQL transaction')
 assert.equal(branchScope.rows[0].granted_by,f.actors.claimant.id)
 const scopes=await db.query(`SELECT event_type,actor_user_id
  FROM dealer_staff_branch_scope_events WHERE scope_id=$1`,
  [branchScope.rows[0].scope_id])
 assert.deepEqual(
  scopes.rows.map(x=>x.event_type).sort(),
  ['AUTO_REVOKED_ON_INVITATION','BRANCH_DETAILS_EDITED','GRANTED'].sort())
 assert.ok(scopes.rows.some(x=>x.event_type==='GRANTED'&&
  x.actor_user_id===f.actors.claimant.id))
 assert.ok(scopes.rows.some(x=>x.event_type==='BRANCH_DETAILS_EDITED'&&
  x.actor_user_id===f.actors.staff.id))
 assert.equal((await db.query(`SELECT count(*)::int AS n FROM
  dealer_staff_branch_scopes WHERE invite_id=$1 AND status='ACTIVE'`,
  [record.invite_id])).rows[0].n,0)
 const persistedPrivateBranch=await db.query(`SELECT id,opening_hours_text
   FROM dealer_branches WHERE id=$1`,[branchScope.rows[0].branch_id])
 assert.equal(persistedPrivateBranch.rowCount,1)
 assert.equal(persistedPrivateBranch.rows[0].opening_hours_text,
  'Fictional Mon-Fri 07:30-18:00; no open-now assertion')
 const state=await db.query(`SELECT
  (SELECT COUNT(*)::int FROM tenant_users WHERE tenant_id=$1
   AND user_id=$2 AND role='member') AS member_after_revocation,
  (SELECT COUNT(*)::int FROM organization_users WHERE organization_id=$3
   AND user_id=$2) AS corporate_after_revocation,
  (SELECT COUNT(*)::int FROM tenant_users WHERE tenant_id=$1
   AND user_id=$4 AND role='dealer') AS original_owner_preserved,
  (SELECT role FROM users WHERE id=$2) AS staff_global_role,
  (SELECT role FROM users WHERE id=$4) AS owner_global_role`,
  [record.tenant_id,f.actors.staff.id,record.organization_id,
   f.actors.claimant.id])
 assert.deepEqual(state.rows[0],{
  member_after_revocation:0,corporate_after_revocation:0,
  original_owner_preserved:1,staff_global_role:'member',owner_global_role:'member'
 })
 assert.equal(f.synthetic_operations?.fictional_only,true);
 const vin=await db.query(`SELECT vin,tenant_id,publication_status,price
   FROM vehicles WHERE vin=$1`,[f.synthetic_operations.vin]);
 assert.equal(vin.rowCount,1);
 assert.equal(String(vin.rows[0].tenant_id),f.synthetic_operations.tenant_id);
 assert.equal(vin.rows[0].publication_status,'draft',
   'synthetic stock must remain unpublished and without seller authority');
 assert.equal(Number(vin.rows[0].price),0,'no real sale or price');
 const privateNew=await db.query(`SELECT vin,tenant_id,status,publication_status,
    price,owner_id,current_seller_type FROM vehicles WHERE vin=$1`,
    ['TEST0000000000002']);
 assert.equal(privateNew.rowCount,1,'physical owner must create second canonical VIN');
 assert.equal(String(privateNew.rows[0].tenant_id),f.synthetic_operations.tenant_id);
 assert.equal(privateNew.rows[0].status,'Pending');
 assert.equal(privateNew.rows[0].publication_status,'draft');
 assert.equal(Number(privateNew.rows[0].price),0);
 assert.equal(privateNew.rows[0].owner_id,null);
 assert.equal(privateNew.rows[0].current_seller_type,null);
 const deniedPrivateVin=await db.query(
  "SELECT vin FROM vehicles WHERE vin=$1",['TEST0000000000003']);
 assert.equal(deniedPrivateVin.rowCount,0,
  'canonical member without owner authority must never insert private VIN');
 const lead=await db.query(`SELECT id,seller_tenant_id,status,risk_status
   FROM marketplace_inquiries WHERE id=$1`,[f.synthetic_operations.inquiry_id]);
 assert.equal(lead.rowCount,1);
 assert.equal(lead.rows[0].seller_tenant_id,f.synthetic_operations.tenant_id);
 assert.equal(lead.rows[0].status,'qualified');
 assert.equal(lead.rows[0].risk_status,'clear');
 const foreign=await db.query(`SELECT id,seller_tenant_id
   FROM marketplace_inquiries WHERE id=$1`,[f.synthetic_operations.foreign_inquiry_id]);
 assert.equal(foreign.rowCount,1);
 assert.notEqual(foreign.rows[0].seller_tenant_id,f.synthetic_operations.tenant_id);
 const foreignPersisted=await db.query(`SELECT status,risk_status
  FROM marketplace_inquiries WHERE id=$1`,[f.synthetic_operations.foreign_inquiry_id]);
 assert.deepEqual(foreignPersisted.rows,[{status:'new',risk_status:'clear'}],
  'a forged cross-tenant follow-up must not change another tenant invoice or buyer lead');
 const progress=await db.query(`SELECT previous_status,next_status,actor_user_id,
  seller_reported_only,buyer_contact_delivery_verified,transaction_status_modified
  FROM dealer_canonical_inquiry_progress_events WHERE inquiry_id=$1
  ORDER BY created_at,event_id`,[f.synthetic_operations.inquiry_id]);
 assert.deepEqual(progress.rows.map(x=>[x.previous_status,x.next_status,x.actor_user_id]),
  [['new','contacted',f.actors.claimant.id],
   ['contacted','qualified',f.actors.claimant.id]]);
 assert.ok(progress.rows.every(x=>x.seller_reported_only===true&&
  x.buyer_contact_delivery_verified===false&&
  x.transaction_status_modified===false));
 const out='web/test-results/fictional-native-staff-custody.json'
 mkdirSync(dirname(out),{recursive:true})
 writeFileSync(out,JSON.stringify({
  synthetic_only:true,
  original_xlsx_checksum_certified:false,
  staff_lifecycle_actions:events.rows.map(x=>x.action),
  independent_staff_acceptor:f.actors.staff.id,
  owner_session:f.actors.claimant.id,
  canonical_member_created_then_revoked:true,
  final_staff_tenant_memberships:0,
  original_owner_preserved:true,
  scoped_private_branch_permission_issued_then_revoked:true,
  private_branch_staff_edit_persisted:true,
  branch_scope_audit_events:['GRANTED','BRANCH_DETAILS_EDITED','AUTO_REVOKED_ON_INVITATION'],
  active_staff_branch_rights_after_revocation:0,
  payments_or_seller_entitlements:false,
  owner_ui_created_second_canonical_private_draft:true,
  second_vin_persisted_and_unpublished:true,
  branch_limited_staff_private_vehicle_create_refused:true,
  real_dealer_role_approval:false,
 },null,2)+'\n',{mode:0o600})
 console.log('DEALER_NATIVE_FICTIONAL_STAFF_CUSTODY PASS: invited, independently accepted, scoped branch-edit persisted, owner revoked tenant/organization and branch scope atomically; owner preserved')
}finally{await db.end()}
