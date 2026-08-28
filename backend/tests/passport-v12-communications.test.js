import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PASSPORT_COMMUNICATION_CLASSES,
  assertPassportCommunicationIntent,
  buildPassportCommunicationIntent,
} from '../services/passport/passportCommunicationIntent.js';

test('V12: canonical lifecycle communication classes are explicit', () => {
  assert.deepEqual(PASSPORT_COMMUNICATION_CLASSES, [
    'evidence_review',
    'discrepancy',
    'trust_material_change',
    'service_maintenance',
    'compliance_due',
    'ownership_transfer',
    'marketplace_transaction',
    'safety_recall',
  ]);
});

test('V12: Passport creates a domain-event intent but selects no transport', () => {
  const intent = buildPassportCommunicationIntent({
    lifecycle_class: 'ownership_transfer',
    domain_event_type: 'vehicle.ownership.transfer_action_required',
    domain_event_id: 'event-1',
    recipient_user_id: 'user-1',
    vin: 'VIN-1',
    safe_payload: {
      transfer_state: 'evidence_required',
    },
  });

  assert.equal(intent.event.event_type, 'vehicle.ownership.transfer_action_required');
  assert.equal(intent.event.payload.recipientUserId, 'user-1');
  assert.equal(intent.routing_authority, 'communications');
  assert.equal(intent.provider_selected, false);
  assert.equal(intent.channel_selected, false);
  assert.equal(intent.template_selected, false);
});

test('V12: deterministic dedupe identity is required when no persisted event id exists', () => {
  assert.throws(
    () => buildPassportCommunicationIntent({
      lifecycle_class: 'evidence_review',
      domain_event_type: 'evidence.review.required',
      recipient_user_id: 'user-1',
      vin: 'VIN-1',
    }),
    /domain_event_id or deterministic dedupe_key/i,
  );

  const intent = buildPassportCommunicationIntent({
    lifecycle_class: 'evidence_review',
    domain_event_type: 'evidence.review.required',
    dedupe_key: 'evidence.review.required:review-1',
    recipient_user_id: 'user-1',
    vin: 'VIN-1',
  });
  assert.equal(intent.event.dedupe_key, 'evidence.review.required:review-1');
});

test('V12: Passport cannot smuggle provider/channel/template choices into safe payload', () => {
  for (const payload of [
    { channel: 'email' },
    { provider: 'resend' },
    { phone_number: 'recipient-address' },
    { template_key: 'passport-template' },
  ]) {
    assert.throws(
      () => buildPassportCommunicationIntent({
        lifecycle_class: 'trust_material_change',
        domain_event_type: 'vehicle.trust.presentation_changed',
        domain_event_id: 'event-2',
        recipient_user_id: 'user-1',
        vin: 'VIN-1',
        safe_payload: payload,
      }),
      /cannot own transport field/i,
    );
  }
});

test('V12: recipient identity is a CarUp account reference, not a transport address', () => {
  const intent = buildPassportCommunicationIntent({
    lifecycle_class: 'service_maintenance',
    domain_event_type: 'vehicle.service.action_required',
    domain_event_id: 'event-3',
    recipient_user_id: 'user-1',
    vin: 'VIN-1',
  });

  assert.equal(intent.event.payload.recipientUserId, 'user-1');
  assert.equal(intent.event.payload.email, undefined);
  assert.equal(intent.event.payload.phone_number, undefined);
});

test('V12: validator rejects any later attempt to claim routing authority', () => {
  const intent = buildPassportCommunicationIntent({
    lifecycle_class: 'discrepancy',
    domain_event_type: 'vehicle.discrepancy.action_required',
    domain_event_id: 'event-4',
    recipient_user_id: 'user-1',
    vin: 'VIN-1',
  });

  intent.channel_selected = true;
  assert.throws(
    () => assertPassportCommunicationIntent(intent),
    /must not preselect provider\/channel\/template/i,
  );
});

test('V12 anti-fork: Passport communication intent owns no event persistence or provider adapter', () => {
  const src = readFileSync('backend/services/passport/passportCommunicationIntent.js', 'utf8');
  assert.doesNotMatch(src, /emitDomainEvent|publishMemoryEvent|queueNotification|handleDomainEvent/);
  assert.doesNotMatch(
    src,
    /from\s+['"][^'"]*(?:providerAdapters|communicationCanonicalNotificationService|communicationOrchestratorService|communicationDeliveryWorker)[^'"]*['"]/i,
  );
  assert.doesNotMatch(src, /\.from\s*\(|\.insert\s*\(|\.update\s*\(|supabase/i);
});
