/**
 * Trade OS T6.5 — the governed research / operations rate workspace.
 *
 * This is NOT a marketplace surface. A rate observation is what CarUp has *learned* about the
 * market — a provider's rate card, an official fee, a researcher's note — and it must never appear
 * to a customer as something a provider quoted them. Keeping it in its own authority, behind
 * platform review authority, is what makes that separation structural rather than a convention.
 *
 * Two rules the code enforces rather than documents:
 *   · authority is PLATFORM review/admin only — a commercial profile never self-grants it, so a
 *     dealer or logistics provider cannot write market data by changing their own business type;
 *   · a synthetic observation is flagged at write time and stays flagged, so certification data
 *     can never be mistaken for real market economics.
 */
import { ValidationError, ForbiddenError } from '../../utils/errors.js';
import { resolveClient, appendAudit, paging } from './diasporaServiceUtils.js';
import { requireUserContext, isPlatformAdmin, isPlatformReviewer } from './diasporaAuthorization.js';
import {
  RATE_CLASSIFICATION_SET, COST_STAGE_SET, CHARGE_BASIS_SET, COST_STAGE_LABELS,
} from './tradeCommercialContract.js';

const OBSERVATIONS = 'diaspora_trade_rate_observations';
const isCode = (c) => /^[A-Z]{3}$/.test(String(c || ''));

/** Research authority is PLATFORM authority. Business type grants nothing here. */
export function assertResearchAuthority(context) {
  if (!(isPlatformAdmin(context) || isPlatformReviewer(context))) {
    throw new ForbiddenError('The rate research workspace is restricted to CarUp platform reviewers and administrators');
  }
  return true;
}

export function normalizeObservation(input = {}) {
  const classification = String(input.classification || '').toUpperCase();
  if (!RATE_CLASSIFICATION_SET.has(classification)) {
    throw new ValidationError(`Unsupported rate classification: ${input.classification}`);
  }
  const stage = String(input.cost_stage || '').toUpperCase();
  if (!COST_STAGE_SET.has(stage)) throw new ValidationError(`Unsupported cost stage: ${input.cost_stage}`);

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new ValidationError('A rate observation needs a non-negative amount');
  const currency = String(input.currency || '').toUpperCase();
  if (!isCode(currency)) throw new ValidationError('A rate observation must state an ISO 4217 currency');

  const label = String(input.label || '').trim();
  if (!label) throw new ValidationError('A rate observation needs a label');
  const source = String(input.source_name || '').trim();
  if (!source) throw new ValidationError('A rate observation must name its source — an unattributed rate is not evidence');

  const effectiveFrom = input.effective_from || null;
  if (!effectiveFrom) throw new ValidationError('A rate observation needs an effective date');
  if (input.effective_to && input.effective_to < effectiveFrom) {
    throw new ValidationError('A rate observation cannot expire before it takes effect');
  }
  const basis = input.basis ? String(input.basis).toUpperCase() : null;
  if (basis && !CHARGE_BASIS_SET.has(basis)) throw new ValidationError(`Unsupported basis: ${input.basis}`);

  return {
    classification,
    // Synthetic is a property of the DATA, declared at write time — never inferred later.
    is_synthetic: input.is_synthetic === true,
    cost_stage: stage,
    label,
    corridor_id: input.corridor_id || null,
    corridor_leg_id: input.corridor_leg_id || null,
    mode: input.mode ? String(input.mode).slice(0, 40) : null,
    cargo_applicability: input.cargo_applicability ? String(input.cargo_applicability).slice(0, 200) : null,
    amount,
    currency,
    basis,
    unit: input.unit ? String(input.unit).slice(0, 40) : null,
    min_amount: input.min_amount === undefined || input.min_amount === null ? null : Number(input.min_amount),
    max_amount: input.max_amount === undefined || input.max_amount === null ? null : Number(input.max_amount),
    effective_from: effectiveFrom,
    effective_to: input.effective_to || null,
    source_name: source,
    source_reference: input.source_reference ? String(input.source_reference).slice(0, 500) : null,
    provider_tenant_id: input.provider_tenant_id || null,
    notes: input.notes ? String(input.notes).slice(0, 2000) : null,
    status: 'ACTIVE',
  };
}

export async function recordObservation(payload, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  assertResearchAuthority(context);
  const client = await resolveClient(options);
  const row = { ...normalizeObservation(payload), created_by: context.id, updated_by: context.id };
  const { data, error } = await client.from(OBSERVATIONS).insert(row).select().single();
  if (error) throw new ValidationError(`Could not record the rate observation: ${error.message}`);
  await appendAudit(client, {
    actorId: context.id, action: 'TRADE_RATE_OBSERVATION_RECORDED',
    resourceType: 'diaspora_trade_rate_observation', resourceId: data.id,
    newState: { classification: data.classification, is_synthetic: data.is_synthetic, source: data.source_name },
    req: options.req,
  });
  return data;
}

/**
 * List observations for the research workspace.
 *
 * Paged deliberately — the workspace must not pull the entire rate history to render a screen.
 */
export async function listObservations(filters = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  assertResearchAuthority(context);
  const client = await resolveClient(options);
  const { limit, offset } = paging(filters);
  let query = client.from(OBSERVATIONS).select('*').is('deleted_at', null);
  if (filters.corridor_id) query = query.eq('corridor_id', filters.corridor_id);
  if (filters.cost_stage) query = query.eq('cost_stage', String(filters.cost_stage).toUpperCase());
  if (filters.classification) query = query.eq('classification', String(filters.classification).toUpperCase());
  const { data, error } = await query.order('effective_from', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw new ValidationError(`Could not read rate observations: ${error.message}`);
  return (data || []).map(projectObservation);
}

/**
 * Projection for the workspace. Provenance is never optional here: classification, source and the
 * synthetic flag travel with every row so no screen can render one without them.
 */
export function projectObservation(row) {
  return {
    id: row.id,
    classification: row.classification,
    is_synthetic: row.is_synthetic === true,
    cost_stage: row.cost_stage,
    stage_label: COST_STAGE_LABELS[row.cost_stage] || row.cost_stage,
    label: row.label,
    corridor_id: row.corridor_id, corridor_leg_id: row.corridor_leg_id,
    mode: row.mode, cargo_applicability: row.cargo_applicability,
    amount: Number(row.amount), currency: row.currency,
    basis: row.basis, unit: row.unit,
    min_amount: row.min_amount === null ? null : Number(row.min_amount),
    max_amount: row.max_amount === null ? null : Number(row.max_amount),
    effective_from: row.effective_from, effective_to: row.effective_to,
    source_name: row.source_name, source_reference: row.source_reference,
    observed_at: row.observed_at, status: row.status, notes: row.notes,
    // Belt and braces for every consumer: a research figure is not a customer quote.
    is_provider_quote_to_customer: false,
  };
}

/**
 * The controlled corridor benchmark (plan §19 / directive §9).
 *
 * Groups observations by corridor for the SAME cost stages, so a like-for-like comparison becomes
 * possible the moment real data exists. It performs no comparison of its own and names no winner —
 * with synthetic-only data there is nothing to conclude, and it says exactly that.
 */
export async function corridorBenchmark(filters = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  assertResearchAuthority(context);
  const client = await resolveClient(options);
  const { data, error } = await client.from(OBSERVATIONS).select('*')
    .is('deleted_at', null).eq('status', 'ACTIVE')
    .order('effective_from', { ascending: false });
  if (error) throw new ValidationError(`Could not read rate observations: ${error.message}`);

  const rows = (data || []).filter((r) => !filters.corridor_ids || filters.corridor_ids.includes(r.corridor_id));
  const byCorridor = new Map();
  for (const row of rows) {
    if (!row.corridor_id) continue;
    const list = byCorridor.get(row.corridor_id) || [];
    list.push(projectObservation(row));
    byCorridor.set(row.corridor_id, list);
  }
  const corridors = [...byCorridor.entries()].map(([corridorId, observations]) => ({
    corridor_id: corridorId,
    observations,
    synthetic_only: observations.every((o) => o.is_synthetic),
    real_observations: observations.filter((o) => !o.is_synthetic).length,
    stages_covered: [...new Set(observations.map((o) => o.cost_stage))],
  }));

  const anyReal = corridors.some((c) => c.real_observations > 0);
  return {
    corridors,
    // The honest state of the programme today, stated rather than implied by an empty screen.
    research_status: anyReal
      ? 'Real observations are recorded. Comparability still depends on matching cargo, scope, period and stages.'
      : 'No real market observations have been recorded yet. Everything here is synthetic certification data and must not be read as market economics.',
    comparable: false,
    note: 'This workspace records and groups observations. It draws no conclusion and names no cheapest corridor — corridor economics for a customer is computed from actual quotes, not from research notes.',
  };
}
