/**
 * Trade OS — the fact observation ledger (Intake Contract §36.5).
 *
 * CAPTURE ONCE -> RECORD PROVENANCE -> VERIFY WHEN AN AUTHORITY EXISTS -> REUSE EVERYWHERE.
 *
 * Every write here is an INSERT. Nothing in this module updates a value in place, because the
 * whole reason the ledger exists is that a customer's "about 400 kg" and a warehouse scale's
 * "437 kg" are two facts about one thing, and the gap between them is what a dispute, a re-quote or
 * a capacity refusal later turns on. Collapsing them into one column loses the only evidence that
 * would settle it.
 *
 * The newest observation is what surfaces; the earlier ones stay readable.
 */
import { requireUserContext, isPlatformAdmin, isPlatformReviewer } from './diasporaAuthorization.js';
import { ForbiddenError, ValidationError } from '../../utils/errors.js';
import { resolveClient } from './diasporaServiceUtils.js';
import { PROVENANCE, CUSTOMER_ASSERTABLE_PROVENANCE } from './tradeIntakeContract.js';

const TABLE = 'diaspora_trade_fact_observations';

const SUBJECT_TYPES = new Set(['import_order', 'import_order_line', 'logistics_request', 'logistics_request_item']);
const ALL_PROVENANCE = new Set(Object.values(PROVENANCE));

/**
 * Record what someone observed.
 *
 * `asAuthority` is the switch that separates a customer describing their cargo from a warehouse
 * measuring it. A customer-facing caller may only assert CUSTOMER_STATED or CUSTOMER_ESTIMATED —
 * a request that could mark its own weight VERIFIED, or speak as a carrier, would make every
 * downstream consumer of this ledger worthless. The authority flag is set by the SERVICE that owns
 * the measuring capability, never by request input.
 */
export async function recordObservation({
  subjectType, subjectId, factKey, valueNumeric = null, valueText = null,
  unit = null, provenance, notes = null, tenantId = null, metadata = {},
} = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const asAuthority = options.asAuthority === true;

  if (!SUBJECT_TYPES.has(subjectType)) throw new ValidationError('Unknown observation subject');
  if (!subjectId) throw new ValidationError('An observation needs a subject');
  if (!factKey) throw new ValidationError('An observation needs a fact key');
  if (!ALL_PROVENANCE.has(provenance)) throw new ValidationError('Unknown provenance');
  if (valueNumeric === null && (valueText === null || valueText === '')) {
    // An observation with no value is not a humble record of uncertainty — it is noise. Absence is
    // already expressed by there being no observation at all.
    throw new ValidationError('An observation needs a value');
  }
  if (!asAuthority && !CUSTOMER_ASSERTABLE_PROVENANCE.has(provenance)) {
    throw new ForbiddenError(
      `A request may only state or estimate its own facts. "${provenance}" belongs to the authority that owns it.`,
    );
  }
  if (provenance === PROVENANCE.VERIFIED && !asAuthority) {
    throw new ForbiddenError('Nothing may mark itself verified');
  }

  const row = {
    tenant_id: tenantId || context.tenantId || null,
    subject_type: subjectType,
    subject_id: subjectId,
    fact_key: String(factKey).trim().toLowerCase(),
    value_numeric: valueNumeric === null ? null : Number(valueNumeric),
    value_text: valueText || null,
    unit: unit || null,
    provenance,
    observed_by: context.id,
    // Stamped by the service rather than left to the column default: ordering is the whole
    // contract here, and a caller must not have to trust two databases' clocks to agree.
    observed_at: new Date().toISOString(),
    notes: notes || null,
    metadata: metadata || {},
  };
  const { data, error } = await client.from(TABLE).insert(row).select().single();
  if (error) throw new ValidationError(`Could not record the observation: ${error.message}`);
  return data;
}

/**
 * Every observation of a subject, newest first, grouped by fact.
 *
 * Returned as a history rather than a value precisely so a caller cannot accidentally present a
 * customer estimate as a measurement: the shape forces you to look at where each number came from.
 */
export async function listObservations(subjectType, subjectId, options = {}) {
  const client = await resolveClient(options);
  if (!SUBJECT_TYPES.has(subjectType)) throw new ValidationError('Unknown observation subject');
  const { data, error } = await client.from(TABLE).select('*')
    .eq('subject_type', subjectType).eq('subject_id', subjectId).is('deleted_at', null);
  if (error) throw new ValidationError(`Could not read observations: ${error.message}`);
  // Newest first. Two observations recorded in the same millisecond are ordered by insertion, so a
  // measurement written immediately after an estimate still reads as the later one.
  const ordered = (data || [])
    .map((row, index) => ({ row, index }))
    .sort((a, b) => String(b.row.observed_at || '').localeCompare(String(a.row.observed_at || '')) || (b.index - a.index))
    .map((entry) => entry.row);

  const byFact = new Map();
  for (const row of ordered) {
    const key = row.fact_key;
    if (!byFact.has(key)) byFact.set(key, []);
    byFact.get(key).push({
      value: row.value_numeric ?? row.value_text,
      unit: row.unit || null,
      provenance: row.provenance,
      observed_at: row.observed_at,
      notes: row.notes || null,
    });
  }
  return Object.fromEntries(byFact);
}

/**
 * The current answer for one fact, WITH where it came from.
 *
 * There is deliberately no variant of this that returns a bare number. A caller that wants the
 * weight must also receive the provenance, so a screen cannot render an estimate as though someone
 * had weighed it.
 */
export async function currentFact(subjectType, subjectId, factKey, options = {}) {
  const all = await listObservations(subjectType, subjectId, options);
  const history = all[String(factKey).trim().toLowerCase()];
  if (!history || !history.length) return null;
  const [latest, ...superseded] = history;
  return { ...latest, superseded_count: superseded.length, superseded };
}

/** True only where a real authority has confirmed the fact. Never inferred from a customer answer. */
export function isVerified(fact) {
  return Boolean(fact && fact.provenance === PROVENANCE.VERIFIED);
}

/**
 * Who may speak AS an authority today.
 *
 * Deliberately narrow: platform admin/reviewer only. Warehouse, carrier and inspection authorities
 * do not exist yet (T9/T11/T12 own them), so nothing else can currently assert a measurement — and
 * that is the honest position rather than pre-authorising roles that have no capability behind them.
 */
export function canActAsAuthority(userContext = {}) {
  return isPlatformAdmin(userContext) || isPlatformReviewer(userContext);
}
