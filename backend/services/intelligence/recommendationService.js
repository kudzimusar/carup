/**
 * CarUp Intelligence 1.0 — I17 next-best-action.
 *
 * Deterministic rules only. Given the same inputs, every rule returns the same
 * output — no model, no ranking heuristic, no learned weights. That is the plan's
 * requirement and it is also what makes a recommendation defensible: a seller who
 * asks "why am I being told this?" gets the rule, the threshold it crossed, and
 * the evidence that crossed it.
 *
 * THE RULE THAT MATTERS MOST IS THE ONE ABOUT NOT FIRING.
 *
 * Every metric in this programme carries an availability envelope, and a rule that
 * treated `insufficient_data` or `unavailable` as a number would be the worst
 * possible consumer of it. "Your listing has had no views, improve your photos" is
 * a damaging thing to tell someone when the truth is that views were never
 * recorded — and the activity ledger currently holds no rows at all, so this is a
 * live hazard rather than a hypothetical one.
 *
 * So `requiresValue` is checked before any threshold comparison, and a rule whose
 * inputs are not all present abstains and reports WHY it abstained. An abstention
 * is part of the output, not an absence from it.
 *
 * WHAT IS STORED. Nothing about a recommendation's content: it is recomputed from
 * authoritative data every time. Only the interaction — shown, dismissed, acted on,
 * snoozed — is persisted, because that alone is not derivable.
 */
import crypto from 'node:crypto';
import { supabase as defaultClient } from '../../db/supabase.js';
import { readAllPages } from './rollupService.js';
import { AVAILABILITY, AuthorizationError } from './intelligenceProjectionService.js';

export const RECOMMENDATION_VERSION = 'next_best_action@1';

const STATE_TABLE = 'intelligence_recommendation_state';

/** Why a rule declined to fire. Reported, never silently dropped. */
export const ABSTAIN = Object.freeze({
  INPUT_UNAVAILABLE: 'input_unavailable',
  BELOW_THRESHOLD: 'below_threshold',
  SUPPRESSED: 'suppressed_by_cooldown',
  DISMISSED: 'dismissed_by_viewer',
  SNOOZED: 'snoozed_by_viewer',
});

/**
 * A metric is usable by a rule only when it actually carries a value.
 *
 * `insufficient_data` and `unavailable` are not small numbers. Treating either as
 * zero is how a rule ends up advising somebody about a measurement nobody took.
 */
export function isUsable(metric) {
  if (metric === null || metric === undefined) return false;
  if (typeof metric === 'number') return Number.isFinite(metric);
  if (typeof metric !== 'object') return false;
  return metric.availability === AVAILABILITY.VALUE
    && metric.value !== null
    && metric.value !== undefined
    && Number.isFinite(Number(metric.value));
}

/** The number inside a usable metric, or null. */
export function valueOf(metric) {
  if (!isUsable(metric)) return null;
  return typeof metric === 'number' ? metric : Number(metric.value);
}

/**
 * The rule registry.
 *
 * Each rule declares everything a reader needs to challenge it: the inputs it
 * requires, the threshold it compares against, the explanation it gives, the
 * action it proposes, and how long it stays quiet once shown.
 */
export const RULES = Object.freeze([
  {
    key: 'listing_incomplete_blocks_discovery',
    label: 'Listing detail is missing',
    subject_type: 'listing',
    requires: ['completeness_percent'],
    threshold: { completeness_percent: { below: 60 } },
    cooldown_days: 14,
    action: 'Add the missing listing details.',
    explain: (e) => `This listing records ${e.completeness_percent}% of the details buyers filter on, which is below the ${60}% point where listings stop appearing in filtered searches.`,
    test: (e) => e.completeness_percent < 60,
  },
  {
    key: 'unanswered_leads',
    label: 'Leads are waiting for a reply',
    subject_type: 'seller',
    requires: ['unanswered_leads', 'oldest_lead_age_days'],
    threshold: { unanswered_leads: { atLeast: 1 }, oldest_lead_age_days: { atLeast: 3 } },
    cooldown_days: 3,
    action: 'Reply to the waiting enquiries.',
    explain: (e) => `${e.unanswered_leads} enquir${e.unanswered_leads === 1 ? 'y has' : 'ies have'} had no reply, the oldest for ${e.oldest_lead_age_days} days.`,
    test: (e) => e.unanswered_leads >= 1 && e.oldest_lead_age_days >= 3,
  },
  {
    key: 'traffic_without_conversion',
    label: 'Views are not turning into enquiries',
    subject_type: 'listing',
    // Both inputs come from the activity ledger. Where it holds nothing, this
    // rule abstains rather than concluding that interest is absent.
    requires: ['views', 'inquiries'],
    threshold: { views: { atLeast: 50 }, inquiries: { atMost: 0 } },
    cooldown_days: 14,
    action: 'Review the price and the photographs.',
    explain: (e) => `This listing was viewed ${e.views} times and received no enquiry.`,
    test: (e) => e.views >= 50 && e.inquiries <= 0,
  },
  {
    key: 'demand_exceeds_supply',
    label: 'More demand than stock',
    subject_type: 'tenant',
    requires: ['inquiries', 'published_listings'],
    threshold: { ratio: { atLeast: 5 }, published_listings: { atLeast: 1 } },
    cooldown_days: 7,
    action: 'Consider listing more stock.',
    explain: (e) => `${e.inquiries} enquiries arrived against ${e.published_listings} published listing${e.published_listings === 1 ? '' : 's'}.`,
    test: (e) => e.published_listings >= 1 && (e.inquiries / e.published_listings) >= 5,
  },
  {
    key: 'campaign_without_uptake',
    label: 'A campaign has had no uptake',
    subject_type: 'platform',
    // Volume only. No return figure is implied: CarUp records no campaign cost,
    // so "underperforming" here can only mean "unused", never "unprofitable".
    requires: ['active_codes', 'validations'],
    threshold: { active_codes: { atLeast: 5 }, validations: { atMost: 0 } },
    cooldown_days: 14,
    action: 'Check whether the codes are reaching anyone.',
    explain: (e) => `${e.active_codes} referral codes are active and none has been used.`,
    test: (e) => e.active_codes >= 5 && e.validations <= 0,
  },
]);

const RULES_BY_KEY = new Map(RULES.map((rule) => [rule.key, rule]));

/**
 * A stable hash of the evidence that triggered a rule.
 *
 * Suppression must hold while the situation is unchanged, but a materially
 * different situation deserves to be raised again — otherwise a listing that gets
 * worse stays silent because an earlier, milder version of the same advice was
 * dismissed.
 */
export function evidenceFingerprint(ruleKey, subjectId, evidence) {
  const normalized = Object.keys(evidence)
    .sort()
    .map((key) => `${key}=${evidence[key]}`)
    .join('|');
  return crypto.createHash('sha256').update(`${ruleKey}::${subjectId}::${normalized}`).digest('hex').slice(0, 32);
}

/**
 * Evaluate one rule against one subject's evidence.
 *
 * Returns a recommendation, or an abstention that says why. Both are results; a
 * rule never simply vanishes.
 */
export function evaluateRule(rule, subjectId, evidence, { now = new Date(), state = null } = {}) {
  const base = { rule: rule.key, label: rule.label, subject_type: rule.subject_type, subject_id: subjectId };

  const missing = rule.requires.filter((key) => !isUsable(evidence[key]));
  if (missing.length > 0) {
    return {
      ...base,
      fired: false,
      abstained: ABSTAIN.INPUT_UNAVAILABLE,
      missing_inputs: missing,
      // Said plainly, because this is the case most likely to be misread.
      note: `This rule needs ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not measured for this subject. No advice is given rather than advice based on a value nobody recorded.`,
    };
  }

  const values = {};
  for (const key of rule.requires) values[key] = valueOf(evidence[key]);

  if (!rule.test(values)) {
    return { ...base, fired: false, abstained: ABSTAIN.BELOW_THRESHOLD, evidence: values };
  }

  const fingerprint = evidenceFingerprint(rule.key, subjectId, values);

  if (state) {
    if (state.dismissed_at) {
      return { ...base, fired: false, abstained: ABSTAIN.DISMISSED, evidence: values };
    }
    if (state.snoozed_until && new Date(state.snoozed_until) > now) {
      return { ...base, fired: false, abstained: ABSTAIN.SNOOZED, evidence: values, snoozed_until: state.snoozed_until };
    }
    if (state.last_emitted_at) {
      const cooldownEnds = new Date(new Date(state.last_emitted_at).getTime() + rule.cooldown_days * 86400000);
      if (cooldownEnds > now) {
        return {
          ...base,
          fired: false,
          abstained: ABSTAIN.SUPPRESSED,
          evidence: values,
          cooldown_until: cooldownEnds.toISOString(),
        };
      }
    }
  }

  return {
    ...base,
    fired: true,
    evidence: values,
    threshold: rule.threshold,
    explanation: rule.explain(values),
    action: rule.action,
    cooldown_days: rule.cooldown_days,
    evidence_fingerprint: fingerprint,
    calculation_version: RECOMMENDATION_VERSION,
  };
}

/**
 * Evaluate every applicable rule for one subject.
 *
 * `stateByKey` maps `${rule_key}:${fingerprint}` to a stored interaction row.
 */
export function evaluateSubject(subjectType, subjectId, evidence, { now = new Date(), stateByKey = new Map() } = {}) {
  const applicable = RULES.filter((rule) => rule.subject_type === subjectType);
  const results = applicable.map((rule) => {
    // The fingerprint depends on the evidence, so state is looked up on a
    // provisional pass and re-checked inside the rule.
    const values = {};
    for (const key of rule.requires) values[key] = valueOf(evidence[key]);
    const fingerprint = evidenceFingerprint(rule.key, subjectId, values);
    const state = stateByKey.get(`${rule.key}:${fingerprint}`) || null;
    return evaluateRule(rule, subjectId, evidence, { now, state });
  });

  return {
    subject_type: subjectType,
    subject_id: subjectId,
    calculation_version: RECOMMENDATION_VERSION,
    recommendations: results.filter((r) => r.fired),
    // Abstentions travel with the output so a reader can see that a rule ran and
    // chose not to speak — and, crucially, why.
    abstentions: results.filter((r) => !r.fired),
  };
}

export function requireSubjectAccess(actor, subjectType) {
  if (!actor?.id) throw new AuthorizationError('Authentication required.');
  // A seller's subject IS their session; there is no caller-supplied scope.
  const role = String(actor?.platformRole || actor?.role || '');
  const isPlatform = ['admin', 'platform_admin', 'super_admin'].includes(role);
  if (subjectType === 'platform' && !isPlatform) {
    throw new AuthorizationError('Platform recommendations require a platform administrator.');
  }
  if (subjectType === 'tenant' && !isPlatform && !actor?.tenantId) {
    throw new AuthorizationError('A verified organization context is required.');
  }
  return { isPlatform, actorId: String(actor.id) };
}

/** Stored interaction rows for one subject, keyed for lookup. */
export async function loadState(client, subjectType, subjectId) {
  const rows = await readAllPages(() => client
    .from(STATE_TABLE)
    .select('rule_key, evidence_fingerprint, last_emitted_at, dismissed_at, acted_at, snoozed_until')
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId));
  const map = new Map();
  for (const row of rows) map.set(`${row.rule_key}:${row.evidence_fingerprint}`, row);
  return map;
}

/**
 * Record that a recommendation was shown.
 *
 * Idempotent on (rule, subject, fingerprint): showing the same advice twice
 * updates the interaction rather than accumulating rows, which is what makes the
 * cooldown a mechanism rather than a hope.
 */
export async function recordEmission(client, recommendation, actor = null) {
  if (!recommendation?.fired) return null;
  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from(STATE_TABLE)
    .upsert({
      rule_key: recommendation.rule,
      subject_type: recommendation.subject_type,
      subject_id: String(recommendation.subject_id),
      evidence_fingerprint: recommendation.evidence_fingerprint,
      last_emitted_at: nowIso,
      updated_at: nowIso,
      // Server-derived, never taken from a caller.
      actor_user_id: actor?.id ? String(actor.id) : null,
      tenant_id: actor?.tenantId ? String(actor.tenantId) : null,
    }, { onConflict: 'rule_key,subject_type,subject_id,evidence_fingerprint' })
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export function ruleFor(key) {
  return RULES_BY_KEY.get(key) || null;
}

// ── Evidence gathering ─────────────────────────────────────────────────────

/**
 * A lead is "unanswered" only while it is still in its arrival state.
 *
 * Anything an operator has already touched — contacted, closed, marked spam — is
 * not waiting on the seller, and nagging about it would train them to ignore the
 * advice entirely.
 */
const UNANSWERED_STATUSES = new Set(['new', 'pending']);

function metricValue(n) {
  return { availability: AVAILABILITY.VALUE, value: n, unit: 'count' };
}

/**
 * Seller evidence, scoped by the same key the listing projections use.
 *
 * A seller sees advice about their own listings and their own leads. There is no
 * caller-supplied scope: the subject IS the session.
 */
export async function getSellerRecommendations(client = defaultClient, actor = null, { now = new Date() } = {}) {
  const { actorId } = requireSubjectAccess(actor, 'seller');

  let inquiries;
  let vehicles;
  try {
    vehicles = await readAllPages(() => client
      .from('vehicles')
      .select('vin, owner_id, current_seller_id, publication_status')
      .or(`owner_id.eq.${actorId},current_seller_id.eq.${actorId}`));
    inquiries = await readAllPages(() => client
      .from('marketplace_inquiries')
      // `marketplace_inquiries` keys the seller as `seller_id`. `current_seller_id`
      // is the VEHICLES column that this one is written FROM — using it here made
      // every read fail against the real schema. It failed CLOSED (unavailable
      // with the reason) rather than reporting a false zero, which is why a live
      // certification run was needed to surface it at all.
      .select('id, seller_id, status, created_at')
      .eq('seller_id', actorId));
  } catch (error) {
    return {
      subject_type: 'seller',
      subject_id: actorId,
      availability: AVAILABILITY.UNAVAILABLE,
      reason: String(error?.message || 'recommendation_read_failed'),
      calculation_version: RECOMMENDATION_VERSION,
      // An unreadable input produces no advice at all — never advice from a zero.
      message: 'Recommendations could not be produced because the underlying data could not be read. This is not a finding that there is nothing to do.',
      recommendations: [],
      abstentions: [],
    };
  }

  const waiting = inquiries.filter((row) => UNANSWERED_STATUSES.has(String(row.status || '').toLowerCase()));
  const oldestAgeDays = waiting.length === 0
    ? 0
    : Math.floor(
      (now.getTime() - Math.min(...waiting.map((row) => new Date(row.created_at).getTime())))
        / 86400000,
    );

  const stateByKey = await loadState(client, 'seller', actorId);
  const outcome = evaluateSubject('seller', actorId, {
    unanswered_leads: metricValue(waiting.length),
    oldest_lead_age_days: metricValue(oldestAgeDays),
  }, { now, stateByKey });

  return {
    ...outcome,
    availability: AVAILABILITY.VALUE,
    published_listings: vehicles.filter((row) => String(row.publication_status) === 'published').length,
  };
}

/**
 * Platform evidence. Campaign uptake only — never a return figure, because CarUp
 * records no campaign cost (I14).
 */
export async function getPlatformRecommendations(client = defaultClient, actor = null, { now = new Date() } = {}) {
  requireSubjectAccess(actor, 'platform');

  let codes;
  let events;
  try {
    codes = await readAllPages(() => client
      .from('referral_codes')
      .select('id, status'));
    events = await readAllPages(() => client
      .from('referral_events')
      .select('id, event_type'));
  } catch (error) {
    return {
      subject_type: 'platform',
      subject_id: 'platform',
      availability: AVAILABILITY.UNAVAILABLE,
      reason: String(error?.message || 'recommendation_read_failed'),
      calculation_version: RECOMMENDATION_VERSION,
      message: 'Recommendations could not be produced because the underlying data could not be read. This is not a finding that there is nothing to do.',
      recommendations: [],
      abstentions: [],
    };
  }

  const stateByKey = await loadState(client, 'platform', 'platform');
  const outcome = evaluateSubject('platform', 'platform', {
    active_codes: metricValue(codes.filter((row) => String(row.status) === 'ACTIVE').length),
    validations: metricValue(events.filter((row) => String(row.event_type) === 'referral.code_validated').length),
  }, { now, stateByKey });

  return { ...outcome, availability: AVAILABILITY.VALUE };
}
