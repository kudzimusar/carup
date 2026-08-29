import { DatabaseError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { requestServiceCase } from './serviceCaseService.js';

/**
 * Service Network S3 — Marketplace and Communications convergence.
 *
 * Two seams, both consume-only:
 *
 *  1. MARKETPLACE (plan §10). Marketplace owns acquisition intent: the inquiry id,
 *     source channel and campaign attribution stay its authority (Invariant 8). This
 *     bridge only READS a `garage_service_request` inquiry and opens the Service Case
 *     that Service Network owns. It never rewrites inquiry status (a lead pipeline is
 *     not a case lifecycle) and never overloads seller semantics for routing — the
 *     target garage is the additive `target_provider_tenant_id` column (§10.2).
 *     Idempotency is the database's: `service_cases.source_inquiry_id` is uniquely
 *     indexed, so a replayed inquiry returns the existing case (§10.3).
 *
 *  2. COMMUNICATIONS (plan §15). Canonical Communications remains the only
 *     conversation authority (Invariant 6) — no service messages silo, no second
 *     messages table. A case binds to a thread through the EXISTING workflow service.
 *
 *     Workflow reconciliation: the canonical stakeholder contract already carries a
 *     `garage` workflow whose declared identity source is literally "work order
 *     participant -> channel_identities" and whose roles are exactly
 *     ['vehicle_owner','garage'] — it was defined for this interaction and has no
 *     producer yet. Adding a near-duplicate `service` workflow would create two
 *     competing conversation keys for one interaction, so S3 reuses `garage` and
 *     distinguishes cases by subject instead: subject_type 'service_case' with the
 *     case id, which makes the deterministic thread key unambiguous.
 */

/** The subject type that identifies a Service Case conversation. Never aliased. */
export const SERVICE_CASE_SUBJECT_TYPE = 'service_case';

/** The canonical workflow a Service Case conversation belongs to (see reconciliation above). */
export const SERVICE_CASE_WORKFLOW = 'garage';

const SERVICE_INQUIRY_TYPES = Object.freeze(['garage_service_request']);

function inquirySourceChannel(inquiry) {
  // Marketplace owns source attribution; map its vocabulary onto the case's own,
  // and stay honest ('unknown') rather than inventing a channel we cannot support.
  switch (String(inquiry.source_channel || '').trim()) {
    case 'qr': return 'qr';
    case 'operator': return 'operator';
    case 'mobile': return 'mobile';
    case 'web': return 'marketplace';
    default: return 'unknown';
  }
}

/**
 * Open (or return) the Service Case for a marketplace service inquiry.
 *
 * Returns `{ case, created }`. A replay returns `created:false` and the same case.
 */
export async function bridgeInquiryToServiceCase(supabaseClient, userContext, inquiryId, deps = {}) {
  const id = String(inquiryId || '').trim();
  if (!id) throw new ValidationError('inquiry id is required');

  const { data: inquiry, error } = await supabaseClient
    .from('marketplace_inquiries')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to load inquiry: ${error.message}`);
  if (!inquiry) throw new NotFoundError('Inquiry not found');

  if (!SERVICE_INQUIRY_TYPES.includes(inquiry.inquiry_type)) {
    throw new ValidationError(`Inquiry ${id} is not a service request (${inquiry.inquiry_type})`);
  }

  // Routing must be governed, not inferred. An inquiry with no target garage is a real
  // lead but not yet a routable service request — say so rather than guessing a garage.
  const targetTenantId = inquiry.target_provider_tenant_id || null;
  if (!targetTenantId) {
    throw new ValidationError(
      'This service request has no target garage recorded, so no Service Case can be opened for it',
    );
  }

  const vin = String(inquiry.listing_id || '').trim();
  if (!vin) throw new ValidationError('This service request is not bound to a vehicle');

  return requestServiceCase(
    supabaseClient,
    // The case requester is the inquiry's buyer, not the caller performing the bridge.
    { id: inquiry.buyer_id || userContext.id || userContext.userId },
    {
      vin,
      garage_tenant_id: targetTenantId,
      source_inquiry_id: inquiry.id,
      source_channel: inquirySourceChannel(inquiry),
      request_summary: inquiry.message || null,
    },
    // The Marketplace inquiry is itself the governed authority path here (plan §10):
    // the buyer raised the inquiry against this listing, so vehicle authority is
    // established by the inquiry rather than by owner lookup. Marked explicitly so it
    // can never be mistaken for an unchecked call.
    { ...deps, authorityAlreadyVerified: 'marketplace_inquiry' },
  );
}

/**
 * Bind a Service Case to its canonical conversation, idempotently.
 *
 * Communications failure MUST NOT erase an otherwise authoritative Service Case
 * (plan §15.5): this returns a recoverable receipt rather than pretending success,
 * and never rolls the case back.
 */
export async function bindServiceCaseConversation(supabaseClient, caseRow, deps = {}) {
  const workflowService = deps.workflowService;
  if (!workflowService) {
    return { bound: false, reason: 'communications_unavailable' };
  }
  if (caseRow.conversation_thread_id) {
    return { bound: true, thread_id: caseRow.conversation_thread_id, created: false };
  }

  const participants = [
    ...(caseRow.requester_user_id
      ? [{ user_id: caseRow.requester_user_id, stakeholder_role: 'vehicle_owner' }]
      : []),
    { tenant_id: caseRow.garage_tenant_id, stakeholder_role: 'garage' },
  ];
  if (participants.length < 2) {
    return { bound: false, reason: 'insufficient_participants' };
  }

  let thread;
  try {
    const result = await workflowService.ensureBusinessConversation({
      business_workflow: SERVICE_CASE_WORKFLOW,
      subject_type: SERVICE_CASE_SUBJECT_TYPE,
      subject_id: caseRow.id,
      tenant_id: caseRow.garage_tenant_id,
      participants,
    });
    thread = result?.thread || result;
  } catch (err) {
    return { bound: false, reason: err?.message || 'conversation_binding_failed' };
  }

  const threadId = thread?.id || thread?.thread_id || null;
  if (!threadId) return { bound: false, reason: 'conversation_binding_failed' };

  const { error } = await supabaseClient
    .from('service_cases')
    .update({ conversation_thread_id: threadId, updated_at: new Date().toISOString() })
    .eq('id', caseRow.id);
  if (error) {
    // The conversation exists but the link did not persist — recoverable, and the
    // binding is idempotent, so a retry re-uses the same deterministic thread.
    return { bound: false, thread_id: threadId, reason: 'link_not_persisted' };
  }
  return { bound: true, thread_id: threadId, created: Boolean(thread?.created) };
}
