/**
 * CARUP-DEALER-ONB-001-R3 source-ledger guard.
 *
 * The 67 Owner acceptance cases, 25 capabilities and 12 phase controls are
 * distinct. A passing synthetic test MUST NOT silently rewrite the historical
 * independently certified case outcomes. The only allowed source of a future
 * PASS is separately recorded qualified evidence with Moderator disposition.
 * No repository secrets, external access, shared DB or live commerce.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root='docs/dealership/';
const files={
  matrix:root+'DEV7_DEV10_67_CASE_ACCEPTANCE_MATRIX_2026-11-04.md',
  capability:root+'DEV4_C01_C25_ENGINEERING_COVERAGE_2026-11-04.md',
  phase:root+'PHASE_REQUIREMENT_TRACE.md',
};
const content=Object.fromEntries(
  Object.entries(files).map(([key,file])=>[key,readFileSync(file,'utf8')]));

function cases(source,prefix,last){
  const exp=new RegExp('^\\|\\s*('+prefix+'\\d{2})\\s*\\|');
  const rows=source.split(/\r?\n/).filter(line=>exp.test(line));
  const ids=rows.map(line=>line.match(exp)[1]);
  const expected=Array.from({length:last},(_,i)=>prefix+String(i+1).padStart(2,'0'));
  assert.deepEqual(ids,expected,prefix+' cases must be ordered, present and unique');
  return rows;
}
const t=cases(content.matrix,'T',42);
const s=cases(content.matrix,'S',25);
const capability=cases(content.capability,'C',25);
const phases=content.phase.split(/\r?\n/)
  .filter(line=>/^\|\s*D(?:\d|1[01])\s*\|/.test(line))
  .map(line=>line.match(/^\|\s*D(\d{1,2})\s*\|/)[1]);
assert.deepEqual(phases,Array.from({length:12},(_,i)=>String(i)),
  'D0-D11 trace must be complete and in order');

const statuses={NOT_RUN:0,BLOCKED_EXTERNAL_AUTHORITY:0};
for(const row of [...t,...s]){
  const columns=row.split('|').map(value=>value.trim()).filter(Boolean);
  assert.ok(columns.length>=7,'Malformed acceptance case row');
  const result=columns.at(-1);
  assert.ok(Object.hasOwn(statuses,result),
    'No independent certification has authorized a formal PASS: '+columns[0]+' '+result);
  statuses[result]++;
  assert.ok(columns.at(-2).length>4,'Missing evidence classification');
}
assert.equal(statuses.NOT_RUN+statuses.BLOCKED_EXTERNAL_AUTHORITY,67);
const expectedOriginalSha='a9a6ac6f68bed5266c6870958520105fc1c69f75dd80f7020839e8d5fdd4b137';
assert.ok(content.matrix.includes(expectedOriginalSha),
  'Original Owner file source checksum must stay explicit');
assert.ok(content.phase.includes(expectedOriginalSha),
  'Phase custody ledger must carry original Owner checksum');
assert.match(content.matrix,/0\/67 independently certified PASS/i);
assert.match(content.capability,/source.*independent.*evidence/i);
assert.match(content.phase,/DO NOT MERGE, DEPLOY, PUBLISH REAL DEALERS OR ACTIVATE PAYMENTS/i);

console.log('DEALER_R3_LEDGER_INTEGRITY PASS: D0-D11=12, C01-C25=25, T01-T42=42, S01-S25=25, formal PASS=0, NOT_RUN='+statuses.NOT_RUN+', BLOCKED_EXTERNAL_AUTHORITY='+statuses.BLOCKED_EXTERNAL_AUTHORITY+', original Owner checksum tracked but NOT privately imported');
