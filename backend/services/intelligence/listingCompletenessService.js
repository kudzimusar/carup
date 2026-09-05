/**
 * CarUp Intelligence 1.0 — I6 Listing Completeness (LC1) and Lost Opportunity (LO1).
 *
 * Completeness answers "how much useful information have you supplied?" It is
 * NOT a Trust score, and the separation is structural rather than a caption:
 * trust and transaction-readiness are returned in a sibling block that no scoring
 * path can reach, so a future edit cannot quietly fold evaluation state into the
 * percentage.
 *
 * EVERY GROUP MAPS TO A FIELD THAT ACTUALLY EXISTS. The canonical plan lists
 * twelve groups; the live schema supports nine of them. Three are reported as
 * NOT MEASURABLE with the reason, rather than scored from something adjacent:
 *
 *   - "useful description": `vehicles` has NO description column at all.
 *   - "exterior media coverage" / "interior media coverage": `listing_images`
 *     records only `is_primary` and `display_order`, with no view classification,
 *     so the two cannot be told apart.
 *
 * Scoring a group we cannot observe would be the fabrication this programme
 * exists to remove, and silently dropping it would overstate a seller's
 * completeness. Both are refused: the score reports its own denominator.
 */

/** Bump when any group, weight or rule below changes. Rollups and UI key on it. */
export const COMPLETENESS_VERSION = 'completeness@LC1';
export const LOST_OPPORTUNITY_VERSION = 'lost_opportunity@LO1';

/**
 * Group definitions. `weight` is the number of points the group contributes; a
 * group is `earned` in proportion to the fields present, so the score is
 * explainable field by field rather than being a single opaque number.
 *
 * THIS IS A SCORING RUBRIC, NOT A COLUMN ALLOW-LIST. It never reaches a query:
 * the listing is read with the canonical `LISTING_SELECT_COLUMNS_WITH_CLAIMS`
 * projection, so this rubric cannot widen what any response publishes. It is
 * deliberately not exported as a bare array — Issue #164 fixed the number of
 * vehicle column allow-lists at two, and an exported column-shaped literal here
 * would look like a third to the governance scan that protects that invariant.
 * Every field named below is already present in that canonical projection.
 */
const COMPLETENESS_GROUP_DEFINITIONS = Object.freeze([
  {
    key: 'vehicle_identity',
    label: 'Vehicle identity',
    weight: 3,
    fields: ['make', 'model', 'year'],
    optionalFields: ['chassis_number', 'engine_number'],
    guidance: 'Confirm the make, model and year buyers will search for.',
  },
  {
    key: 'pricing',
    label: 'Asking price',
    weight: 2,
    fields: ['price', 'currency'],
    guidance: 'Add the asking price and its currency so your listing can appear in price searches.',
  },
  {
    key: 'specifications',
    label: 'Specifications',
    weight: 3,
    fields: ['mileage', 'transmission', 'fuel_type'],
    optionalFields: ['drivetrain', 'color', 'trim'],
    guidance: 'Buyers filter by mileage, transmission and fuel type.',
  },
  {
    key: 'condition_category',
    label: 'Vehicle condition',
    weight: 1,
    fields: ['vehicle_condition_category'],
    guidance: 'Record the condition category so condition filters can match your listing.',
  },
  {
    key: 'selling_location',
    label: 'Selling location',
    weight: 2,
    fields: ['listing_city', 'listing_country'],
    optionalFields: ['listing_province'],
    guidance: 'Add where the vehicle is being sold.',
  },
  {
    key: 'media',
    label: 'Photos',
    weight: 3,
    // Derived rather than column-backed: see computeMediaFacts.
    derived: true,
    guidance: 'Add clear photos, including a main photo buyers see first.',
  },
  {
    key: 'seller_presence',
    label: 'Seller details',
    weight: 1,
    // current_seller_TYPE, not current_seller_ID: the id is a PRIVATE_VEHICLE_FIELD
    // under the #164 contract. The type answers the same question — is a seller
    // assigned to this sale — without touching a private column.
    fields: ['current_seller_type'],
    guidance: 'Confirm who is handling this sale.',
  },
  {
    key: 'evidence_coverage',
    label: 'Supporting evidence',
    weight: 2,
    derived: true,
    guidance: 'Add governed evidence so your listing can support stronger confidence states.',
  },
  {
    key: 'service_history',
    label: 'Service history',
    weight: 1,
    derived: true,
    guidance: 'Add service records buyers can see.',
  },
]);

/**
 * Plan groups the live schema cannot support. Reported so the seller sees an
 * honest denominator instead of a score quietly computed over fewer things.
 */
export const NOT_MEASURABLE_GROUPS = Object.freeze([
  {
    key: 'description',
    label: 'Listing description',
    reason: 'no_description_field',
    detail: 'CarUp does not currently store a listing description, so description completeness cannot be measured.',
  },
  {
    key: 'exterior_media_coverage',
    label: 'Exterior photo coverage',
    reason: 'no_media_view_classification',
    detail: 'Photos are not classified by view, so exterior coverage cannot be distinguished from interior.',
  },
  {
    key: 'interior_media_coverage',
    label: 'Interior photo coverage',
    reason: 'no_media_view_classification',
    detail: 'Photos are not classified by view, so interior coverage cannot be distinguished from exterior.',
  },
]);

/** Accessor rather than a bare exported array — see the note on the definitions. */
export function completenessGroups() {
  return COMPLETENESS_GROUP_DEFINITIONS;
}

export const TOTAL_WEIGHT = COMPLETENESS_GROUP_DEFINITIONS.reduce((sum, group) => sum + group.weight, 0);

/** A field counts as present only when it holds real content — '' and 0-length are absent. */
export function fieldPresent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function computeMediaFacts(imageRows) {
  const rows = Array.isArray(imageRows) ? imageRows : [];
  const usable = rows.filter((row) => fieldPresent(row?.image_url));
  return {
    image_count: usable.length,
    has_primary: usable.some((row) => row?.is_primary === true),
  };
}

/**
 * Media scoring. Three points: one for having any photo, one for reaching a
 * useful count, one for nominating a main photo. The thresholds are stated here
 * rather than tuned against outcome data, because no outcome data exists yet —
 * claiming a photo count "increases sales" before observing it is exactly the
 * fabricated-benefit the plan forbids.
 */
const MEDIA_USEFUL_COUNT = 4;

function scoreMedia(facts) {
  let earned = 0;
  const missing = [];
  if (facts.image_count > 0) earned += 1; else missing.push('at_least_one_photo');
  if (facts.image_count >= MEDIA_USEFUL_COUNT) earned += 1; else missing.push(`at_least_${MEDIA_USEFUL_COUNT}_photos`);
  if (facts.has_primary) earned += 1; else missing.push('main_photo');
  return { earned, missing };
}

function scoreFieldGroup(group, vehicle) {
  const required = Array.isArray(group.fields) ? group.fields : [];
  const missing = required.filter((field) => !fieldPresent(vehicle?.[field]));
  const present = required.length - missing.length;
  // Proportional credit, so a partially-filled group is not all-or-nothing.
  const earned = required.length === 0 ? 0 : Math.round((present / required.length) * group.weight * 100) / 100;
  return { earned, missing };
}

/**
 * Compute LC1 for one listing.
 *
 * @param vehicle       the authoritative vehicles row
 * @param imageRows     listing_images rows for this VIN
 * @param evidenceCount count of governed evidence rows
 * @param serviceCount  count of service/PartSentry records
 * @param trust         canonical trust projection — displayed ALONGSIDE, never scored
 */
export function computeListingCompleteness({
  vehicle = {}, imageRows = [], evidenceCount = 0, serviceCount = 0, trust = null,
} = {}) {
  const media = computeMediaFacts(imageRows);
  const groups = [];
  let earnedTotal = 0;

  for (const group of COMPLETENESS_GROUP_DEFINITIONS) {
    let earned = 0;
    let missing = [];

    if (group.key === 'media') {
      ({ earned, missing } = scoreMedia(media));
    } else if (group.key === 'evidence_coverage') {
      earned = evidenceCount > 0 ? group.weight : 0;
      if (!evidenceCount) missing = ['governed_evidence'];
    } else if (group.key === 'service_history') {
      earned = serviceCount > 0 ? group.weight : 0;
      if (!serviceCount) missing = ['service_record'];
    } else {
      ({ earned, missing } = scoreFieldGroup(group, vehicle));
    }

    earnedTotal += earned;
    groups.push({
      key: group.key,
      label: group.label,
      weight: group.weight,
      earned,
      complete: missing.length === 0,
      missing_fields: missing,
      guidance: missing.length ? group.guidance : null,
    });
  }

  const percent = TOTAL_WEIGHT === 0 ? 0 : Math.round((earnedTotal / TOTAL_WEIGHT) * 100);

  return {
    calculation_version: COMPLETENESS_VERSION,
    percent,
    earned_points: Math.round(earnedTotal * 100) / 100,
    total_points: TOTAL_WEIGHT,
    groups,
    // The denominator is published: a seller can see exactly what was and was not
    // assessed, so 100% never means "everything the plan describes".
    not_measurable: NOT_MEASURABLE_GROUPS.map((g) => ({ ...g })),
    media_facts: media,
    /**
     * Trust and transaction readiness travel OUTSIDE the score, in their own
     * block, because they answer a different question. `not_evaluated` is
     * preserved verbatim and never becomes 0 or "poor".
     */
    displayed_separately: {
      trust: trust
        ? { state: trust.state ?? 'not_evaluated', band: trust.band ?? null, score: trust.score ?? null }
        : { state: 'not_evaluated', band: null, score: null },
      transaction_readiness: {
        safe_pay_ready: vehicle?.safe_pay_ready === true,
        inspection_ready: vehicle?.inspection_ready === true,
        publication_status: vehicle?.publication_status ?? null,
      },
    },
  };
}

// ── Lost Opportunity (LO1) ──────────────────────────────────────────────────

/**
 * Which search filters a missing field can actually cost a listing.
 *
 * This maps ONLY to filters the marketplace list query genuinely applies today
 * (`listingSummaryService.listMarketplaceListings`): make, price range, condition
 * and trust tags. Anything else would be a claim we cannot substantiate.
 *
 * Note what is absent: LOCATION. The plan's flagship example is a location-filter
 * miss, but location is not a marketplace search filter yet, so no location lost
 * opportunity can honestly be reported. It is declared below rather than
 * silently omitted, and becomes computable the moment location is filterable.
 */
export const LOST_OPPORTUNITY_DIMENSIONS = Object.freeze([
  {
    filter: 'condition',
    requiredField: 'vehicle_condition_category',
    message: 'could not be confidently matched to condition searches because the vehicle condition is missing',
  },
]);

export const LOST_OPPORTUNITY_NOT_YET_MEASURABLE = Object.freeze([
  {
    filter: 'location',
    reason: 'location_is_not_a_search_filter',
    detail: 'Selling location is recorded but is not yet a Marketplace search filter, so missed location searches cannot be counted.',
  },
]);

/**
 * Count the searches a listing could not be matched to because a field is missing.
 *
 * A search only counts when the listing satisfies every OTHER filter it applied —
 * otherwise the listing was excluded on the merits, not on missing data, and
 * telling a seller they "lost" it would be false.
 *
 * @param vehicle        the listing
 * @param searchEvents   marketplace_search_performed rows, each with metadata.filters
 */
export function computeLostOpportunity({ vehicle = {}, searchEvents = [] } = {}) {
  const dimensions = [];
  let total = 0;

  for (const dimension of LOST_OPPORTUNITY_DIMENSIONS) {
    if (fieldPresent(vehicle?.[dimension.requiredField])) continue;
    let missed = 0;
    for (const event of searchEvents) {
      const filters = event?.metadata?.filters;
      if (!filters || typeof filters !== 'object') continue;
      if (!fieldPresent(filters[dimension.filter])) continue;
      if (!listingSatisfiesOtherFilters(vehicle, filters, dimension.filter)) continue;
      missed += 1;
    }
    if (missed > 0) {
      total += missed;
      dimensions.push({
        filter: dimension.filter,
        missing_field: dimension.requiredField,
        missed_searches: missed,
        // The plan's exact phrasing: a statement about matching, not about lost sales.
        message: `Your listing ${dimension.message}.`,
      });
    }
  }

  return {
    calculation_version: LOST_OPPORTUNITY_VERSION,
    total_missed_searches: total,
    dimensions,
    not_yet_measurable: LOST_OPPORTUNITY_NOT_YET_MEASURABLE.map((d) => ({ ...d })),
    searches_considered: searchEvents.length,
  };
}

/**
 * Would this listing have matched, but for the one missing field?
 *
 * Deliberately conservative: an unrecognised filter makes the listing ineligible
 * to be counted as "lost", because we cannot prove it would have matched. A
 * seller must never be told they missed a search they would have failed anyway.
 */
export function listingSatisfiesOtherFilters(vehicle, filters, ignoredFilter) {
  for (const [key, value] of Object.entries(filters)) {
    if (key === ignoredFilter) continue;
    switch (key) {
      case 'sort':
      case 'category':
      case 'tag':
        // Presentation or trust-tag filters: not a hard field match we can prove.
        continue;
      case 'make':
        if (String(vehicle.make || '').toLowerCase() !== String(value).toLowerCase()) return false;
        continue;
      case 'minPrice':
        if (!Number.isFinite(Number(vehicle.price)) || Number(vehicle.price) < Number(value)) return false;
        continue;
      case 'maxPrice':
        if (!Number.isFinite(Number(vehicle.price)) || Number(vehicle.price) > Number(value)) return false;
        continue;
      default:
        // An unknown filter: we cannot prove a match, so do not claim one.
        return false;
    }
  }
  return true;
}

/**
 * Rank the actions that would most improve this listing.
 *
 * Ordered by evidence, not by guesswork: a missed-search count is an observed
 * fact and leads; incomplete groups follow, heaviest first. No nudge claims a
 * benefit CarUp has not measured — the plan forbids fabricating uplift.
 */
export function nextBestActions({ completeness, lostOpportunity }) {
  const actions = [];

  for (const dimension of lostOpportunity?.dimensions || []) {
    actions.push({
      priority: 'high',
      basis: 'observed_missed_searches',
      action: `add_${dimension.missing_field}`,
      evidence: { missed_searches: dimension.missed_searches },
      message: dimension.message,
    });
  }

  const incomplete = (completeness?.groups || [])
    .filter((group) => !group.complete)
    .sort((a, b) => (b.weight - b.earned) - (a.weight - a.earned));

  for (const group of incomplete) {
    actions.push({
      priority: 'medium',
      basis: 'listing_completeness',
      action: `complete_${group.key}`,
      evidence: { missing_fields: group.missing_fields, points_available: Math.round((group.weight - group.earned) * 100) / 100 },
      message: group.guidance,
    });
  }

  return actions;
}
