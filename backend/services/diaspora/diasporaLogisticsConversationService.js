/**
 * Trade OS T3 — requester ↔ logistics-provider clarification.
 *
 * This deliberately creates NO logistics chat table. A shipping request conversation is a canonical
 * CarUp Communications reference flow, private to one requester/provider pair. Provider access is
 * earned by logistics-provider eligibility (or an existing quote); requester access is ownership.
 */
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { requireUserContext, isPlatformAdmin, isPlatformReviewer, normalizeId } from './diasporaAuthorization.js';
import { resolveClient } from './diasporaServiceUtils.js';
import { resolveLogisticsProviderContext } from './diasporaLogisticsRfqService.js';
import { createCommunicationServices } from '../communication/communicationServiceFactory.js';

const REQUESTS = 'diaspora_logistics_requests';
const QUOTES = 'diaspora_logistics_quotes';
const REQUESTER_VISIBLE_QUOTE_STATUSES = new Set(['SUBMITTED', 'ACCEPTED', 'REJECTED', 'EXPIRED']);
export const LOGISTICS_SUBJECT_TYPE = 'diaspora_logistics_request';
export const LOGISTICS_WORKFLOW = 'marketplace';

function privileged(context) {
  return isPlatformAdmin(context) || isPlatformReviewer(context);
}

async function loadRequest(client, requestId) {
  const { data, error } = await client.from(REQUESTS).select('*').eq('id', requestId).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Shipping request not found');
  return data;
}

async function providerHasEngaged(client, requestId, providerId, { requesterVisibleOnly = false } = {}) {
  const { data } = await client.from(QUOTES).select('id, provider_id, status')
    .eq('logistics_request_id', requestId)
    .eq('provider_id', providerId)
    .is('deleted_at', null);
  if (requesterVisibleOnly) {
    // A provider DRAFT is private work-in-progress. The requester must not be able to use the
    // conversation bootstrap as an existence oracle for a draft they cannot otherwise see.
    return Boolean((data || []).some((quote) => REQUESTER_VISIBLE_QUOTE_STATUSES.has(quote.status)));
  }
  // The provider may continue a conversation they themselves started while the request was open;
  // a withdrawn offer deliberately no longer counts as an active engagement.
  return Boolean((data || []).some((quote) => quote.status !== 'WITHDRAWN'));
}

export async function ensureLogisticsConversation(requestId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const request = await loadRequest(client, requestId);
  const requesterId = normalizeId(request.requester_id || request.created_by);
  if (!requesterId) throw new ValidationError('This shipping request has no requester on record');

  const isRequester = requesterId === context.id;
  let providerId;
  let role;

  if (isRequester) {
    providerId = normalizeId(options.providerId || userContext.providerId);
    if (!providerId) throw new ValidationError('providerId is required to open a specific provider conversation');
    if (!privileged(context) && !(await providerHasEngaged(client, requestId, providerId, { requesterVisibleOnly: true }))) {
      throw new ForbiddenError('A provider must submit an offer before the requester can open a direct conversation');
    }
    role = 'requester';
  } else {
    // This call establishes commercial eligibility independently from users.role.
    await resolveLogisticsProviderContext(context, { ...options, supabaseClient: client });
    providerId = context.id;
    const hasQuote = await providerHasEngaged(client, requestId, providerId);
    if (request.status !== 'OPEN_FOR_QUOTES' && !hasQuote && !privileged(context)) {
      throw new ForbiddenError('This shipping request is not open for provider questions');
    }
    role = 'provider';
  }

  const services = options.communicationServices || createCommunicationServices();
  const result = await services.stakeholderService.ensureReferenceFlow({
    workflow: LOGISTICS_WORKFLOW,
    subject_type: LOGISTICS_SUBJECT_TYPE,
    subject_id: `${requestId}:${providerId}`,
    tenant_id: request.tenant_id || null,
    participants: [
      { user_id: requesterId, stakeholder_role: 'buyer' },
      // Canonical Communications already governs buyer/seller marketplace participants. The
      // commercial meaning here is logistics provider; no new shadow messaging role is invented.
      { user_id: providerId, stakeholder_role: 'seller' },
    ],
    metadata: {
      diaspora_logistics_request_id: requestId,
      shipping_reference: `SHIP-${String(requestId).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      commercial_relationship: 'logistics_provider',
    },
  });

  const thread = result?.thread || result;
  return { threadId: thread?.id || null, role, logisticsRequestId: requestId };
}
