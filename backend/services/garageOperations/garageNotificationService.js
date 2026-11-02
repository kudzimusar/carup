import { emitDomainEvent } from '../eventBus/eventBusService.js';

/**
 * GARAGE-1.0 — customer-facing Garage lifecycle events, through the EXISTING Communications authority.
 *
 * This module sends nothing and queues nothing. It only states, in the shape Communications already
 * reads (`domain_events` outbox -> policy -> governed template -> in-app queue), that something
 * happened that the person the work is for should hear about. The recipient is always a governed
 * participant of the case — the vehicle's registered owner and/or the person who asked — never an
 * address a caller supplied and never "somebody at the garage".
 *
 * Emission is best-effort by design (the Service Network rule, plan §15.5): a notification failure must
 * never undo an authoritative estimate, invoice, payment or appointment. The outcome is returned so a
 * caller and a test can see exactly what was and was not emitted — there is no silent "sent".
 *
 * Copy is a fixed, bounded headline: no amount, no price, no private note, no promise.
 */

export const GARAGE_NOTIFICATION_EVENTS = Object.freeze({
  estimateSent: 'garage.estimate.sent',
  invoiceIssued: 'garage.invoice.issued',
  paymentRecorded: 'garage.payment.recorded',
  appointmentConfirmed: 'garage.appointment.confirmed',
  appointmentRescheduled: 'garage.appointment.rescheduled',
  appointmentDeclined: 'garage.appointment.declined',
  appointmentCancelled: 'garage.appointment.cancelled',
});

const HEADLINES = Object.freeze({
  'garage.estimate.sent': 'The garage sent you an estimate to review',
  'garage.invoice.issued': 'The garage issued an invoice for your service',
  'garage.payment.recorded': 'The garage recorded a payment on your invoice',
  'garage.appointment.confirmed': 'Your appointment was confirmed',
  'garage.appointment.rescheduled': 'Your appointment time was changed',
  'garage.appointment.declined': 'The garage could not offer that appointment',
  'garage.appointment.cancelled': 'The garage cancelled your appointment',
});

/**
 * One named emitter per event, each naming its event as a LITERAL: communication-event-coverage.test.js
 * is a static gate that refuses to believe a subscription is real unless it can SEE an emitter for it.
 */
const EMITTERS = Object.freeze({
  'garage.estimate.sent': (emitEvent, payload, tenantId) => emitEvent(null, 'garage.estimate.sent', payload, tenantId),
  'garage.invoice.issued': (emitEvent, payload, tenantId) => emitEvent(null, 'garage.invoice.issued', payload, tenantId),
  'garage.payment.recorded': (emitEvent, payload, tenantId) => emitEvent(null, 'garage.payment.recorded', payload, tenantId),
  'garage.appointment.confirmed': (emitEvent, payload, tenantId) => emitEvent(null, 'garage.appointment.confirmed', payload, tenantId),
  'garage.appointment.rescheduled': (emitEvent, payload, tenantId) => emitEvent(null, 'garage.appointment.rescheduled', payload, tenantId),
  'garage.appointment.declined': (emitEvent, payload, tenantId) => emitEvent(null, 'garage.appointment.declined', payload, tenantId),
  'garage.appointment.cancelled': (emitEvent, payload, tenantId) => emitEvent(null, 'garage.appointment.cancelled', payload, tenantId),
});

/** The people the work is for: the registered owner of the vehicle and the person who asked. */
export async function caseAudience(client, serviceCase) {
  const recipients = new Set();
  if (serviceCase.requester_user_id) recipients.add(serviceCase.requester_user_id);
  try {
    const { data } = await client.from('vehicles').select('owner_id').eq('vin', serviceCase.vin).maybeSingle();
    if (data?.owner_id) recipients.add(data.owner_id);
  } catch {
    // an unreadable owner must not stop the requester being told
  }
  return [...recipients];
}

/**
 * @param {object} client supabase client (to resolve the audience)
 * @param {object} args
 * @param {string} args.eventType one of GARAGE_NOTIFICATION_EVENTS
 * @param {object} args.serviceCase { id, vin, garage_tenant_id, requester_user_id }
 * @param {{ field: string, id: string }} args.entity the thing it is about (estimateId / invoiceId / paymentId / appointmentId)
 * @param {string[]} [args.recipients] override (e.g. appointment events go to the requester only)
 * @returns {Promise<{ attempted: number, emitted: number, failures: string[] }>}
 */
export async function notifyCaseAudience(client, { eventType, serviceCase, entity, recipients = null }, deps = {}) {
  const emitter = EMITTERS[eventType];
  if (!emitter) return { attempted: 0, emitted: 0, failures: [`unregistered garage event: ${eventType}`] };
  const persist = deps.emitDomainEvent || emitDomainEvent;
  const audience = recipients || await caseAudience(client, serviceCase);
  let emitted = 0;
  const failures = [];
  for (const recipient of audience) {
    const payload = {
      serviceCaseId: serviceCase.id,
      vin: serviceCase.vin,
      garageTenantId: serviceCase.garage_tenant_id,
      [entity.field]: entity.id,
      headline: HEADLINES[eventType],
      // Communications reads this field to address the notification
      recipientUserId: recipient,
      notificationKey: `${entity.id}:${recipient}`,
      occurredAt: new Date().toISOString(),
    };
    try {
      await emitter(persist, payload, serviceCase.garage_tenant_id);
      emitted += 1;
    } catch (error) {
      failures.push(error?.message || 'emit failed');
    }
  }
  return { attempted: audience.length, emitted, failures };
}

export default { GARAGE_NOTIFICATION_EVENTS, notifyCaseAudience, caseAudience };
