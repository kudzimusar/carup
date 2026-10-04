/**
 * O2-X6 — semantic event pins.
 *
 * Events fire AFTER authoritative durable writes; payloads carry safe structured facts only (no
 * reviewer free text, no artifacts, no rendered copy, no internal state names); who_must_act is
 * canonical; no duplicate semantic names; O2 lanes call no delivery provider; every X6 type is fully
 * wired (allowlist + policy + REGISTERED template, all transactional — zero marketing expansion).
 *
 * Ported by OC-5C from PR #208. Adapted:
 *   - the identity event carries a SUBJECT-SAFE status label and the reason's applicant guidance —
 *     never the internal state ('compromised') or the reason code (#208 carried both);
 *   - the wired types are the four People types on this lineage — workbook.import.completed belongs to
 *     the X5A workbook slice, which is not ported here;
 *   - the template variables the emitters feed are asserted, not assumed.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { supabase } = await import('../db/supabase.js');
const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { transitionIdentityLifecycle, LIFECYCLE_REASON_CODES } = await import('../services/identity/identityLifecycleService.js');
const { supersedeSellerAuthorityOnOwnershipTransfer } = await import('../services/seller/sellerAuthorityService.js');
const { recordDecision, buildDealerActionSummary } = await import('../services/dealer/dealerComplianceService.js');
const { COMMUNICATION_EVENT_TYPES } = await import('../services/communication/communicationEventListeners.js');
const { NOTIFICATION_POLICIES, CommunicationNotificationService } = await import('../services/communication/communicationNotificationService.js');
const { CommunicationTemplateService } = await import('../services/communication/communicationTemplateService.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '../..');
const CANONICAL_ACTORS = ['none', 'platform_processing', 'carup_review', 'subject_action', 'external_authority', 'escalated'];
const X6_TYPES = [
  'identity.lifecycle.changed',
  'dealer.compliance.decided',
  'dealer.compliance.evidence_required',
  'seller.authority.superseded',
];

let restore = null;
function install(seed) {
  const world = createSupabaseWorld({ domain_events: [], trust_audit_events: [], audit_logs: [], ...seed });
  restore = installSupabaseWorld(supabase, world);
  return world;
}
afterEach(() => { restore?.(); restore = null; });
const emitted = (world, type) => world.rows('domain_events').filter((row) => row.event_type === type);

const REVIEWER = { id: 'admin-1', role: 'admin', platformRole: 'admin', baseRole: 'admin', authenticationMethod: 'session' };
const APPROVED_SESSION = { id: 'vs-1', user_id: 'subject-1', status: 'verified', reviewed_at: '2026-06-01T00:00:00Z', created_at: '2026-05-30T00:00:00Z', ocr_result: {} };

test('identity.lifecycle.changed fires AFTER the ledger write — a subject-safe status label, the applicant guidance, NO note, NO internal state, NO reason code', async () => {
  const world = install({ verification_sessions: [APPROVED_SESSION], identity_lifecycle_events: [] });
  await transitionIdentityLifecycle(supabase, REVIEWER, {
    userId: 'subject-1',
    nextState: 'suspended',
    reasonCode: 'SECURITY_REVIEW',
    note: 'internal reviewer detail that must never leave the ledger',
  });

  const events = emitted(world, 'identity.lifecycle.changed');
  assert.equal(events.length, 1);
  const payload = events[0].payload;
  assert.equal(payload.status, 'on hold', 'what the person is told — not the internal state name');
  assert.equal(payload.summary, LIFECYCLE_REASON_CODES.SECURITY_REVIEW.applicantGuidance);
  assert.equal(payload.recipientUserId, 'subject-1');
  assert.ok(CANONICAL_ACTORS.includes(payload.whoMustAct));
  assert.equal(payload.schemaVersion, 'o2_event.v1');
  for (const key of ['newState', 'previousState', 'reasonCode', 'note', 'actorUserId']) {
    assert.ok(!(key in payload), `${key} stays in the ledger`);
  }
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes('internal reviewer detail'), 'the note stays in the ledger');
  assert.ok(!serialized.includes('SECURITY_REVIEW') && !serialized.includes('suspended'), 'no reason code, no internal state');
  // The authoritative-state law: the ledger row exists with the event.
  assert.equal(world.rows('identity_lifecycle_events').length, 1);
});

test('a COMPROMISED identity is announced as "under security review" — the person never reads "compromised" or a takeover hypothesis', async () => {
  const world = install({ verification_sessions: [APPROVED_SESSION], identity_lifecycle_events: [], user_sessions: [] });
  await transitionIdentityLifecycle(supabase, REVIEWER, { userId: 'subject-1', nextState: 'compromised', reasonCode: 'SUSPECTED_ACCOUNT_TAKEOVER' });
  const [event] = emitted(world, 'identity.lifecycle.changed');
  assert.equal(event.payload.status, 'under security review');
  assert.equal(event.payload.summary, LIFECYCLE_REASON_CODES.SUSPECTED_ACCOUNT_TAKEOVER.applicantGuidance);
  assert.doesNotMatch(JSON.stringify(event.payload), /compromised|TAKEOVER/i);
});

test('a refused transition announces nothing (the event follows the durable write, never precedes it)', async () => {
  const world = install({ verification_sessions: [], identity_lifecycle_events: [] });
  // not_established → suspended is not a permitted transition.
  await assert.rejects(() => transitionIdentityLifecycle(supabase, REVIEWER, { userId: 'subject-1', nextState: 'suspended', reasonCode: 'SECURITY_REVIEW' }),
    /IDENTITY_LIFECYCLE_INVALID_TRANSITION/);
  assert.equal(emitted(world, 'identity.lifecycle.changed').length, 0);
  assert.equal(world.rows('identity_lifecycle_events').length, 0);
});

const DEALER = { id: 'dp-1', user_id: 'dealer-1', tenant_id: null, legal_name: 'Acme', identity_status: 'unverified', business_evidence_status: 'incomplete', compliance_review_state: 'not_started', active_state: 'inactive', restriction_state: 'none', suspension_state: 'none', investigation_state: 'none', expiry_state: 'none' };

test('dealer.compliance.decided carries NO free-text reason; request_more_info also emits ONE batched evidence_required', async () => {
  const world = install({
    dealer_profiles: [DEALER],
    dealer_compliance_decisions: [],
    dealer_compliance_requirements: [
      { id: 'r1', dealer_id: 'dp-1', requirement_key: 'company_registration', status: 'required', is_blocking: true },
      { id: 'r2', dealer_id: 'dp-1', requirement_key: 'tax_document', status: 'required', is_blocking: true },
    ],
  });
  await recordDecision('dp-1', { decision: 'request_more_info', requirement_key: 'company_registration', reason: 'the scanned certificate is illegible — reviewer private wording' }, { id: 'admin-1', role: 'admin' });

  const decided = emitted(world, 'dealer.compliance.decided');
  assert.equal(decided.length, 1);
  assert.ok(!('reason' in decided[0].payload), 'reviewer free text never rides the event');
  assert.ok(!JSON.stringify(decided[0].payload).includes('illegible'));
  assert.equal(decided[0].payload.whoMustAct, 'subject_action');

  const required = emitted(world, 'dealer.compliance.evidence_required');
  assert.equal(required.length, 1, 'ONE batched message, not drip-fed rejections');
  assert.deepEqual(required[0].payload.missingRequirements.map((item) => item.code).sort(), ['company_registration', 'tax_document']);
  assert.equal(required[0].payload.summary, 'company registration · tax document', 'the template renders the domain-built summary');
  assert.equal(required[0].payload.whoMustAct, 'subject_action');
  assert.ok(!JSON.stringify(required[0].payload).includes('illegible'));
});

test('who_must_act on the decided event is the CANONICAL dealer projection — never a verb-derived "none"', async () => {
  const { toResponsibilityProjection } = await import('../services/dealer/dealerComplianceService.js');
  const cases = [
    // A rejected blocking requirement is the dealer's to replace (#208 said 'none').
    { decision: 'reject_requirement', requirement_key: 'company_registration', expected: 'subject_action',
      profile: { ...DEALER, identity_status: 'verified' },
      requirements: [{ id: 'r1', dealer_id: 'dp-1', requirement_key: 'company_registration', status: 'submitted', is_blocking: true }] },
    // Approving one item while another submitted item awaits CarUp: CarUp's move.
    { decision: 'approve_requirement', requirement_key: 'company_registration', expected: 'carup_review',
      profile: { ...DEALER, identity_status: 'verified' },
      requirements: [
        { id: 'r1', dealer_id: 'dp-1', requirement_key: 'company_registration', status: 'submitted', is_blocking: true },
        { id: 'r2', dealer_id: 'dp-1', requirement_key: 'tax_document', status: 'submitted', is_blocking: true },
      ] },
    // The last item approved on a passed review with a verified identity: nobody must act.
    { decision: 'approve_requirement', requirement_key: 'company_registration', expected: 'none',
      profile: { ...DEALER, identity_status: 'verified', compliance_review_state: 'passed' },
      requirements: [{ id: 'r1', dealer_id: 'dp-1', requirement_key: 'company_registration', status: 'submitted', is_blocking: true }] },
  ];
  for (const c of cases) {
    const world = install({ dealer_profiles: [c.profile], dealer_compliance_decisions: [], dealer_compliance_requirements: c.requirements });
    await recordDecision('dp-1', { decision: c.decision, requirement_key: c.requirement_key, reason: 'private wording' }, { id: 'admin-1', role: 'admin' });
    const [decided] = emitted(world, 'dealer.compliance.decided');
    assert.equal(decided.payload.whoMustAct, c.expected, `${c.decision} → ${c.expected}`);
    // …and it is the very answer the reviewer's People read model computes from the same facts.
    assert.equal(decided.payload.whoMustAct, toResponsibilityProjection({
      profile: world.rows('dealer_profiles')[0], blockingRequirements: world.rows('dealer_compliance_requirements'),
    }));
    assert.equal(emitted(world, 'dealer.compliance.evidence_required').length, 0, 'only request_more_info announces a batch');
    restore(); restore = null;
  }
});

test('a request for more information with nothing outstanding announces no empty "still needs" message', async () => {
  const world = install({
    dealer_profiles: [DEALER],
    dealer_compliance_decisions: [],
    dealer_compliance_requirements: [{ id: 'r1', dealer_id: 'dp-1', requirement_key: 'optional_extra', status: 'required', is_blocking: false }],
  });
  await recordDecision('dp-1', { decision: 'request_more_info', requirement_key: 'optional_extra' }, { id: 'admin-1', role: 'admin' });
  assert.equal(emitted(world, 'dealer.compliance.decided').length, 1);
  assert.equal(emitted(world, 'dealer.compliance.evidence_required').length, 0);
});

test('a submitted item awaiting CarUp is never listed as "still needed" from the dealer', async () => {
  install({
    dealer_compliance_requirements: [
      { id: 'r1', dealer_id: 'dp-7', requirement_key: 'company_registration', status: 'submitted', is_blocking: true },
      { id: 'r2', dealer_id: 'dp-7', requirement_key: 'tax_document', status: 'required', is_blocking: true },
    ],
  });
  const summary = await buildDealerActionSummary('dp-7');
  assert.deepEqual(summary.missing.map((item) => item.code), ['tax_document']);
  assert.deepEqual(summary.awaiting_review.map((item) => item.code), ['company_registration']);
});

test('the batched summary derives from DOMAIN FACTS (requirements), not template logic', async () => {
  install({
    dealer_compliance_requirements: [
      { id: 'r1', dealer_id: 'dp-9', requirement_key: 'company_registration', status: 'verified', is_blocking: true },
      { id: 'r2', dealer_id: 'dp-9', requirement_key: 'address_evidence', status: 'required', is_blocking: true },
      { id: 'r3', dealer_id: 'dp-9', requirement_key: 'optional_extra', status: 'required', is_blocking: false },
    ],
  });
  const summary = await buildDealerActionSummary('dp-9');
  assert.deepEqual(summary.missing.map((item) => item.code), ['address_evidence'], 'verified and non-blocking rows never appear');
  assert.equal(summary.who_must_act, 'subject_action');
});

test('seller.authority.superseded finally tells the former seller — after the audited revocation, safe facts only, exactly once', async () => {
  const world = install({
    vehicle_seller_authority: [{ id: 'a-1', vin: 'JT123456789012345', seller_user_id: 'former-1', status: 'confirmed', basis: 'governed_verified_evidence', evidence_ids: [] }],
  });
  const transfer = { vin: 'JT123456789012345', previousOwnerId: 'former-1', transferId: 'tr-9', actor: { id: 'system-transfer', role: 'admin' } };
  const result = await supersedeSellerAuthorityOnOwnershipTransfer(supabase, transfer);
  assert.equal(result.changed, true);
  const events = emitted(world, 'seller.authority.superseded');
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.recipientUserId, 'former-1');
  assert.equal(events[0].payload.whoMustAct, 'none');
  assert.ok(!JSON.stringify(events[0].payload).includes('tr-9'), 'transfer internals stay out of the announcement');
  // The idempotent no-op path emits nothing new.
  await supersedeSellerAuthorityOnOwnershipTransfer(supabase, transfer);
  assert.equal(emitted(world, 'seller.authority.superseded').length, 1);
});

test('the X6 types are wired exactly once: allowlist + policy + REGISTERED template, all transactional (zero marketing expansion)', () => {
  const templates = new CommunicationTemplateService();
  for (const type of X6_TYPES) {
    assert.equal(COMMUNICATION_EVENT_TYPES.filter((t) => t === type).length, 1, `${type} subscribed exactly once`);
    const policy = NOTIFICATION_POLICIES[type];
    assert.ok(policy, `${type} has a policy`);
    assert.equal(policy.classification, 'transactional', `${type} is transactional — never marketing`);
    assert.deepEqual(policy.channels, ['in_app']);
    assert.equal(policy.policyChannelsOnly, true);
    assert.ok(templates.listTemplates().includes(policy.templateKey),
      `${type} template ${policy.templateKey} is REGISTERED (the fallback template never counts)`);
  }
  // No duplicates anywhere in the allowlist (no second name for an existing semantic).
  assert.equal(new Set(COMMUNICATION_EVENT_TYPES).size, COMMUNICATION_EVENT_TYPES.length);
});

test('the templates render what the emitters actually send — status, summary, vehicle — and nothing the payload lacks', () => {
  const notifications = new CommunicationNotificationService({});
  const templates = new CommunicationTemplateService();
  const render = (type, payload) => templates.render(NOTIFICATION_POLICIES[type].templateKey, notifications.variablesForEvent(type, payload));

  const identity = render('identity.lifecycle.changed', { status: 'on hold', summary: LIFECYCLE_REASON_CODES.SECURITY_REVIEW.applicantGuidance });
  assert.match(identity.body, /Your identity status is now: on hold\. For your security, CarUp is reviewing this account\./);

  const dealer = render('dealer.compliance.evidence_required', { summary: 'company registration · tax document' });
  assert.match(dealer.body, /still needs: company registration · tax document\./);

  const seller = render('seller.authority.superseded', { vin: 'JT123456789012345', status: 'revoked' });
  assert.match(seller.body, /for vehicle JT123456789012345 ended because ownership transferred/);

  for (const rendered of [identity, dealer, seller]) {
    assert.doesNotMatch(rendered.body, /\{\{|undefined|null/, 'every placeholder is fed');
  }
});

test('EMIT-ONLY: no O2 lane calls a delivery provider or writes the notification queue directly', () => {
  const lanes = ['services/identity', 'services/dealer', 'services/seller', 'services/registration', 'services/workbook', 'services/operations'];
  const banned = /sendEmail|sendMail|nodemailer|twilio|sendWhatsApp|sendSms|sendPush|queueNotification|notification_queue|resend\./;
  let scanned = 0;
  for (const lane of lanes) {
    const dir = path.join(repoRoot, 'backend', lane);
    if (!fs.existsSync(dir)) continue; // a lane this lineage does not have (the X5A workbook)
    const files = fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.js'));
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, String(file)), 'utf8');
      assert.ok(!banned.test(source), `${lane}/${file} must stay emit-only`);
      scanned += 1;
    }
  }
  assert.ok(scanned > 10, `the scan read the O2 lanes (${scanned} files)`);
});

test('every X6 emitter payload is free of prohibited material (static source scan)', () => {
  let payloads = 0;
  for (const file of [
    'backend/services/identity/identityLifecycleService.js',
    'backend/services/dealer/dealerComplianceService.js',
    'backend/services/seller/sellerAuthorityService.js',
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    for (const match of source.matchAll(/emitDomainEvent\(null, '([^']+)', \{([\s\S]*?)\}, /g)) {
      const body = match[2];
      payloads += 1;
      assert.ok(!/(^|\W)note(\W|$)/.test(body), `${match[1]} payload must not carry a note`);
      assert.ok(!/reason:\s*reason\b/.test(body), `${match[1]} payload must not forward free-text reason`);
      assert.ok(!/reasonCode|newState|previousState|next_state/.test(body), `${match[1]} payload must not carry internal state or reason codes`);
      assert.ok(!/file_ref|storage|selfie|score/i.test(body), `${match[1]} payload must not carry artifacts`);
    }
  }
  assert.ok(payloads >= 4, `the scan found the X6 payloads (${payloads})`);
});
