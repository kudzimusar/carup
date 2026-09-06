/**
 * Trade OS T6.3/T6.4 — structured charge components, and the comparison built on them.
 *
 * The whole point: a cheap-looking quote must not win because its expected charges were never
 * written down. Everything here is arranged so that "we don't know" survives all the way to the
 * screen instead of quietly becoming zero.
 */
import { ValidationError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { resolveClient, appendAudit } from './diasporaServiceUtils.js';
import { requireUserContext, normalizeId, isPlatformAdmin, isPlatformReviewer } from './diasporaAuthorization.js';

/** Platform review authority — the same shape the logistics service uses locally. */
const isPrivileged = (context) => isPlatformAdmin(context) || isPlatformReviewer(context);
import {
  COST_STAGE_SET, INCLUSION_SET, COMMERCIAL_STATUS_SET, PROVENANCE_SET, REVENUE_CLASS_SET,
  CHARGE_BASIS_SET, CLIENT_ASSERTABLE_PROVENANCE, CARUP_REVENUE_CLASSES, COST_STAGE_LABELS,
  T6_MUST_NOT_CALCULATE, MATERIAL_STAGES,
} from './tradeCommercialContract.js';
import { toReferenceUsd, FX_STATUS } from './tradeFxRateService.js';

const COMPONENTS = 'diaspora_trade_charge_components';
const IMPORT_QUOTES = 'diaspora_import_quotes';
const LOGISTICS_QUOTES = 'diaspora_logistics_quotes';

const isCode = (c) => /^[A-Z]{3}$/.test(String(c || ''));
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Normalize one client-supplied component.
 *
 * Server-owned facts are NOT taken from the caller: provenance beyond what a client may legitimately
 * assert, and anything resembling a normalized USD figure or an FX rate. A client that could send
 * `normalized_usd` or `provenance: 'VERIFIED'` could manufacture commercial truth.
 */
export function normalizeComponent(input = {}, { actorMayAssertProvenance = CLIENT_ASSERTABLE_PROVENANCE } = {}) {
  const stage = String(input.cost_stage || '').toUpperCase();
  if (!COST_STAGE_SET.has(stage)) throw new ValidationError(`Unsupported cost stage: ${input.cost_stage}`);
  const label = String(input.label || '').trim();
  if (!label) throw new ValidationError('A charge component needs a label');

  const amount = num(input.original_amount);
  const currency = input.original_currency ? String(input.original_currency).toUpperCase() : null;
  // Money always carries its currency. The legacy columns default to USD, which silently mislabels
  // a JPY figure; T6 refuses the ambiguity outright rather than guessing.
  if (amount !== null && !isCode(currency)) {
    throw new ValidationError('A charge amount must state its own currency (ISO 4217) — it is never assumed to be USD');
  }
  if (amount !== null && amount < 0) throw new ValidationError('A charge amount cannot be negative');

  const inclusion = String(input.inclusion || 'UNKNOWN').toUpperCase();
  if (!INCLUSION_SET.has(inclusion)) throw new ValidationError(`Unsupported inclusion state: ${input.inclusion}`);
  const status = String(input.commercial_status || 'INDICATIVE').toUpperCase();
  if (!COMMERCIAL_STATUS_SET.has(status)) throw new ValidationError(`Unsupported commercial status: ${input.commercial_status}`);

  const provenance = String(input.provenance || 'PROVIDER_STATED').toUpperCase();
  if (!PROVENANCE_SET.has(provenance)) throw new ValidationError(`Unsupported provenance: ${input.provenance}`);
  // The customs firewall is checked FIRST so the caller hears the rule that actually matters.
  // Both refusals are safe; this one explains why, and it applies to privileged callers too.
  if (T6_MUST_NOT_CALCULATE.has(stage) && provenance === 'CARUP_CALCULATED') {
    throw new ValidationError(`${stage} cannot be CarUp-calculated — duty, tax and valuation are decided by the customs authority (T12)`);
  }
  if (!actorMayAssertProvenance.has(provenance)) {
    // VERIFIED and HISTORICAL_ACTUAL are conclusions CarUp draws from evidence, not claims a
    // counterparty may type about itself.
    throw new ValidationError(`Provenance ${provenance} is server-derived and cannot be supplied by a client`);
  }

  const revenue = String(input.revenue_class || 'PASS_THROUGH_COST').toUpperCase();
  if (!REVENUE_CLASS_SET.has(revenue)) throw new ValidationError(`Unsupported revenue class: ${input.revenue_class}`);
  // A counterparty may not label their own charge as CarUp revenue, nor disguise CarUp revenue as
  // theirs. Only CarUp's own surfaces set those classes.
  if (CARUP_REVENUE_CLASSES.has(revenue) && !input.__carupAuthored) {
    throw new ValidationError('Only CarUp may classify a charge as CarUp revenue');
  }

  const basis = input.basis ? String(input.basis).toUpperCase() : null;
  if (basis && !CHARGE_BASIS_SET.has(basis)) throw new ValidationError(`Unsupported charge basis: ${input.basis}`);

  return {
    cost_stage: stage,
    label,
    original_amount: amount,
    original_currency: amount === null ? (isCode(currency) ? currency : null) : currency,
    quantity: num(input.quantity),
    unit: input.unit ? String(input.unit).slice(0, 40) : null,
    unit_rate: num(input.unit_rate),
    basis,
    inclusion,
    commercial_status: status,
    provenance,
    revenue_class: revenue,
    service_scope: input.service_scope ? String(input.service_scope).slice(0, 200) : null,
    valid_from: input.valid_from || null,
    valid_until: input.valid_until || null,
    evidence_document_id: input.evidence_document_id || null,
    notes: input.notes ? String(input.notes).slice(0, 1000) : null,
  };
}

async function loadQuoteOwner(client, { importQuoteId, logisticsQuoteId }) {
  if (Boolean(importQuoteId) === Boolean(logisticsQuoteId)) {
    throw new ValidationError('A charge component belongs to exactly one quote — a procurement offer or a logistics offer');
  }
  const table = importQuoteId ? IMPORT_QUOTES : LOGISTICS_QUOTES;
  const id = importQuoteId || logisticsQuoteId;
  const { data } = await client.from(table).select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!data) throw new NotFoundError('Quote not found');
  return { table, quote: data };
}

/** The provider who owns the quote — taken from the SERVER's row, never from the request body. */
function assertOwnsQuote(quote, context) {
  const owner = normalizeId(quote.seller_id || quote.provider_id);
  if (owner !== context.id && !isPrivileged(context)) {
    throw new ForbiddenError('You can only add charge components to your own offer');
  }
}

export async function addChargeComponents(target, components, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { quote } = await loadQuoteOwner(client, target);
  assertOwnsQuote(quote, context);
  if (!Array.isArray(components) || !components.length) throw new ValidationError('No charge components supplied');

  const rows = components.map((c) => ({
    ...normalizeComponent(c, { actorMayAssertProvenance: isPrivileged(context) ? PROVENANCE_SET : CLIENT_ASSERTABLE_PROVENANCE }),
    import_quote_id: target.importQuoteId || null,
    logistics_quote_id: target.logisticsQuoteId || null,
    created_by: context.id,
    updated_by: context.id,
  }));
  const { data, error } = await client.from(COMPONENTS).insert(rows).select();
  if (error) throw new ValidationError(`Could not save charge components: ${error.message}`);
  await appendAudit(client, {
    actorId: context.id, action: 'TRADE_CHARGE_COMPONENTS_RECORDED',
    resourceType: 'diaspora_trade_charge_component',
    resourceId: (data || [])[0]?.id || null,
    newState: { count: (data || []).length, quote: target }, req: options.req,
  });
  return data || [];
}

export async function listChargeComponents(target, options = {}) {
  const client = await resolveClient(options);
  const column = target.importQuoteId ? 'import_quote_id' : 'logistics_quote_id';
  const id = target.importQuoteId || target.logisticsQuoteId;
  if (!id) return [];
  const { data, error } = await client.from(COMPONENTS).select('*')
    .eq(column, id).is('deleted_at', null).order('created_at', { ascending: true });
  if (error) throw new ValidationError(`Could not read charge components: ${error.message}`);
  return data || [];
}

/**
 * Project components for display: source money always, reference USD only when a real rate exists.
 *
 * An EXCLUDED or UNKNOWN component keeps its identity — it is never folded into a total, and its
 * amount (where known) is reported separately so a customer can see what they will still pay.
 */
export async function projectComponentsForDisplay(components, options = {}) {
  const out = [];
  for (const c of components) {
    const money = await toReferenceUsd(c.original_amount, c.original_currency, options);
    out.push({
      id: c.id,
      cost_stage: c.cost_stage,
      stage_label: COST_STAGE_LABELS[c.cost_stage] || c.cost_stage,
      label: c.label,
      // SOURCE MONEY — the permanent commercial fact, never replaced by its conversion.
      original: money.source,
      // REFERENCE ONLY. null means no rate; the UI then says so instead of showing a number.
      reference_usd: money.reference,
      fx: money.reference
        ? { status: money.fx.status, rate: money.fx.rate, rate_date: money.fx.rate_date, source: money.fx.source, triangulation: money.fx.triangulation || null }
        : { status: money.fx.status, reason: money.fx.reason || null },
      quantity: c.quantity, unit: c.unit, unit_rate: c.unit_rate, basis: c.basis,
      inclusion: c.inclusion,
      commercial_status: c.commercial_status,
      provenance: c.provenance,
      revenue_class: c.revenue_class,
      is_carup_revenue: CARUP_REVENUE_CLASSES.has(c.revenue_class),
      service_scope: c.service_scope,
      valid_from: c.valid_from, valid_until: c.valid_until,
      has_evidence: Boolean(c.evidence_document_id),   // presence, never verification (T8)
      notes: c.notes,
    });
  }
  return out;
}

/**
 * T6.6 — the landed-cost composition.
 *
 * Deliberately NOT a single number. It reports what is priced, what is excluded, what is
 * contingent and — most importantly — which stages remain unpriced, so the screen can say
 * "known estimated cost" instead of "landed cost" whenever anything material is missing.
 */
export function composeLandedEstimate(projected, { materialStages = MATERIAL_STAGES } = {}) {
  const included = projected.filter((c) => c.inclusion === 'INCLUDED');
  const excluded = projected.filter((c) => c.inclusion === 'EXCLUDED');
  const contingent = projected.filter((c) => c.inclusion === 'CONTINGENT');
  const unpriced = projected.filter((c) => c.original.amount === null);

  // Subtotals are grouped BY CURRENCY and never summed across currencies — the same rule
  // tradeIntelligenceService already holds, because adding JPY to USD performs a conversion
  // nobody authorised.
  const byCurrency = {};
  let anyUnconvertible = false;
  let usdTotal = 0;
  let pricedCount = 0;
  for (const c of included) {
    if (c.original.amount === null) continue;   // unpriced contributes NOTHING, not zero
    pricedCount += 1;
    const cur = c.original.currency;
    byCurrency[cur] = Number(((byCurrency[cur] || 0) + c.original.amount).toFixed(2));
    if (c.reference_usd) usdTotal += c.reference_usd.amount; else anyUnconvertible = true;
  }

  const stagesPresent = new Set(projected.filter((c) => c.original.amount !== null && c.inclusion === 'INCLUDED').map((c) => c.cost_stage));
  const missingMaterial = materialStages.filter((s) => !stagesPresent.has(s));

  return {
    // Grouped source money is always truthful, whatever FX does.
    known_included_by_currency: byCurrency,
    // A single comparable figure ONLY when every included component converted.
    // NULL when nothing is priced. Summing an empty set to 0 would put "USD 0.00" on screen for a
    // journey whose cost is entirely unknown — the exact unknown-becomes-zero failure this phase
    // exists to prevent. (Caught by mutation testing against an earlier version of this line.)
    known_included_reference_usd: anyUnconvertible || pricedCount === 0 ? null : Number(usdTotal.toFixed(2)),
    reference_usd_incomplete: anyUnconvertible,
    excluded: excluded.map((c) => ({ stage: c.cost_stage, stage_label: c.stage_label, label: c.label, original: c.original })),
    contingent: contingent.map((c) => ({ stage: c.cost_stage, stage_label: c.stage_label, label: c.label, original: c.original })),
    unpriced: unpriced.map((c) => ({ stage: c.cost_stage, stage_label: c.stage_label, label: c.label })),
    // The stages a customer usually needs before a journey cost means anything.
    missing_material_stages: missingMaterial.map((s) => ({ stage: s, stage_label: COST_STAGE_LABELS[s] || s })),
    // THE flag the UI keys off. When false the screen must not print "landed cost".
    is_complete: missingMaterial.length === 0 && unpriced.length === 0 && !anyUnconvertible,
    carup_charges: projected.filter((c) => c.is_carup_revenue)
      .map((c) => ({ label: c.label, original: c.original, revenue_class: c.revenue_class })),
    // Customs is never computed here. If nothing supplied a figure, say so in those words.
    customs_note: stagesPresent.has('IMPORT_CUSTOMS')
      ? 'An import duty/tax figure has been recorded from an external authority or provider.'
      : 'Import taxes and duties: not calculated yet.',
  };
}

export { FX_STATUS };
