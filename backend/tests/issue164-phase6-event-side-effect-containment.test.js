import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../services/eventBus/listeners.js',import.meta.url),'utf8');

test('Phase 6: VEHICLE_RESERVED cannot manufacture seller/currency/legacy escrow state',()=>{
  const a=source.indexOf("worker.subscribe('VEHICLE_RESERVED'");
  const b=source.indexOf("worker.subscribe('PAYMENT_RECEIVED'",a);
  const block=source.slice(a,b);
  assert.ok(a>=0&&b>a);
  for(const forbidden of ['createEscrow(',"sellerId = 'u3'","'USD'",'updateEscrowStatus(']){
    assert.equal(block.includes(forbidden),false,`reservation listener must not contain ${forbidden}`);
  }
  assert.match(block,/Vehicle Reservation Recorded/);
});

test('Phase 6: PAYMENT_RECEIVED compatibility event cannot directly mutate canonical/legacy escrow state',()=>{
  const a=source.indexOf("worker.subscribe('PAYMENT_RECEIVED'");
  const b=source.indexOf("worker.subscribe('ESCROW_CREATED'",a);
  const block=source.slice(a,b);
  assert.ok(a>=0&&b>a);
  assert.equal(block.includes('updateEscrowStatus('),false);
  assert.equal(block.includes('createEscrow('),false);
  assert.match(block,/no transaction state was changed/);
});
