import { createCommunicationServices } from './communicationServiceFactory.js';

// Every type listed here MUST have a real emitter (a literal in an
// emitDomainEvent/publishMemoryEvent call under backend/services or
// backend/routes) — enforced by backend/tests/communication-event-coverage.test.js.
export const COMMUNICATION_EVENT_TYPES = [
  'marketplace.inquiry.created',
  'marketplace.listing.moderated',
  'ESCROW_CREATED',
  'ESCROW_UPDATED',
  'finance.application.status_changed',
  'finance.application.approved',
  'finance.application.declined',
  'identity.verification.decided',
  'evidence.review.decided',
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
    eventWorker.subscribe(eventType, async (payload, pgClient, tenantId) => {
      try {
        await services.orchestrator.handleDomainEvent({ event_type: eventType, payload }, pgClient, tenantId);
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
