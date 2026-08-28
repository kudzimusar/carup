import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  deriveStakeholderKey,
  signLedgerHash,
  verifyLedgerHash,
} from '../services/blockchain/blockchainKeyCustodyService.js';
import {
  isMissingCustodyMetadataColumn,
} from '../services/blockchain/blockchainService.js';

test('Issue #158: same secret + user + version derives stable public key across calls', () => {
  const opts = { secret: 'unit-test-master-material', version: 'v-test' };
  const a = deriveStakeholderKey('stakeholder-1', opts);
  const b = deriveStakeholderKey('stakeholder-1', opts);
  assert.equal(a.publicKeyPem, b.publicKeyPem);
  assert.equal(a.keyRef, b.keyRef);
  assert.equal(a.keyVersion, 'v-test');
});

test('Issue #158: different stakeholder IDs derive different public keys', () => {
  const opts = { secret: 'unit-test-master-material', version: 'v-test' };
  const a = deriveStakeholderKey('stakeholder-1', opts);
  const b = deriveStakeholderKey('stakeholder-2', opts);
  assert.notEqual(a.publicKeyPem, b.publicKeyPem);
  assert.notEqual(a.keyRef, b.keyRef);
});

test('Issue #158: derived signature verifies with public key only', () => {
  const hash = crypto.createHash('sha256').update('ledger-event').digest('hex');
  const signed = signLedgerHash('stakeholder-1', hash, {
    secret: 'unit-test-master-material',
    version: 'v-test',
  });

  assert.equal(verifyLedgerHash(signed.publicKeyPem, hash, signed.signatureHex), true);
  assert.equal(verifyLedgerHash(signed.publicKeyPem, hash + 'x', signed.signatureHex), false);
});

test('Issue #158: custody API never returns PEM private material', () => {
  const key = deriveStakeholderKey('stakeholder-1', {
    secret: 'unit-test-master-material',
    version: 'v-test',
  });
  assert.equal('privateKeyPem' in key, false);
  assert.match(key.keyRef, /^derived:carup-blockchain:/);
});

test('Issue #158 migration erases and blocks private_key_pem while retaining public verification', () => {
  const sql = readFileSync('database/migrations/20260828210000_issue158_private_key_custody.sql', 'utf8');
  assert.match(sql, /SET private_key_pem = NULL/);
  assert.match(sql, /CHECK \(private_key_pem IS NULL\)/);
  assert.match(sql, /key_ref TEXT/);
  assert.match(sql, /custody_provider TEXT/);
  assert.match(sql, /GRANT SELECT \([\s\S]*public_key_pem[\s\S]*\) ON public\.public_keys TO service_role/);
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE) \([^)]*private_key_pem/i);
});

test('Issue #158 source contract: blockchain runtime never selects or writes private_key_pem', () => {
  const src = readFileSync('backend/services/blockchain/blockchainService.js', 'utf8');
  assert.doesNotMatch(src, /private_key_pem/);
  assert.doesNotMatch(src, /select\(['"]\*['"]\)/);
  assert.match(src, /public_key_pem/);
  assert.match(src, /key_ref/);
});

test('Issue #158: system ledger signing secret is configuration-backed, not hard-coded', () => {
  const runtime = readFileSync('backend/services/blockchain/blockchainService.js', 'utf8');
  const custody = readFileSync('backend/services/blockchain/blockchainKeyCustodyService.js', 'utf8');
  assert.doesNotMatch(runtime, /carup-system-secret/i);
  assert.doesNotMatch(custody, /carup-system-secret/i);
  assert.match(custody, /CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET/);
  assert.match(custody, /CARUP_BLOCKCHAIN_LEGACY_SYSTEM_HMAC_SECRETS/);
});

test('Issue #158: blockchain compatibility API returns public metadata only', () => {
  const src = readFileSync('backend/services/blockchain/blockchainService.js', 'utf8');
  assert.doesNotMatch(src, /privateKeyPem|privateKeyPem:/);
  assert.match(src, /custodyProvider/);
  assert.match(src, /keyVersion/);
});


test('Issue #158: deploy-before-migrate detection recognizes PostgreSQL and PostgREST missing custody columns', () => {
  assert.equal(isMissingCustodyMetadataColumn({
    code: '42703',
    message: 'column public_keys.key_ref does not exist',
  }), true);
  assert.equal(isMissingCustodyMetadataColumn({
    code: 'PGRST204',
    message: "Could not find the 'key_ref' column of 'public_keys' in the schema cache",
  }), true);
  assert.equal(isMissingCustodyMetadataColumn({
    code: '42P01',
    message: 'relation public_keys does not exist',
  }), false);
  assert.equal(isMissingCustodyMetadataColumn({
    code: '42501',
    message: 'permission denied for table public_keys',
  }), false);
});

test('Issue #158: pre-migration compatibility uses public-only named columns and never secret material', () => {
  const src = readFileSync('backend/services/blockchain/blockchainService.js', 'utf8');
  assert.match(src, /BASE_PUBLIC_KEY_SELECT/);
  assert.match(src, /CUSTODY_PUBLIC_KEY_SELECT/);
  assert.match(src, /select\(BASE_PUBLIC_KEY_SELECT\)/);
  assert.match(src, /isMissingCustodyMetadataColumn/);
  assert.doesNotMatch(src, /private_key_pem/);
  assert.doesNotMatch(src, /select\(['"]\*['"]\)/);
});

test('Issue #158: legacy-schema inserts omit custody metadata rather than inventing unavailable columns', () => {
  const src = readFileSync('backend/services/blockchain/blockchainService.js', 'utf8');
  assert.match(src, /\.\.\.\(custodyMetadataAvailable[\s\S]*key_ref: derived\.keyRef/);
  assert.match(src, /custodyMetadataPersisted: custodyMetadataAvailable/);
});
