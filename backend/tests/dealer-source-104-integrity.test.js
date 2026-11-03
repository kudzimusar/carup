/**
 * CARUP-DEALER-ONB-001 D0/D4 — exact safe source/crosswalk metadata manifest.
 * Reconciled against the 20-tab original workbook on 2026-11-03.
 * No private phone/email/parent name/source URLs, no independent publication.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('./fixtures/dealer_source_104_safe_manifest.json',import.meta.url),'utf8'));
const byCount=(key)=>Object.fromEntries(
  manifest.rows.reduce((m,r)=>(m.set(r[key],(m.get(r[key])||0)+1),m),new Map())
);
test('S01/S02 104 exact canonical IDs, immutable source row crosswalk, local source checksum',()=>{
  assert.equal(manifest.schema,'CARUP_DEALER_SOURCE_104_SAFE_MANIFEST_1');
  assert.match(manifest.original_source_sha256,/^[a-f0-9]{64}$/);
  assert.equal(manifest.rows.length,104);
  assert.equal(new Set(manifest.rows.map(x=>x.seed_id)).size,104);
  for(const [index,row] of manifest.rows.entries()){
    assert.equal(row.seed_id,'ZW-DEAL-'+String(index+1).padStart(4,'0'));
    assert.equal(row.row,index+8);
    assert.ok(typeof row.category==='string'&&row.category.length>3);
    assert.ok(typeof row.city==='string'&&row.city.length>2);
    assert.equal(row.group_state,'UNREVIEWED_PARENT_BRANCH_MATCH');
    assert.equal(row.publication_eligibility,'PENDING_HUMAN_SOURCE_ELIGIBILITY');
    assert.equal(row.candidate_state,'RESEARCH_ONLY_NOT_LEGAL_ENTITY');
  }
});
test('S03/S04 no source row ever claims verified legal parent or eligibility',()=>{
  assert.equal(manifest.not_publication_authority,true);
  const count=byCount('category');
  assert.equal(Object.values(count).reduce((sum,n)=>sum+n,0),104);
  assert.deepEqual(count,{
    'Official dealer / franchise label — UNVERIFIED':40,
    'Assembler / manufacturing claim':3,'Premium / luxury dealer claim':5,
    'Importer / bonded / clearing claim':6,'Importer / sourcing claim':13,
    'Dealer and service centre claim':1,
    'Dealer / seller claim — categorize in D0':4,
    'Independent dealer claim':28,
    'Commercial / heavy vehicle claim':1,'Marketplace / brokerage claim':3,
  });
  for(const x of manifest.rows){
    assert.ok(!Object.hasOwn(x,'verified_parent_id'));
    assert.ok(!Object.hasOwn(x,'tenant_id'));
    assert.ok(!Object.hasOwn(x,'publication_status'));
    assert.ok(!Object.hasOwn(x,'contacts'));
  }
});
test('S05 non-public source fixture cannot leak contacts or silently derive dealer trust',()=>{
  const serialized=JSON.stringify(manifest).toLowerCase();
  for(const field of ['phone','email','whatsapp','tax_id','registration_number',
    'principal','responsible_person','source_url','legal_owner','merchant_account',
    'is_verified','business_verified','password','token'])
    assert.equal(serialized.includes('"'+field+'"'),false,'unsafe source fixture '+field);
  assert.equal(manifest.rows.filter(x=>x.publication_eligibility!=='PENDING_HUMAN_SOURCE_ELIGIBILITY').length,0);
  assert.equal(manifest.rows.filter(x=>x.group_state!=='UNREVIEWED_PARENT_BRANCH_MATCH').length,0);
});
