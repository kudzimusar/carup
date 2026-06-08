import { supabase } from '../../db/supabase.js';
import { DatabaseError, ValidationError } from '../../utils/errors.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';

export async function createReputationRecord(payload, userContext = {}, req = null) {
  if (!payload.trade_profile_id || !payload.rating) throw new ValidationError('trade_profile_id and rating are required');
  const { data, error } = await supabase
    .from('diaspora_reputation_records')
    .insert({
      tenant_id: userContext?.tenantId || payload.tenant_id || null,
      trade_profile_id: payload.trade_profile_id,
      import_order_id: payload.import_order_id || null,
      reviewer_id: userContext?.id || payload.reviewer_id || null,
      rating: payload.rating,
      review_text: payload.review_text || null,
      dispute_flag: !!payload.dispute_flag,
      verification_status: payload.verification_status || 'PUBLISHED',
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
  const { data, error } = await supabase.from('diaspora_reputation_records').select('rating, dispute_flag').eq('trade_profile_id', tradeProfileId).is('deleted_at', null);
  if (error) throw new DatabaseError(error.message);
  const records = data || [];
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
