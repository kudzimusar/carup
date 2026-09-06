/**
 * Trade OS T6.4/T6.7/T6.8 — comparability, corridor economics and the deterministic advisor.
 *
 * One rule governs this whole file:
 *
 *     UNCERTAINTY IS PENALISED, NEVER REWARDED.
 *
 * A quote that omitted three charges is not cheap — it is incomplete, and saying otherwise would
 * make hiding costs the winning strategy. Everything below is pure over already-projected facts,
 * so it is exactly testable and performs no I/O.
 */
import { COST_STAGE_LABELS, MATERIAL_STAGES, isStageAnswered } from './tradeCommercialContract.js';

export const COMPARABILITY = Object.freeze({
  COMPARABLE: 'COMPARABLE',
  PARTIALLY_COMPARABLE: 'PARTIALLY_COMPARABLE',
  NOT_COMPARABLE: 'NOT_COMPARABLE',
  INSUFFICIENT_INFORMATION: 'INSUFFICIENT_INFORMATION',
});

/** The stages a quote actually prices as INCLUDED. */
const includedStages = (q) => new Set((q.components || [])
  .filter((c) => c.inclusion === 'INCLUDED' && c.original.amount !== null)
  .map((c) => c.cost_stage));

const excludedStages = (q) => new Set((q.components || [])
  .filter((c) => c.inclusion === 'EXCLUDED').map((c) => c.cost_stage));

/**
 * Compare the commercial SCOPE of two quotes before any number is compared.
 *
 * $1,700 port-to-port is not "$400 cheaper" than $2,100 door-to-door; it is a different purchase.
 */
export function assessComparability(a, b) {
  const aIn = includedStages(a);
  const bIn = includedStages(b);
  const reasons = [];

  if (!aIn.size || !bIn.size) {
    return {
      verdict: COMPARABILITY.INSUFFICIENT_INFORMATION,
      reasons: ['At least one offer has no priced components recorded, so there is nothing to compare.'],
      only_in_a: [], only_in_b: [], shared: [],
    };
  }

  const onlyA = [...aIn].filter((s) => !bIn.has(s));
  const onlyB = [...bIn].filter((s) => !aIn.has(s));
  const shared = [...aIn].filter((s) => bIn.has(s));

  for (const s of onlyA) reasons.push(`${a.label || 'Offer A'} prices ${COST_STAGE_LABELS[s] || s}; ${b.label || 'Offer B'} does not.`);
  for (const s of onlyB) reasons.push(`${b.label || 'Offer B'} prices ${COST_STAGE_LABELS[s] || s}; ${a.label || 'Offer A'} does not.`);

  // A currency neither side can convert makes the totals unaddable, whatever the scopes say.
  const unconvertible = [a, b].some((q) => (q.components || []).some((c) => c.original.amount !== null && !c.reference_usd));
  if (unconvertible) reasons.push('At least one amount has no reference USD conversion, so totals cannot be placed side by side.');

  let verdict;
  if (!onlyA.length && !onlyB.length) verdict = unconvertible ? COMPARABILITY.PARTIALLY_COMPARABLE : COMPARABILITY.COMPARABLE;
  else if (shared.length === 0) verdict = COMPARABILITY.NOT_COMPARABLE;
  else verdict = COMPARABILITY.PARTIALLY_COMPARABLE;

  if (verdict === COMPARABILITY.COMPARABLE) reasons.push('Both offers price the same stages, so the totals describe the same purchase.');
  return { verdict, reasons, only_in_a: onlyA, only_in_b: onlyB, shared };
}

/**
 * Rank offers ONLY where that is honest.
 *
 * `cheapest` is populated exclusively when every offer is fully COMPARABLE. Otherwise the caller
 * receives the differences and the reasons, and shows no winner at all.
 */
export function compareQuotes(quotes = []) {
  if (quotes.length < 2) {
    return { comparable: false, verdict: COMPARABILITY.INSUFFICIENT_INFORMATION, cheapest: null,
      reasons: ['At least two offers are needed for a comparison.'], pairs: [] };
  }
  const pairs = [];
  let worst = COMPARABILITY.COMPARABLE;
  const rank = { COMPARABLE: 0, PARTIALLY_COMPARABLE: 1, NOT_COMPARABLE: 2, INSUFFICIENT_INFORMATION: 3 };
  for (let i = 0; i < quotes.length; i += 1) {
    for (let j = i + 1; j < quotes.length; j += 1) {
      const assessment = assessComparability(quotes[i], quotes[j]);
      pairs.push({ a: quotes[i].id, b: quotes[j].id, ...assessment });
      if (rank[assessment.verdict] > rank[worst]) worst = assessment.verdict;
    }
  }
  const totals = quotes.map((q) => ({
    id: q.id, label: q.label || null,
    reference_usd: q.estimate?.known_included_reference_usd ?? null,
    complete: Boolean(q.estimate?.is_complete),
  }));
  const allConvertible = totals.every((t) => t.reference_usd !== null);
  const allComplete = totals.every((t) => t.complete);

  if (worst !== COMPARABILITY.COMPARABLE || !allConvertible) {
    return {
      comparable: false, verdict: worst, cheapest: null, totals, pairs,
      reasons: ['These offers do not describe the same purchase, so CarUp shows no cheapest option.'],
    };
  }
  // Reaching here means every offer prices the SAME stages — assessComparability already refused
  // anything else. Two offers that both price only the ocean leg are genuinely comparable on that
  // leg, and blocking the arithmetic would hide a real, honest difference. What must never happen
  // is ranking offers whose COVERAGE differs, and that case has already returned above.
  const cheapest = [...totals].sort((x, y) => x.reference_usd - y.reference_usd)[0];
  return {
    comparable: true, verdict: COMPARABILITY.COMPARABLE, cheapest: cheapest.id, totals, pairs,
    reasons: allComplete
      ? ['Every offer prices the same stages and converts to a reference USD figure, so the totals are directly comparable.']
      : ['These offers price the same stages, so their totals compare directly — but the journey is not fully priced, and the remaining stages will add cost to whichever you choose.'],
    // The caller must surface this: a lowest total across a partial scope is a lowest PARTIAL cost.
    covers_full_journey: allComplete,
  };
}

/**
 * T6.7 — corridor economics.
 *
 * A corridor with cheaper KNOWN costs and three unpriced stages is not a cheaper corridor. The
 * output therefore always carries the coverage alongside the money, and `cheapest_corridor` stays
 * null unless coverage matches.
 */
export function compareCorridorEconomics(corridorOptions = [], { materialStages = MATERIAL_STAGES } = {}) {
  const rows = corridorOptions.map((option) => {
    // The SAME coverage rule the landed estimate uses — imported, not re-implemented, because
    // these two drifted apart the first time they were written separately.
    const answered = new Set((option.components || []).filter(isStageAnswered).map((c) => c.cost_stage));
    const priced = new Set((option.components || [])
      .filter((c) => c.inclusion === 'INCLUDED' && c.original.amount !== null).map((c) => c.cost_stage));
    const missing = materialStages.filter((s) => !answered.has(s));
    const convertible = (option.components || []).every((c) => c.original.amount === null || Boolean(c.reference_usd));
    const known = (option.components || [])
      .filter((c) => c.inclusion === 'INCLUDED' && c.reference_usd)
      .reduce((sum, c) => sum + c.reference_usd.amount, 0);
    return {
      corridor_code: option.corridor_code,
      corridor_name: option.corridor_name || null,
      planning_status: option.planning_status || null,
      known_cost_usd: convertible && priced.size ? Number(known.toFixed(2)) : null,
      priced_stages: [...priced],
      missing_material_stages: missing.map((s) => ({ stage: s, stage_label: COST_STAGE_LABELS[s] || s })),
      coverage_complete: missing.length === 0 && convertible,
      reference_usd_incomplete: !convertible,
    };
  });

  const complete = rows.filter((r) => r.coverage_complete && r.known_cost_usd !== null);
  const sameCoverage = complete.length === rows.length && rows.length >= 2;

  return {
    corridors: rows,
    // Only when EVERY corridor prices the same material scope may one be called cheaper.
    cheapest_corridor: sameCoverage
      ? [...complete].sort((a, b) => a.known_cost_usd - b.known_cost_usd)[0].corridor_code
      : null,
    comparable: sameCoverage,
    reasons: sameCoverage
      ? ['Every corridor prices the same material stages, so the known costs describe the same journey.']
      : ['At least one corridor has unpriced stages. CarUp does not present a corridor as cheaper when part of its cost is simply unknown.'],
    // Neither T5 nor T6 ranks corridors by anything other than measured, comparable cost.
    note: 'No corridor is preferred by CarUp. Planning status describes evidence maturity, never desirability.',
  };
}

/**
 * T6.8 — the deterministic advisor.
 *
 * Every statement carries the measured fact that produced it. There is no scoring model, no
 * weighting nobody can inspect, and no language model deciding a commercial question.
 */
export function adviseOptions(context = {}) {
  const findings = [];
  const { cargo = {}, options = [], objective = null } = context;

  if (!options.length) {
    return { findings: [{ code: 'NO_OPTIONS', headline: 'Nothing to compare yet', because: ['No priced options are recorded for this shipment.'] }], compared: false };
  }

  const comparison = compareQuotes(options);
  if (comparison.comparable && comparison.cheapest) {
    const winner = comparison.totals.find((t) => t.id === comparison.cheapest);
    findings.push({
      code: 'LOWER_KNOWN_COST_SAME_SCOPE',
      headline: 'Lower known cost for the same scope',
      because: [
        `Every option prices the same stages, so the totals compare like with like.`,
        `${winner.label || 'This option'} has the lowest reference total at USD ${winner.reference_usd}.`,
      ],
      option_id: comparison.cheapest,
    });
  } else {
    findings.push({
      code: 'NOT_COMPARABLE',
      headline: 'These options are not the same purchase',
      because: comparison.reasons.concat(
        comparison.pairs.flatMap((p) => p.reasons).slice(0, 4),
      ),
    });
  }

  // Cargo facts that change what is even eligible — stated as facts, never as a booking.
  if (cargo.vehicle_running_state === 'non_running') {
    findings.push({
      code: 'NON_RUNNING_VEHICLE',
      headline: 'This vehicle does not run',
      because: ['A non-running vehicle needs winching and cannot be driven on or off, so RoRo may not be available.',
        'Whether it can be carried remains the operator and carrier decision.'],
    });
  }
  if (cargo.estimated_volume_cbm === null || cargo.estimated_volume_cbm === undefined) {
    findings.push({
      code: 'DIMENSIONS_UNKNOWN',
      headline: 'Dimensions are not recorded yet',
      because: ['Cargo volume is unknown, so options priced per CBM cannot be compared on price.',
        'CBM arithmetic would not prove physical fit in any case — that stays with the operator.'],
    });
  }
  if (objective) {
    findings.push({
      code: 'CUSTOMER_OBJECTIVE',
      headline: 'Your stated priority',
      because: [`You told us this shipment should prioritise: ${String(objective).replace(/_/g, ' ')}.`,
        'CarUp orders nothing by that priority on its own; it is shown so you can weigh the options yourself.'],
    });
  }
  return { findings, compared: comparison.comparable, comparison };
}
