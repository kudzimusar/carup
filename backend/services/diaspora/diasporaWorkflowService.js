import { supabase } from '../../db/supabase.js';
import { IMPORT_ORDER_STATUSES, IMPORT_ORDER_TRANSITIONS } from '../../constants/diaspora/diasporaStatuses.js';
import { GOVERNMENT_DOCUMENT_CATEGORIES } from '../../constants/diaspora/diasporaDocumentTypes.js';
import { DatabaseError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import { notifyDiasporaMilestone } from './diasporaNotificationService.js';

export const ZIMBABWE_READY_REQUIRED_DOCUMENTS = Object.freeze([
  'ZIMRA_CLEARANCE',
  'CVR_REGISTRATION',
  'ZINARA_LICENSE',
  'VID_ROADWORTHINESS',
  'CID_POLICE_CLEARANCE',
  'INSURANCE_RECORD',
  'DUTY_TAX_PROOF',
  'IMPORT_PORT_RECORD',
  'ODOMETER_VERIFICATION',
  'MECHANICAL_VERIFICATION',
]);

export function canTransitionImportOrder(currentStatus, nextStatus) {
  return (IMPORT_ORDER_TRANSITIONS[currentStatus] || []).includes(nextStatus);
}

export function assertTransitionAllowed(currentStatus, nextStatus) {
  if (!Object.values(IMPORT_ORDER_STATUSES).includes(nextStatus)) {
    throw new ValidationError(`Unknown diaspora import status: ${nextStatus}`);
  }
  if (!canTransitionImportOrder(currentStatus, nextStatus)) {
    throw new ValidationError(`Illegal diaspora workflow transition: ${currentStatus} -> ${nextStatus}`, {
      currentStatus,
      nextStatus,
      allowed: IMPORT_ORDER_TRANSITIONS[currentStatus] || [],
    });
  }
}

export async function getGovernmentFootprint(importOrderId) {
  const { data, error } = await supabase
    .from('vehicle_government_documents')
    .select('document_category, verification_status')
    .eq('import_order_id', importOrderId)
    .is('deleted_at', null);

  if (error) throw new DatabaseError(error.message);

  const statusByCategory = new Map((data || []).map((row) => [row.document_category, row.verification_status]));
  return GOVERNMENT_DOCUMENT_CATEGORIES.map((category) => ({
    category,
    status: statusByCategory.get(category) || 'MISSING',
    requiredForZimbabweReady: ZIMBABWE_READY_REQUIRED_DOCUMENTS.includes(category),
  }));
}

export async function assertZimbabweReadyPrerequisites(importOrderId) {
  const footprint = await getGovernmentFootprint(importOrderId);
  const missing = footprint
    .filter((doc) => doc.requiredForZimbabweReady && doc.status !== 'VERIFIED')
    .map((doc) => doc.category);

  if (missing.length > 0) {
    throw new ValidationError('Cannot mark import order as ZIMBABWE_READY until all required government documents are verified.', {
      missing,
    });
  }
}

export async function transitionImportOrder({ importOrderId, nextStatus, actorId, metadata = {}, req = null }) {
  const { data: order, error: fetchError } = await supabase
    .from('diaspora_import_orders')
    .select('*')
    .eq('id', importOrderId)
    .is('deleted_at', null)
    .single();

  if (fetchError || !order) throw new NotFoundError('Diaspora import order not found');

  assertTransitionAllowed(order.status, nextStatus);

  if (nextStatus === IMPORT_ORDER_STATUSES.ZIMBABWE_READY) {
    await assertZimbabweReadyPrerequisites(importOrderId);
  }

  const { data: updated, error: updateError } = await supabase
    .from('diaspora_import_orders')
    .update({
      status: nextStatus,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
      metadata: { ...(order.metadata || {}), last_transition: metadata },
    })
    .eq('id', importOrderId)
    .select()
    .single();

  if (updateError) throw new DatabaseError(updateError.message);

  await writeDiasporaAudit({
    importOrderId,
    tenantId: order.tenant_id,
    actorId,
    action: 'IMPORT_ORDER_STATUS_CHANGED',
    resourceType: 'diaspora_import_order',
    resourceId: importOrderId,
    previousState: { status: order.status },
    newState: { status: nextStatus },
    metadata,
    req,
  });

  await notifyDiasporaMilestone({
    eventType: `DIASPORA_${nextStatus}`,
    importOrder: updated,
    actorId,
    title: `Import order ${nextStatus.replaceAll('_', ' ').toLowerCase()}`,
    message: `Your CarUp diaspora import order has moved from ${order.status} to ${nextStatus}.`,
    metadata,
  });

  return updated;
}
