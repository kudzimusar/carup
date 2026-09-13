/**
 * Trade OS T9 — who may act at a receiving warehouse.
 *
 * A pure predicate in its own module, for the same reason `diasporaAuthorization.js` exists: more
 * than one service has to ask the question (the intake service, and the T8 documents workspace when
 * it is showing an intake's evidence), and an authority rule that gets re-implemented per caller is
 * an authority rule that will eventually disagree with itself.
 *
 * The rule: authority to receive comes from the WAREHOUSE — its named operator, a tenant admin of
 * the tenant that runs it, or a platform admin/reviewer. Owning the cargo grants none of it.
 */
import { isPlatformAdmin, isPlatformReviewer, isTenantAdminForRecord, normalizeId } from './diasporaAuthorization.js';

export function canReceiveAtWarehouse(warehouse = {}, userContext = {}) {
  if (!warehouse || warehouse.deleted_at) return false;
  if (isPlatformAdmin(userContext) || isPlatformReviewer(userContext)) return true;
  const operator = normalizeId(warehouse.operator_user_id);
  if (operator && operator === normalizeId(userContext.id ?? userContext.userId)) return true;
  return isTenantAdminForRecord(warehouse, userContext);
}
