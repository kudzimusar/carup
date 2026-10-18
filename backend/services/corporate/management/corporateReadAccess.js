/**
 * CA-OWNER-02 — the read gate in front of every Corporate management read model.
 *
 * It decides nothing about admission: it asks the frozen server decision (evaluateCorporateAccess — persistent Corporate
 * authority, CA-CLOSE-01) and then requires the ONE capability the Corporate destination already names in
 * web/src/config/corporate/navigation.ts. A read model can therefore only ever be narrower than admission, never wider:
 *
 *   · the destination `.read` capabilities exist only in the bounded legacy compatibility the frozen decision adds to an
 *     ADMITTED platform administrator (Governor A on staging);
 *   · an admitted platform OWNER governor holds governance capabilities only (Governor B on staging), so destination reads are
 *     refused here exactly where the navigation already hides those destinations;
 *   · nothing here reads users.role, a header, a tenant or a title.
 */
import { supabase as defaultSupabase } from '../../../db/supabase.js';
import { evaluateCorporateAccess } from '../corporateAccessService.js';

export const CORPORATE_READ_CONTRACT = 'carup.corporate_management.v1';

/**
 * @returns {Promise<{ allowed: true, grant: object } | { allowed: false, status: number, body: object }>} — never throws
 */
export async function authorizeCorporateRead(userContext, capability, { supabaseClient = defaultSupabase, now = new Date(), signal } = {}) {
  let decision;
  try {
    decision = await evaluateCorporateAccess(userContext, { supabaseClient, now, signal });
  } catch {
    decision = { allowed: false, status: 503, body: { decision: 'unavailable', code: 'CORPORATE_AUTHORITY_UNAVAILABLE', error: 'Corporate authority could not be confirmed right now. Nothing was granted.' } };
  }
  if (!decision.allowed) return { allowed: false, status: decision.status, body: { ...decision.body, contract: CORPORATE_READ_CONTRACT } };

  const grant = decision.body.grant;
  const held = new Set([...(grant.capabilities ?? []), ...(grant.governance_capabilities ?? [])]);
  if (typeof capability !== 'string' || !held.has(capability)) {
    return {
      allowed: false,
      status: 403,
      body: {
        contract: CORPORATE_READ_CONTRACT,
        decision: 'denied',
        code: 'CORPORATE_CAPABILITY_REQUIRED',
        capability: typeof capability === 'string' ? capability : null,
        error: `Forbidden. This Corporate view requires the ${String(capability)} capability, which your Corporate access does not hold.`,
      },
    };
  }
  return { allowed: true, grant };
}
