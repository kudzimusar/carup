import { supabase } from '../../db/supabase.js';
import { DOCUMENT_STATUSES, IMPORT_ORDER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { GOVERNMENT_DOCUMENT_CATEGORIES } from '../../constants/diaspora/diasporaDocumentTypes.js';
import { DatabaseError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import { transitionImportOrder, getGovernmentFootprint } from './diasporaWorkflowService.js';

export async function createComplianceReview(payload, userContext = {}, req = null) {
  if (!payload.import_order_id || !payload.review_type) throw new ValidationError('import_order_id and review_type are required');
  const { data: order, error: orderError } = await supabase.from('diaspora_import_orders').select('*').eq('id', payload.import_order_id).single();
  if (orderError || !order) throw new NotFoundError('Diaspora import order not found');

  const { data, error } = await supabase
    .from('diaspora_compliance_reviews')
    .insert({
      tenant_id: userContext?.tenantId || order.tenant_id,
      import_order_id: payload.import_order_id,
      review_type: payload.review_type,
      status: payload.status || 'PENDING_REVIEW',
      assigned_to: payload.assigned_to || null,
      notes: payload.notes || null,
      metadata: payload.metadata || {},
      created_by: userContext?.id,
      updated_by: userContext?.id,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  await writeDiasporaAudit({ importOrderId: data.import_order_id, tenantId: data.tenant_id, actorId: userContext?.id, action: 'COMPLIANCE_REVIEW_CREATED', resourceType: 'diaspora_compliance_review', resourceId: data.id, newState: data, req });
  return data;
}

export async function listComplianceReviews({ importOrderId, status, limit = 50, offset = 0 }) {
  let query = supabase.from('diaspora_compliance_reviews').select('*').is('deleted_at', null).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (importOrderId) query = query.eq('import_order_id', importOrderId);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new DatabaseError(error.message);
  return data || [];
}

async function getComplianceReview(id) {
  const { data, error } = await supabase.from('diaspora_compliance_reviews').select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('Diaspora compliance review not found');
  return data;
}

export async function updateComplianceReview(id, nextStatus, payload = {}, userContext = {}, req = null) {
  const previous = await getComplianceReview(id);
  const { data, error } = await supabase
    .from('diaspora_compliance_reviews')
    .update({ status: nextStatus, reviewed_by: userContext?.id, reviewed_at: new Date().toISOString(), notes: payload.notes || previous.notes, updated_by: userContext?.id, updated_at: new Date().toISOString(), metadata: { ...(previous.metadata || {}), review: payload } })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);

  await writeDiasporaAudit({ importOrderId: data.import_order_id, tenantId: data.tenant_id, actorId: userContext?.id, action: `COMPLIANCE_${nextStatus}`, resourceType: 'diaspora_compliance_review', resourceId: id, previousState: previous, newState: data, req });
  if (nextStatus === 'APPROVED') {
    try {
      await transitionImportOrder({ importOrderId: data.import_order_id, nextStatus: IMPORT_ORDER_STATUSES.CUSTOMS_IN_PROGRESS, actorId: userContext?.id, userContext, metadata: { complianceReviewId: id }, req });
    } catch (err) {
      console.warn('Skipping automatic compliance transition:', err.message);
    }
  }
  return data;
}

export async function upsertGovernmentDocument(payload, userContext = {}, req = null) {
  if (!payload.import_order_id || !payload.document_category) throw new ValidationError('import_order_id and document_category are required');
  if (!GOVERNMENT_DOCUMENT_CATEGORIES.includes(payload.document_category)) throw new ValidationError(`Unsupported government document category: ${payload.document_category}`);

  const { data: order, error: orderError } = await supabase.from('diaspora_import_orders').select('*').eq('id', payload.import_order_id).single();
  if (orderError || !order) throw new NotFoundError('Diaspora import order not found');

  const row = {
    tenant_id: userContext?.tenantId || order.tenant_id,
    import_order_id: payload.import_order_id,
    vehicle_vin: payload.vehicle_vin || order.linked_vehicle_vin || null,
    document_category: payload.document_category,
    trade_document_id: payload.trade_document_id || null,
    ocr_document_id: payload.ocr_document_id || null,
    verification_status: payload.verification_status || DOCUMENT_STATUSES.UPLOADED,
    verified_by: payload.verification_status === DOCUMENT_STATUSES.VERIFIED ? (userContext?.id || payload.verified_by || null) : payload.verified_by || null,
    verified_at: payload.verification_status === DOCUMENT_STATUSES.VERIFIED ? new Date().toISOString() : payload.verified_at || null,
    metadata: payload.metadata || {},
    created_by: userContext?.id,
    updated_by: userContext?.id,
  };

  const { data, error } = await supabase
    .from('vehicle_government_documents')
    .upsert(row, { onConflict: 'import_order_id,document_category' })
    .select()
    .single();
  if (error) throw new DatabaseError(error.message);
  await writeDiasporaAudit({ importOrderId: data.import_order_id, tenantId: data.tenant_id, actorId: userContext?.id, action: 'GOVERNMENT_DOCUMENT_UPSERTED', resourceType: 'vehicle_government_document', resourceId: data.id, newState: data, req });
  return data;
}

export { getGovernmentFootprint };
