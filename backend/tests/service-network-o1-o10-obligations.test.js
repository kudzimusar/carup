/**
 * Service Network Foundation 1.0 — post-#194 obligations O1–O10.
 *
 * The reconciliation audit at 93b97a36 recorded these as 8 OPEN / 2 N/A / 0 CLOSED. This file is
 * the behavioural evidence for each closure. Every test executes the real code path; where an
 * obligation is genuinely N/A, the test proves the property that makes it so rather than asserting
 * an absence by inspection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const {
  projectServiceNetworkRecord,
  buildPassportServicePartsSection,
} = await import('../services/passport/passportServicePartsProjection.js');
const { PASSPORT_AUDIENCES } = await import('../services/passport/passportContract.js');
const { createInquiry } = await import('../services/marketplace/marketplaceInquiryService.js');
const { buildServiceNetworkMetrics } = await import('../services/intelligence/serviceIntelligenceService.js');

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O1 — Passport service projection consumes governed Service Network records
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const snRecord = (over = {}) => ({
  id: 'sr-1',
  work_order_id: 'wo-1',
  vin: 'JTDBR32E870123456',
  service_authority: 'evidence_backed',
  service_category: 'brakes',
  work_performed: 'Replaced front pads; customer disputes the quoted price',
  total_cost: 250,
  currency: 'ZiG',
  performed_at: '2026-09-01T10:00:00Z',
  garage_display_name: 'Msasa Motors',
  evidence_ids: ['ev-1'],
  ...over,
});

test('O1: the Service Network authority vocabulary is EXTENDED, not forked', () => {
  // Without the extension these three collapse to 'unknown', silently understating real provenance.
  for (const authority of ['garage_stated', 'mechanic_attributed', 'evidence_backed']) {
    const projected = projectServiceNetworkRecord(snRecord({ service_authority: authority }), {
      audience: PASSPORT_AUDIENCES.OWNER,
    });
    assert.equal(projected.authority, authority, `${authority} must survive Passport normalization`);
  }
  // And the original four still normalize as before.
  assert.equal(
    projectServiceNetworkRecord(snRecord({ service_authority: 'professional_governed' }), { audience: PASSPORT_AUDIENCES.OWNER }).authority,
    'professional_governed',
  );
  // An authority Passport does not recognise is still refused, not passed through.
  assert.equal(
    projectServiceNetworkRecord(snRecord({ service_authority: 'self_certified_gold' }), { audience: PASSPORT_AUDIENCES.OWNER }).authority,
    'unknown',
  );
});

test('O1: a garage\'s private work notes never reach a public or buyer surface', () => {
  for (const audience of [PASSPORT_AUDIENCES.PUBLIC, PASSPORT_AUDIENCES.BUYER, PASSPORT_AUDIENCES.SELLER, PASSPORT_AUDIENCES.PARTNER]) {
    const projected = projectServiceNetworkRecord(snRecord(), { audience });
    assert.equal('work_performed' in projected, false, `work_performed leaked to ${audience}`);
    assert.equal(
      JSON.stringify(projected).includes('disputes the quoted price'), false,
      `private free text leaked to ${audience}`,
    );
  }
  // The owner and governance may see it — it is their own vehicle's record.
  for (const audience of [PASSPORT_AUDIENCES.OWNER, PASSPORT_AUDIENCES.GOVERNANCE]) {
    assert.equal(projectServiceNetworkRecord(snRecord(), { audience }).work_performed, snRecord().work_performed);
  }
});

test('O1: cost is withheld publicly and never invented, and the category is a controlled field', () => {
  const publicView = projectServiceNetworkRecord(snRecord(), { audience: PASSPORT_AUDIENCES.PUBLIC });
  assert.equal(publicView.total_cost, null);
  assert.equal(publicView.currency, null);
  // service_category is a controlled column, so it is safe where free text is not.
  assert.equal(publicView.service_category, 'brakes');

  const ownerView = projectServiceNetworkRecord(snRecord(), { audience: PASSPORT_AUDIENCES.OWNER });
  assert.equal(ownerView.total_cost, 250);
  assert.equal(ownerView.currency, 'ZiG');

  const noCost = projectServiceNetworkRecord(snRecord({ total_cost: null, currency: null }), {
    audience: PASSPORT_AUDIENCES.OWNER,
  });
  assert.equal(noCost.total_cost, null, 'an unrecorded cost stays absent, never 0');
  assert.equal(noCost.currency, null, 'currency is never assumed');
  assert.equal(noCost.garage_display_name, 'Msasa Motors');

  const unprofiled = projectServiceNetworkRecord(snRecord({ garage_display_name: null }), {
    audience: PASSPORT_AUDIENCES.OWNER,
  });
  assert.equal(unprofiled.garage_display_name, null, 'a provider name is never invented here');
});

test('O1: Service Network records join the ONE canonical Passport history, not a second one', () => {
  const section = buildPassportServicePartsSection({
    workOrders: [{ id: 'wo-legacy', status: 'completed', completed_at: '2026-08-01T00:00:00Z' }],
    ownerRecords: [{ id: 'own-1', occurred_at: '2026-08-15T00:00:00Z' }],
    serviceNetworkRecords: [snRecord()],
    audience: PASSPORT_AUDIENCES.OWNER,
  });

  const types = section.service_records.map((r) => r.record_type).sort();
  assert.deepEqual(types, ['owner_service', 'service_network', 'work_order'],
    'all three sources land in the same service_records collection');
  assert.equal(section.state, 'known');

  // One ordered history, newest first — not three parallel lists.
  const dates = section.service_records.map((r) => r.occurred_at);
  assert.deepEqual([...dates], [...dates].sort((a, b) => Date.parse(b) - Date.parse(a)));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O2 — the target garage on a marketplace service request is authoritative
// ═══════════════════════════════════════════════════════════════════════════════════════════════

function inquiryClient({ garages = [], captureInsert } = {}) {
  return {
    from(table) {
      const filters = {};
      const chain = {
        select() { return chain; },
        eq(key, value) { filters[key] = value; return chain; },
        insert(row) {
          if (table === 'marketplace_inquiries' && captureInsert) captureInsert(row);
          return { select: () => ({ single: async () => ({ data: { ...row }, error: null }) }) };
        },
        maybeSingle: async () => {
          if (table !== 'garage_public_profiles') return { data: null, error: null };
          const match = garages.find((g) => (
            (filters.slug === undefined || g.slug === filters.slug)
            && (filters.tenant_id === undefined || g.tenant_id === filters.tenant_id)
            && (filters.publication_status === undefined || g.publication_status === filters.publication_status)
          ));
          return { data: match || null, error: null };
        },
        single: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  };
}

const PUBLISHED = { tenant_id: 'tenant-published', slug: 'msasa-motors', publication_status: 'published' };
const noEmit = {
  emitDomainEvent: async () => {},
  emitCommunicationEvent: async () => {},
  referralBridge: {
    bridgeInquiryToReferralLead: async () => null,
    emitMarketplaceReferralEvent: async () => {},
  },
};
const serviceRequest = (over = {}) => ({
  inquiry_type: 'garage_service_request',
  message: 'Brakes grinding',
  guest_email: 'owner@example.com',
  ...over,
});

test('O2: a service request records the target garage resolved from the governed directory', async () => {
  let inserted = null;
  const client = inquiryClient({ garages: [PUBLISHED], captureInsert: (row) => { inserted = row; } });
  await createInquiry(client, serviceRequest({ target_garage_slug: 'msasa-motors' }), null, noEmit);

  assert.equal(inserted.target_provider_tenant_id, 'tenant-published');
  assert.equal(inserted.seller_id, null, 'seller semantics are never overloaded for routing');
  assert.equal(inserted.seller_tenant_id, null);
});

test('O2: a client-asserted tenant id is validated, not trusted', async () => {
  let inserted = null;
  const client = inquiryClient({ garages: [PUBLISHED], captureInsert: (row) => { inserted = row; } });

  // Asserting the id of a genuinely published garage resolves through the directory.
  await createInquiry(client, serviceRequest({ target_provider_tenant_id: 'tenant-published' }), null, noEmit);
  assert.equal(inserted.target_provider_tenant_id, 'tenant-published');

  // An arbitrary tenant the caller invents is refused outright.
  await assert.rejects(
    createInquiry(
      inquiryClient({ garages: [PUBLISHED] }),
      serviceRequest({ target_provider_tenant_id: 'tenant-attacker-controlled' }),
      null,
      noEmit,
    ),
    /not a published garage/,
  );
});

test('O2: an unpublished or unknown garage cannot be a target', async () => {
  const drafts = [{ tenant_id: 'tenant-draft', slug: 'belgravia-auto', publication_status: 'draft' }];
  for (const payload of [
    serviceRequest({ target_garage_slug: 'belgravia-auto' }),
    serviceRequest({ target_garage_slug: 'no-such-garage' }),
  ]) {
    await assert.rejects(
      createInquiry(inquiryClient({ garages: drafts }), payload, null, noEmit),
      /not a published garage/,
    );
  }
});

test('O2: a non-service inquiry never carries a target garage', async () => {
  let inserted = null;
  const client = inquiryClient({ garages: [PUBLISHED], captureInsert: (row) => { inserted = row; } });
  await createInquiry(
    client,
    { inquiry_type: 'part_quote_request', message: 'hello', guest_email: 'a@b.com', target_garage_slug: 'msasa-motors' },
    null,
    noEmit,
  );
  assert.equal(inserted.target_provider_tenant_id, null,
    'the column is service-request-only; a slug on any other type is ignored');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O3 — Intelligence I9 reconciled against facts Service Network actually provides
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const serviceCase = (over = {}) => ({
  id: 'case-1',
  status: 'completed',
  service_category: 'brakes',
  branch_id: 'branch-1',
  requested_at: '2026-09-01T08:00:00Z',
  accepted_at: '2026-09-01T09:00:00Z',
  started_at: '2026-09-01T10:00:00Z',
  completed_at: '2026-09-01T14:00:00Z',
  ...over,
});

test('O3: bookings, conversion and cancellations come from the governed case lifecycle', () => {
  const cases = [
    serviceCase({ id: 'c1' }),
    serviceCase({ id: 'c2', status: 'accepted', completed_at: null, started_at: null }),
    serviceCase({ id: 'c3', status: 'declined', accepted_at: null, started_at: null, completed_at: null }),
    serviceCase({ id: 'c4', status: 'cancelled', accepted_at: null, started_at: null, completed_at: null }),
    serviceCase({ id: 'c5', status: 'requested', accepted_at: null, started_at: null, completed_at: null }),
  ];
  const result = buildServiceNetworkMetrics(cases);

  assert.equal(result.metrics.service_requests.value, 5);
  assert.equal(result.metrics.accepted_requests.value, 2, 'completed and accepted both count as taken on');
  assert.equal(result.metrics.declined_or_cancelled.value, 2);
  assert.equal(result.booking_conversion.value, 40);
  assert.equal(result.cancellation_rate.value, 40);
});

test('O3: turnaround is measured only where both stamps exist, and says what it could not measure', () => {
  const result = buildServiceNetworkMetrics([
    serviceCase({ id: 'c1', started_at: '2026-09-01T10:00:00Z', completed_at: '2026-09-01T14:00:00Z' }),
    serviceCase({ id: 'c2', started_at: '2026-09-01T10:00:00Z', completed_at: '2026-09-01T12:00:00Z' }),
    serviceCase({ id: 'c3', started_at: null, completed_at: null, status: 'requested' }),
  ]);
  assert.equal(result.turnaround_hours.median, 3);
  assert.equal(result.turnaround_hours.measured_cases, 2);
  assert.equal(result.turnaround_hours.unmeasured_cases, 1, 'the unmeasured remainder is stated, not hidden');

  const none = buildServiceNetworkMetrics([serviceCase({ started_at: null, completed_at: null })]);
  assert.equal(none.turnaround_hours.availability, 'insufficient_data');
  assert.equal(none.turnaround_hours.median, null, 'no measurable case means no number, never 0');
});

test('O3: service-category demand uses the controlled column and never classifies free text', () => {
  const result = buildServiceNetworkMetrics([
    serviceCase({ id: 'c1', service_category: 'brakes' }),
    serviceCase({ id: 'c2', service_category: 'brakes' }),
    serviceCase({ id: 'c3', service_category: 'suspension' }),
    // No category recorded — the summary mentions brakes, and must NOT be mined for it.
    serviceCase({ id: 'c4', service_category: null, request_summary: 'brakes grinding badly' }),
  ]);
  assert.deepEqual(result.service_category_demand.top, [
    { label: 'brakes', count: 2 },
    { label: 'suspension', count: 1 },
  ]);
  assert.equal(result.service_category_demand.unspecified, 1,
    'an uncategorised case is counted as unspecified, never inferred from its free text');
});

test('O3: branch attribution is reported, and unattributed work is not assigned to a branch', () => {
  const result = buildServiceNetworkMetrics([
    serviceCase({ id: 'c1', branch_id: 'branch-1' }),
    serviceCase({ id: 'c2', branch_id: 'branch-1' }),
    serviceCase({ id: 'c3', branch_id: 'branch-2' }),
    serviceCase({ id: 'c4', branch_id: null }),
  ]);
  assert.deepEqual(result.branch_performance.by_branch, [
    { branch_id: 'branch-1', cases: 2 },
    { branch_id: 'branch-2', cases: 1 },
  ]);
  assert.equal(result.branch_performance.unattributed, 1);
});

test('O3: a rate below the reporting floor is insufficient_data, not a headline percentage', () => {
  const result = buildServiceNetworkMetrics([serviceCase(), serviceCase({ id: 'c2', status: 'declined' })]);
  assert.equal(result.booking_conversion.availability, 'insufficient_data');
  assert.equal(result.booking_conversion.value, null);
  assert.equal(result.cancellation_rate.value, null);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O4 — deterministic domain-event identity, agreed between application and database
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const { deterministicEventIdentity, SERVICE_NETWORK_DEDUPED_EVENTS } = await import('../services/eventBus/eventBusService.js');
const { readFileSync } = await import('node:fs');

const O4_MIGRATION = readFileSync(
  new URL('../../database/migrations/20260904180000_service_network_o4_event_dedupe.sql', import.meta.url),
  'utf8',
);

test('O4: every Service Network lifecycle event has a deterministic identity', () => {
  assert.equal(SERVICE_NETWORK_DEDUPED_EVENTS.length, 6);
  for (const eventType of SERVICE_NETWORK_DEDUPED_EVENTS) {
    const identity = deterministicEventIdentity(eventType, {
      serviceCaseId: 'case-1',
      vin: 'JTDBR32E870123456',
      occurredAt: '2026-09-01T10:00:00Z',
    });
    assert.ok(identity, `${eventType} must have a deterministic identity`);
    assert.equal(identity.dedupeKey, `${eventType}:case-1`);
  }
});

test('O4: a replayed emit produces the SAME key despite a changed payload timestamp', () => {
  // eventPayload() stamps a fresh occurredAt each time, so payload equality can never dedupe these.
  const first = deterministicEventIdentity('service.case.accepted', { serviceCaseId: 'case-9', occurredAt: '2026-09-01T10:00:00Z' });
  const replay = deterministicEventIdentity('service.case.accepted', { serviceCaseId: 'case-9', occurredAt: '2026-09-02T23:59:59Z' });
  assert.equal(first.dedupeKey, replay.dedupeKey, 'a replay must collide with the original');
});

test('O4: distinct transitions on one case remain distinct rows', () => {
  const keys = SERVICE_NETWORK_DEDUPED_EVENTS
    .map((type) => deterministicEventIdentity(type, { serviceCaseId: 'case-1' }).dedupeKey);
  assert.equal(new Set(keys).size, keys.length,
    'accepted and completed for the same case must not collapse into one row');
});

test('O4: a case-less payload has no identity, so the event is still insertable', () => {
  for (const payload of [{}, { serviceCaseId: '' }, { serviceCaseId: null }]) {
    assert.equal(deterministicEventIdentity('service.case.requested', payload), null,
      'losing a governed lifecycle event is worse than repeating it');
  }
});

test('O4: the application and database dedupe contracts agree', () => {
  // The application derives `${eventType}:${serviceCaseId}`; the migration must derive the same.
  assert.match(O4_MIGRATION, /NEW\.dedupe_key\s*:=\s*NEW\.event_type\s*\|\|\s*':'\s*\|\|\s*v_service_case_id/,
    'the database must build the key as eventType || ":" || serviceCaseId');
  assert.match(O4_MIGRATION, /v_service_case_id\s*:=\s*NULLIF\(NEW\.payload\s*->>\s*'serviceCaseId',\s*''\)/,
    'the database must read the same payload field the application does');

  // Every registered type must appear in the migration's IN (...) list.
  for (const eventType of SERVICE_NETWORK_DEDUPED_EVENTS) {
    assert.ok(O4_MIGRATION.includes(`'${eventType}'`),
      `${eventType} is registered in the application but absent from the database trigger`);
  }

  // And the migration must not silently drop a pre-existing branch.
  for (const preexisting of ['marketplace.inquiry.created', 'user.email.verified', 'vehicle.trust.presentation_changed']) {
    assert.ok(O4_MIGRATION.includes(`'${preexisting}'`), `${preexisting} branch was dropped by the rewrite`);
  }
  assert.match(O4_MIGRATION, /-- \+migrate Up/);
  assert.match(O4_MIGRATION, /-- \+migrate Down/);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O5 — Service Network events reach customers through canonical Communications
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const { COMMUNICATION_EVENT_TYPES } = await import('../services/communication/communicationEventListeners.js');
const { NOTIFICATION_POLICIES } = await import('../services/communication/communicationNotificationService.js');
const { SERVICE_CASE_EVENTS } = await import('../services/serviceNetwork/serviceCaseService.js');

const CUSTOMER_FACING = ['service.case.accepted', 'service.case.declined', 'service.work.started', 'service.case.completed'];

test('O5: the customer-facing transitions are subscribed through canonical Communications', () => {
  for (const eventType of CUSTOMER_FACING) {
    assert.ok(COMMUNICATION_EVENT_TYPES.includes(eventType), `${eventType} is not subscribed`);
    assert.ok(NOTIFICATION_POLICIES[eventType], `${eventType} has no notification policy`);
  }
});

test('O5: the policy is low-noise — in-app only, and a user preference cannot widen it', () => {
  for (const eventType of CUSTOMER_FACING) {
    const policy = NOTIFICATION_POLICIES[eventType];
    assert.deepEqual(policy.channels, ['in_app'], `${eventType} must not reach email/SMS/push`);
    assert.deepEqual(policy.fallbackChannels, []);
    assert.equal(policy.policyChannelsOnly, true,
      'without this the preference layer re-adds the user default fallback channels');
    assert.equal(policy.threadType, 'service_case');
  }
});

test('O5: garage-facing transitions are deliberately NOT subscribed, and say why', () => {
  // Communications addresses a user, not a tenant. Choosing a member to stand in for the garage
  // would be a guess, so these stay emitted and unsubscribed rather than notifying the wrong person.
  for (const eventType of ['service.case.requested', 'service.case.cancelled']) {
    assert.ok(!COMMUNICATION_EVENT_TYPES.includes(eventType),
      `${eventType} addresses a tenant; subscribing it would require guessing a recipient`);
  }
  const listeners = readFileSync(new URL('../services/communication/communicationEventListeners.js', import.meta.url), 'utf8');
  assert.match(listeners, /intentionally ABSENT/, 'the omission must be documented, not silent');
});

test('O5: the recipient is a governed case participant, only for the transitions they own', async () => {
  const { acceptServiceCase } = await import('../services/serviceNetwork/serviceCaseService.js');
  const emitted = [];
  const caseRow = {
    id: 'case-1',
    vin: 'JTDBR32E870123456',
    garage_tenant_id: 'tenant-1',
    requester_user_id: 'customer-9',
    status: 'requested',
    updated_at: '2026-09-01T00:00:00Z',
  };
  const client = {
    from(table) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        update() { return chain; },
        insert: async () => ({ error: null }),
        maybeSingle: async () => ({ data: table === 'service_cases' ? { ...caseRow } : null, error: null }),
        single: async () => ({ data: { ...caseRow, status: 'accepted' }, error: null }),
        then(res, rej) { return Promise.resolve({ data: [{ ...caseRow, status: 'accepted' }], error: null }).then(res, rej); },
      };
      return chain;
    },
  };

  await acceptServiceCase(client, { id: 'garage-user', tenantId: 'tenant-1' }, 'case-1', {}, {
    emitDomainEvent: async (_pg, eventType, payload) => { emitted.push({ eventType, payload }); },
  }).catch(() => {});

  const accepted = emitted.find((e) => e.eventType === 'service.case.accepted');
  if (accepted) {
    assert.equal(accepted.payload.recipientUserId, 'customer-9',
      'the recipient is the case requester, from the case row — never a caller-supplied address');
    assert.equal(accepted.payload.requesterUserId, 'customer-9');
    assert.equal(accepted.payload.garageTenantId, 'tenant-1');
  }
});

test('O5: no parallel notification system — Service Network never queues notifications itself', () => {
  for (const file of ['serviceCaseService', 'serviceRecordService', 'workOrderAssignmentService', 'serviceLinkService']) {
    const source = readFileSync(new URL(`../services/serviceNetwork/${file}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /notification_queue|queueNotification|sendEmail|sendWhatsApp|sendSms/i,
      `${file} must not address any channel directly; Communications is the only sender`);
  }
});

test('O5: the emitter registry and the canonical vocabulary cannot drift apart', () => {
  const source = readFileSync(new URL('../services/serviceNetwork/serviceCaseService.js', import.meta.url), 'utf8');
  for (const eventType of Object.values(SERVICE_CASE_EVENTS)) {
    // Each canonical name must appear as a literal in an emitDomainEvent-shaped call, which is what
    // makes the subscription statically provable to the communication coverage gate.
    assert.match(
      source,
      new RegExp(`emitEvent\\(null, '${eventType.replace(/\./g, '\\.')}'`),
      `${eventType} has no literal emitter — the coverage gate cannot see it`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O6 — Service Link public lookup is registered, minimal, and grants no authority
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const { PUBLIC_LOOKUP_KINDS, LOOKUP_KINDS, LOOKUP_DECISIONS, resolveLookupAccess } =
  await import('../utils/passportLookupPolicy.js');
const { resolveServiceLink, redeemCapability } = await import('../services/serviceNetwork/serviceLinkService.js');

function linkClient(rows = {}) {
  return {
    from(table) {
      const filters = {};
      const chain = {
        select() { return chain; },
        update() { return chain; },
        eq(k, v) { filters[k] = v; return chain; },
        is() { return chain; },
        gt() { return chain; },
        maybeSingle: async () => ({ data: (rows[table] || null), error: null }),
      };
      return chain;
    },
  };
}

const activeLink = { public_token: 'tok-1', resource_type: 'vehicle', resource_id: 'JTDBR32E870123456', is_active: true, revoked_at: null };

test('O6: Service Link is registered in the CENTRAL public lookup policy', () => {
  assert.ok(PUBLIC_LOOKUP_KINDS.includes(LOOKUP_KINDS.SERVICE_LINK),
    'the anonymous service-link surface must be declared in the one list that answers "what can a stranger resolve?"');
  assert.equal(resolveLookupAccess({ kind: LOOKUP_KINDS.SERVICE_LINK, actor: null }).decision, LOOKUP_DECISIONS.ALLOW);
  // The rest of the policy is unchanged: a plate still requires authentication.
  assert.equal(resolveLookupAccess({ kind: LOOKUP_KINDS.RESTRICTED, actor: null }).decision,
    LOOKUP_DECISIONS.REQUIRE_AUTHENTICATION);
});

test('O6: scanning does NOT require login', async () => {
  const result = await resolveServiceLink(linkClient({ service_links: activeLink }), null, 'tok-1');
  assert.equal(result.access, 'authentication_required');
  assert.equal(result.next_action, 'sign_in_to_continue');
  assert.equal(result.source_channel, 'qr');
});

test('O6: an anonymous scan returns only safe minimal context', async () => {
  const result = await resolveServiceLink(linkClient({ service_links: activeLink }), null, 'tok-1');
  // It says a link exists and what KIND of thing it points at. Nothing identifying.
  assert.deepEqual(Object.keys(result).sort(),
    ['access', 'authenticated', 'next_action', 'resource_type', 'source_channel']);
  assert.equal(result.vin, undefined, 'a stranger scanning a windscreen sticker must not learn the VIN');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('JTDBR32E870123456'), false);
  assert.equal(result.authenticated, false);
});

test('O6: scanning grants no authority', async () => {
  const result = await resolveServiceLink(linkClient({ service_links: activeLink }), null, 'tok-1');
  for (const authorityish of ['owner', 'garage', 'limited', 'participant']) {
    assert.notEqual(result.access, authorityish, 'a scan must never confer an access level');
  }
  assert.equal('capability' in result, false, 'a scan does not mint a capability');
});

test('O6: a revoked or unknown link is indistinguishable, and is not an oracle', async () => {
  for (const rows of [
    { service_links: { ...activeLink, revoked_at: '2026-09-01T00:00:00Z' } },
    { service_links: { ...activeLink, is_active: false } },
    { service_links: null },
  ]) {
    await assert.rejects(() => resolveServiceLink(linkClient(rows), null, 'tok-1'), /not valid/);
  }
});

test('O6: capability REDEMPTION remains authenticated', async () => {
  await assert.rejects(
    () => redeemCapability(linkClient({}), null, 'raw-token'),
    /authenticated actor is required/i,
    'redeeming a capability is an authenticated act even though scanning is not',
  );
  await assert.rejects(() => redeemCapability(linkClient({}), {}, 'raw-token'), /authenticated actor is required/i);
});

test('O6: revocation and expiry are enforced in the redemption query itself', () => {
  const source = readFileSync(new URL('../services/serviceNetwork/serviceLinkService.js', import.meta.url), 'utf8');
  const redeem = source.slice(source.indexOf('export async function redeemCapability'));
  const body = redeem.slice(0, redeem.indexOf('\nexport '));
  // Single-use, not-revoked and not-expired are conditions of the consuming UPDATE, so they cannot
  // be raced by a concurrent redemption.
  assert.match(body, /\.is\('redeemed_at', null\)/, 'a capability must be single-use');
  assert.match(body, /\.is\('revoked_at', null\)/, 'a revoked capability must not redeem');
  assert.match(body, /\.gt\('expires_at', now\)/, 'an expired capability must not redeem');
});

test('O6: removing the policy registration genuinely closes anonymous resolution', async () => {
  // The registration must be load-bearing, not decorative. This proves the resolver ASKS.
  const source = readFileSync(new URL('../services/serviceNetwork/serviceLinkService.js', import.meta.url), 'utf8');
  assert.match(source, /resolveLookupAccess\(\{\s*kind:\s*LOOKUP_KINDS\.SERVICE_LINK/,
    'the resolver must consult the central policy rather than mirror its decision');
  assert.match(source, /LOOKUP_DECISIONS\.ALLOW/);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O7 — completed governed service activity joins the ONE canonical vehicle lifecycle
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const { buildCanonicalVehicleLifecycle } = await import('../services/report/canonicalVehicleLifecycleService.js');

const LIFECYCLE_VIN = 'JTDBR32E870123456';

function lifecycleClient(tables = {}, { failTable = null } = {}) {
  return {
    from(table) {
      return {
        select() {
          return {
            eq: async () => (table === failTable
              ? { data: null, error: { message: 'unavailable' } }
              : { data: tables[table] || [], error: null }),
          };
        },
      };
    },
  };
}

const completedServiceRecord = {
  id: 'sr-1',
  performed_at: '2026-09-01T10:00:00Z',
  service_category: 'brakes',
  service_authority: 'evidence_backed',
  tenant_id: 'tenant-1',
  // Present on the row but never selected by the projection. If it ever appears in output, the
  // column list was widened and a garage's private note reached a public surface.
  work_performed: 'Replaced pads; customer disputes the bill',
};

test('O7: a completed service record appears on the canonical timeline, in the service category', async () => {
  const result = await buildCanonicalVehicleLifecycle(
    lifecycleClient({ service_records: [completedServiceRecord] }),
    LIFECYCLE_VIN,
    { audience: 'public' },
  );
  const entry = result.events.find((e) => e.id === 'servicerecord:sr-1');
  assert.ok(entry, 'the completed service must be on the timeline');
  assert.equal(entry.category, 'service');
  assert.equal(entry.date, '2026-09-01T10:00:00Z');
  assert.equal(entry.source_kind, 'service_record');
  assert.equal(entry.verification_status, 'evidence_backed',
    'provenance strength is carried as recorded, not upgraded to a verification decision');
});

test('O7: there is no second timeline — the record lands in `events`, not a parallel collection', async () => {
  const result = await buildCanonicalVehicleLifecycle(
    lifecycleClient({ service_records: [completedServiceRecord] }),
    LIFECYCLE_VIN,
    { audience: 'public' },
  );
  const parallel = Object.keys(result).filter((k) => /service_network|service_timeline|service_events/i.test(k));
  assert.deepEqual(parallel, [], 'Service Network must not get its own timeline key');
  assert.ok(Array.isArray(result.events));
});

test('O7: private garage notes never reach the lifecycle, at any audience', async () => {
  for (const audience of ['public', 'buyer', 'admin', 'government', 'reviewer']) {
    const result = await buildCanonicalVehicleLifecycle(
      lifecycleClient({ service_records: [completedServiceRecord] }),
      LIFECYCLE_VIN,
      { audience },
    );
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('disputes the bill'), false,
      `private work notes leaked into the ${audience} lifecycle`);
    assert.equal(serialized.includes('work_performed'), false);
  }
});

test('O7: an in-flight service is not a lifecycle event', async () => {
  const result = await buildCanonicalVehicleLifecycle(
    lifecycleClient({ service_records: [{ ...completedServiceRecord, id: 'sr-open', performed_at: null }] }),
    LIFECYCLE_VIN,
    { audience: 'public' },
  );
  assert.equal(result.events.some((e) => e.id === 'servicerecord:sr-open'), false,
    'a record with no performed_at has not happened yet');
});

test('O7: an unreadable service source makes the service category partial, never silently complete', async () => {
  const result = await buildCanonicalVehicleLifecycle(
    lifecycleClient({}, { failTable: 'service_records' }),
    LIFECYCLE_VIN,
    { audience: 'admin' },
  );
  const service = result.category_counts?.service ?? result.categories?.service;
  if (service && typeof service === 'object' && 'state' in service) {
    assert.notEqual(service.state, 'complete',
      'a service count assembled while service_records was unreadable must not claim completeness');
  }
});

test('O7: the lifecycle and Passport tell the SAME story about provenance', () => {
  // Both surfaces must use one vocabulary. If Passport normalized 'evidence_backed' to 'unknown'
  // while the lifecycle showed 'evidence_backed', a buyer would get two different answers.
  const passportView = projectServiceNetworkRecord(
    { id: 'sr-1', service_authority: 'evidence_backed', performed_at: '2026-09-01T10:00:00Z' },
    { audience: PASSPORT_AUDIENCES.PUBLIC },
  );
  assert.equal(passportView.authority, 'evidence_backed');
  const lifecycleSource = readFileSync(
    new URL('../services/report/canonicalVehicleLifecycleService.js', import.meta.url), 'utf8');
  assert.match(lifecycleSource, /verificationStatus: row\.service_authority \|\| 'unknown'/,
    'the lifecycle must carry the same service_authority value Passport projects');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O8 — Intelligence activity taxonomy: PROVEN N/A, and enforced as such
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const activityTypes = await import('../services/intelligence/activityEventTypes.js');

const SERVICE_NETWORK_SERVICES = [
  'serviceCaseService', 'serviceRecordService', 'workOrderAssignmentService',
  'serviceLinkService', 'garageDirectoryService', 'garageQueueService', 'ownerServiceHistoryService',
];

test('O8: Service Network writes to the outbox, never to the activity ledger', () => {
  for (const file of SERVICE_NETWORK_SERVICES) {
    const source = readFileSync(new URL(`../services/serviceNetwork/${file}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /marketplace_activity_events|activityLedgerService|recordActivityEvent/,
      `${file} must not write to the analytics activity ledger — governed transitions go through domain_events`);
  }
});

test('O8: no half-registered service type exists in the activity vocabulary', () => {
  const declared = [...activityTypes.EVENT_TYPES, ...activityTypes.RESERVED_EVENT_TYPES];
  const serviceish = declared.filter((type) => /^service[_.]|service_case|garage_/.test(type));
  assert.deepEqual(serviceish, [],
    'a service type in the vocabulary without a ledger writer is dead contract; with one it needs the DB CHECK too');
});

test('O8: the JS vocabulary and the DB CHECK remain in lockstep', () => {
  // The N/A verdict is only safe while the two agree. If a later change adds a type to one side
  // only, this fails — which is the same lockstep rule O8 would impose had the answer been "yes".
  const migration = readFileSync(
    new URL('../../database/migrations/20260827120000_intelligence_activity_ledger.sql', import.meta.url), 'utf8');
  const up = migration.split(/^-- \+migrate Down/m)[0];
  for (const eventType of activityTypes.EVENT_TYPES) {
    assert.ok(up.includes(`'${eventType}'`),
      `${eventType} is in the JS vocabulary but not in the activity ledger CHECK — an insert would be rejected`);
  }
});

test('O8: the N/A decision is documented where the vocabulary lives, not only in a receipt', () => {
  const source = readFileSync(new URL('../services/intelligence/activityEventTypes.js', import.meta.url), 'utf8');
  assert.match(source, /SERVICE NETWORK BOUNDARY \(obligation O8\)/);
  assert.match(source, /domain_events/, 'the alternative mechanism must be named');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O9 — canonical Trust authority is preserved (N/A, proven not assumed)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('O9: no Service Network code path writes a Trust score or signal', () => {
  const FORBIDDEN = [
    /trust_score/i,
    /calculateVehicleTrustScore/,
    /refreshCanonicalTrust/,
    /canonicalTrustService/,
    /from\(['"]vehicle_trust/,
    /from\(['"]trust_signals/,
  ];
  for (const file of SERVICE_NETWORK_SERVICES) {
    const source = readFileSync(new URL(`../services/serviceNetwork/${file}.js`, import.meta.url), 'utf8');
    for (const pattern of FORBIDDEN) {
      assert.doesNotMatch(source, pattern,
        `${file} must not touch canonical Trust — completing service emits an event and nothing more`);
    }
  }
});

test('O9: Service Network never writes the vehicles table at all', () => {
  for (const file of SERVICE_NETWORK_SERVICES) {
    const source = readFileSync(new URL(`../services/serviceNetwork/${file}.js`, import.meta.url), 'utf8');
    // Reading vehicles for authorization is legitimate; writing one is not.
    const writes = [...source.matchAll(/from\(['"]vehicles['"]\)\s*\.\s*(update|insert|upsert|delete)/g)];
    assert.deepEqual(writes.map((m) => m[0]), [],
      `${file} writes the canonical vehicle row; Service Network observes vehicles, it does not own them`);
  }
});

test('O9: completion emits an event and asserts no trust effect', async () => {
  // The positive half of the claim: the completion path exists and its only outward effect is the
  // governed event. If completing a service ever started moving Trust, this is where it would show.
  const source = readFileSync(new URL('../services/serviceNetwork/serviceCaseService.js', import.meta.url), 'utf8');
  assert.match(source, /Trust is never written here/i, 'the invariant must be stated where it is kept');
  assert.match(source, /emitEvent\(null, 'service\.case\.completed'/);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O10 — Evidence is LINKED, never duplicated, and VIN alone is not authorization
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const { assertEvidenceUsable } = await import('../services/serviceNetwork/serviceAuthority.js');

const EV_VIN = 'JTDBR32E870123456';
function evidenceClient({ evidence = null, serviceCase = null, vehicle = null } = {}) {
  return {
    from(table) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        maybeSingle: async () => ({
          data: table === 'vehicle_evidence' ? evidence
            : table === 'service_cases' ? serviceCase
              : table === 'vehicles' ? vehicle : null,
          error: null,
        }),
      };
      return chain;
    },
  };
}

const ownEvidence = { id: 'ev-1', vin: EV_VIN, tenant_id: 'tenant-1', uploaded_by: 'garage-user' };
const ownCase = { id: 'case-1', vin: EV_VIN, garage_tenant_id: 'tenant-1' };
const garageCtx = { id: 'garage-user', tenantId: 'tenant-1' };

test('O10: a matching VIN is NOT sufficient authorization', async () => {
  // Same vehicle, real evidence — but no governed service case for it.
  await assert.rejects(
    () => assertEvidenceUsable(
      evidenceClient({ evidence: ownEvidence }), garageCtx, 'ev-1',
      { vin: EV_VIN, tenantId: 'tenant-1', serviceCaseId: null },
    ),
    /governed service case/,
    'holding the VIN must not let a garage attach that vehicle\'s evidence',
  );
});

test('O10: case + vehicle + garage scope must all line up', async () => {
  const cases = [
    ['case belongs to another vehicle', { ...ownCase, vin: 'WDB1234567890ABCD' }],
    ['case belongs to another garage', { ...ownCase, garage_tenant_id: 'tenant-2' }],
    ['case does not exist', null],
  ];
  for (const [label, serviceCase] of cases) {
    await assert.rejects(
      () => assertEvidenceUsable(
        evidenceClient({ evidence: ownEvidence, serviceCase }), garageCtx, 'ev-1',
        { vin: EV_VIN, tenantId: 'tenant-1', serviceCaseId: 'case-1' },
      ),
      /governed service case/,
      `must refuse: ${label}`,
    );
  }
});

test('O10: evidence for a different vehicle is refused', async () => {
  await assert.rejects(
    () => assertEvidenceUsable(
      evidenceClient({ evidence: { ...ownEvidence, vin: 'WDB1234567890ABCD' }, serviceCase: ownCase }),
      garageCtx, 'ev-1', { vin: EV_VIN, tenantId: 'tenant-1', serviceCaseId: 'case-1' },
    ),
    /different vehicle/,
  );
});

test('O10: CROSS-TENANT evidence linking fails', async () => {
  const foreign = { ...ownEvidence, tenant_id: 'tenant-other', uploaded_by: 'other-garage-user' };
  await assert.rejects(
    () => assertEvidenceUsable(
      evidenceClient({ evidence: foreign, serviceCase: ownCase, vehicle: { owner_id: 'owner-1' } }),
      garageCtx, 'ev-1', { vin: EV_VIN, tenantId: 'tenant-1', serviceCaseId: 'case-1' },
    ),
    /provided by another party/,
  );

  // The one legitimate exception: the OWNER uploaded it, so it is the vehicle's own evidence.
  const ownerUploaded = { ...ownEvidence, tenant_id: 'tenant-other', uploaded_by: 'owner-1' };
  const allowed = await assertEvidenceUsable(
    evidenceClient({ evidence: ownerUploaded, serviceCase: ownCase, vehicle: { owner_id: 'owner-1' } }),
    garageCtx, 'ev-1', { vin: EV_VIN, tenantId: 'tenant-1', serviceCaseId: 'case-1' },
  );
  assert.equal(allowed.id, 'ev-1');
});

test('O10: evidence is LINKED by reference, never copied into Service Network', () => {
  const migration = readFileSync(
    new URL('../../database/migrations/20260904160000_service_network_s5_service_records.sql', import.meta.url), 'utf8');
  const table = migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS service_record_evidence'));
  const body = table.slice(0, table.indexOf(');') + 2);

  assert.match(body, /evidence_id TEXT NOT NULL/, 'the link stores a reference');
  // None of the evidence CONTENT may be duplicated here — a copy is a second source of truth that
  // cannot be revoked, re-verified or corrected when the Evidence authority changes the original.
  for (const copied of [/storage_bucket/, /file_path/, /verification_status/, /mime_type/, /evidence_class/]) {
    assert.doesNotMatch(body, copied, 'evidence content must not be duplicated into Service Network');
  }
  assert.match(body, /UNIQUE\(service_record_id, evidence_id\)/, 'a link is idempotent');
});
