import { supabase } from '../../db/supabase.js';
import { DatabaseError, ValidationError } from '../../utils/errors.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';

/**
 * A rating is a number of stars, and the vocabulary is 1..5.
 *
 * The column CHECK admits 0..5, and nothing in the service narrowed it further, so
 * `rating: 1000` clamped the derived trust score to 100 and `rating: -1000` clamped it to 0 —
 * a single POST could set any trade profile's score to either end of the scale.
 */
function validRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) && rating >= 1 && rating <= 5;
}

/**
 * The reviewer must have actually transacted with the profile they are rating.
 *
 * `diaspora_import_order_participants` is the linkage: it carries the order, the participating
 * `user_id` and the participating `trade_profile_id`. A review is admissible only when the
 * reviewer and the reviewed profile are BOTH participants on the SAME order, and that order has
 * reached 'COMPLETED'. Anything less means the reviewer is rating a counterparty they never dealt
 * with, which is what made this a second, unauthenticated-in-practice trust authority.
 *
 * Fails closed: a read error refuses the review rather than admitting it.
 */
async function reviewerTransactedWithProfile({ importOrderId, reviewerId, tradeProfileId }) {
  if (!importOrderId || !reviewerId || !tradeProfileId) return false;

  const { data: order, error: orderError } = await supabase
    .from('diaspora_import_orders')
    .select('id, status')
    .eq('id', importOrderId)
    .maybeSingle();
  if (orderError || !order || order.status !== 'COMPLETED') return false;

  const { data: participants, error: participantError } = await supabase
    .from('diaspora_import_order_participants')
    .select('user_id, trade_profile_id')
    .eq('import_order_id', importOrderId)
    .is('deleted_at', null);
  if (participantError || !Array.isArray(participants)) return false;

  const reviewerOnOrder = participants.some((row) => row.user_id === reviewerId);
  const profileOnOrder = participants.some((row) => row.trade_profile_id === tradeProfileId);
  return reviewerOnOrder && profileOnOrder;
}

export async function createReputationRecord(payload, userContext = {}, req = null) {
  if (!payload.trade_profile_id || !payload.rating) throw new ValidationError('trade_profile_id and rating are required');
  if (!validRating(payload.rating)) throw new ValidationError('rating must be a number between 1 and 5');

  // The reviewer is the authenticated caller. Accepting `payload.reviewer_id` would let a caller
  // file a review as somebody else, and every guard below is keyed on this identity.
  const reviewerId = userContext?.id || null;
  if (!reviewerId) throw new ValidationError('an authenticated reviewer is required');

  const { data: profile, error: profileError } = await supabase
    .from('diaspora_trade_profiles')
    .select('id, user_id')
    .eq('id', payload.trade_profile_id)
    .maybeSingle();
  if (profileError) throw new DatabaseError(profileError.message);
  if (!profile) throw new ValidationError('trade profile not found');

  // Self-review is not reputation.
  if (profile.user_id === reviewerId) throw new ValidationError('a trade profile cannot review itself');

  const transacted = await reviewerTransactedWithProfile({
    importOrderId: payload.import_order_id,
    reviewerId,
    tradeProfileId: payload.trade_profile_id,
  });
  if (!transacted) {
    throw new ValidationError(
      'a review must cite a COMPLETED import order on which both the reviewer and the reviewed profile participated',
    );
  }

  const { data, error } = await supabase
    .from('diaspora_reputation_records')
    .insert({
      tenant_id: userContext?.tenantId || payload.tenant_id || null,
      trade_profile_id: payload.trade_profile_id,
      import_order_id: payload.import_order_id,
      reviewer_id: reviewerId,
      rating: Number(payload.rating),
      review_text: payload.review_text || null,
      dispute_flag: !!payload.dispute_flag,
      // SERVER-DECIDED. Taking this from the body let a caller publish their own review directly
      // into the reputation average with no moderation step at all.
      verification_status: 'PENDING_REVIEW',
      metadata: payload.metadata || {},
      created_by: userContext?.id,
      updated_by: userContext?.id,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);

  await recalculateTradeProfileReputation(payload.trade_profile_id);
  await writeDiasporaAudit({ importOrderId: data.import_order_id, tenantId: data.tenant_id, actorId: userContext?.id, action: 'REPUTATION_RECORDED', resourceType: 'diaspora_reputation_record', resourceId: data.id, newState: data, req });
  return data;
}

export async function recalculateTradeProfileReputation(tradeProfileId) {
  // A moderated-away review must not keep moving the score. 'REMOVED' and 'FLAGGED' are exactly
  // the states that say "this is not a review we stand behind", so they are excluded from the
  // average rather than merely hidden from the list.
  const { data, error } = await supabase.from('diaspora_reputation_records')
    .select('rating, dispute_flag, verification_status')
    .eq('trade_profile_id', tradeProfileId)
    .is('deleted_at', null);
  if (error) throw new DatabaseError(error.message);
  const records = (data || []).filter((row) => row.verification_status !== 'REMOVED' && row.verification_status !== 'FLAGGED');
  const ratingAverage = records.length ? records.reduce((sum, r) => sum + Number(r.rating || 0), 0) / records.length : 0;
  const disputeCount = records.filter((r) => r.dispute_flag).length;
  const trustScore = Math.max(0, Math.min(100, 50 + ratingAverage * 10 - disputeCount * 5));
  await supabase.from('diaspora_trade_profiles').update({ rating_average: ratingAverage, dispute_count: disputeCount, trust_score: trustScore, updated_at: new Date().toISOString() }).eq('id', tradeProfileId);
  return { ratingAverage, disputeCount, trustScore };
}

export async function listReputationRecords({ tradeProfileId, importOrderId, limit = 50, offset = 0 }) {
  let query = supabase.from('diaspora_reputation_records').select('*').is('deleted_at', null).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (tradeProfileId) query = query.eq('trade_profile_id', tradeProfileId);
  if (importOrderId) query = query.eq('import_order_id', importOrderId);
  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);
  return data || [];
}
