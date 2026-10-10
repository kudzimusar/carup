/**
 * The O2 identity REVIEW contract, as ruled by the Product Owner (§12D) — ported to #222 by PC01-F F2
 * from #209 43be0ad2 and RE-KEYED to this lineage's DocumentIntelligenceService result shape.
 *
 * `likely_identity_document` is REVIEWABLE evidence: not verified, never auto-granted, but approvable
 * by a capable, stepped-up reviewer when the extraction facts stand on their own.
 *
 * The defect this pins closed: extraction trust used to be granted only when the classifier had chosen
 * exactly `valid_identity_document`, so a `likely` case was stamped OCR_RESULT_UNTRUSTED and became
 * unapprovable by anyone — while `decisionPolicy._checkApprove` said "approval requires a valid OR
 * LIKELY identity document". Classification and extraction trust are INDEPENDENT AXES.
 *
 * RE-KEYING. #209 read delivery proof from `provider_execution.usage` and PASSED when it was absent.
 * Here the service records the bytes it actually sent in `extractedData.provenance.imageBytesSent`;
 * delivery must be proven positively, so a reading that carries no proof is untrusted (CONTRACT-3b).
 *
 * OCR_RESULT_UNTRUSTED remains approval-blocking. It is not weakened here and must not be.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const {
  createVerificationSession,
  uploadVerificationSessionImage,
  submitVerificationSession,
} = await import('../services/identity/verificationSessionService.js');
const { DecisionPolicyEngine } = await import('../services/identity/decisionPolicy.js');
const { DECISION_ACTION } = await import('../services/identity/caseWorkflow.js');
const { getReasonConfig } = await import('../services/identity/reasonCodes.js');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

class MockQuery {
  constructor(client, table) {
    this.client = client; this.table = table;
    this.operation = 'select'; this.payload = null; this.filters = [];
  }
  select() { return this; }
  eq(key, value) { this.filters.push({ key, value }); return this; }
  in() { return this; }
  order() { return this; }
  limit() { return this; }
  insert(payload) { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload) { this.operation = 'update'; this.payload = payload; return this; }
  maybeSingle() { return this.execute({ single: true, maybe: true }); }
  single() { return this.execute({ single: true, maybe: false }); }
  then(resolve, reject) { return this.execute({ single: false, maybe: false }).then(resolve, reject); }
  rows() { return (this.client.data[this.table] ||= []); }
  matches(row) { return this.filters.every((f) => row[f.key] === f.value); }
  async execute({ single, maybe }) {
    if (this.operation === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.map((r) => ({
        id: r.id || `row-${++this.client.sequence}`,
        created_at: r.created_at || new Date(2026, 0, ++this.client.sequence).toISOString(),
        ...clone(r),
      }));
      this.rows().push(...inserted);
      return single ? { data: clone(inserted[0]), error: null } : { data: clone(inserted), error: null };
    }
    if (this.operation === 'update') {
      const updated = [];
      for (const row of this.rows()) {
        if (this.matches(row)) { Object.assign(row, clone(this.payload)); updated.push(clone(row)); }
      }
      if (single) return { data: updated[0] || null, error: updated.length || maybe ? null : { message: 'No rows updated' } };
      return { data: updated, error: null };
    }
    const rows = this.rows().filter((r) => this.matches(r)).map(clone);
    if (single) {
      if (!rows.length && !maybe) return { data: null, error: { message: 'No rows found' } };
      return { data: rows[0] || null, error: null };
    }
    return { data: rows, error: null };
  }
}

function createMockClient(accountName) {
  return {
    sequence: 0,
    data: {
      verification_sessions: [],
      verification_decisions: [],
      trust_audit_events: [],
      organization_audit_logs: [],
      organization_users: [],
      ocr_documents: [{ id: 'ocr-1', file_path: 'placeholder' }],
      users: [{ id: 'owner-1', name: accountName, email: 'owner@example.test' }],
      verification_ocr_provenance: [],
    },
    from(table) { return new MockQuery(this, table); },
  };
}

const owner = { id: 'owner-1', userId: 'owner-1', role: 'owner', tenantId: null };
let __imgSeq = 0;
/** A JPEG-magic, non-trivial image (distinct fill per call avoids duplicate-evidence detection). */
function validImage() {
  const buf = Buffer.alloc(3000, (__imgSeq++ % 200) + 30);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
  return buf;
}
const upload = () => ({ image: 'data:image/jpeg;base64,' + validImage().toString('base64') });

const CORE_FIELDS = { confidenceScore: 0.9, first_name: 'Ruvimbo', last_name: 'Chigumba', national_id_number: '63-1234567-A-42' };
/** What DocumentIntelligenceService records when the provider actually carried the image. */
const DELIVERED = { imageBytesSent: 888564, mimeTypeSent: 'image/jpeg', executionStatus: 'provider_succeeded' };

function fakeClassifier(classification, { extractionAllowed = true } = {}) {
  return {
    classify: async () => ({
      classification,
      classificationConfidence: 0.9,
      reasonCode: extractionAllowed ? null : 'NON_DOCUMENT',
      reasons: [],
      hashes: {},
      extractionAllowed,
      extractionTrust: extractionAllowed ? 'partially_trusted' : 'not_run',
      provider: 'cloudflare',
      model: '@cf/qwen/qwen3.8-27b',
    }),
    persistClassification: async () => {},
  };
}

async function runSubmit({ classification, extractionAllowed = true, extracted = CORE_FIELDS, success = true, provenance = DELIVERED, accountName = 'Ruvimbo Chigumba' }) {
  const client = createMockClient(accountName);
  const session = await createVerificationSession(client, owner, { documentType: 'national_id', doubleSided: false });
  await uploadVerificationSessionImage(client, owner, session.id, 'front', upload(), { storage: { uploadToStorage: async () => 'front.jpg' } });
  await uploadVerificationSessionImage(client, owner, session.id, 'selfie', upload(), { storage: { uploadToStorage: async () => 'selfie.jpg' } });
  const extractedData = success ? { ...extracted, ...(provenance ? { provenance } : {}) } : undefined;
  await submitVerificationSession(client, owner, session.id, {
    storage: { downloadFromStorage: async () => ({ buffer: validImage(), mimeType: 'image/jpeg' }) },
    classifier: fakeClassifier(classification, { extractionAllowed }),
    ocr: { extractDocumentData: async () => ({ success, ocrDocumentId: 'ocr-1', extractedData, executionStatus: success ? 'provider_succeeded' : 'provider_failed' }) },
  });
  return client.data.verification_sessions.find((r) => r.id === session.id);
}

/** Would a capable, stepped-up reviewer be permitted to APPROVE this stored case? */
function reviewerMayApprove(row) {
  return DecisionPolicyEngine.isActionAllowed(DECISION_ACTION.APPROVE, {
    workflow_phase: row.workflow_phase,
    evidence_classification: row.evidence_classification,
    extraction_trust_status: row.extraction_trust_status,
    identity_binding_status: row.identity_binding_status,
    primary_reason_code: row.primary_reason_code,
  });
}

/* ── 1 & 2: VALID and LIKELY are both reviewer-approvable on their own facts ── */

test('CONTRACT-1: VALID + trusted extraction + MATCH may be reviewer-approved', async () => {
  const row = await runSubmit({ classification: 'valid_identity_document' });
  assert.equal(row.extraction_trust_status, 'partially_trusted');
  assert.equal(row.identity_binding_status, 'match');
  assert.equal(row.primary_reason_code, null);
  assert.equal(reviewerMayApprove(row).allowed, true);
});

test('CONTRACT-2: LIKELY + trusted extraction + MATCH may be reviewer-approved', async () => {
  const row = await runSubmit({ classification: 'likely_identity_document' });
  assert.equal(row.evidence_classification, 'likely_identity_document');
  assert.equal(row.extraction_trust_status, 'partially_trusted',
    'extraction trust must come from the extraction facts, not from the classifier picking VALID');
  assert.equal(row.primary_reason_code, null);
  assert.equal(reviewerMayApprove(row).allowed, true);
});

/* ── 3-9: everything that must stay blocked ─────────────────────────────────── */

test('CONTRACT-3: LIKELY + a reading that reports NO bytes delivered stays blocked', async () => {
  const row = await runSubmit({ classification: 'likely_identity_document', provenance: { imageBytesSent: 0 } });
  assert.equal(row.extraction_trust_status, 'untrusted');
  assert.equal(row.primary_reason_code, 'OCR_RESULT_UNTRUSTED');
  assert.equal(reviewerMayApprove(row).allowed, false);
});

test('CONTRACT-3b (re-keying): a reading that carries NO delivery proof at all is untrusted — absence never passes', async () => {
  for (const classification of ['valid_identity_document', 'likely_identity_document']) {
    const row = await runSubmit({ classification, provenance: null });
    assert.equal(row.extraction_trust_status, 'untrusted', classification);
    assert.equal(row.primary_reason_code, 'OCR_RESULT_UNTRUSTED', classification);
    assert.equal(reviewerMayApprove(row).allowed, false, classification);
  }
});

test('CONTRACT-4: NON_DOCUMENT stays blocked even when text was extracted — on the reason AND on the stored class', async () => {
  const row = await runSubmit({ classification: 'non_document', extractionAllowed: false });
  // The rejected path used to store a reason code and NO classification, so the policy's
  // evidence-class gate read NOT_RUN — the single guard a reviewer's reason could once overwrite.
  assert.equal(row.evidence_classification, 'non_document');
  assert.equal(row.extraction_trust_status, 'not_run');
  assert.equal(row.primary_reason_code, 'NON_DOCUMENT');
  assert.equal(reviewerMayApprove(row).allowed, false);
  // Even if the reason were somehow relaxed, the stored class still blocks approval.
  assert.equal(reviewerMayApprove({ ...row, primary_reason_code: 'OTHER' }).allowed, false);
});

test('CONTRACT-5/6: UNSUPPORTED, UNREADABLE and UNCERTAIN stay blocked', () => {
  for (const evidence of ['unsupported_document', 'unreadable', 'uncertain']) {
    assert.equal(DecisionPolicyEngine.isActionAllowed(DECISION_ACTION.APPROVE, {
      workflow_phase: 'reviewer_action_required', evidence_classification: evidence,
      extraction_trust_status: 'partially_trusted', identity_binding_status: 'match', primary_reason_code: null,
    }).allowed, false, `${evidence} must remain unapprovable`);
  }
});

test('CONTRACT-7: ACCOUNT_DOCUMENT_MISMATCH stays blocked', async () => {
  const row = await runSubmit({ classification: 'likely_identity_document', accountName: 'Someone Else' });
  assert.equal(row.identity_binding_status, 'mismatch');
  assert.equal(row.primary_reason_code, 'ACCOUNT_DOCUMENT_MISMATCH');
  assert.equal(reviewerMayApprove(row).allowed, false);
});

test('CONTRACT-8: a provider failure can never produce trusted extraction', async () => {
  const row = await runSubmit({ classification: 'likely_identity_document', success: false });
  assert.equal(row.extraction_trust_status, 'no_fields');
  assert.equal(row.primary_reason_code, 'OCR_PROVIDER_FAILED');
  assert.equal(reviewerMayApprove(row).allowed, false);
});

test('CONTRACT-9: OCR_RESULT_UNTRUSTED itself is NOT weakened', () => {
  assert.equal(getReasonConfig('OCR_RESULT_UNTRUSTED').approveAllowed, false,
    'the ruling repairs the coupling, it does not make the untrusted code approvable');
  for (const code of ['DOCUMENT_NOT_VISIBLE', 'OCR_PROVIDER_FAILED', 'REQUIRED_FIELDS_MISSING', 'ACCOUNT_DOCUMENT_MISMATCH']) {
    assert.equal(getReasonConfig(code).approveAllowed, false, `${code} must stay approval-blocking`);
  }
});

/* ── 10-12: nothing here grants authority ──────────────────────────────────── */

test('CONTRACT-10: LIKELY never auto-verifies — the case always awaits a human', async () => {
  const row = await runSubmit({ classification: 'likely_identity_document' });
  assert.equal(row.status, 'pending_manual_review');
  assert.equal(row.workflow_phase, 'reviewer_action_required');
  assert.notEqual(row.final_disposition, 'verified');
});

test('CONTRACT-11: the provider cannot grant identity authority — approval is minted elsewhere', () => {
  const lifecycle = fs.readFileSync(path.join(ROOT, 'backend/services/identity/identityLifecycleService.js'), 'utf8');
  assert.match(lifecycle, /const APPROVAL_ONLY_STATES = new Set\(/);
  assert.match(lifecycle, /APPROVAL_ONLY_STATES\.has\(nextState\)/);
  const session = fs.readFileSync(path.join(ROOT, 'backend/services/identity/verificationSessionService.js'), 'utf8');
  assert.doesNotMatch(session, /final_disposition:\s*['"]verified['"]/, 'submission never verifies');
  assert.match(session, /NEVER auto-verify/);
});

test('CONTRACT-12: reviewer capability AND step-up are mandatory on the identity DECISION route', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'backend/routes/identityVerificationAdminRoutes.js'), 'utf8');
  const decision = routes.slice(routes.indexOf('verification-sessions/:sessionId/review'));
  const guards = decision.slice(0, decision.indexOf('asyncHandler'));
  assert.match(guards, /authorizeRole\(\['admin'\]\)/, 'reviewer capability is required');
  assert.match(guards, /requireAuthenticationAssurance\(ACTION_CLASSES\.SENSITIVE\)/,
    'a sensitive-action step-up is required to DECIDE an identity');
});
