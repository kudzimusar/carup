/**
 * GARAGE-1.0 — which actions may the caller offer on this job RIGHT NOW?
 *
 * "Only show actions the backend actually allows." This is that answer, computed server-side from
 * recorded facts plus the caller's garage role. Every rule restates a refusal the database or a
 * service already enforces (OPS04 estimate states, OPS05 start/record/complete gates, OPS06 stock
 * rules, OPS07 invoice/payment rules) — it adds none. A test cross-checks each against the real
 * enforcement so the two can never drift apart.
 *
 * Money is a garage-ADMIN matter; the workshop (start, record, parts, complete) belongs to the
 * workspace (admin + mechanic).
 */
export function allowedActions({
  caseStatus,
  workOrder = null,
  estimate = null,
  assignedMechanicUserId = null,
  serviceRecordCount = 0,
  invoice = null,
  isAdmin = false,
} = {}) {
  const actions = new Set();
  const status = String(caseStatus || '').toLowerCase();
  const auth = workOrder?.owner_authorization || 'pending';
  const woOpen = workOrder && !['completed', 'cancelled'].includes(String(workOrder.status || '').toLowerCase());
  const estimateStatus = estimate?.status || null;

  if (status === 'requested') {
    actions.add('accept_case');
    actions.add('decline_case');
  }

  if (status === 'accepted' && isAdmin) {
    const decidable = auth === 'pending' || auth === 'declined';
    if ((!workOrder || woOpen) && decidable) {
      if (!estimateStatus || ['accepted', 'declined', 'superseded', 'cancelled'].includes(estimateStatus)) {
        // a fresh estimate is possible only when no live (draft/sent) one exists and the customer has not authorized
        if (estimateStatus !== 'accepted' && auth !== 'authorized') actions.add('prepare_estimate');
      }
      if (estimateStatus === 'draft') { actions.add('edit_estimate'); actions.add('send_estimate'); actions.add('cancel_estimate'); }
      if (estimateStatus === 'sent') { actions.add('revise_estimate'); actions.add('cancel_estimate'); }
      if (estimateStatus === 'declined') actions.add('revise_estimate');
    }
  }

  if (isAdmin && workOrder && woOpen && ['accepted', 'active'].includes(status)) actions.add('assign_mechanic');

  if (status === 'accepted' && workOrder && woOpen && auth === 'authorized' && assignedMechanicUserId) actions.add('start_work');

  if (status === 'active' && workOrder && woOpen && auth === 'authorized') {
    actions.add('record_service');
    if (serviceRecordCount > 0) {
      actions.add('use_part');
      actions.add('complete_job');
    }
  }

  if (isAdmin && status === 'completed') {
    const live = invoice && invoice.status === 'issued' ? invoice : null;
    if (!live) actions.add('issue_invoice');
    if (live) {
      if (live.payment_status !== 'paid') actions.add('record_payment');
      if (live.payment_status === 'unpaid') actions.add('void_invoice');
      if (live.payment_status === 'partially_paid' || live.payment_status === 'paid') actions.add('reverse_payment');
    }
  }
  return [...actions];
}

export default { allowedActions };
