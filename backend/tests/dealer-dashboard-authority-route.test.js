/**
 * CARUP-DEALER-ONB-001 D7 C11/C15/C17 regression:
 * the authenticated dealer UI must use the independently authorized canonical
 * tenant workflow, not legacy global-user-role dealer CRUD.
 * Static route contract only; physical authenticated browser UAT remains separate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const dashboard=readFileSync(new URL('../../web/src/pages/dashboard/dealer/DealerDashboard.tsx',import.meta.url),'utf8');
const routes=readFileSync(new URL('../routes/dealerRoutes.js',import.meta.url),'utf8');
const service=readFileSync(new URL('../services/dealer/dealerVerifiedWorkspaceService.js',import.meta.url),'utf8');
const inventory=readFileSync(new URL('../services/dealer/dealerTenantInventoryReadService.js',import.meta.url),'utf8');

test('C11/C15 ordinary-member legal dealer dashboard uses claim-linked authority not legacy dealer global role',()=>{
  assert.match(dashboard,/path:'\/dealer\/operational-workspace'/);
  assert.match(routes,/router\.get\('\/api\/dealer\/operational-workspace',\s*authorizeSessionRole\(\[\]\)/);
  assert.match(service,/readMyOperationalDealerAuthority\(link\.claim_id,actor\)/);
  assert.match(service,/authority\.tenant_id!==link\.tenant_id/);
  assert.doesNotMatch(dashboard,/path:'\/dealer\/profile'/);
  assert.doesNotMatch(dashboard,/path:'\/dealer\/branches'/);
  assert.doesNotMatch(dashboard,/useCarUpApi|fetchDealerInventory/);
});
test('C14 new branch is real tenant-checked canonical persistence, never local mock',()=>{
  assert.match(dashboard,/path:'\/dealer\/operational-branches'/);
  assert.match(dashboard,/method:'POST'/);
  assert.match(routes,/router\.post\('\/api\/dealer\/operational-branches'/);
  assert.match(service,/supabase\.from\('dealer_branches'\)/);
  assert.match(service,/requireApprovedOwnerWorkspace\(actor\)/);
  assert.doesNotMatch(dashboard,/mockBranches|fakeBranch/);
});
test('C17 VIN display uses the server-issued matching active tenant envelope and no seller grant',()=>{
  assert.match(dashboard,/path:'\/dealer\/operational-inventory'/);
  assert.match(dashboard,/response\.inventory\.owner_tenant_id===result\.workspace\.tenant_id/);
  assert.match(inventory,/\.eq\('tenant_id',owner\.tenant_id\)/);
  assert.match(inventory,/public_listing_approved_by_this_read:false/);
  assert.doesNotMatch(dashboard,/SellerInquiriesCard|DealerIntelligence/);
  assert.doesNotMatch(dashboard,/Publish VIN|Create marketplace listing/);
});
test('C15 never conflate unknown seller/financial counts with verified zero',()=>{
  assert.match(dashboard,/Not available/);
  assert.match(dashboard,/Not measured/);
  assert.match(dashboard,/first 100/);
  assert.doesNotMatch(dashboard,/actual_revenue\s*\|\|\s*0/);
  assert.doesNotMatch(dashboard,/complaint_count\s*\|\|\s*0/);
});
