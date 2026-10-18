/**
 * CA-OWNER-02 — the Corporate management FACT: one management position, with exactly the truth it can bear.
 *
 * Every figure a Corporate read model returns is one of these, and the SERVER decides its truth state:
 *
 *   · a LIVE fact, read completely from an existing authoritative source, carries its value (0 included) and is labelled for
 *     what it is — an operational or a technical fact. It is never a certified Corporate Actual: no Corporate source path is
 *     certified yet, and a provisional figure may appear only as a labelled diagnostic (OD-CAMETRIC-022). The one exception is
 *     a governance record read from the persistent Corporate authority itself (memberships, permission assignments);
 *   · a source that could not be read, or was read only in part, is DEGRADED and carries NO value — a failed read is never 0;
 *   · a figure with no source, no accepted semantics or no accounting authority is a STATEMENT: it says why and has no value.
 *
 * Every live fact names its source, as-of time, scope and window, or it cannot be built. Facts carry aggregates only — never
 * a person's name, e-mail, a token or a secret.
 */

/** The truth states a Corporate read model may emit (a subset of the web grammar in web/src/lib/corporate/truthState.ts). */
export const FACT_STATES = Object.freeze([
  'GOVERNED_ACTUAL',
  'TECHNICAL_OPERATIONAL',
  'DEGRADED',
  'UNAVAILABLE_NO_SOURCE',
  'UNAVAILABLE_NOT_SEPARABLE',
  'PENDING_CA_FIN',
  'PENDING_K2B_CONSUMPTION',
  'UNKNOWN_AUTHORITY',
  'INSUFFICIENT_DATA',
  'FORBIDDEN',
  'NO_DATA',
]);

/** States that state a reason instead of a value. */
export const STATEMENT_STATES = Object.freeze(FACT_STATES.filter((s) => !['GOVERNED_ACTUAL', 'TECHNICAL_OPERATIONAL', 'DEGRADED'].includes(s)));

/** operational = business workload / activity; technical = platform runtime; governance = the persistent Corporate authority. */
export const FACT_KINDS = Object.freeze(['operational', 'technical', 'governance']);

export const CURRENT_WINDOW = Object.freeze({ kind: 'current' });

export const DEFAULT_READ_TIMEOUT_MS = 8_000;

const iso = (v) => {
  const d = v instanceof Date ? v : new Date(v);
  if (v === undefined || v === null || Number.isNaN(d.getTime())) return null;
  return d.toISOString();
};

/** A rolling window of whole days ending at `now`, with its exact bounds. */
export function rollingWindow(days, now = new Date()) {
  if (!Number.isInteger(days) || days <= 0) throw new Error('rolling window: days must be a positive integer');
  const to = new Date(now);
  return Object.freeze({ kind: 'rolling', days, from: new Date(to.getTime() - days * 86_400_000).toISOString(), to: to.toISOString() });
}

function checkIdentity({ id, label }) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('fact: id is required');
  if (typeof label !== 'string' || !label.trim()) throw new Error('fact: label is required');
}

function checkSourceAndScope({ source, asOf, scope, window }) {
  if (!source || typeof source.authority !== 'string' || !source.authority.trim()) throw new Error('fact: a live fact must name its source authority');
  if (!iso(asOf)) throw new Error('fact: a live fact must carry its as-of time');
  if (typeof scope !== 'string' || !scope.trim()) throw new Error('fact: a live fact must state its scope');
  if (!window || typeof window.kind !== 'string') throw new Error('fact: a live fact must state its window');
}

const freezeDeep = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) freezeDeep(v);
  }
  return o;
};

function shape(spec, { state, value, certification, reason = null }) {
  return freezeDeep({
    id: spec.id,
    label: spec.label,
    kind: spec.kind ?? null,
    state,
    value,
    unit: spec.unit ?? null,
    source: spec.source ? { authority: spec.source.authority, path: spec.source.path ?? null } : null,
    as_of: iso(spec.asOf),
    window: spec.window ? { ...spec.window } : null,
    scope: spec.scope ?? null,
    provenance: spec.provenance ? structuredClone(spec.provenance) : null,
    certification,
    reason,
    detail: spec.detail ?? null,
  });
}

/** A fact read completely from an existing authoritative source. */
export function liveFact(spec) {
  checkIdentity(spec);
  if (!FACT_KINDS.includes(spec.kind)) throw new Error(`fact: unknown kind ${String(spec.kind)}`);
  checkSourceAndScope(spec);
  const { value } = spec;
  const textual = spec.kind === 'technical' && typeof value === 'string' && value.trim() !== '';
  if (!textual && !(typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
    throw new Error('fact: a live fact value must be a finite number ≥ 0 (or text, for a technical fact)');
  }
  const governance = spec.kind === 'governance';
  return shape(spec, {
    state: governance ? 'GOVERNED_ACTUAL' : 'TECHNICAL_OPERATIONAL',
    value,
    certification: governance ? 'governance_record' : 'not_certified',
  });
}

/** A figure that states why it has no value. Any value passed in is discarded. */
export function statementFact(spec) {
  checkIdentity(spec);
  if (!STATEMENT_STATES.includes(spec.state)) throw new Error(`fact: ${String(spec.state)} is not a statement state`);
  if (typeof spec.reason !== 'string' || !spec.reason.trim()) throw new Error('fact: a statement fact must give its reason');
  return shape(spec, { state: spec.state, value: null, certification: 'not_applicable', reason: spec.reason });
}

function degraded(spec, reason) {
  return shape(spec, { state: 'DEGRADED', value: null, certification: 'not_certified', reason });
}

/**
 * Run one source read under a time budget and turn its outcome into a fact. The reader resolves to
 * `{ value, complete = true, provenance?, detail? }`. It never throws: a failure, a timeout or an incomplete read is DEGRADED.
 */
export async function readFact(spec, reader, { now = new Date(), timeoutMs = DEFAULT_READ_TIMEOUT_MS } = {}) {
  const asOf = spec.asOf ?? now;
  let timer;
  try {
    const outcome = await Promise.race([
      Promise.resolve().then(reader),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    if (!outcome || outcome.complete === false) {
      return degraded({ ...spec, asOf, detail: outcome?.detail ?? spec.detail }, 'The source returned an incomplete read, so no value is shown.');
    }
    return liveFact({ ...spec, asOf, value: outcome.value, provenance: outcome.provenance ?? spec.provenance, detail: outcome.detail ?? spec.detail });
  } catch {
    return degraded({ ...spec, asOf }, `The source could not be read at ${iso(asOf)}, so no value is shown.`);
  } finally {
    clearTimeout(timer);
  }
}
