/**
 * Vehicle Finance Obligation / Encumbrance authority (DESIGN.md §11.7, master plan §0.7; M16, M17,
 * M18, R22–R26, R28).
 *
 * This is the GOVERNED counterpart to `vehicles.seller_finance_disclosure`
 * (backend/services/seller/vehicleHistoryDisclosures.js) — that module is the Seller's own
 * statement; this one is what a lender, a governed provider, or an admin has recorded. The two
 * never merge: there is no `seller_asserted` member in `source_authority` here, on purpose. A
 * Seller declaration must never become a governed fact, and a governed fact must never be
 * attributed to the Seller.
 *
 * It is also NOT `financeService.js` (finance_applications): that authority is a buyer seeking
 * funding to purchase a currently-published listing, and its rows are REQUIRED to carry APR and
 * monthly payment. This authority is the inverse — an obligation already attached to the vehicle,
 * which exists on drafts and unlisted vehicles, and stores no banking terms at all.
 */
import { ValidationError, ForbiddenError, DatabaseError } from '../../utils/errors.js';
import { FINANCE_TYPES, PRIVATE_FINANCE_KEYS } from '../seller/vehicleHistoryDisclosures.js';
import { toVehicleFinanceObligationBlock } from '../../utils/publicVehicleProjection.js';
import { classifyConflict, persistClaims, persistConflict } from '../intelligence/disclosureConflict.js';

export const OBLIGATION_SOURCE_AUTHORITIES = Object.freeze([
  'lender_attested', 'provider_attested', 'admin_recorded', 'document_extracted',
]);
// Only these three GATE anything (R24) or ENTER the M16 comparison. `document_extracted` is
// recorded for admin/audit visibility only: `vehicle_evidence.verification_status` defaults to
// 'unverified', and an unverified upload must not be able to block a legal ownership transfer or
// publish as governed truth.
export const GOVERNED_SOURCE_AUTHORITIES = Object.freeze(['lender_attested', 'provider_attested', 'admin_recorded']);
export const OBLIGATION_STATES = Object.freeze([
  'active', 'arrears', 'settlement_pending', 'settled_pending_release', 'released', 'disputed',
]);
// R24: blocks ownership transfer. 'disputed' is deliberately excluded — freezing a legal transfer
// indefinitely on a contested record with no adjudication SLA is a worse failure than letting it
// ride through pending review. 'document_extracted' obligations never block (see above).
export const BLOCKING_OBLIGATION_STATES = Object.freeze(['active', 'arrears', 'settlement_pending', 'settled_pending_release']);
export const OBLIGATION_KINDS = FINANCE_TYPES; // one vocabulary with the Seller's own finance_type
export const VALUATION_SOURCES = Object.freeze([
  'lender_valuation', 'independent_valuer', 'insurer_valuation', 'auction_result', 'customs_declared_value',
]);
const SETTLEMENT_CONTEXT_ALLOWED_KEYS = Object.freeze(['settlement_deadline_date', 'payee_reference_type', 'notes_internal_ref']);

/** Recursive scan for a banned private-finance key at any depth, mirroring vehicleHistoryDisclosures.js. */
function findPrivateFinanceKey(value) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, nested] of Object.entries(value)) {
    if (PRIVATE_FINANCE_KEYS.includes(key)) return key;
    const found = findPrivateFinanceKey(nested);
    if (found) return found;
  }
  return null;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate + allow-list a settlement_context payload. Closed shape: only the three named keys may
 * appear, `notes_internal_ref` must be a plain string, and — defense in depth — no private-finance
 * key may appear anywhere in it even though the schema already makes that structurally impossible
 * given the shape.
 */
function normalizeSettlementContext(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'settlement_context must be an object' };
  }
  const unknownKey = Object.keys(raw).find((key) => !SETTLEMENT_CONTEXT_ALLOWED_KEYS.includes(key));
  if (unknownKey) return { ok: false, error: `settlement_context does not permit key "${unknownKey}"` };
  if ('notes_internal_ref' in raw && typeof raw.notes_internal_ref !== 'string') {
    return { ok: false, error: 'settlement_context.notes_internal_ref must be a string' };
  }
  const privateKey = findPrivateFinanceKey(raw);
  if (privateKey) return { ok: false, error: `settlement_context may not carry "${privateKey}"` };
  return { ok: true, value: raw };
}

/**
 * Validate + allow-list the caller-supplied fields for recordFinanceObligation. Closed
 * vocabularies fail closed, exactly as normalizeFinanceDisclosure does for the Seller's own
 * statement — a typo must never coerce into the nearest legitimate-looking value.
 * @returns {{ok:true, value:object} | {ok:false, error:string}}
 */
export function normalizeObligationInput(raw = {}) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'obligation payload must be an object' };

  const sourceAuthority = raw.source_authority;
  if (!OBLIGATION_SOURCE_AUTHORITIES.includes(sourceAuthority)) {
    return { ok: false, error: `source_authority must be one of: ${OBLIGATION_SOURCE_AUTHORITIES.join(', ')}` };
  }
  const obligationKind = raw.obligation_kind;
  if (!OBLIGATION_KINDS.includes(obligationKind)) {
    return { ok: false, error: `obligation_kind must be one of: ${OBLIGATION_KINDS.join(', ')}` };
  }
  const state = raw.state ?? 'active';
  if (!OBLIGATION_STATES.includes(state)) {
    return { ok: false, error: `state must be one of: ${OBLIGATION_STATES.join(', ')}` };
  }
  if (raw.origination_valuation_source !== undefined && raw.origination_valuation_source !== null
      && !VALUATION_SOURCES.includes(raw.origination_valuation_source)) {
    return { ok: false, error: `origination_valuation_source must be one of: ${VALUATION_SOURCES.join(', ')}` };
  }

  const settlementContext = normalizeSettlementContext(raw.settlement_context);
  if (!settlementContext.ok) return settlementContext;

  const directPrivateKey = findPrivateFinanceKey(raw);
  if (directPrivateKey) return { ok: false, error: `obligation payload may not carry "${directPrivateKey}"` };

  if (sourceAuthority === 'lender_attested' && !isNonEmptyString(raw.attestation_reference)) {
    return { ok: false, error: 'lender_attested requires attestation_reference' };
  }
  if (sourceAuthority === 'provider_attested' && !isNonEmptyString(raw.attestation_reference)) {
    return { ok: false, error: 'provider_attested requires attestation_reference' };
  }
  if (sourceAuthority === 'document_extracted' && !isNonEmptyString(raw.evidence_id)) {
    return { ok: false, error: 'document_extracted requires evidence_id' };
  }
  if (sourceAuthority === 'admin_recorded' && !isNonEmptyString(raw.recorded_reason)) {
    return { ok: false, error: 'admin_recorded requires recorded_reason' };
  }

  return {
    ok: true,
    value: {
      source_authority: sourceAuthority,
      obligation_kind: obligationKind,
      state,
      lender_profile_id: raw.lender_profile_id ?? null,
      provider_id: raw.provider_id ?? null,
      evidence_id: raw.evidence_id ?? null,
      attestation_reference: raw.attestation_reference ?? null,
      lender_display_name: raw.lender_display_name ?? null,
      lender_disclosure_permitted: raw.lender_disclosure_permitted === true,
      origination_date: raw.origination_date ?? null,
      origination_valuation_amount: raw.origination_valuation_amount ?? null,
      origination_valuation_currency: raw.origination_valuation_currency ?? null,
      origination_valuation_date: raw.origination_valuation_date ?? null,
      origination_valuation_source: raw.origination_valuation_source ?? null,
      settlement_required: raw.settlement_required !== false,
      disputed_reason: raw.disputed_reason ?? null,
      recorded_reason: raw.recorded_reason ?? null,
      release_reference: raw.release_reference ?? null,
      supersedes_obligation_id: raw.supersedes_obligation_id ?? null,
      settlement_context: settlementContext.value,
    },
  };
}

function actorId(actor = {}) { return actor.id || actor.userId || null; }
function actorRole(actor = {}) { return String(actor.platformRole || actor.baseRole || actor.role || '').toLowerCase(); }

function assertActor(actor) {
  const id = actorId(actor);
  if (!id) throw new ForbiddenError('Authentication required to record a finance obligation.');
  return { id, role: actorRole(actor) };
}

/** Whether an active, non-kill-switched finance attestation channel exists AT ALL. This is what
 *  makes the block-level `source_state` honest: with none configured, EVERY vehicle must report
 *  'unavailable', never a governed zero — a governed authority that does not exist cannot have
 *  found nothing. */
export async function financeAttestationChannelExists(client) {
  const [{ count: lenderCount, error: lenderErr }, { count: providerCount, error: providerErr }] = await Promise.all([
    client.from('lender_profiles').select('id', { count: 'exact', head: true }).eq('active', true),
    client.from('provider_registry').select('id', { count: 'exact', head: true })
      .eq('capability_type', 'finance').eq('kill_switch_enabled', false).neq('activation_mode', 'not_configured'),
  ]);
  if (lenderErr || providerErr) return { available: false, readable: false };
  return { available: (lenderCount ?? 0) > 0 || (providerCount ?? 0) > 0, readable: true };
}

/**
 * The single read used by the transfer pre-check, the completeness advisory requirement, and any
 * future settlement handoff. Reads state and attribution only — never settlement_context.
 * @returns {Promise<{blocking:boolean, transfer_condition:string|null, obligations:object[]}>}
 */
export async function getGovernedEncumbrance(client, vin) {
  const { data, error } = await client
    .from('vehicle_finance_obligations')
    .select('id, source_authority, state, obligation_kind, supersedes_obligation_id')
    .eq('vin', vin)
    .order('recorded_at', { ascending: false });
  if (error) throw new DatabaseError('Failed to read finance obligations.', { reason: error.message });

  const superseded = new Set((data || []).filter((r) => r.supersedes_obligation_id).map((r) => r.supersedes_obligation_id));
  const live = (data || []).filter((r) => !superseded.has(r.id));
  const blocking = live.filter((r) =>
    GOVERNED_SOURCE_AUTHORITIES.includes(r.source_authority) && BLOCKING_OBLIGATION_STATES.includes(r.state));

  let transferCondition = null;
  if (blocking.length) {
    if (blocking.some((r) => r.state === 'settled_pending_release')) transferCondition = 'release_confirmation_outstanding';
    else transferCondition = 'settlement_required';
  }
  return { blocking: blocking.length > 0, transfer_condition: transferCondition, obligations: live };
}

/**
 * Record a new obligation. Refuses a governed sourceAuthority unless the actor holds the matching
 * authority and, for lender/provider attestation, unless the referenced row is active.
 */
export async function recordFinanceObligation(client, input, actor = {}) {
  const identity = assertActor(actor);
  const normalized = normalizeObligationInput(input);
  if (!normalized.ok) throw new ValidationError(normalized.error);
  const { vin } = input;
  if (!isNonEmptyString(vin)) throw new ValidationError('vin is required.');

  const value = normalized.value;
  if (value.source_authority === 'lender_attested') {
    if (!['admin', 'lender'].includes(identity.role)) {
      throw new ForbiddenError('Only a lender or admin actor may record a lender_attested obligation.');
    }
    const { data: lender, error } = await client.from('lender_profiles')
      .select('id, active').eq('id', value.lender_profile_id).maybeSingle();
    if (error) throw new DatabaseError('Failed to verify lender profile.', { reason: error.message });
    if (!lender || !lender.active) throw new ValidationError('The referenced lender profile is not active.');
  }
  if (value.source_authority === 'provider_attested') {
    if (!['admin', 'insurance', 'lender'].includes(identity.role)) {
      throw new ForbiddenError('Only a governed provider actor or admin may record a provider_attested obligation.');
    }
    const { data: provider, error } = await client.from('provider_registry')
      .select('id, kill_switch_enabled, activation_mode').eq('id', value.provider_id).maybeSingle();
    if (error) throw new DatabaseError('Failed to verify provider.', { reason: error.message });
    if (!provider || provider.kill_switch_enabled || provider.activation_mode === 'not_configured') {
      throw new ValidationError('The referenced provider is not active.');
    }
  }
  if (value.source_authority === 'admin_recorded' && identity.role !== 'admin') {
    throw new ForbiddenError('Only an admin actor may record an admin_recorded obligation.');
  }

  const { data, error } = await client.rpc('finance_obligation_record_atomic', {
    p_vin: String(vin),
    p_source_authority: value.source_authority,
    p_obligation_kind: value.obligation_kind,
    p_state: value.state,
    p_actor_id: String(identity.id),
    p_actor_role: identity.role || null,
    p_fields: value,
  });
  if (error) {
    // Never forward a raw Postgres error (it can include `DETAIL: Failing row contains (...)`,
    // which would carry attestation_reference/settlement_context into the log/Sentry/response).
    throw new DatabaseError('Failed to record finance obligation.');
  }
  reconcileSellerFinanceDisclosure(client, vin).catch(() => {}); // M16, best-effort, never blocks the write
  return data;
}

export async function transitionFinanceObligation(client, { obligationId, toState, reason = null, effectiveDate = null, releaseReference = null } = {}, actor = {}) {
  const identity = assertActor(actor);
  if (!isNonEmptyString(obligationId) || !OBLIGATION_STATES.includes(toState)) {
    throw new ValidationError('obligationId and a valid toState are required.');
  }
  const { data, error } = await client.rpc('finance_obligation_transition_atomic', {
    p_obligation_id: obligationId,
    p_to_state: toState,
    p_actor_id: String(identity.id),
    p_actor_role: identity.role || null,
    p_reason: reason,
    p_effective_date: effectiveDate,
    p_release_reference: releaseReference,
  });
  if (error) throw new DatabaseError('Failed to transition finance obligation.');
  if (data?.vin) reconcileSellerFinanceDisclosure(client, data.vin).catch(() => {});
  return data;
}

/**
 * The single call the passport/marketplace injected collaborator makes: both the rows AND whether
 * a real finance attestation channel exists, so the projection can render the honest three-state
 * `source_state` without a second round trip. Never throws — a failed read degrades to
 * `{ rows: undefined, channelAvailable: false }`, which the projection renders as 'unavailable'.
 */
export async function getFinanceObligationProjectionInput(client, vin) {
  const [rows, channel] = await Promise.all([
    readFinanceObligationsForVehicle(client, vin),
    financeAttestationChannelExists(client).catch(() => ({ available: false, readable: false })),
  ]);
  return { rows, channelAvailable: channel.available === true };
}

/**
 * THE INJECTED COLLABORATOR ITSELF — the composed fetch-then-project function passed as
 * `buildVehiclePassport`'s 9th parameter, mirroring how `toVehicleHistoryDisclosures` is passed
 * directly rather than being imported and called as a free name inside the passport's source.
 * `buildVehiclePassport` calls this and nothing else; the projection import stays local to this
 * module, which is never itself executed via the source-extraction harnesses.
 */
export async function projectFinanceObligationForVehicle(client, vin) {
  const { rows, channelAvailable } = await getFinanceObligationProjectionInput(client, vin);
  return toVehicleFinanceObligationBlock(rows, { channelAvailable });
}

/**
 * M16 — compare the Seller's OWN finance statement against the GOVERNED encumbrance, routed
 * through the ONE existing disclosure-conflict engine (classifyConflict/persistClaims/
 * persistConflict) rather than a second classifier/writer. Never mutates
 * `vehicles.seller_finance_disclosure`, never writes 'strong_conflict' for this claim type (the
 * engine caps it at 'possible_conflict' — a governed record disagreeing with a Seller statement is
 * not proof of anything on its own), and is idempotent-by-best-effort: it will not insert a second
 * claim+conflict pair for a VIN that already has one open. Never throws — a failure here must not
 * be able to break a finance-obligation write or a listing write path.
 */
export async function reconcileSellerFinanceDisclosure(client, vin) {
  try {
    const [{ data: vehicle, error: vErr }, encumbrance, { count: existing, error: existingErr }] = await Promise.all([
      client.from('vehicles').select('vin, seller_finance_disclosure').eq('vin', vin).maybeSingle(),
      getGovernedEncumbrance(client, vin),
      client.from('disclosure_claims').select('id', { count: 'exact', head: true })
        .eq('vin', vin).eq('claim_type', 'no_finance_outstanding'),
    ]);
    if (vErr || existingErr || !vehicle) return { recorded: false };
    if ((existing ?? 0) > 0) return { recorded: false, reason: 'already_recorded' };

    const sellerState = vehicle.seller_finance_disclosure?.state;
    if (!['none_known', 'cleared'].includes(sellerState) || !encumbrance.blocking) {
      return { recorded: false };
    }

    const conflict = classifyConflict(
      { vin, claim_type: 'no_finance_outstanding' },
      { hasGovernedFinanceObligation: true },
    );
    if (!conflict) return { recorded: false };

    const [claim] = await persistClaims(client, [{
      vin, listing_snapshot_id: null, claim_type: 'no_finance_outstanding',
      original_text: sellerState, normalized_claim: { asserted: true, source: 'seller_finance_disclosure' },
      confidence: null,
    }]);
    conflict.claim_id = claim?.id ?? null;
    await persistConflict(client, conflict);
    return { recorded: true };
  } catch {
    return { recorded: false };
  }
}

/** Public-audience read: rows only, already narrowed to the columns the projection needs. */
export async function readFinanceObligationsForVehicle(client, vin) {
  const { data, error } = await client
    .from('vehicle_finance_obligations')
    .select('id, source_authority, state, obligation_kind, lender_display_name, lender_disclosure_permitted, '
      + 'origination_date, origination_valuation_amount, origination_valuation_currency, origination_valuation_date, '
      + 'origination_valuation_source, cleared_at, released_at, recorded_at, supersedes_obligation_id')
    .eq('vin', vin)
    .order('recorded_at', { ascending: false });
  if (error) return undefined; // let the caller render `source_state: 'unavailable'`, never []
  return data || [];
}
