import { supabase } from '../../db/supabase.js';
import { DatabaseError, NotFoundError } from '../../utils/errors.js';
import { validateTradeProfilePayload } from '../../validators/diaspora/diasporaSchemas.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';

export async function createTradeProfile(payload, userContext = {}, req = null) {
  validateTradeProfilePayload(payload);
  const { data, error } = await supabase
    .from('diaspora_trade_profiles')
    .insert({
      tenant_id: userContext?.tenantId || payload.tenant_id || null,
      user_id: payload.user_id,
      organization_id: payload.organization_id || null,
      country: payload.country,
      city: payload.city,
      role_type: payload.role_type,
      verification_status: payload.verification_status || 'PENDING_REVIEW',
      trust_score: payload.trust_score || 50,
      completed_shipments_count: payload.completed_shipments_count || 0,
      dispute_count: payload.dispute_count || 0,
      rating_average: payload.rating_average || 0,
      metadata: payload.metadata || {},
      created_by: userContext?.id,
      updated_by: userContext?.id,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  await writeDiasporaAudit({ tenantId: data.tenant_id, actorId: userContext?.id, action: 'TRADE_PROFILE_CREATED', resourceType: 'diaspora_trade_profile', resourceId: data.id, newState: data, req });
  return data;
}

export async function listTradeProfiles({ roleType, verificationStatus, country, limit = 50, offset = 0 }) {
  let query = supabase.from('diaspora_trade_profiles').select('*').is('deleted_at', null).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (roleType) query = query.eq('role_type', roleType);
  if (verificationStatus) query = query.eq('verification_status', verificationStatus);
  if (country) query = query.eq('country', country);
  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);
  return data || [];
}

export async function getTradeProfile(id) {
  const { data, error } = await supabase.from('diaspora_trade_profiles').select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Diaspora trade profile not found');
  return data;
}

export async function verifyTradeProfile(id, payload = {}, userContext = {}, req = null) {
  const previous = await getTradeProfile(id);
  const trustScore = Math.min(100, Math.max(previous.trust_score || 50, payload.trust_score || 80));
  const { data, error } = await supabase
    .from('diaspora_trade_profiles')
    .update({ verification_status: 'VERIFIED', trust_score: trustScore, updated_by: userContext?.id, updated_at: new Date().toISOString(), metadata: { ...(previous.metadata || {}), verification: payload } })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  await writeDiasporaAudit({ tenantId: data.tenant_id, actorId: userContext?.id, action: 'TRADE_PROFILE_VERIFIED', resourceType: 'diaspora_trade_profile', resourceId: id, previousState: previous, newState: data, req });
  return data;
}

export async function suspendTradeProfile(id, payload = {}, userContext = {}, req = null) {
  const previous = await getTradeProfile(id);
  const { data, error } = await supabase
    .from('diaspora_trade_profiles')
    .update({ verification_status: 'SUSPENDED', updated_by: userContext?.id, updated_at: new Date().toISOString(), metadata: { ...(previous.metadata || {}), suspension: payload } })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  await writeDiasporaAudit({ tenantId: data.tenant_id, actorId: userContext?.id, action: 'TRADE_PROFILE_SUSPENDED', resourceType: 'diaspora_trade_profile', resourceId: id, previousState: previous, newState: data, req });
  return data;
}
