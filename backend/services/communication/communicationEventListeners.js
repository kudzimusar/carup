import { createCommunicationServices } from './communicationServiceFactory.js';

const COMMUNICATION_EVENT_TYPES = [
  'marketplace.inquiry.created',
  'ESCROW_CREATED',
  'ESCROW_UPDATED',
  'finance.application.status_changed',
  'finance.application_received',
  'finance.application.approved',
  'finance.application.declined',
  'referral.code_validated',
  'referral.coupon_applied',
  'referral.wallet_status_changed',
  'campaign.status_changed',
  'referral.review_required',
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
