import { ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js';

/**
 * GARAGE-1.0 OPS05 — the database enforces who may START, RECORD and COMPLETE work. This module turns
 * its refusals (GARAGE_OPS05_* messages raised by triggers and RPCs) into honest HTTP-shaped errors,
 * so every route — legacy or new — explains the refusal instead of surfacing a database fault.
 */
const MESSAGES = Object.freeze({
  WORK_ORDER_REQUIRED: 'There is no job for this request yet. Prepare an estimate (or open the job) first.',
  WORK_ORDER_TERMINAL: 'This job is already finished or cancelled and remains historical.',
  MECHANIC_REQUIRED: 'Assign a mechanic before starting the work.',
  WORK_NOT_STARTED: 'Start the work first — service can only be recorded or completed on a job that is under way.',
  NO_SERVICE_RECORD: 'Record the work that was actually done before completing the job.',
  WORK_ORDER_NOT_COMPLETED: 'Complete the job (its recorded work) before closing the request.',
});

const AUTHORIZATION_MESSAGES = Object.freeze({
  pending: 'The customer has not authorized this work yet. Send an estimate, or wait for the vehicle owner\'s decision.',
  declined: 'The customer declined this work, so it cannot proceed.',
  revoked: 'The customer withdrew their authorization, so this work cannot proceed.',
});

/** @returns {Error|null} a mapped error, or null when this is not an OPS05 refusal */
export function executionGateFailure(error) {
  const message = String(error?.message || error || '');
  const match = /GARAGE_OPS05_([A-Z_]+)/.exec(message);
  if (!match) return null;
  const token = match[1];
  if (token === 'NOT_AUTHORIZED') {
    const state = String(error?.details ?? error?.detail ?? '').trim().toLowerCase();
    return new ConflictError(AUTHORIZATION_MESSAGES[state] || AUTHORIZATION_MESSAGES.pending);
  }
  if (token === 'WORKSPACE_REQUIRED') return new ForbiddenError('Only a member of this garage can do that.');
  if (token === 'CASE_NOT_FOUND') return new NotFoundError('Service case not found');
  return new ConflictError(MESSAGES[token] || token.toLowerCase().replaceAll('_', ' '));
}

export default { executionGateFailure };
