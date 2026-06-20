/**
 * Marketplace pricing / all-in landed-cost estimator.
 *
 * PURE, DETERMINISTIC by default. Produces a MarketplacePricingSummary (shared/types/marketplace.ts)
 * with a conservative fair-price band and transparent cost components. AI price intelligence, when
 * available, may refine these, but the deterministic bands are the safe fallback (confidence 'low').
 * Never asserts authoritative pricing — everything is advisory and labelled.
 */

const FAIR_BAND_RATIO = 0.12; // +/-12% deterministic fair band around the asking price.
const SERVICE_FEE_RATIO = 0.015; // 1.5% platform service fee estimate.
const LOCAL_TRANSPORT_RATIO = 0.02; // 2% of price, capped.
const LOCAL_TRANSPORT_CAP = 350;
const INSPECTION_FLAT = 80;
const DOCUMENTATION_FLAT = 120;
// Import / container components apply only to import-style listings.
const EXPORT_IMPORT_RATIO = 0.18;
const CONTAINER_SHIPPING_FLAT = 1800;

function round(value) {
  return Math.round(Number(value) || 0);
}

function isImportListing(listingType) {
  return ['import_request', 'container_space', 'diaspora_request'].includes(listingType) ||
    listingType === 'recently_imported';
}

/**
 * @param {object} args
 * @param {object} args.listingSummary buildMarketplaceListingSummary output (price, currency, condition_category)
 * @param {string} [args.listingType='vehicle']
 * @param {number} [args.referralDiscount=0]
 * @param {boolean} [args.includeImportComponents] override; defaults from condition/listing type
 */
export function buildPricingSummary({ listingSummary = {}, listingType = 'vehicle', referralDiscount = 0, includeImportComponents } = {}) {
  const asking = Number(listingSummary.price) || 0;
  const currency = listingSummary.currency || 'USD';
  const conditionCategory = listingSummary.condition_category;
  const importComponents = includeImportComponents ?? (isImportListing(listingType) || conditionCategory === 'recently_imported');

  const price_warnings = [];
  if (asking <= 0) {
    price_warnings.push('No asking price published — request a quote.');
  }

  const estimated_fair_min = asking > 0 ? round(asking * (1 - FAIR_BAND_RATIO)) : undefined;
  const estimated_fair_max = asking > 0 ? round(asking * (1 + FAIR_BAND_RATIO)) : undefined;

  const inspection_estimate = INSPECTION_FLAT;
  const local_transport_estimate = asking > 0 ? Math.min(round(asking * LOCAL_TRANSPORT_RATIO), LOCAL_TRANSPORT_CAP) : 0;
  const documentation_estimate = DOCUMENTATION_FLAT;
  const service_fee_estimate = asking > 0 ? round(asking * SERVICE_FEE_RATIO) : 0;
  const export_import_estimate = importComponents && asking > 0 ? round(asking * EXPORT_IMPORT_RATIO) : undefined;
  const container_shipping_estimate = importComponents ? CONTAINER_SHIPPING_FLAT : undefined;
  const referral_discount_estimate = referralDiscount > 0 ? round(referralDiscount) : undefined;

  const components = [
    asking,
    inspection_estimate,
    local_transport_estimate,
    documentation_estimate,
    service_fee_estimate,
    export_import_estimate || 0,
    container_shipping_estimate || 0,
  ];
  const estimated_total = asking > 0
    ? round(components.reduce((sum, n) => sum + (Number(n) || 0), 0) - (referral_discount_estimate || 0))
    : undefined;

  if (importComponents) {
    price_warnings.push('Import estimates are provisional and exclude live ZIMRA duty assessment.');
  }

  return {
    asking_price: asking || undefined,
    currency,
    estimated_fair_min,
    estimated_fair_max,
    price_confidence: 'low',
    inspection_estimate,
    local_transport_estimate,
    export_import_estimate,
    container_shipping_estimate,
    documentation_estimate,
    service_fee_estimate,
    referral_discount_estimate,
    estimated_total,
    price_warnings,
    estimate_basis: 'deterministic',
  };
}
