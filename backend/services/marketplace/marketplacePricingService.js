/**
 * Marketplace pricing / all-in landed-cost estimator.
 *
 * PURE, DETERMINISTIC by default. Produces a MarketplacePricingSummary (shared/types/marketplace.ts)
 * with a conservative fair-price band and transparent cost components. AI price intelligence, when
 * available, may refine these, but the deterministic bands are the safe fallback (confidence 'low').
 * Never asserts authoritative pricing — everything is advisory and labelled.
 *
 * ===========================================================================================
 * ISSUE #164 PHASE 4 — THIS ESTIMATOR STATES A CURRENCY AND A PRICE; IT NEVER CHOOSES EITHER.
 *
 * Two substitutions lived on the first two lines of the builder and both survived the phase that
 * was supposed to remove them, because they had been MOVED rather than deleted:
 *
 *   · `listingSummary.currency || 'USD'` — the read path above this one (listingSummaryService)
 *     publishes a PROVENANCE-GATED currency: NULL unless a `currency_source` names who asserted it.
 *     This line re-invented 'USD' one level down, so a single detail response answered "what
 *     currency is this listing in?" twice and differently: `currency: null` at the top level and
 *     `pricing_summary.currency: "USD"` in the same body. Two answers to one question is worse
 *     than either answer alone — a consumer that reads the wrong one cannot even tell it disagreed
 *     with the other. The gate is re-derived here rather than inherited; see `currencyClaim` below
 *     for why a caller's asserted `currency_state` is not accepted in its place.
 *
 *   · `Number(listingSummary.price) || 0` — an unrecorded, blank or non-numeric price became a
 *     recorded 0, and the estimator then priced the listing off that zero: a flat inspection fee,
 *     a flat documentation fee and (for an import listing) a flat container-shipping figure were
 *     all published, alongside a 0-valued transport and service fee. A listing with no published
 *     price was handed a costed, itemised estimate. THE RULE HERE IS THE SAME ONE THE WRITE PATH
 *     APPLIES TO mileage: where a fact was never recorded, the honest output is nothing, not zero.
 *
 * Both are now stated pairs built with the canonical contract's `statedValue()` — `asking_price`
 * and `currency` carry their value only when recorded, and a companion `*_state` says which of the
 * four FIELD_STATES applies. This file consumes that contract; it does not restate it.
 *
 * ── THE CONSTANTS BELOW ARE DENOMINATED, AND THE DENOMINATION IS NOW PUBLISHED ─────────────
 * `INSPECTION_FLAT`, `DOCUMENTATION_FLAT`, `CONTAINER_SHIPPING_FLAT` and `LOCAL_TRANSPORT_CAP` are
 * absolute amounts, not ratios, so they mean nothing without a currency — and they were written
 * against USD. While `currency || 'USD'` was in place that assumption was self-fulfilling and
 * invisible. With the substitution gone it becomes a real, reportable limitation: a listing priced
 * in another currency would otherwise have USD amounts silently added to its total.
 *
 * The resolution is to STATE it, not to hide it and not to invent an exchange rate: whenever
 * denominated components are actually published, the summary carries `estimate_denomination` and a
 * price warning naming the mismatch if the listing's currency is unrecorded or different. The
 * ratio-derived components (fair band, service fee, export/import, the uncapped part of local
 * transport) are proportions of the asking price and are therefore already in the listing's own
 * currency.
 *
 * `estimate_denomination` IS OMITTED WHEN NO COMPONENT IS PUBLISHED, and that is not cosmetic. On an
 * unpriced listing there is no cost figure to denominate, so naming a currency would put the string
 * 'USD' into the body of a listing whose currency is not recorded — which is the defect this file
 * just removed, wearing a different key. Rule 2 of the claim contract in the same shape: nothing
 * estimated means nothing to denominate.
 *
 * A stronger closure — withholding the denominated components entirely on a non-USD listing — is
 * NOT taken here because backend/tests/marketplace-v1-spine.test.js:170 pins a currency-less
 * listing to a populated `container_shipping_estimate`, and weakening another lane's test to widen
 * this one is not this file's call. Recorded as an open finding rather than worked around.
 * ===========================================================================================
 */

import { FIELD_STATES, attestedValue, isRecordedValue, statedValue } from '../../utils/publicVehicleProjection.js';

const FAIR_BAND_RATIO = 0.12; // +/-12% deterministic fair band around the asking price.
const SERVICE_FEE_RATIO = 0.015; // 1.5% platform service fee estimate.
const LOCAL_TRANSPORT_RATIO = 0.02; // 2% of price, capped.
const LOCAL_TRANSPORT_CAP = 350;
const INSPECTION_FLAT = 80;
const DOCUMENTATION_FLAT = 120;
// Import / container components apply only to import-style listings.
const EXPORT_IMPORT_RATIO = 0.18;
const CONTAINER_SHIPPING_FLAT = 1800;

/**
 * The currency the ABSOLUTE constants above are expressed in.
 *
 * This is the one place 'USD' is allowed to appear in this file, and it is a different kind of
 * statement from the one that was removed: it does not answer "what currency is this listing in?"
 * — only the seller's recorded `vehicles.currency` may answer that — it answers "what currency are
 * CarUp's own flat cost estimates quoted in?", which is a fact about this module's constants and
 * about nothing else. Published alongside those estimates, and only alongside them, so a consumer
 * can reconcile the two rather than assume they agree.
 */
export const ESTIMATE_DENOMINATION = 'USD';

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
  // THE ASKING PRICE IS A RECORDED NUMBER OR IT IS NOTHING. `isRecordedValue` supplies Rule 4 of
  // the claim contract unchanged: a genuine 0 is a recorded fact and is reported as one, while
  // null/undefined/''/whitespace/NaN are not prices and are not turned into one.
  const rawAsking = listingSummary.price;
  const numericAsking = Number(rawAsking);
  const askingRecorded = isRecordedValue(rawAsking) && Number.isFinite(numericAsking);
  const askingClaim = statedValue(askingRecorded ? numericAsking : null);

  // The listing's currency, RE-DERIVED FROM VALUE AND SOURCE — the same gate listingSummaryService
  // applies, not a restatement of its answer.
  //
  // This was `statedValue(listingSummary.currency)`, which asked only "is this string non-blank?".
  // That was enough while the only caller was the listing summary, and not enough for anything
  // else: `buildPricingSummary({ listingSummary: { price: 10000, currency: 'USD' } })` — a shape
  // this module is called with directly — turned a currency nobody had attested into
  // `currency_state: 'recorded'` inside the pricing block. The summary above gates currency on
  // `currency_source`; if this line trusted a bare string, a caller could route around that gate by
  // handing the estimator a hand-built object, and the fabricated 'USD' would reappear one level
  // down exactly as `currency || 'USD'` once did.
  //
  // Reading `listingSummary.currency_state` instead would be worse, not better: it would make this
  // module trust a state its caller asserted, and a state can be asserted by anyone. Value + source
  // is the only pair from which the claim can be RE-COMPUTED, so the two layers cannot drift and
  // neither can be talked past. A genuinely attested currency round-trips unchanged.
  const currencyClaim = attestedValue(listingSummary.currency, listingSummary.currency_source);

  const conditionCategory = listingSummary.condition_category;
  const importComponents = includeImportComponents ?? (isImportListing(listingType) || conditionCategory === 'recently_imported');

  // Every component below is derived from the asking price — the ratios directly, the flats as
  // additions to it — so without a positive recorded price there is no basis for ANY of them.
  // A recorded 0 is a fact about the price and still not a basis for a percentage of it.
  const priced = askingRecorded && numericAsking > 0;
  const asking = priced ? numericAsking : 0;

  const price_warnings = [];
  if (!priced) {
    price_warnings.push('No asking price published — request a quote.');
    // Said explicitly rather than left to be inferred from missing keys: the previous shape
    // published inspection, documentation and container-shipping figures for exactly this listing.
    price_warnings.push('No cost estimate is produced without a published asking price — the components below are omitted rather than estimated from zero.');
  }

  const estimated_fair_min = priced ? round(asking * (1 - FAIR_BAND_RATIO)) : undefined;
  const estimated_fair_max = priced ? round(asking * (1 + FAIR_BAND_RATIO)) : undefined;

  const inspection_estimate = priced ? INSPECTION_FLAT : undefined;
  const local_transport_estimate = priced ? Math.min(round(asking * LOCAL_TRANSPORT_RATIO), LOCAL_TRANSPORT_CAP) : undefined;
  const documentation_estimate = priced ? DOCUMENTATION_FLAT : undefined;
  const service_fee_estimate = priced ? round(asking * SERVICE_FEE_RATIO) : undefined;
  const export_import_estimate = priced && importComponents ? round(asking * EXPORT_IMPORT_RATIO) : undefined;
  const container_shipping_estimate = priced && importComponents ? CONTAINER_SHIPPING_FLAT : undefined;
  const referral_discount_estimate = priced && referralDiscount > 0 ? round(referralDiscount) : undefined;

  const estimated_total = priced
    ? round(
      [
        asking,
        inspection_estimate,
        local_transport_estimate,
        documentation_estimate,
        service_fee_estimate,
        export_import_estimate,
        container_shipping_estimate,
      ].reduce((sum, n) => sum + (typeof n === 'number' ? n : 0), 0)
      - (referral_discount_estimate || 0),
    )
    : undefined;

  if (importComponents && priced) {
    price_warnings.push('Import estimates are provisional and exclude live ZIMRA duty assessment.');
  }

  // THE DENOMINATION MISMATCH, NAMED. Only meaningful once there are denominated components to
  // mismatch, so it is gated on `priced` like the components themselves.
  if (priced) {
    if (currencyClaim.state !== FIELD_STATES.RECORDED) {
      price_warnings.push(
        `Fixed cost components (inspection, documentation, container shipping and the local-transport cap) are denominated in ${ESTIMATE_DENOMINATION}. This listing's currency is not recorded, so the total cannot be reconciled to the asking price.`,
      );
    } else if (currencyClaim.value !== ESTIMATE_DENOMINATION) {
      price_warnings.push(
        `Fixed cost components (inspection, documentation, container shipping and the local-transport cap) are denominated in ${ESTIMATE_DENOMINATION}, and this listing is priced in ${currencyClaim.value}. No exchange rate is applied, so the total mixes two currencies.`,
      );
    }
  }

  return {
    // Stated pairs, flattened onto the existing keys so no consumer has to change to stop reading
    // a fabricated value — the `*_state` companions are what tell an absent price or currency apart
    // from a recorded one. Same shape the listing-detail seller block already publishes.
    asking_price: askingClaim.value,
    asking_price_state: askingClaim.state,
    currency: currencyClaim.value,
    currency_state: currencyClaim.state,
    // Carried so the pair stays re-derivable one more hop out, exactly as it is here.
    currency_source: currencyClaim.source,
    // Present only when there is a denominated figure below to attach it to. See the header.
    estimate_denomination: priced ? ESTIMATE_DENOMINATION : undefined,
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
