import { createCommunicationServices } from './communicationServiceFactory.js';

// Every type listed here MUST have a real emitter (a literal in an
// emitDomainEvent/publishMemoryEvent call under backend/services or
// backend/routes) — enforced by backend/tests/communication-event-coverage.test.js.
export const COMMUNICATION_EVENT_TYPES = [
  'marketplace.inquiry.created',
  'marketplace.listing.moderated',
  // ESCROW_CREATED / ESCROW_UPDATED are intentionally ABSENT. Issue #164 Phase 6 retired the legacy
  // SafePay transaction authority (services/safepay/escrowService.js is now a throwing shim), which
  // was the only emitter of those two event types. Subscribing to them again would be dead code, and
  // re-adding an emitter would resurrect the pre-Phase-6 writer that treated a payment transition as
  // legal ownership proof. Canonical escrow/settlement truth lives in services/transaction/* and
  // services/escrow/escrowTrustService.js; when that authority grows a governed customer-facing
  // notification it must be subscribed here under its own canonical event name.
  // NOTIFICATION_POLICIES still carries ESCROW_* so historical queued rows keep resolving a policy.
  'finance.application.status_changed',
  'finance.application.approved',
  'finance.application.declined',
  'identity.verification.decided',
  'evidence.review.decided',
  // Operations M2 — governed Seller Authority decisions reach the seller.
  'seller.authority.decided',
  // O2-X6 — semantic O2 events (domains emit; Communications owns delivery).
  'identity.lifecycle.changed',
  'dealer.compliance.decided',
  'dealer.compliance.evidence_required',
  'seller.authority.superseded',
  'workbook.import.completed',
  // R4 — the marketplace transaction stages. Emitted by `issue164_transition_session_atomic` into
  // `domain_events` since Issue #164 Phase 6, and never subscribed until now: the transitions
  // happened and the customer was never told. These are the CURRENT canonical authority's events,
  // not the retired SafePay ones above.
  'MARKETPLACE_PAYMENT_INITIATED',
  'MARKETPLACE_INSPECTION_PENDING',
  'MARKETPLACE_RELEASE_APPROVED',
  'MARKETPLACE_TRANSACTION_DISPUTED',
  'MARKETPLACE_TRANSACTION_CANCELLED',
  // The provider-confirmed outcomes, from `issue164_record_payment_state_atomic`.
  'MARKETPLACE_FUNDS_HELD',
  'MARKETPLACE_TRANSACTION_SETTLED',
  'MARKETPLACE_TRANSACTION_REFUNDED',
  'MARKETPLACE_TRANSACTION_FAILED',
  'MARKETPLACE_PAYMENT_FAILED',
  // R5 — the canonical Trust presentation change.
  'vehicle.trust.presentation_changed',
  // Passport ownership lifecycle. These are emitted inside the same database
  // transactions that mutate the transfer state; Communications is only a consumer.
  'vehicle.ownership.transfer_started',
  'vehicle.ownership.transfer_action_required',
  'vehicle.ownership.transfer_state_changed',
  'vehicle.ownership.transfer_completed',
  // R1 — the durable post-verification work item. The Leadership Welcome used to be produced
  // inline in the verification route and its failure swallowed, which permanently lost the welcome
  // for that account because the verification token is single-use and already consumed.
  'user.email.verified',
  // Service Network O5 — the garage-side decisions the CUSTOMER is waiting on. Each is a governed
  // transition on a case the recipient opened, addressed to `requester_user_id`, delivered through
  // this canonical pipeline rather than any Service-Network-specific channel.
  //
  // 'service.case.requested' and 'service.case.cancelled' are intentionally ABSENT. Their audience
  // is the garage tenant, and Communications addresses a user rather than a tenant; picking a
  // member to stand in for the organization would be a guess. They stay emitted and unsubscribed
  // until a governed tenant-recipient model exists — the same discipline the ESCROW_* note above
  // records, and the reason this list is a deliberate registry rather than a wildcard.
  'service.case.accepted',
  'service.case.declined',
  'service.work.started',
  'service.case.completed',
];

let registered = false;
let migrationWarningLogged = false;

function isCommunicationSchemaMissing(error = {}) {
  return /message_threads|notification_queue|messages|webhook_logs/i.test(String(error.message || ''))
    && /schema cache|could not find the table|does not exist/i.test(String(error.message || ''));
}

export function registerCommunicationListeners(eventWorker, services = createCommunicationServices()) {
  if (registered || !eventWorker?.subscribe) return;
  registered = true;
  for (const eventType of COMMUNICATION_EVENT_TYPES) {
    eventWorker.subscribe(eventType, async (payload, pgClient, tenantId, outboxEvent) => {
      try {
        // Forward the RAW outbox record (4th handler arg — see eventWorker.processEvent):
        // the notification layer reads event.id into notification_queue.event_id and uses it
        // as the per-event dedupe discriminator. Dropping it orphaned event_id (always NULL)
        // and collapsed dedupe keys to per-user/per-type, swallowing repeat events.
        await services.orchestrator.handleDomainEvent({
          ...(outboxEvent || {}),
          event_type: eventType,
          payload,
        }, pgClient, tenantId);
      } catch (error) {
        if (isCommunicationSchemaMissing(error) && process.env.COMMUNICATION_ENGINE_ENABLED !== 'true') {
          if (!migrationWarningLogged) {
            migrationWarningLogged = true;
            console.warn('[Communication] Agent 8 schema is not applied; skipping communication event listeners until COMMUNICATION_ENGINE_ENABLED=true after migration.');
          }
          return;
        }
        throw error;
      }
    });
  }
}
