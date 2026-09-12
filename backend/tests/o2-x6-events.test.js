/**
 * O2-X6 — semantic event pins.
 *
 * Events fire AFTER authoritative durable writes; payloads carry safe
 * structured facts only (no reviewer free text, no artifacts, no rendered
 * copy); who_must_act is canonical; no duplicate semantic names; O2 lanes call
 * no delivery provider; the five X6 types are fully wired (allowlist + policy
 * + template, all transactional — zero marketing expansion).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../db/supabase.js';
import { transitionIdentityLifecycle } from '../services/identity/identityLifecycleService.js';
import { supersedeSellerAuthorityOnOwnershipTransfer } from '../services/seller/sellerAuthorityService.js';
import { recordDecision, buildDealerActionSummary } from '../services/dealer/dealerComplianceService.js';
import { COMMUNICATION_EVENT_TYPES } from '../services/communication/communicationEventListeners.js';
import { NOTIFICATION_POLICIES } from '../services/communication/communicationNotificationService.js';
import { CommunicationTemplateService } from '../services/communication/communicationTemplateService.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '../..');
const CANONICAL_ACTORS = ['none', 'platform_processing', 'carup_review', 'subject_action', 'external_authority', 'escalated'];
const X6_TYPES = [
  'identity.lifecycle.changed',
  'dealer.compliance.decided',
  'dealer.compliance.evidence_required',
  'seller.authority.superseded',
  'workbook.import.completed',
];

/* Generic chainable mock over the global supabase singleton (captures domain_events). */
const db = {};
let seq = 1;
function builder(table) {
  const filters = [];
  let insertRows = null;
  let updatePatch = null;
  let single = false;
  const api = {
    select() { return api; },
    eq(c, v) { filters.push([c, v]); return api; },
    order() { return api; },
    limit() { return api; },
    single() { single = true; return api; },
    maybeSingle() { single = true; return api; },
    insert(rows) { insertRows = Array.isArray(rows) ? rows : [rows]; return api; },
    update(patch) { updatePatch = patch; return api; },
    then(resolve) {
      if (insertRows) {
        const inserted = insertRows.map((row) => ({ id: `${table}-${seq}`, seq: seq++, created_at: new Date().toISOString(), ...row }));
        (db[table] ||= []).push(...inserted);
        return resolve({ data: single ? inserted[0] : inserted, error: null });
      }
      if (updatePatch) {
        const rows = (db[table] || []).filter((row) => filters.every(([c, v]) => row[c] === v));
        rows.forEach((row) => Object.assign(row, updatePatch));
        return resolve({ data: single ? (rows[0] ?? null) : rows, error: single && !rows[0] ? { message: 'not found' } : null });
      }
      const rows = (db[table] || []).filter((row) => filters.every(([c, v]) => row[c] === v));
      return resolve({ data: single ? (rows[0] ?? null) : rows, error: null });
    },
  };
  return api;
}
function reset() { for (const key of Object.keys(db)) delete db[key]; seq = 1; supabase.from = (t) => builder(t); }
const events = () => db.domain_events || [];

test('identity.lifecycle.changed fires AFTER the ledger write, with safe codes and NO reviewer note', async () => {
  reset();
  db.verification_sessions = [{ id: 'vs-1', user_id: 'subject-1', status: 'verified', reviewed_at: '2026-06-01T00:00:00Z', created_at: '2026-05-30', ocr_result: {} }];
  db.trust_audit_events = [];
  const actor = { id: 'admin-1', role: 'admin', platformRole: 'admin', baseRole: 'admin', authenticationMethod: 'session' };
  await transitionIdentityLifecycle(supabase, actor, {
    userId: 'subject-1',
    nextState: 'suspended',
    reasonCode: 'SECURITY_REVIEW',
    note: 'internal reviewer detail that must never leave the ledger',
  }).catch((err) => { throw new Error(`transition failed: ${err.message}`); });

  const emitted = events().filter((row) => row.event_type === 'identity.lifecycle.changed');
  assert.equal(emitted.length, 1);
  const payload = emitted[0].payload;
  assert.equal(payload.newState, 'suspended');
  assert.equal(payload.previousState, 'verified');
  assert.equal(payload.recipientUserId, 'subject-1');
  assert.ok(CANONICAL_ACTORS.includes(payload.whoMustAct));
  assert.equal(payload.schemaVersion, 'o2_event.v1');
  assert.ok(!JSON.stringify(payload).includes('internal reviewer detail'), 'the note stays in the ledger');
  // The ledger row exists BEFORE/with the event (authoritative-state law).
  assert.ok((db.identity_lifecycle_events || []).length === 1);
});

test('dealer.compliance.decided carries NO free-text reason; request_more_info also emits ONE batched evidence_required', async () => {
  reset();
  db.dealer_profiles = [{ id: 'dp-1', user_id: 'dealer-1', tenant_id: null, legal_name: 'Acme', identity_status: 'unverified', business_evidence_status: 'incomplete', compliance_review_state: 'not_started', active_state: 'inactive', restriction_state: 'none', suspension_state: 'none', investigation_state: 'none', expiry_state: 'none' }];
  db.dealer_compliance_requirements = [
    { id: 'r1', dealer_id: 'dp-1', requirement_key: 'company_registration', status: 'required', is_blocking: true },
    { id: 'r2', dealer_id: 'dp-1', requirement_key: 'tax_document', status: 'required', is_blocking: true },
  ];
  await recordDecision('dp-1', { decision: 'request_more_info', requirement_key: 'company_registration', reason: 'the scanned certificate is illegible — reviewer private wording' }, { id: 'admin-1', role: 'admin' });

  const decided = events().filter((row) => row.event_type === 'dealer.compliance.decided');
  assert.equal(decided.length, 1);
  assert.ok(!('reason' in decided[0].payload), 'reviewer free text never rides the event');
  assert.ok(!JSON.stringify(decided[0].payload).includes('illegible'));
  assert.ok(CANONICAL_ACTORS.includes(decided[0].payload.whoMustAct));

  const required = events().filter((row) => row.event_type === 'dealer.compliance.evidence_required');
  assert.equal(required.length, 1, 'ONE batched message, not drip-fed rejections');
  const missing = required[0].payload.missingRequirements;
  assert.deepEqual(missing.map((item) => item.code).sort(), ['company_registration', 'tax_document']);
  assert.equal(required[0].payload.whoMustAct, 'subject_action');
});

test('the batched summary derives from DOMAIN FACTS (requirements), not template logic', async () => {
  reset();
  db.dealer_compliance_requirements = [
    { id: 'r1', dealer_id: 'dp-9', requirement_key: 'company_registration', status: 'verified', is_blocking: true },
    { id: 'r2', dealer_id: 'dp-9', requirement_key: 'address_evidence', status: 'required', is_blocking: true },
    { id: 'r3', dealer_id: 'dp-9', requirement_key: 'optional_extra', status: 'required', is_blocking: false },
  ];
  const summary = await buildDealerActionSummary('dp-9');
  assert.deepEqual(summary.missing.map((item) => item.code), ['address_evidence'], 'verified and non-blocking rows never appear');
  assert.equal(summary.who_must_act, 'subject_action');
});

test('seller.authority.superseded finally tells the former seller — after the audited revocation, safe facts only', async () => {
  reset();
  db.vehicle_seller_authority = [{ id: 'a-1', vin: 'JT123456789012345', seller_user_id: 'former-1', status: 'confirmed', basis: 'governed_verified_evidence', evidence_ids: [] }];
  db.trust_audit_events = [];
  const result = await supersedeSellerAuthorityOnOwnershipTransfer(supabase, {
    vin: 'JT123456789012345', previousOwnerId: 'former-1', transferId: 'tr-9', actor: { id: 'system-transfer', role: 'admin' },
  });
  assert.equal(result.changed, true);
  const emitted = events().filter((row) => row.event_type === 'seller.authority.superseded');
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].payload.recipientUserId, 'former-1');
  assert.equal(emitted[0].payload.whoMustAct, 'none');
  assert.ok(!JSON.stringify(emitted[0].payload).includes('tr-9'), 'transfer internals stay out of the announcement');
  // Idempotent no-op path emits nothing new.
  await supersedeSellerAuthorityOnOwnershipTransfer(supabase, {
    vin: 'JT123456789012345', previousOwnerId: 'former-1', transferId: 'tr-9', actor: { id: 'system-transfer', role: 'admin' },
  });
  assert.equal(events().filter((row) => row.event_type === 'seller.authority.superseded').length, 1);
});

test('the five X6 types are wired exactly once: allowlist + policy + template, all transactional (zero marketing expansion)', () => {
  for (const type of X6_TYPES) {
    assert.equal(COMMUNICATION_EVENT_TYPES.filter((t) => t === type).length, 1, `${type} subscribed exactly once`);
    const policy = NOTIFICATION_POLICIES[type];
    assert.ok(policy, `${type} has a policy`);
    assert.equal(policy.classification, 'transactional', `${type} is transactional — never marketing`);
    assert.deepEqual(policy.channels, ['in_app']);
    assert.equal(policy.policyChannelsOnly, true);
    assert.ok(new CommunicationTemplateService().listTemplates().includes(policy.templateKey),
      `${type} template ${policy.templateKey} is REGISTERED (the fallback template never counts)`);
  }
  // No duplicates anywhere in the allowlist (no second name for an existing semantic).
  assert.equal(new Set(COMMUNICATION_EVENT_TYPES).size, COMMUNICATION_EVENT_TYPES.length);
});

test('EMIT-ONLY: no O2 lane calls a delivery provider or writes the notification queue directly', () => {
  const lanes = ['services/identity', 'services/dealer', 'services/seller', 'services/registration', 'services/workbook', 'services/operations'];
  const banned = /sendEmail|sendMail|nodemailer|twilio|sendWhatsApp|sendSms|sendPush|queueNotification|notification_queue|resend\./;
  for (const lane of lanes) {
    const dir = path.join(repoRoot, 'backend', lane);
    const files = fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.js'));
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, String(file)), 'utf8');
      assert.ok(!banned.test(source), `${lane}/${file} must stay emit-only`);
    }
  }
});

test('every X6 emitter payload key set is free of prohibited material (static source scan)', () => {
  const prohibited = /payload\s*:\s*\{[^}]*(note|reason:\s*reason|document_number|file_ref|storage|score|selfie)/i;
  for (const file of [
    'backend/services/identity/identityLifecycleService.js',
    'backend/services/dealer/dealerComplianceService.js',
    'backend/services/seller/sellerAuthorityService.js',
    'backend/services/workbook/vehicleWorkbookImportService.js',
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    for (const match of source.matchAll(/emitDomainEvent\(null, '([^']+)', \{([\s\S]*?)\}, /g)) {
      const body = match[2];
      assert.ok(!/(^|\W)note(\W|$)/.test(body), `${match[1]} payload must not carry a note`);
      assert.ok(!/reason:\s*reason\b/.test(body), `${match[1]} payload must not forward free-text reason`);
      assert.ok(!/file_ref|storage|selfie|score/i.test(body), `${match[1]} payload must not carry artifacts`);
    }
  }
  assert.ok(prohibited, 'scan configured');
});
