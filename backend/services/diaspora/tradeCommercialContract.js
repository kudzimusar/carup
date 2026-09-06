/**
 * Trade OS T6 — the commercial vocabulary.
 *
 * Mirrors the database CHECK constraints in 20260908090000. A value that is not here is not
 * storable, and a value that is storable must be here — the contract test asserts both directions,
 * because a vocabulary that drifts from its constraint is how invented categories get in.
 */

const set = (...values) => Object.freeze(new Set(values));

/**
 * The stage of the journey a charge belongs to. This identifies a charge's TYPE — it never
 * asserts the charge exists, and an absent stage is UNPRICED, not free.
 */
export const COST_STAGES = Object.freeze([
  'GOODS', 'ORIGIN', 'EXPORT', 'ORIGIN_TERMINAL', 'MAIN_CARRIAGE', 'INSURANCE', 'TRANSSHIPMENT',
  'DESTINATION_PORT', 'TRANSIT', 'IMPORT_CUSTOMS', 'REGULATORY', 'CLEARING', 'INLAND',
  'FINAL_DELIVERY', 'FINANCE', 'CARUP', 'EXCEPTIONS',
]);
export const COST_STAGE_SET = set(...COST_STAGES);

/** Human labels. Freight jargon is explanatory, never required knowledge (master plan §27). */
export const COST_STAGE_LABELS = Object.freeze({
  GOODS: 'The goods themselves',
  ORIGIN: 'Collection at origin',
  EXPORT: 'Export processing',
  ORIGIN_TERMINAL: 'Origin port / terminal',
  MAIN_CARRIAGE: 'Main transport',
  INSURANCE: 'Insurance',
  TRANSSHIPMENT: 'Transshipment',
  DESTINATION_PORT: 'Destination port',
  TRANSIT: 'Cross-border transit',
  IMPORT_CUSTOMS: 'Import duty and taxes',
  REGULATORY: 'Regulatory and inspection',
  CLEARING: 'Customs clearing',
  INLAND: 'Inland transport',
  FINAL_DELIVERY: 'Final delivery',
  FINANCE: 'Finance charges',
  CARUP: 'CarUp',
  EXCEPTIONS: 'Exceptions and extras',
});

/**
 * Is a charge part of the price, outside it, or unknown?
 *
 * EXCLUDED is emphatically NOT zero: "destination clearing: EXCLUDED" means the customer must
 * arrange and pay for it separately, which is a cost they will meet — not a cost of nothing.
 */
export const INCLUSIONS = Object.freeze(['INCLUDED', 'EXCLUDED', 'CONTINGENT', 'NOT_APPLICABLE', 'UNKNOWN']);
export const INCLUSION_SET = set(...INCLUSIONS);

/** How firm the number is. T6 never manufactures INVOICED/PAID/RECONCILED — those are T13. */
export const COMMERCIAL_STATUSES = Object.freeze(['INDICATIVE', 'QUOTED', 'CONFIRMED']);
export const COMMERCIAL_STATUS_SET = set(...COMMERCIAL_STATUSES);

/** Who says so. A provider typing a number makes it PROVIDER_STATED, never VERIFIED. */
export const PROVENANCES = Object.freeze([
  'CUSTOMER_ESTIMATED', 'CARUP_CALCULATED', 'PROVIDER_STATED', 'DOCUMENT_DERIVED',
  'VERIFIED', 'HISTORICAL_ACTUAL',
]);
export const PROVENANCE_SET = set(...PROVENANCES);

/** Provenance a client may assert. VERIFIED and HISTORICAL_ACTUAL are server-derived only. */
export const CLIENT_ASSERTABLE_PROVENANCE = set('CUSTOMER_ESTIMATED', 'PROVIDER_STATED');

/**
 * Whose money it is. The permanent rule: CarUp revenue is never labelled as a third party's
 * charge. This classification is what makes that checkable rather than merely intended.
 */
export const REVENUE_CLASSES = Object.freeze([
  'PASS_THROUGH_COST', 'GOVERNMENT_DUTY', 'TAX', 'PARTNER_CHARGE',
  'CARUP_SERVICE_FEE', 'CARUP_COMMISSION', 'CARUP_LOGISTICS_MARGIN', 'CONTINGENT_COST',
]);
export const REVENUE_CLASS_SET = set(...REVENUE_CLASSES);
export const CARUP_REVENUE_CLASSES = set('CARUP_SERVICE_FEE', 'CARUP_COMMISSION', 'CARUP_LOGISTICS_MARGIN');

export const CHARGE_BASES = Object.freeze(['FLAT', 'PER_CBM', 'PER_KG', 'PER_VEHICLE', 'PER_UNIT', 'PER_CONTAINER', 'PERCENTAGE']);
export const CHARGE_BASIS_SET = set(...CHARGE_BASES);

/** Rate/observation classification. A research figure is not a provider quote. */
export const RATE_CLASSIFICATIONS = Object.freeze([
  'PROVIDER_QUOTED', 'PROVIDER_RATE_CARD', 'OFFICIAL_FEE', 'RESEARCH_OBSERVATION',
  'CARUP_ESTIMATE', 'HISTORICAL_ACTUAL',
]);
export const RATE_CLASSIFICATION_SET = set(...RATE_CLASSIFICATIONS);

/** Allocation bases. There is deliberately no default — see tradeChargeAllocationService. */
export const ALLOCATION_BASES = Object.freeze(['CBM', 'WEIGHT', 'UNIT', 'FLAT', 'EXPLICIT']);
export const ALLOCATION_BASIS_SET = set(...ALLOCATION_BASES);

/**
 * Stages T6 must never price itself. IMPORT_CUSTOMS and REGULATORY amounts may be RECORDED when an
 * authority or provider supplies them with provenance, but T6 computes no duty, VAT, surtax,
 * excise or valuation — that engine is T12's, and a placeholder here would be a fabricated legal
 * assessment.
 */
export const T6_MUST_NOT_CALCULATE = set('IMPORT_CUSTOMS', 'REGULATORY');

/** Stages a customer generally needs priced before a journey cost is meaningful. */
export const MATERIAL_STAGES = Object.freeze(['GOODS', 'MAIN_CARRIAGE', 'CLEARING', 'INLAND', 'IMPORT_CUSTOMS']);

/**
 * Is this component's stage ANSWERED?
 *
 * Answered means the provider told us something usable: a price, or an explicit "excluded" or
 * "not applicable". Only UNKNOWN — and INCLUDED-but-unpriced — leaves a genuine gap.
 *
 * This lives here, once, because the coverage rule was originally written twice (the landed
 * estimate and the corridor comparison) and the two drifted the moment one was corrected.
 */
export function isStageAnswered(component) {
  const inclusion = component.inclusion;
  if (inclusion === 'NOT_APPLICABLE' || inclusion === 'EXCLUDED') return true;
  const amount = component.original ? component.original.amount : component.original_amount;
  return inclusion === 'INCLUDED' && amount !== null && amount !== undefined;
}

/** Is this component a genuine pricing GAP (as opposed to an answered non-cost)? */
export function isUnpricedGap(component) {
  const inclusion = component.inclusion;
  if (inclusion === 'NOT_APPLICABLE' || inclusion === 'EXCLUDED') return false;
  const amount = component.original ? component.original.amount : component.original_amount;
  return amount === null || amount === undefined;
}

/**
 * T6 — quote TOTAL versus structured BREAKDOWN.
 *
 * The provider's headline total already existed before T6 and is their stated commercial figure.
 * The component breakdown is new and may legitimately be partial. Conflating the two would let a
 * breakdown that itemises 2,250,000 of a 2,400,000 offer read as if the whole offer were explained.
 *
 * So: never assume sum(components) == total. Compute the difference, name it, and refuse a
 * "complete" declaration that does not actually reconcile.
 *
 * Mixed currencies are never summed to force agreement — if components are quoted in a currency
 * other than the total's, reconciliation is simply not computable and says so.
 */
export function reconcileBreakdown({ total, currency, components = [] }) {
  const totalAmount = total === null || total === undefined || total === '' ? null : Number(total);
  const priced = components.filter((c) => {
    const amount = c.original ? c.original.amount : c.original_amount;
    return amount !== null && amount !== undefined && c.inclusion === 'INCLUDED';
  });

  const byCurrency = {};
  for (const c of priced) {
    const cur = (c.original ? c.original.currency : c.original_currency) || null;
    const amount = Number(c.original ? c.original.amount : c.original_amount);
    if (!cur) continue;
    byCurrency[cur] = Number(((byCurrency[cur] || 0) + amount).toFixed(2));
  }
  const currencies = Object.keys(byCurrency);
  const itemised = currency && byCurrency[currency] !== undefined ? byCurrency[currency] : null;
  const foreignCurrencies = currencies.filter((c) => c !== currency);

  if (totalAmount === null || !currency) {
    return { computable: false, reason: 'The offer total or its currency is not recorded.', itemised_by_currency: byCurrency };
  }
  if (!priced.length) {
    return {
      computable: true, total: totalAmount, currency, itemised: null,
      not_itemised: totalAmount, complete: false, mixed_currency: false,
      itemised_by_currency: byCurrency,
      note: 'No components are itemised yet, so none of this total is explained.',
    };
  }
  if (foreignCurrencies.length) {
    // Adding JPY to USD to make the numbers agree would be a conversion nobody performed.
    return {
      computable: false, mixed_currency: true, total: totalAmount, currency,
      itemised_by_currency: byCurrency, foreign_currencies: foreignCurrencies,
      reason: `Components are quoted in ${foreignCurrencies.join(', ')} as well as ${currency}, so they cannot be reconciled against a single total without a conversion nobody has authorised.`,
    };
  }
  const difference = Number((totalAmount - (itemised || 0)).toFixed(2));
  return {
    computable: true, mixed_currency: false,
    total: totalAmount, currency, itemised: itemised || 0,
    not_itemised: difference,
    complete: Math.abs(difference) < 0.005,
    itemised_by_currency: byCurrency,
    note: Math.abs(difference) < 0.005
      ? 'Every part of this total is itemised.'
      : difference > 0
        ? `${difference} ${currency} of this total is not itemised.`
        : `The itemised components exceed the stated total by ${Math.abs(difference)} ${currency}.`,
  };
}
