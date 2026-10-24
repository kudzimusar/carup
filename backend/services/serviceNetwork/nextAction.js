/**
 * GARAGE-1.0 — what is a job actually waiting for?
 *
 * One pure function, derived only from recorded facts, shared by the queue, the case hub and (via the
 * web mirror) the screens, so they can never disagree. It contains no policy of its own: every rule
 * below restates something the database already enforces (OPS04 estimate states, OPS05 start gate).
 *
 * The earlier rule — "accepted + has a work order => start work" — is gone on purpose: a work order
 * exists before the customer has authorized anything, and the database now refuses that start.
 */
export const NEXT_ACTIONS = Object.freeze([
  'accept_or_decline',
  'prepare_estimate',
  'send_estimate',
  'await_customer',
  'revise_estimate',
  'assign_mechanic',
  'start_work',
  'record_service',
  'complete_job',
  'authorization_revoked',
  'issue_invoice',
  'await_payment',
  'none',
]);

/**
 * @param {object} facts
 * @param {string} facts.caseStatus
 * @param {{owner_authorization?: string, assigned_mechanic_user_id?: string|null, status?: string}|null} [facts.workOrder]
 * @param {{status?: string}|null} [facts.estimate] the LATEST estimate version
 * @param {number|null} [facts.serviceRecordCount] null = not known
 * @param {{status?: string, payment_status?: string}|null} [facts.invoice] the live invoice, if any
 */
export function deriveNextAction({ caseStatus, workOrder = null, estimate = null, serviceRecordCount = null, invoice = null } = {}) {
  const status = String(caseStatus || '').toLowerCase();
  if (status === 'requested') return 'accept_or_decline';

  if (status === 'accepted') {
    if (!workOrder) return 'prepare_estimate';
    const authorization = workOrder.owner_authorization || 'pending';
    if (authorization === 'authorized') return workOrder.assigned_mechanic_user_id ? 'start_work' : 'assign_mechanic';
    if (authorization === 'revoked') return 'authorization_revoked';
    // pending | declined: the customer's word is what the job is waiting for
    if (estimate?.status === 'draft') return 'send_estimate';
    if (estimate?.status === 'sent') return 'await_customer';
    if (authorization === 'declined' || estimate?.status === 'declined') return 'revise_estimate';
    return 'prepare_estimate';
  }

  if (status === 'active') {
    if (workOrder?.owner_authorization === 'revoked') return 'authorization_revoked';
    return serviceRecordCount && serviceRecordCount > 0 ? 'complete_job' : 'record_service';
  }

  if (status === 'completed') {
    if (!invoice || invoice.status === 'voided') return 'issue_invoice';
    return invoice.payment_status === 'paid' ? 'none' : 'await_payment';
  }
  return 'none';
}

export default { NEXT_ACTIONS, deriveNextAction };
