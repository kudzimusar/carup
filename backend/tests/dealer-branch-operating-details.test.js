import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parsePrivateBranchDetails} from '../services/dealer/dealerBranchDetailsValidation.js';
const base={name:'Fictional Test Branch',address:'Synthetic Street, Test City'};
test('C14 parses persisted private coordinates and hours; never public-verifies location',()=>{
  const payload=parsePrivateBranchDetails({
    ...base,latitude:'-17.825500',longitude:'31.050000',
    opening_hours_text:'Mon–Fri 08:00–17:00; Sat closed'
  });
  assert.deepEqual({...payload},{...base,latitude:-17.8255,longitude:31.05,
    opening_hours_text:'Mon–Fri 08:00–17:00; Sat closed'});
  assert.equal(parsePrivateBranchDetails(base).latitude,null);
  assert.equal(parsePrivateBranchDetails({...base,opening_hours_text:''}).opening_hours_text,null);
});
test('C14 refuses invalid or partial GPS, control chars, or forged authority fields',()=>{
  const bad=[
    {...base,latitude:'-17.82'},{...base,longitude:'31.05'},
    {...base,latitude:91,longitude:31},{...base,latitude:-17,longitude:-181},
    {...base,latitude:'-17.1234567',longitude:'31.05'},
    {...base,latitude:Infinity,longitude:31},
    {...base,latitude:'nan',longitude:'31'},
    {...base,opening_hours_text:'x'.repeat(351)},
    {...base,opening_hours_text:'Mon\nTue'},
    {...base,tenant_id:'other'},{...base,dealer_id:'other'},
    {...base,public_verified:true},{...base,staff_role:'owner'},
    {...base,publication_status:'approved'},
    {name:'',address:'Synthetic Street'},{name:'Name',address:''}
  ];
  for(const input of bad)assert.throws(()=>parsePrivateBranchDetails(input));
});
test('C14 edits use existing canonical tenant owner scope and persisted application path',()=>{
  const routes=readFileSync(new URL('../routes/dealerRoutes.js',import.meta.url),'utf8');
  const service=readFileSync(new URL('../services/dealer/dealerVerifiedWorkspaceService.js',import.meta.url),'utf8');
  const view=readFileSync(new URL('../../web/src/pages/dashboard/dealer/DealerDashboard.tsx',import.meta.url),'utf8');
  assert.match(routes,/router\.patch\('\/api\/dealer\/operational-branches\/:branchId'/);
  assert.match(service,/requireApprovedOwnerWorkspace\(actor\)/);
  assert.match(service,/\.eq\('dealer_id',authority\.dealer_profile_id\)/);
  assert.match(service,/\.update\(\{\.\.\.details,/);
  assert.match(view,/method:editingBranchId\?'PATCH':'POST'/);
  assert.match(view,/opening_hours_text/);
  assert.match(view,/branchLatitude/);
  assert.doesNotMatch(view,/mockBranches|fakeBranch/);
});
