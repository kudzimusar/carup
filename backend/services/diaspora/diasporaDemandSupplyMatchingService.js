/**
 * Phase 4 — deterministic, explainable demand/supply matching.
 *
 * Given a buyer order, return candidate stock items with a transparent score and human-readable
 * reasons. Excludes unavailable stock. No opaque AI scoring (directive §17).
 */
import { MATCH_WEIGHTS } from '../../constants/diaspora/diasporaRfqConstants.js';
import { requireUserContext } from './diasporaAuthorization.js';
import { resolveClient, paging } from './diasporaServiceUtils.js';
import { deriveBalances } from './diasporaStockLedgerService.js';

function norm(value) {
  return String(value || '').trim().toLowerCase();
}

export function scoreStockAgainstOrder(order, item) {
  const reasons = [];
  let score = 0;

  const reqMake = norm(order.requested_make);
  const reqModel = norm(order.requested_model);
  if (reqMake && norm(item.vehicle_make) === reqMake) {
    score += MATCH_WEIGHTS.MAKE;
    reasons.push(`Make matches ${order.requested_make}`);
  }
  if (reqModel && norm(item.vehicle_model) === reqModel) {
    score += MATCH_WEIGHTS.MODEL;
    reasons.push(`Model matches ${order.requested_model}`);
  }

  const yMin = order.requested_year_min;
  const yMax = order.requested_year_max;
  if (yMin || yMax) {
    const itemMin = item.vehicle_year_min ?? null;
    const itemMax = item.vehicle_year_max ?? null;
    const lo = yMin ?? -Infinity;
    const hi = yMax ?? Infinity;
    const ilo = itemMin ?? -Infinity;
    const ihi = itemMax ?? Infinity;
    const overlaps = ilo <= hi && ihi >= lo;
    if (overlaps && (itemMin !== null || itemMax !== null)) {
      score += MATCH_WEIGHTS.YEAR;
      reasons.push('Year range overlaps');
    }
  }

  // Part-number signal from the order (chassis/part hints in metadata).
  const reqPart = norm(order.metadata?.requested_part_number);
  if (reqPart && [norm(item.part_number), norm(item.oem_number), norm(item.aftermarket_number)].includes(reqPart)) {
    score += MATCH_WEIGHTS.PART_NUMBER;
    reasons.push('Part number matches');
  }

  const balances = item.balances || deriveBalances(item);
  if (balances.available > 0) {
    score += MATCH_WEIGHTS.AVAILABILITY;
    reasons.push(`Available quantity ${balances.available}`);
  }

  if (item.export_readiness_status === 'EXPORT_READY') {
    score += MATCH_WEIGHTS.EXPORT_READY;
    reasons.push('Export ready');
  }

  return { score, reasons, available: balances.available };
}

/**
 * Find matches for a buyer order among PUBLISHED stock with availability. Returns ranked candidates
 * with reasons. Caller must already be authorized to read the order.
 */
export async function matchSupplyForOrder(order, userContext = {}, options = {}) {
  requireUserContext(userContext);
  const client = await resolveClient(options);
  const { limit } = paging({ limit: options.limit || 25 });

  const { data: stock, error } = await client
    .from('diaspora_stock_items')
    .select('*')
    .eq('publication_status', 'PUBLISHED')
    .is('deleted_at', null);
  if (error) return [];

  const candidates = (stock || [])
    .map((item) => ({ ...item, balances: deriveBalances(item) }))
    .filter((item) => item.balances.available > 0) // exclude unavailable stock
    .map((item) => {
      const { score, reasons, available } = scoreStockAgainstOrder(order, item);
      return {
        stockItemId: item.id,
        partName: item.part_name,
        sku: item.sku,
        vehicleMake: item.vehicle_make,
        vehicleModel: item.vehicle_model,
        available,
        unitPrice: item.unit_price,
        currency: item.currency,
        sellerTradeProfileId: item.seller_trade_profile_id,
        score,
        reasons,
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return candidates;
}
