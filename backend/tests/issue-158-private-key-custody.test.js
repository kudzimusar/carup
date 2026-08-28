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
  isMissingCustodyRolloutStateFunction,
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

test('Issue #158 PREPARED migration is additive and keeps legacy private-key writes intact', () => {
  const sql = readFileSync('database/migrations/20260828210000_issue158_private_key_custody.sql', 'utf8');
  assert.match(sql, /blockchain_custody_rollout/);
  assert.match(sql, /'PREPARED'/);
  assert.match(sql, /blockchain_custody_rollout_state/);
  assert.match(sql, /blockchain_activate_public_key_atomic/);
  assert.match(sql, /key_ref TEXT/);
  assert.match(sql, /custody_provider TEXT/);
  assert.doesNotMatch(sql, /SET private_key_pem\s*=\s*NULL/);
  assert.doesNotMatch(sql, /CHECK \(private_key_pem IS NULL\)/);
});

test('Issue #158 protected finalizer erases private material and removes direct service-role key writes', () => {
  const sql = readFileSync('database/scripts/issue158_private_key_custody_finalize.sql', 'utf8');
  assert.match(sql, /old_writers_drained/);
  assert.match(sql, /ACCESS EXCLUSIVE/);
  assert.match(sql, /SET private_key_pem=NULL/);
  assert.match(sql, /CHECK \(private_key_pem IS NULL\)/);
  assert.match(sql, /REVOKE SELECT,INSERT,UPDATE,DELETE ON TABLE public\.public_keys FROM service_role/);
  assert.match(sql, /GRANT SELECT \([\s\S]*public_key_pem[\s\S]*\) ON public\.public_keys TO service_role/);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE) \(/i);
  assert.match(sql, /state='FINALIZED'/);
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

  assert.equal(isMissingCustodyRolloutStateFunction({
    code: '42883',
    message: 'function blockchain_custody_rollout_state() does not exist',
  }), true);
  assert.equal(isMissingCustodyRolloutStateFunction({
    code: 'PGRST202',
    message: "Could not find the function public.blockchain_custody_rollout_state in the schema cache",
  }), true);
  assert.equal(isMissingCustodyRolloutStateFunction({
    code: '42501',
    message: 'permission denied',
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

test('Issue #158: new runtime does not mutate stakeholder keys before protected finalization', () => {
  const src = readFileSync('backend/services/blockchain/blockchainService.js', 'utf8');
  assert.match(src, /blockchain_custody_rollout_state/);
  assert.match(src, /rolloutState !== 'FINALIZED'/);
  assert.match(src, /stakeholder signing is temporarily unavailable until protected finalization/);
  assert.doesNotMatch(src, /\.from\('public_keys'\)\.insert/);
  assert.doesNotMatch(src, /\.from\('public_keys'\)[\s\S]{0,120}\.update\(/);
});


test('Issue #158: addEvent registers stakeholder key before ledger event timestamp/hash', () => {
  const src = readFileSync('backend/services/blockchain/blockchainService.js', 'utf8');
  const addStart = src.indexOf('export async function addEvent');
  const addEnd = src.indexOf('\nfunction eventKeyForTimestamp', addStart);
  const addEventSource = src.slice(addStart, addEnd);
  const registerAt = addEventSource.indexOf('await getOrCreateKeypair(signerId)');
  const timestampAt = addEventSource.indexOf('const timestamp = new Date().toISOString()');
  const hashAt = addEventSource.indexOf('const currentHash = calculateHash');
  assert.ok(registerAt >= 0, 'stakeholder key registration must exist');
  assert.ok(timestampAt > registerAt, 'event timestamp must be captured after key registration/rotation');
  assert.ok(hashAt > timestampAt, 'event hash must use the post-registration timestamp');
});


test('Issue #158: finalized runtime owns all stakeholder key mutation through the atomic RPC', () => {
  const src = readFileSync('backend/services/blockchain/blockchainService.js', 'utf8');
  assert.match(src, /blockchain_activate_public_key_atomic/);
  assert.match(src, /return activateCustodiedPublicKey\(userId, derived, timestamp\)/);
  assert.doesNotMatch(src, /deterministicPublicKeyId/);
  assert.doesNotMatch(src, /isPublicKeyRegistrationConflict/);
});

test('Issue #158: migration enforces one active public key per stakeholder', () => {
  const sql = readFileSync('database/migrations/20260828210000_issue158_private_key_custody.sql', 'utf8');
  assert.match(sql, /uq_public_keys_one_active_per_user/);
  assert.match(sql, /ON public\.public_keys\(user_id\)\s+WHERE status='ACTIVE'/s);
  assert.match(sql, /multiple distinct ACTIVE public keys/i);
  assert.match(sql, /count\(DISTINCT public_key_pem\) > 1/);
});


test('Issue #158: custody runtime routes finalized rotations through atomic activation and fresh incarnations', () => {
  const src = readFileSync('backend/services/blockchain/blockchainService.js', 'utf8');
  assert.match(src, /blockchain_activate_public_key_atomic/);
  assert.match(src, /const candidateId = 'key_' \+ crypto\.randomUUID\(\)/);
  assert.match(src, /rolloutState !== 'FINALIZED'/);
  assert.match(src, /return activateCustodiedPublicKey\(userId, derived, timestamp\)/);
});

test('Issue #158: PREPARED migration guards atomic activation until FINALIZED', () => {
  const sql = readFileSync('database/migrations/20260828210000_issue158_private_key_custody.sql', 'utf8');
  assert.match(sql, /blockchain_activate_public_key_atomic/);
  assert.match(sql, /cutover is not finalized; key activation is disabled/);
  assert.match(sql, /LOCK TABLE public\.public_keys IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(sql, /Always create a fresh incarnation/);
  assert.doesNotMatch(sql, /SET status='ACTIVE'[\s\S]{0,300}WHERE p\.id=v_active\.id/);
});
