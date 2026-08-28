import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  normalizeInstitutionalAdapterDescriptor,
  projectExternalVerificationForPassport,
  assertNoFalsePositiveSourceLanguage,
} from '../services/passport/passportExternalSourceAdapter.js';

function descriptor(overrides = {}) {
  return {
    provider_key: 'zinara',
    authority_name: 'ZINARA',
    capability_type: 'government_source',
    mode: 'sandbox',
    legal_basis: 'Sandbox demonstration only.',
    request_identity: { query_type: 'vin' },
    response_schema: { result: 'verification_result@1' },
    evidence_retention: 'append_only_result_reference',
    retry_policy: 'governed_provider_policy',
    credential_ref: 'ZINARA_API_TOKEN',
    audit_policy: 'provider_request_attempt',
    privacy_policy: 'public_safe_projection_only',
    user_visible_wording: 'Sandbox source check',
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    mode: 'sandbox',
    result: 'match',
    confidence: 0.8,
    source_record_id: 'source-1',
    retrieved_at: '2026-08-28T11:00:00Z',
    identity_fields: {},
    mismatch_flags: [],
    legal_basis: 'Sandbox demonstration only.',
    ...overrides,
  };
}

test('V14: adapter descriptor requires the documented governance fields', () => {
  const d = normalizeInstitutionalAdapterDescriptor(descriptor());
  assert.equal(d.provider_key, 'zinara');
  assert.equal(d.mode, 'sandbox');
  assert.equal(d.credential_ref, 'ZINARA_API_TOKEN');
});

test('V14: credential references may be named but secret-looking values are rejected', () => {
  assert.throws(
    () => normalizeInstitutionalAdapterDescriptor(descriptor({
      credential_ref: 'api_key=super-sensitive-value',
    })),
    /never a secret/i,
  );
});

test('V14: live mode requires concrete staging/production runtime proof', () => {
  assert.throws(
    () => normalizeInstitutionalAdapterDescriptor(descriptor({ mode: 'live' })),
    /runtime proof/i,
  );

  const d = normalizeInstitutionalAdapterDescriptor(descriptor({
    mode: 'live',
    runtime_proof: {
      connected: true,
      environment: 'staging',
      observed_at: '2026-08-28T11:05:00Z',
      request_id: 'req-live-1',
      provider_response_id: 'provider-response-1',
      evidence_ref: 'provider-cert/zinara-live.json',
    },
  }));
  assert.equal(d.runtime_proof.connected, true);
});

test('V14: source result mode must match the adapter descriptor mode', () => {
  assert.throws(
    () => projectExternalVerificationForPassport(
      result({ mode: 'sandbox' }),
      descriptor({ mode: 'partner_file' }),
    ),
    /mode mismatch/i,
  );
});

test('V14: no-record remains no-record and explicitly is not clearance', () => {
  const p = projectExternalVerificationForPassport(
    result({ result: 'no_record', confidence: 0.2 }),
    descriptor(),
  );
  assert.equal(p.result, 'no_record');
  assert.match(p.user_visible_wording, /not a clearance/i);
  assert.doesNotThrow(() => assertNoFalsePositiveSourceLanguage(p));
});

test('V14: unavailable remains unavailable and cannot become a positive conclusion', () => {
  const p = projectExternalVerificationForPassport(
    result({
      mode: 'unavailable',
      result: 'unavailable',
      confidence: null,
      error_class: 'not_contracted',
    }),
    descriptor({ mode: 'unavailable' }),
  );
  assert.equal(p.result, 'unavailable');
  assert.match(p.user_visible_wording, /no conclusion/i);
  assert.doesNotThrow(() => assertNoFalsePositiveSourceLanguage(p));
});

test('V14: public projection withholds provider record reference by default', () => {
  const p = projectExternalVerificationForPassport(result(), descriptor());
  assert.equal(p.source_reference, null);

  const privileged = projectExternalVerificationForPassport(
    result(),
    descriptor(),
    { includeSourceReference: true },
  );
  assert.equal(privileged.source_reference, 'source-1');
});

test('V14: only proven live descriptor renders live_connectivity_proven', () => {
  const sandbox = projectExternalVerificationForPassport(result(), descriptor());
  assert.equal(sandbox.live_connectivity_proven, false);

  const liveDescriptor = descriptor({
    mode: 'live',
    runtime_proof: {
      connected: true,
      environment: 'staging',
      observed_at: '2026-08-28T11:05:00Z',
      request_id: 'req-live-2',
      provider_response_id: 'provider-response-2',
    },
  });
  const live = projectExternalVerificationForPassport(
    result({ mode: 'live' }),
    liveDescriptor,
  );
  assert.equal(live.live_connectivity_proven, true);
});

test('V14 anti-fork: Passport adapter layer reuses source verification and owns no provider execution', () => {
  const src = readFileSync('backend/services/passport/passportExternalSourceAdapter.js', 'utf8');
  assert.match(src, /sourceVerification\/verificationContract\.js/);
  assert.doesNotMatch(src, /executeProviderRequest|setActivationMode|setKillSwitch|registerAdapter\s*\(/);
  assert.doesNotMatch(src, /\.from\s*\(|\.insert\s*\(|\.update\s*\(|supabase/i);
});
