// CARUP-DEALER-ONB-001-LR01-R4 P0-1: guards of the PRIVATE Owner-original import proof.
// Fictional values only — the real workbook never enters a test, fixture or CI run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RESTRICTED_SOURCE_FIELDS,
  assertNoRestrictedValues,
  aggregateDigest,
} from '../scripts/dealership/proveOwnerOriginal104NativePostgres.mjs';
import {
  assertOriginalImportTarget,
  assertOriginalOwnerSourceSha,
  ORIGINAL_OWNER_SOURCE_SHA256,
} from '../scripts/dealership/importResearchSeed.mjs';

const fictional = (id, overrides = {}) => ({
  seed_dealer_id: id,
  source_row_sha256: id.endsWith('1') ? 'a'.repeat(64) : 'b'.repeat(64),
  source_snapshot: {
    'Dealer / Company Name': 'Fictional Motors ' + id,
    'Brands / Specialization': 'Imaginary brand',
    'Physical Address': '1 Nowhere Road',
    'Suburb / Area': 'Testville',
    'City / Town': 'Harare',
    'Phone / WhatsApp': '+000 000 0000',
    Email: 'nobody@example.invalid',
    'Ownership / Parent Company / Key Principal': 'Fictional Holdings',
    'Website / Source URL': 'https://example.invalid/' + id,
    ...overrides,
  },
});

test('restricted field list covers every contact, identity and principal column', () => {
  for (const field of ['Dealer / Company Name', 'Physical Address', 'Phone / WhatsApp', 'Email',
    'Ownership / Parent Company / Key Principal', 'Website / Source URL', 'Suburb / Area']) {
    assert.ok(RESTRICTED_SOURCE_FIELDS.includes(field), field);
  }
  assert.ok(!RESTRICTED_SOURCE_FIELDS.includes('City / Town'), 'city is a public-safe aggregate');
});

test('privacy self-check refuses evidence that would disclose a restricted value (negative control)', () => {
  const records = [fictional('ZW-DEAL-0001')];
  assert.throws(() => assertNoRestrictedValues('{"note":"fictional motors zw-deal-0001"}', records),
    /would disclose a restricted source value \(Dealer \/ Company Name of ZW-DEAL-0001\)/);
  assert.throws(() => assertNoRestrictedValues('call +000 000 0000', records), /Phone \/ WhatsApp/);
  assert.throws(() => assertNoRestrictedValues('mail NOBODY@example.invalid', records), /Email/);
});

test('privacy self-check passes aggregate-only evidence and exempts only exact public-safe tokens', () => {
  const records = [fictional('ZW-DEAL-0001', { 'Suburb / Area': 'Harare' })];
  const evidence = JSON.stringify({ city_counts_from_db: { Harare: 1 }, readback_rows: 1 });
  // Without the public-safe token set the suburb equal to its city is (conservatively) refused...
  assert.throws(() => assertNoRestrictedValues(evidence, records), /Suburb \/ Area/);
  // ...with it, an exact city token is exempt, but a longer restricted value is still checked.
  assert.ok(assertNoRestrictedValues(evidence, records, new Set(['Harare'])) > 0);
  const withName = JSON.stringify({ leak: 'Fictional Motors ZW-DEAL-0001', city: 'Harare' });
  assert.throws(() => assertNoRestrictedValues(withName, records, new Set(['Harare'])), /Dealer \/ Company Name/);
});

test('aggregate digest is order-independent and changes when any row hash changes', () => {
  const a = [fictional('ZW-DEAL-0001'), fictional('ZW-DEAL-0002')];
  assert.equal(aggregateDigest(a), aggregateDigest([...a].reverse()));
  assert.notEqual(aggregateDigest(a), aggregateDigest([{ ...a[0], source_row_sha256: 'c'.repeat(64) }, a[1]]));
});

test('original import refuses every non-dedicated or non-loopback target and any other bytes', () => {
  for (const url of [
    'postgresql://postgres@127.0.0.1:5432/carup_dealer_isolated_ci',
    'postgresql://postgres@db.example.com:5432/carup_dealer_owner_original_isolated',
    'postgresql://postgres@127.0.0.1:5432/carup_dealer_owner_original_isolated?sslmode=require',
    'postgresql://postgres@127.0.0.1:5432/postgres',
  ]) {
    assert.throws(() => assertOriginalImportTarget(url), /DEALER_SEED_REJECTED/, url);
  }
  assert.equal(assertOriginalImportTarget('postgresql://postgres@127.0.0.1:55471/carup_dealer_owner_original_isolated'),
    'postgresql://postgres@127.0.0.1:55471/carup_dealer_owner_original_isolated');
  assert.throws(() => assertOriginalOwnerSourceSha('0'.repeat(64), ORIGINAL_OWNER_SOURCE_SHA256), /does not match/);
  assert.throws(() => assertOriginalOwnerSourceSha(ORIGINAL_OWNER_SOURCE_SHA256, undefined), /does not match/);
  assert.doesNotThrow(() => assertOriginalOwnerSourceSha(ORIGINAL_OWNER_SOURCE_SHA256, ORIGINAL_OWNER_SOURCE_SHA256));
});

test('proof script refuses CI and shared-runtime environments by construction', () => {
  const source = readFileSync(new URL('../scripts/dealership/proveOwnerOriginal104NativePostgres.mjs', import.meta.url), 'utf8');
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GITHUB_ACTIONS', 'CI']) {
    assert.ok(source.includes("'" + key + "'"), key + ' must be refused');
  }
  assert.ok(!/console\.log\([^)]*source_snapshot/.test(source), 'snapshots are never logged');
});
