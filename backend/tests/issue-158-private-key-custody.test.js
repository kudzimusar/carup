import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

import {
  custodyGeneration,
  deriveStakeholderKey,
  signLedgerHash,
  verifyLedgerHash,
} from '../services/blockchain/blockchainKeyCustodyService.js';
import {
  isMissingCustodyMetadataColumn,
  isMissingCustodyRolloutContractFunction,
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

test('Issue #158: custody generation binds both configured version and master secret', () => {
  const a = custodyGeneration({ secret: 'master-a', version: 'v1' });
  const same = custodyGeneration({ secret: 'master-a', version: 'v1' });
  const versionRotated = custodyGeneration({ secret: 'master-a', version: 'v2' });
  const secretRotated = custodyGeneration({ secret: 'master-b', version: 'v1' });
  assert.equal(a, same);
  assert.notEqual(a, versionRotated);
  assert.notEqual(a, secretRotated);
  assert.match(a, /^custody:v1:[0-9a-f]{32}$/);
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
  // The rollout-contract RPC and generation authority belong to the LATER upgrade
  // migration on purpose: DBs that recorded the earlier monolithic filename must still
  // receive them through 20260829003000_issue158_custody_rollout_upgrade.sql.
  assert.doesNotMatch(sql, /blockchain_custody_rollout_contract/);
  assert.doesNotMatch(sql, /authorized_generation/);
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
  // FINALIZED is what enables activation at all, so it must be unreachable while the
  // superseded caller-clock contract would still be the service-role authority.
  assert.match(sql, /blockchain_signing_watermarks/);
  assert.match(sql, /blockchain_activate_public_key_boundary/);
  assert.match(sql, /boundary-hardening migration is absent/);
  assert.match(sql, /has_function_privilege\('service_role',v_superseded,'EXECUTE'\)/);
  assert.match(sql, /superseded caller-clock activation contract is still executable by service_role/);
  assert.match(sql, /terminal ledger uniqueness invariant is absent/);
  assert.match(sql, /uq_blockchain_events_terminal_signer/);
  assert.match(sql, /durable terminal operation identity migration is absent/);
  assert.match(sql, /blockchain_events_terminal_operation_id_required/);
  assert.match(sql, /uq_blockchain_events_signer_operation_id/);
  assert.match(sql, /terminal ledger row lacks durable operation identity/);
  // The PREPARED window keeps legacy writers alive, so the watermark must be reseeded
  // after the drain and BEFORE anything that makes FINALIZED reachable.
  assert.match(sql, /POST-DRAIN WATERMARK RESEED/);
  assert.match(sql, /blockchain_reseed_signing_watermarks/);
  const reseedAt = sql.indexOf('PERFORM public.blockchain_reseed_signing_watermarks()');
  const drainCheckAt = sql.indexOf('old runtime writers are explicitly marked drained');
  const finalizedAt = sql.indexOf("state='FINALIZED'");
  assert.ok(reseedAt > drainCheckAt, 'the reseed must follow the drain assertion');
  assert.ok(reseedAt < finalizedAt, 'the reseed must precede FINALIZED');
});

test('Issue #158 source contract: blockchain runtime never selects or writes private_key_pem', () => {
  const src = readFileSync('backend/services/blockchain/blockchainService.js', 'utf8');
  assert.doesNotMatch(src, /private_key_pem/);
  assert.doesNotMatch(src, /select\(['"]\*['"]\)/);
  assert.match(src, /public_key_pem/);
  assert.match(src, /key_ref/);
});

test('Issue #158: system ledger signing secret is configuration-backed, not hard-coded', () => {
  const custody = readFileSync('backend/services/blockchain/blockchainKeyCustodyService.js', 'utf8');
  assert.match(custody, /CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET/);
  assert.match(custody, /CARUP_BLOCKCHAIN_LEGACY_SYSTEM_HMAC_SECRETS/);

  // REPO-WIDE, not two files. The previous form checked only blockchainService and
  // blockchainKeyCustodyService, so a COPY of the retired literal in
  // diasporaOwnershipHandoffService escaped it entirely — and that copy signed real
  // ownership-handoff ledger events, every one of which would fail verifyChain forever
  // because the verifier holds the configured secret, not the retired constant. A guard
  // scoped to the file it was written for cannot catch the next copy.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'tests') continue;
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
        if (/carup-system-secret/i.test(readFileSync(full, 'utf8'))) offenders.push(full);
      }
    }
  };
  walk('backend');
  assert.deepEqual(offenders, [], `the retired system-secret literal must not survive anywhere: ${offenders.join(', ')}`);
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

  assert.equal(isMissingCustodyRolloutContractFunction({
    code: '42883',
    message: 'function blockchain_custody_rollout_contract() does not exist',
  }), true);
  assert.equal(isMissingCustodyRolloutContractFunction({
    code: 'PGRST202',
    message: "Could not find the function public.blockchain_custody_rollout_contract in the schema cache",
  }), true);
  assert.equal(isMissingCustodyRolloutContractFunction({
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

test('Issue #158: new runtime fails closed before upgrade/finalization and rejects superseded custody generations', () => {
  const src = readFileSync('backend/services/blockchain/blockchainService.js', 'utf8');
  assert.match(src, /blockchain_custody_rollout_contract/);
  assert.match(src, /UPGRADE_REQUIRED/);
  assert.doesNotMatch(src, /return \{ state: 'FINALIZED', authorizedGeneration: null \}/);
  assert.match(src, /rollout\.state !== 'FINALIZED'/);
  assert.match(src, /rollout\.authorizedGeneration !== derived\.custodyGeneration/);
  assert.match(src, /superseded runtime\/configuration is blocked/);
  assert.doesNotMatch(src, /\.from\('public_keys'\)\.insert/);
  assert.doesNotMatch(src, /\.from\('public_keys'\)[\s\S]{0,120}\.update\(/);
});


test('Issue #158: stakeholder event timestamp is bound to the successful generation-authorized key check', () => {
  const src = readFileSync('backend/services/blockchain/blockchainService.js', 'utf8');
  const addStart = src.indexOf('export async function addEvent');
  const addEnd = src.indexOf('\nfunction eventKeyForTimestamp', addStart);
  const addEventSource = src.slice(addStart, addEnd);
  const registerAt = addEventSource.indexOf('await getOrCreateKeypair(signerId)');
  const timestampAt = addEventSource.indexOf('registeredSignerKey?.eventTimestamp');
  const hashAt = addEventSource.indexOf('const currentHash = calculateHash');
  assert.ok(registerAt >= 0, 'stakeholder key registration must exist');
  assert.ok(timestampAt > registerAt, 'event timestamp must come from the authorized key check');
  assert.ok(hashAt > timestampAt, 'event hash must use the generation-authorized timestamp');
  assert.match(addEventSource, /registeredSignerKey\?\.custodyGeneration !== signed\.custodyGeneration/);
});


test('Issue #158: finalized runtime owns all stakeholder key mutation through generation-bound atomic RPC', () => {
  const src = readFileSync('backend/services/blockchain/blockchainService.js', 'utf8');
  assert.match(src, /blockchain_activate_public_key_boundary/);
  assert.match(src, /p_custody_generation: derived\.custodyGeneration/);
  assert.match(src, /eventTimestamp: authoritativeTimestamp/);
  assert.match(src, /return activateCustodiedPublicKey\(userId, derived\)/);
  assert.doesNotMatch(src, /deterministicPublicKeyId/);
  assert.doesNotMatch(src, /isPublicKeyRegistrationConflict/);
});

test('Issue #158: activation boundary is DB-authoritative, never the caller clock, with half-open validity', () => {
  const src = readFileSync('backend/services/blockchain/blockchainService.js', 'utf8');
  // The runtime never supplies its own wall-clock timestamp to key activation.
  assert.doesNotMatch(src, /p_created_at/);
  assert.match(src, /activated\.event_timestamp/);
  assert.match(src, /returned no authoritative event timestamp/);
  // Verification treats validity intervals as half-open [created_at, revoked_at).
  assert.match(src, /created <= eventTime && eventTime < revoked/);
  assert.doesNotMatch(src, /eventTime <= revoked/);

  const sql = readFileSync('database/migrations/20260829020000_issue158_activation_boundary_hardening.sql', 'utf8');
  assert.match(sql, /NEW identity on purpose/i);
  assert.match(sql, /blockchain_signing_watermarks/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.blockchain_signing_watermarks[\s\S]*service_role/);
  assert.match(sql, /blockchain_activate_public_key_boundary/);
  assert.match(sql, /date_trunc\('milliseconds', clock_timestamp\(\)\)/);
  assert.match(sql, /date_trunc\('milliseconds', v_floor\) \+ interval '1 millisecond'/);
  // The upgrade must not rewind time relative to pre-hardening caller-clock history.
  assert.match(sql, /blockchain_boundary_parse_ts/);
  // A successful cast is not sufficient: PostgreSQL accepts infinity and years this
  // code path cannot emit or parse, and persisting one as a watermark stops the
  // activation RPC returning any event timestamp at all.
  assert.match(sql, /NOT isfinite\(v_parsed\)/);
  assert.match(sql, /c_min CONSTANT TIMESTAMPTZ/);
  assert.match(sql, /c_max CONSTANT TIMESTAMPTZ/);
  assert.match(sql, /v_parsed < c_min OR v_parsed > c_max/);
  // The parser admits the full representable window, including the final day; the
  // boundary emitter is what refuses to cross the last representable millisecond.
  assert.match(sql, /c_max CONSTANT TIMESTAMPTZ := TIMESTAMPTZ '9999-12-31 23:59:59\.999\+00'/);
  assert.match(sql, /c_max_boundary CONSTANT TIMESTAMPTZ := TIMESTAMPTZ '9999-12-31 23:59:59\.999\+00'/);
  assert.match(sql, /v_boundary > c_max_boundary/);
  assert.match(sql, /exceeds the representable timestamp range/);
  // The terminal instant is the only re-issuable boundary, so the ledger itself must
  // admit at most one terminal event per signer.
  // The terminal invariant is delivered by its own later identity, never appended to
  // this already-published one.
  assert.doesNotMatch(sql, /CREATE UNIQUE INDEX/);
  const terminalSql = readFileSync('database/migrations/20260829040000_issue158_terminal_event_uniqueness.sql', 'utf8');
  assert.match(terminalSql, /NEW identity on purpose/i);
  assert.match(terminalSql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_blockchain_events_terminal_signer/);
  assert.match(terminalSql, /AT MOST ONE TERMINAL EVENT PER SIGNER/);

  const operationSql = readFileSync('database/migrations/20260830060000_issue158_terminal_operation_identity.sql', 'utf8');
  assert.match(operationSql, /NEW forward-only migration identity/i);
  assert.match(operationSql, /ADD COLUMN IF NOT EXISTS operation_id TEXT/);
  assert.match(operationSql, /legacy-terminal:/);
  assert.match(operationSql, /blockchain_events_terminal_operation_id_required/);
  assert.match(operationSql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_blockchain_events_signer_operation_id/);
  assert.match(operationSql, /split_part\(signature,':',1\), operation_id/);
  // It must be self-sufficient: it re-publishes the activation contract too.
  assert.match(terminalSql, /CREATE OR REPLACE FUNCTION public\.blockchain_activate_public_key_boundary/);
  // Honest operational cost, not a claim that the partial predicate makes it free.
  assert.match(terminalSql, /PostgreSQL still scans public\.blockchain_events once to build it/);
  assert.match(terminalSql, /CREATE INDEX CONCURRENTLY is deliberately NOT used/);
  // Recovery of an unpersisted terminal allocation is bound to the same authority.
  assert.match(sql, /v_active\.public_key_pem = p_public_key_pem/);
  assert.match(sql, /NOT v_terminal_persisted/);

  const runtimeSrc = readFileSync('backend/services/blockchain/blockchainService.js', 'utf8');
  assert.match(runtimeSrc, /isLedgerUniquenessConflict/);
  assert.match(runtimeSrc, /findIdempotentTerminalEvent/);
  assert.match(runtimeSrc, /normalizePersistedPayload/);
  assert.match(runtimeSrc, /operationIdFrom/);
  assert.match(runtimeSrc, /terminal ledger event requires a durable operation id/);
  assert.match(runtimeSrc, /distinct durable operation already owns/);
  assert.match(runtimeSrc, /operation id reuse refused/);
  // Identity must NOT be the event hash: a retry re-reads an advanced tail and so
  // computes a different predecessor, and therefore a different current_hash.
  assert.match(runtimeSrc, /TERMINAL_EVENT_TIMESTAMP/);
  assert.match(runtimeSrc, /canonicalPersistedPayload/);
  assert.doesNotMatch(runtimeSrc, /findLedgerEventByHash/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.blockchain_boundary_parse_ts\(TEXT\)[\s\S]*service_role/);
  assert.match(sql, /WATERMARK RESEED/);
  // The seed is a callable function on purpose: the finalizer repeats it post-drain.
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.blockchain_reseed_signing_watermarks\(\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.blockchain_reseed_signing_watermarks\(\)[\s\S]*service_role/);
  assert.match(sql, /LOCK TABLE public\.blockchain_events IN SHARE MODE/);
  assert.match(sql, /SELECT public\.blockchain_reseed_signing_watermarks\(\)/);
  assert.match(sql, /GREATEST\(\s*public\.blockchain_signing_watermarks\.last_authorized_at,\s*EXCLUDED\.last_authorized_at\s*\)/);
  assert.match(sql, /v_floor := GREATEST\(v_watermark,v_key_floor\)/);
  assert.match(sql, /revoked_at=v_boundary_text/);
  assert.match(sql, /'ACTIVE',v_boundary_text,NULL/);
  // The superseded nine-argument caller-clock contract is retired outright.
  assert.match(sql, /obsolete custody activation contract/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.blockchain_activate_public_key_atomic\(\s*TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT\s*\) FROM PUBLIC,anon,authenticated,service_role/);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE)/i);
});

test('Issue #158: migration enforces one active public key per stakeholder', () => {
  const sql = readFileSync('database/migrations/20260828210000_issue158_private_key_custody.sql', 'utf8');
  assert.match(sql, /uq_public_keys_one_active_per_user/);
  assert.match(sql, /ON public\.public_keys\(user_id\)\s+WHERE status='ACTIVE'/s);
  assert.match(sql, /multiple distinct ACTIVE public keys/i);
  assert.match(sql, /count\(DISTINCT public_key_pem\) > 1/);
});


test('Issue #158: custody runtime routes only the authorized generation through atomic activation', () => {
  const src = readFileSync('backend/services/blockchain/blockchainService.js', 'utf8');
  assert.match(src, /blockchain_activate_public_key_boundary/);
  assert.match(src, /const candidateId = 'key_' \+ crypto\.randomUUID\(\)/);
  assert.match(src, /rollout\.state !== 'FINALIZED'/);
  assert.match(src, /rollout\.authorizedGeneration !== derived\.custodyGeneration/);
  assert.match(src, /return activateCustodiedPublicKey\(userId, derived\)/);
});

test('Issue #158: PREPARED migration guards atomic activation until FINALIZED', () => {
  const sql = readFileSync('database/migrations/20260828210000_issue158_private_key_custody.sql', 'utf8');
  assert.match(sql, /blockchain_activate_public_key_atomic/);
  assert.match(sql, /cutover is not finalized; key activation is disabled/);
  assert.match(sql, /LOCK TABLE public\.public_keys IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(sql, /Always create a fresh incarnation/);
  assert.doesNotMatch(sql, /SET status='ACTIVE'[\s\S]{0,300}WHERE p\.id=v_active\.id/);
});

test('Issue #158: later-version rollout upgrade repairs previously recorded monolithic migration state', () => {
  const sql = readFileSync('database/migrations/20260829003000_issue158_custody_rollout_upgrade.sql', 'utf8');
  assert.match(sql, /NEW identity on purpose/i);
  assert.match(sql, /public_keys_private_material_absent/);
  assert.match(sql, /blockchain_custody_rollout_contract/);
  assert.match(sql, /authorized_generation/);
  assert.match(sql, /blockchain_authorize_custody_generation/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.blockchain_authorize_custody_generation\(TEXT\)[\s\S]*service_role/);
  assert.match(sql, /obsolete custody activation contract/);
  assert.match(sql, /p_custody_generation TEXT/);
  assert.match(sql, /stakeholder signer custody generation is not authorized/);
});
