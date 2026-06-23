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

export function registerCommunicationListeners(eventWorker, services = createCommunicationServices()) {
  if (registered || !eventWorker?.subscribe) return;
  registered = true;
  for (const eventType of COMMUNICATION_EVENT_TYPES) {
    eventWorker.subscribe(eventType, async (payload, pgClient, tenantId) => {
      await services.orchestrator.handleDomainEvent({ event_type: eventType, payload }, pgClient, tenantId);
    });
  }
}

