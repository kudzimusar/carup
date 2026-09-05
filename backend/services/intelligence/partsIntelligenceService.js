/**
 * CarUp Intelligence 1.0 — I12 parts and supplier intelligence.
 *
 * The plan asks for parts demand, zero-result demand, compatibility, RFQ,
 * supplier performance and the PartSentry/provenance relationship. Reading the
 * live schema first settles which of those CarUp can actually answer, and the
 * answer is narrower than the list:
 *
 *   - part RFQs exist (`marketplace_inquiries.inquiry_type = 'part_quote_request'`)
 *     but every one of them has a NULL `seller_id`, `seller_tenant_id` and
 *     `listing_id`, and an empty `metadata`. So an RFQ records that somebody asked
 *     for a part — not WHICH part, and not WHO was asked;
 *   - there is no parts catalogue table anywhere, and no part↔vehicle fitment
 *     table, so compatibility has no source at all;
 *   - there is no supplier registry and no supplier login. `mechanic_parts.supplier`
 *     is free text on a garage's own private stock row, not a platform principal;
 *   - the activity ledger's zero-result event covers the VEHICLE marketplace
 *     search. No parts search surface exists, so counting those as unmet parts
 *     demand would attribute vehicle searches to parts.
 *
 * What remains is real and is served: RFQ volume and its status funnel, PartSentry
 * provenance, and a garage's own parts inventory. Everything else is declared
 * unmeasurable with the specific structural reason, rather than estimated.
 *
 * The two scopes frozen in I9 are preserved exactly. A PartSentry log belongs to a
 * PERSON (`mechanic_id`); a parts inventory belongs to an ORGANIZATION
 * (`tenant_id`). One never answers for the other.
 */
import { supabase as defaultClient } from '../../db/supabase.js';
import { readAllPages } from './rollupService.js';
import {
  AVAILABILITY,
  metric,
  rate,
  AuthorizationError,
  windowDates,
} from './intelligenceProjectionService.js';

export const PARTS_INTELLIGENCE_VERSION = 'parts_demand@1';

const PART_RFQ_TYPE = 'part_quote_request';

/** Statuses that mean the request was discarded rather than worked. */
const DISCARDED_STATUSES = new Set(['spam', 'rejected']);

/** A status that shows somebody actually responded to the request. */
const ENGAGED_STATUSES = new Set(['contacted', 'quoted', 'converted', 'closed', 'completed']);

export const NOT_MEASURABLE = Object.freeze([
  {
    key: 'demand_by_part',
    label: 'Demand by part',
    reason: 'rfq_records_no_part_reference',
    detail: 'A part quote request carries no listing reference and no structured part identity — only a free-text message. Which part was wanted was never recorded, so it cannot be counted.',
  },
  {
    key: 'supplier_attribution',
    label: 'Supplier attribution',
    reason: 'rfq_records_no_supplier',
    detail: 'No part quote request names a supplier. Every one has a null seller, so no request can be attributed to anybody and no supplier has a request queue to read.',
  },
  {
    key: 'supplier_performance',
    label: 'Supplier performance',
    reason: 'no_supplier_principal',
    detail: 'CarUp holds no supplier registry and no supplier login. The supplier field on a stock row is free text a garage typed about its own purchasing, not a platform party whose response time, win rate or fulfilment could be measured.',
  },
  {
    key: 'compatibility',
    label: 'Compatibility and fitment',
    reason: 'no_catalogue_or_fitment_data',
    detail: 'There is no parts catalogue and no table relating a part to the vehicles it fits. A compatibility claim would be invented outright, and a wrong one puts the wrong component on a car.',
  },
  {
    key: 'zero_result_parts_demand',
    label: 'Unmet parts demand',
    reason: 'no_parts_search_surface',
    detail: 'CarUp has no parts search. The ledger records zero-result searches of the vehicle marketplace, and counting those as unmet parts demand would attribute vehicle searches to parts.',
  },
  {
    key: 'cross_tenant_inventory',
    label: 'Platform-wide stock levels',
    reason: 'inventory_is_private_commercial_data',
    detail: 'A garage stock list is that organization\'s private commercial data. It is reported to its own organization and is not aggregated into a platform inventory view.',
  },
]);

function windowBounds(windowDays) {
  const dates = windowDates(windowDays);
  const start = new Date(`${dates[0]}T00:00:00.000Z`).toISOString();
  const end = new Date(new Date(`${dates[dates.length - 1]}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

function withinWindow(row, start, end) {
  return Boolean(row?.created_at) && row.created_at >= start && row.created_at < end;
}

/**
 * A recorded number, or null.
 *
 * `Number(null)` is 0 and `Number('')` is 0, so the obvious
 * `Number.isFinite(Number(v))` check reports a missing value as a real zero —
 * which is precisely the fake-zero this phase exists to remove. A part with no
 * stock level recorded must never be counted as out of stock, and one with no
 * price must never be valued at nothing.
 */
function recorded(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function notMeasurableFor(scope) {
  return NOT_MEASURABLE
    // A practitioner is not answering for platform-wide stock.
    .filter((entry) => !(scope === 'mechanic' && entry.key === 'cross_tenant_inventory'))
    .map((entry) => ({ ...entry }));
}

function unavailableEnvelope(windowDays, reason, scope) {
  return {
    scope,
    window_days: windowDays,
    availability: AVAILABILITY.UNAVAILABLE,
    reason: String(reason || 'parts_read_failed'),
    calculation_version: PARTS_INTELLIGENCE_VERSION,
    message: 'Parts intelligence could not be read. These figures are NOT zero.',
    not_measurable: notMeasurableFor(scope),
  };
}

/**
 * RFQ demand, which only the platform can see.
 *
 * Deliberately not exposed per-supplier: with no seller on any request there is
 * no supplier scope to filter to, and handing the platform-wide figure to one
 * party would present everybody's demand as theirs.
 */
export function buildRfqDemand(inquiries) {
  const worked = inquiries.filter((row) => !DISCARDED_STATUSES.has(String(row.status || '')));
  const engaged = worked.filter((row) => ENGAGED_STATUSES.has(String(row.status || '')));
  const byStatus = {};
  for (const row of worked) {
    const status = String(row.status || 'unknown');
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  return {
    requests_received: metric(worked.length),
    responded: metric(engaged.length),
    awaiting_response: metric(worked.length - engaged.length),
    response_rate: rate(engaged.length, worked.length, { min: 10 }),
    by_status: byStatus,
  };
}

/**
 * PartSentry provenance.
 *
 * `public_card_eligible` is the governed gate on what a log may say publicly, and
 * it is reported rather than recomputed. `suspicion_status` is counted but NOT
 * turned into a fraud verdict: flagging is a review input, and a flagged log here
 * is also a verified one. Fraud adjudication is a separate governed domain.
 */
export function buildProvenance(logs) {
  const verified = logs.filter((row) => String(row.part_verification_status) === 'verified');
  return {
    logs_recorded: metric(logs.length),
    parts_verified: metric(verified.length),
    awaiting_verification: metric(logs.length - verified.length),
    publicly_shareable: metric(logs.filter((row) => row.public_card_eligible === true).length),
    flagged_for_review: metric(logs.filter((row) => String(row.suspicion_status || 'none') !== 'none').length),
    verification_rate: rate(verified.length, logs.length, { min: 10 }),
  };
}

/**
 * A garage's own stock list.
 *
 * Two things are deliberately NOT done. An unrecorded stock level is not read as
 * zero, so it never lands in an out-of-stock count; and an unrecorded unit price
 * is excluded from the valuation, with the coverage stated, rather than being
 * summed in as zero and understating the total.
 */
export function buildInventory(parts) {
  const priced = parts.filter((row) => recorded(row.unit_price) !== null && recorded(row.stock_level) !== null);
  const withThreshold = parts.filter((row) => recorded(row.min_stock) !== null);
  const valuation = priced.reduce((sum, row) => sum + recorded(row.unit_price) * recorded(row.stock_level), 0);

  return {
    part_types_tracked: metric(parts.length),
    stock_recorded: metric(parts.filter((row) => recorded(row.stock_level) !== null).length),
    out_of_stock: metric(parts.filter((row) => recorded(row.stock_level) === 0).length),
    // Only parts that carry a threshold the garage actually set.
    below_reorder_threshold: withThreshold.length === 0
      ? metric(null, { availability: AVAILABILITY.INSUFFICIENT_DATA, reason: 'no_reorder_threshold_recorded' })
      : metric(withThreshold.filter((row) => {
        const stock = recorded(row.stock_level);
        return stock !== null && stock <= recorded(row.min_stock);
      }).length),
    stock_value: priced.length === 0 && parts.length > 0
      ? metric(null, { availability: AVAILABILITY.INSUFFICIENT_DATA, reason: 'no_priced_stock_recorded', unit: 'currency' })
      : metric(valuation, { unit: 'currency' }),
    valuation_coverage: {
      priced_parts: priced.length,
      total_parts: parts.length,
      note: priced.length === parts.length
        ? null
        : 'Parts with no recorded price or stock level are excluded from this value, so the true total is higher.',
    },
  };
}

async function readPartRfqs(client, { start, end }) {
  const rows = await readAllPages(() => client
    .from('marketplace_inquiries')
    .select('id, inquiry_type, status, source_channel, created_at')
    .eq('inquiry_type', PART_RFQ_TYPE));
  return rows.filter((row) => withinWindow(row, start, end));
}

/**
 * Parts intelligence for a PRACTITIONER: their own provenance logs, plus their
 * organization's stock where they have one.
 */
export async function getMechanicPartsIntelligence(client = defaultClient, actor = null, { windowDays = 30 } = {}) {
  const mechanicId = actor?.id ? String(actor.id) : null;
  if (!mechanicId) throw new AuthorizationError('Authentication required.');
  const tenantId = actor?.tenantId ? String(actor.tenantId) : null;
  const { start, end } = windowBounds(windowDays);

  let logs;
  let parts;
  try {
    logs = await readAllPages(() => client
      .from('partsentry_logs')
      .select('id, mechanic_id, part_verification_status, verification_status, suspicion_status, public_card_eligible, created_at')
      // The person scope never widens: a log with no mechanic is not this
      // practitioner's work, and this filter already refuses to match it.
      .eq('mechanic_id', mechanicId));
    parts = tenantId
      ? await readAllPages(() => client
        .from('mechanic_parts')
        .select('id, stock_level, min_stock, unit_price, tenant_id')
        .eq('tenant_id', tenantId))
      : [];
  } catch (error) {
    return unavailableEnvelope(windowDays, error?.message, 'mechanic');
  }

  return {
    scope: 'mechanic',
    window_days: windowDays,
    availability: AVAILABILITY.VALUE,
    calculation_version: PARTS_INTELLIGENCE_VERSION,
    provenance: buildProvenance(logs.filter((row) => withinWindow(row, start, end))),
    inventory: tenantId
      ? buildInventory(parts)
      : { unavailable: true, reason: 'no_organization_context', note: 'A parts inventory belongs to an organization. You are not currently in one.' },
    scope_note: 'Your own PartSentry records, and your organization\'s stock. Not the whole platform.',
    not_measurable: notMeasurableFor('mechanic'),
  };
}

/**
 * Platform parts intelligence: RFQ demand and provenance across CarUp.
 */
export async function getPlatformPartsIntelligence(client = defaultClient, actor = null, { windowDays = 30 } = {}) {
  const role = String(actor?.platformRole || actor?.role || '');
  if (!['admin', 'platform_admin', 'super_admin'].includes(role)) {
    throw new AuthorizationError('Platform parts intelligence requires a platform administrator.');
  }
  const { start, end } = windowBounds(windowDays);

  let inquiries;
  let logs;
  try {
    inquiries = await readPartRfqs(client, { start, end });
    logs = await readAllPages(() => client
      .from('partsentry_logs')
      .select('id, mechanic_id, part_verification_status, verification_status, suspicion_status, public_card_eligible, created_at'));
  } catch (error) {
    return unavailableEnvelope(windowDays, error?.message, 'platform');
  }

  return {
    scope: 'platform',
    window_days: windowDays,
    availability: AVAILABILITY.VALUE,
    calculation_version: PARTS_INTELLIGENCE_VERSION,
    rfq_demand: buildRfqDemand(inquiries),
    provenance: buildProvenance(logs.filter((row) => withinWindow(row, start, end))),
    not_measurable: notMeasurableFor('platform'),
    domain_boundary: 'Parts demand and provenance only. Fraud adjudication on a flagged part is a separate governed domain and is not decided here.',
  };
}
