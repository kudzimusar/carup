import { DatabaseError, ForbiddenError } from '../../utils/errors.js';

/**
 * Service Network S6 — owner Service History projection.
 *
 * Passport remains the projection authority for public/buyer surfaces (Invariant 9);
 * this is the OWNER projection (plan §11.2, §22.2), assembled from the source records
 * S2–S5 established rather than from a second stored copy.
 *
 * It exists to retire four documented truth debts on the owner surface (plan §3.4):
 *   1. a hard-coded "Next Service — 500 km" that no authority supports;
 *   2. an absent cost rendered as $0;
 *   3. a generic literal "Garage" standing in for provider identity;
 *   4. currency assumed to be USD.
 *
 * The replacement rule throughout is Invariant 10: unknown is not zero, and unknown is
 * not a guess. A field with no supporting fact is reported as absent, and the surface
 * says so.
 */

/** Garage display name comes from the governed publication projection, never invented. */
async function loadProviders(supabaseClient, tenantIds) {
  const ids = [...new Set(tenantIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await supabaseClient
    .from('garage_public_profiles')
    .select('tenant_id, display_name, slug, publication_status')
    .in('tenant_id', ids);
  if (error) return new Map();
  const map = new Map();
  for (const row of data || []) {
    map.set(row.tenant_id, {
      display_name: row.display_name,
      // Only a published garage gets a public link; an unpublished one is still a real
      // provider, so we name it without pretending it has a public page.
      slug: row.publication_status === 'published' ? row.slug : null,
    });
  }
  return map;
}

/**
 * Provider identity for one work order.
 *
 * A work order always has a tenant, but that tenant may have no governed profile yet.
 * That is reported as "not recorded" rather than papered over with the word "Garage".
 */
function projectProvider(workOrder, providers) {
  const profile = workOrder.tenant_id ? providers.get(workOrder.tenant_id) : null;
  if (!profile) {
    return { known: false, display_name: null, slug: null };
  }
  return { known: true, display_name: profile.display_name, slug: profile.slug };
}

/** Money is reported with its currency or not at all. Absent never becomes zero. */
function projectCost(workOrder, record) {
  const amount = record?.total_cost ?? workOrder.total_cost ?? null;
  const currency = record?.currency ?? workOrder.currency ?? null;
  if (amount === null || amount === undefined || currency === null) {
    // Either no cost was recorded, or it was recorded without a currency and is
    // therefore not safely displayable as money.
    return { recorded: false, amount: null, currency: null };
  }
  return { recorded: true, amount: Number(amount), currency };
}

export async function getOwnerServiceHistory(supabaseClient, userContext) {
  const ownerId = userContext?.id || userContext?.userId || null;
  if (!ownerId) throw new ForbiddenError('An authenticated owner is required');

  const { data: vehicles, error: vehicleError } = await supabaseClient
    .from('vehicles')
    .select('vin')
    .eq('owner_id', ownerId);
  if (vehicleError) throw new DatabaseError(`Failed to load vehicles: ${vehicleError.message}`);
  const vins = (vehicles || []).map((v) => v.vin).filter(Boolean);
  if (!vins.length) return { entries: [], total: 0 };

  const { data: workOrders, error: workOrderError } = await supabaseClient
    .from('mechanic_work_orders')
    .select('*')
    .in('vin', vins);
  if (workOrderError) throw new DatabaseError(`Failed to load service history: ${workOrderError.message}`);
  const orders = workOrders || [];
  if (!orders.length) return { entries: [], total: 0 };

  const orderIds = orders.map((o) => o.id);
  const [{ data: records }, providers] = await Promise.all([
    supabaseClient.from('service_records').select('*').in('work_order_id', orderIds),
    loadProviders(supabaseClient, orders.map((o) => o.tenant_id)),
  ]);
  const recordByOrder = new Map();
  for (const r of records || []) recordByOrder.set(r.work_order_id, r);

  const recordIds = (records || []).map((r) => r.id);
  let observationsByRecord = new Map();
  if (recordIds.length) {
    const { data: observations } = await supabaseClient
      .from('service_mileage_observations')
      .select('*')
      .in('service_record_id', recordIds);
    for (const o of observations || []) {
      if (!observationsByRecord.has(o.service_record_id)) observationsByRecord.set(o.service_record_id, []);
      observationsByRecord.get(o.service_record_id).push(o);
    }
  }

  const entries = orders.map((workOrder) => {
    const record = recordByOrder.get(workOrder.id) || null;
    const observations = record ? (observationsByRecord.get(record.id) || []) : [];
    // The most recent observation, if any — reported as an observation, never as the
    // canonical odometer (plan §13.1).
    const latest = observations
      .slice()
      .sort((a, b) => String(b.observed_at || '').localeCompare(String(a.observed_at || '')))[0] || null;

    return {
      id: workOrder.id,
      vin: workOrder.vin,
      status: workOrder.status,
      // Preserved for existing consumers of this endpoint.
      description: workOrder.description ?? null,
      issue_description: workOrder.issue_description ?? null,
      total_cost: workOrder.total_cost ?? null,
      created_at: workOrder.created_at,

      // Service Network enrichment:
      service_case_id: workOrder.service_case_id || null,
      service_category: record?.service_category || workOrder.service_category || null,
      work_performed: record?.work_performed || null,
      // Provenance is stated, never assumed; with no service record the honest answer
      // is that provenance is unknown.
      provenance: record?.service_authority || 'unknown',
      provider: projectProvider(workOrder, providers),
      cost: projectCost(workOrder, record),
      // Completion time is the authoritative stamped column, never derived from updated_at.
      completed_at: workOrder.completed_at || null,
      cancelled_at: workOrder.cancelled_at || null,
      performed_at: record?.performed_at || null,
      mileage_observation: latest
        ? { observed_mileage: latest.observed_mileage, observed_at: latest.observed_at, source: latest.observation_source }
        : null,
    };
  });

  return { entries, total: entries.length };
}
