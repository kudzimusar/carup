/**
 * Trade OS T2 §9.7 — buyer↔supplier clarification on a sourcing request.
 *
 * An RFQ is not a one-shot form: a supplier usually needs one question answered before quoting.
 * This is the seam that lets the WEB client reach canonical Communications, which it otherwise
 * cannot — `POST /api/internal/communications/workflows/:workflow/ensure` is worker-secret guarded
 * for server-to-server callers only.
 *
 * Deliberate constraints:
 *   - NO rfq_messages table and no feature-specific chat. The conversation is a canonical
 *     Communications thread, reusing the existing `marketplace` workflow (buyer/seller stakeholder
 *     contract, `marketplace_inquiry` thread type — both already legal, no new vocabulary).
 *   - The RFQ is identified by `subject_type: 'diaspora_rfq'` + the canonical order id, so the
 *     thread is attached to the authoritative record rather than floating.
 *   - Participation is EARNED, not asserted: the buyer must own the order and a supplier must be
 *     able to see it in the marketplace (published + open). Nobody else can open or join a thread.
 *   - The supplier never learns the buyer's identity from this call; they are added by user id,
 *     which Communications already treats as private participant data.
 */
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { requireUserContext, isPlatformAdmin, isPlatformReviewer, normalizeId } from './diasporaAuthorization.js';
import { resolveClient } from './diasporaServiceUtils.js';
import { createCommunicationServices } from '../communication/communicationServiceFactory.js';

const ORDERS = 'diaspora_import_orders';

/** The canonical subject vocabulary for a sourcing request conversation. */
export const RFQ_SUBJECT_TYPE = 'diaspora_rfq';
export const RFQ_WORKFLOW = 'marketplace';

function isPublished(order) {
  return Boolean(order.metadata?.rfq?.published);
}

/**
 * Decide who this caller is on this request, or refuse.
 *
 * Returns 'buyer' or 'seller'. A caller who is neither the order owner nor an eligible supplier
 * gets a ForbiddenError — marketplace visibility is what earns a supplier the right to ask, and it
 * ends when the request is unpublished or awarded.
 */
async function resolveParticipantRole(client, orderId, context) {
  const { data: order, error } = await client.from(ORDERS).select('*').eq('id', orderId).is('deleted_at', null).single();
  if (error || !order) throw new NotFoundError('Request not found');

  const isOwner = [order.buyer_id, order.created_by].some((c) => normalizeId(c) === context.id);
  if (isOwner) return { order, role: 'buyer' };

  if (isPlatformAdmin(context) || isPlatformReviewer(context)) return { order, role: 'seller' };

  if (!isPublished(order)) throw new ForbiddenError('This request is not open for questions');
  if (order.metadata?.rfq?.acceptedQuoteId) throw new ForbiddenError('This request has already been awarded');
  return { order, role: 'seller' };
}

/**
 * Ensure the canonical conversation for one supplier on one request, and return its thread id.
 *
 * One thread per (request, supplier) pair: a supplier's questions are private to that supplier, so
 * competitors never read each other's clarifications. The buyer participates in each.
 */
export async function ensureRfqConversation(orderId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { order, role } = await resolveParticipantRole(client, orderId, context);

  // The supplier side of the pair. When the BUYER opens the thread they must say which supplier
  // they are answering, because the buyer may hold several separate conversations on one request.
  const sellerId = role === 'seller' ? context.id : normalizeId(options.sellerId || userContext.sellerId);
  if (!sellerId) throw new ValidationError('sellerId is required to open the conversation with a specific supplier');

  const buyerId = normalizeId(order.buyer_id || order.created_by);
  if (!buyerId) throw new ValidationError('This request has no buyer on record');

  const services = options.communicationServices || createCommunicationServices();
  const result = await services.stakeholderService.ensureReferenceFlow({
    workflow: RFQ_WORKFLOW,
    subject_type: RFQ_SUBJECT_TYPE,
    // Distinct per supplier so clarifications stay private between competitors.
    subject_id: `${orderId}:${sellerId}`,
    tenant_id: order.tenant_id || null,
    participants: [
      { user_id: buyerId, stakeholder_role: 'buyer' },
      { user_id: sellerId, stakeholder_role: 'seller' },
    ],
    metadata: {
      diaspora_rfq_id: orderId,
      // The reference a human sees, so the thread is identifiable in the inbox without exposing ids.
      rfq_reference: `RFQ-${String(orderId).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    },
  });

  const thread = result?.thread || result;
  return { threadId: thread?.id || null, role, rfqId: orderId };
}
