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

test('dealer action-class quotas preserve 4/hour per class and 8/hour aggregate; no bypass',async()=>{
  const ip='198.51.100.205';
  const hour=3600000;
  const all=rateLimiter({max:8,windowMs:hour,isSensitive:true,
    bucket:'dealer-claimant-total'});
  const claim=rateLimiter({max:4,windowMs:hour,isSensitive:true,
    bucket:'dealer-claim-control'});
  const evidence=rateLimiter({max:4,windowMs:hour,isSensitive:true,
    bucket:'dealer-private-evidence'});
  const intake=rateLimiter({max:4,windowMs:hour,isSensitive:true,
    bucket:'dealer-application-intake'});
  async function chained(specific,route){
    const broad=await request(all,ip,route);
    if(!broad.allowed)return broad;
    return request(specific,ip,route);
  }
  // Normal, distinct steps (including later supporting evidence) must fit
  // without spoofing X-Forwarded-For, bypass headers or server restarts.
  for(const [limit,route] of [
    [claim,'/research/1/claim'],
    [evidence,'/claims/1/evidence/registration'],
    [intake,'/claims/1/workbook'],
    [intake,'/claims/1/compliance-submissions'],
    [evidence,'/claims/1/evidence/signatory'],
  ]){
    assert.deepEqual(await chained(limit,route),{allowed:true});
  }
  for(const limit of [claim,claim,evidence])
    assert.deepEqual(await chained(limit,'/claims/1/action'),{allowed:true});
  const over=await chained(intake,'/claims/1/workbook');
  assert.equal(over.allowed,false);
  assert.equal(over.status,429);
  // Each independent class must also remain strictly bounded even if it is
  // the only activity for that IP.
  const distinctIp='198.51.100.206';
  const onlyEvidence=rateLimiter({max:4,windowMs:hour,isSensitive:true,
    bucket:'dealer-private-evidence'});
  for(let i=0;i<4;i++)
    assert.deepEqual(await request(onlyEvidence,distinctIp,'/claims/1/evidence'),{allowed:true});
  assert.equal((await request(onlyEvidence,distinctIp,'/claims/1/evidence')).status,429);
});
