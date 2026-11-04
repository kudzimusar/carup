import test from 'node:test';
import assert from 'node:assert/strict';
import {rateLimiter} from '../middleware/securityMiddleware.js';

// CARUP-DEALER-ONB-001 R3 regression from physical PostgreSQL/Chromium
// run 41794572614. Independent reviewer requests were consuming the
// claimant's smaller 4/hour rate-limit budget on the same loopback IP.
// Do NOT bypass, expand, or account/route-key the claimant's four-write budget.
function request(limiter,ip,route){
  return new Promise((resolve,reject)=>{
    const req={method:'POST',ip,originalUrl:route,headers:{}};
    const res={
      status(code){this.code=code;return this},
      json(body){resolve({allowed:false,status:this.code,body})},
    };
    try{limiter(req,res,()=>resolve({allowed:true}));}
    catch(error){reject(error);}
  });
}
test('reviewer step-up does not consume separate 4/hour claimant budget, while all four claimant routes share it',async()=>{
  const ip='198.51.100.204';
  const claims=rateLimiter({max:4,windowMs:3600000,isSensitive:true});
  const reviews=rateLimiter({max:15,windowMs:3600000,isSensitive:true});
  const claimantRoutes=[
    '/api/dealership/research/ZW-DEAL-0001/claim',
    '/api/dealership/claims/test/evidence',
    '/api/dealership/claims/test/workbook',
    '/api/dealership/claims/test/compliance-submissions',
  ];
  for(const route of [
    '/api/admin/dealership/claims/test/evidence/test/preview',
    '/api/admin/dealership/claims/test/review',
  ]){
    assert.deepEqual(await request(reviews,ip,route),{allowed:true});
  }
  for(const route of claimantRoutes){
    assert.deepEqual(await request(claims,ip,route),{allowed:true},
      'legitimate fourth write must not be exhausted by reviewer activity');
  }
  const fifth=await request(claims,ip,'/api/dealership/claims/test/appeal');
  assert.equal(fifth.status,429,'fifth claim-class write stays denied');
  assert.equal(fifth.body.error,'Too many requests. Please try again later.');
  assert.deepEqual(await request(reviews,ip,'/api/admin/dealership/claims/test/review'),
    {allowed:true},'reviewer budget must also be independent of claimant traffic');
});
