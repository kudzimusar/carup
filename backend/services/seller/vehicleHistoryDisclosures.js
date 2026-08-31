/**
 * Vehicle History & Obligations — Seller disclosure vocabulary and normalization (DESIGN.md §11.7,
 * master plan §0.7 / F18–F20 / M17).
 *
 * These are SELLER STATEMENTS, never governed facts. Three invariants shape every function here:
 *
 *   1. Absence never becomes "No". An unanswered disclosure is null; only an explicit Seller choice
 *      from the closed vocabulary is stored. There is no default branch that manufactures an answer.
 *   2. Closed vocabularies fail closed. An out-of-vocabulary state is a refusal (the caller returns
 *      400), never a silent coercion into the nearest legitimate-looking value — a typo must not
 *      turn into a disclosure the Seller did not make.
 *   3. Private banking terms are refused at the door (M17/INV-18). A finance disclosure carrying an
 *      exact balance, APR, monthly payment, account/loan/contract identifier, repayment history or
 *      credit data is rejected outright rather than stored-and-hidden; the vehicles-table CHECK
 *      constraint enforces the same ban as defense in depth.
 *
 * The structured detail fields are allow-list projected: unknown keys are dropped so a client can
 * never smuggle arbitrary payload into a seller_* column.
 */

export const ACCIDENT_DISCLOSURE_STATES = Object.freeze(['yes', 'no_known_accident_history', 'unknown']);
export const INSURANCE_DISCLOSURE_STATES = Object.freeze(['insured', 'not_insured', 'unknown']);
export const FINANCE_DISCLOSURE_STATES = Object.freeze(['none_known', 'active', 'settlement_pending', 'cleared', 'unknown']);
export const FINANCE_TYPES = Object.freeze(['bank_loan', 'vehicle_finance', 'lease', 'hire_purchase', 'secured_lien', 'other']);

/**
 * Keys that may never appear anywhere inside a Seller finance disclosure. Mirrored by the DB CHECK
 * on vehicles.seller_finance_disclosure. Kept in one exported list so the migration, this module
 * and the tests cannot drift apart silently.
 */
export const PRIVATE_FINANCE_KEYS = Object.freeze([
  'outstanding_balance', 'monthly_payment', 'apr', 'interest_rate',
  'account_number', 'loan_reference', 'contract_number', 'bank_account',
  'repayment_history', 'credit_score', 'credit_report',
]);

const ACCIDENT_EVENT_FIELDS = Object.freeze([
  'approx_date', 'mileage', 'damage_area', 'severity',
  'insurer_involved', 'police_report_state', 'repair_state', 'repairer',
]);
const MAX_ACCIDENT_EVENTS = 10;
const MAX_FIELD_LENGTH = 200;

function trimmedOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '') return null;
  return text.slice(0, MAX_FIELD_LENGTH);
}

function invalid(error) {
  return { ok: false, error };
}

function sanitizeAccidentEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const event = {};
  for (const field of ACCIDENT_EVENT_FIELDS) {
    const value = trimmedOrNull(raw[field]);
    if (value !== null) event[field] = value;
  }
  return Object.keys(event).length > 0 ? event : null;
}

/**
 * @returns {{ok: true, value: object|null} | {ok: false, error: string}}
 * `value: null` means the Seller has not answered — the caller stores NULL, which every read
 * surface renders as "not recorded", never as a clean history.
 */
export function normalizeAccidentDisclosure(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return invalid('accident_disclosure must be an object with a state from the declared vocabulary');
  }
  const state = trimmedOrNull(raw.state);
  if (!ACCIDENT_DISCLOSURE_STATES.includes(state)) {
    return invalid(`accident_disclosure.state must be one of: ${ACCIDENT_DISCLOSURE_STATES.join(', ')}`);
  }
  const value = { state };
  if (state === 'yes' && Array.isArray(raw.events)) {
    const events = raw.events.slice(0, MAX_ACCIDENT_EVENTS).map(sanitizeAccidentEvent).filter(Boolean);
    if (events.length > 0) value.events = events;
  }
  return { ok: true, value };
}

export function normalizeInsuranceDisclosure(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return invalid('insurance_disclosure must be an object with a state from the declared vocabulary');
  }
  const state = trimmedOrNull(raw.state);
  if (!INSURANCE_DISCLOSURE_STATES.includes(state)) {
    return invalid(`insurance_disclosure.state must be one of: ${INSURANCE_DISCLOSURE_STATES.join(', ')}`);
  }
  const value = { state };
  if (state === 'insured') {
    const insurerName = trimmedOrNull(raw.insurer_name);
    if (insurerName !== null) value.insurer_name = insurerName;
  }
  return { ok: true, value };
}

function findPrivateFinanceKey(node) {
  if (!node || typeof node !== 'object') return null;
  for (const [key, value] of Object.entries(node)) {
    if (PRIVATE_FINANCE_KEYS.includes(key)) return key;
    const nested = findPrivateFinanceKey(value);
    if (nested) return nested;
  }
  return null;
}

export function normalizeFinanceDisclosure(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return invalid('finance_disclosure must be an object with a state from the declared vocabulary');
  }
  const privateKey = findPrivateFinanceKey(raw);
  if (privateKey) {
    return invalid(`finance_disclosure may not carry private banking terms (rejected key: ${privateKey}). `
      + 'Exact balances, payments, rates, identifiers and credit data are private by default and are not stored on the listing.');
  }
  const state = trimmedOrNull(raw.state);
  if (!FINANCE_DISCLOSURE_STATES.includes(state)) {
    return invalid(`finance_disclosure.state must be one of: ${FINANCE_DISCLOSURE_STATES.join(', ')}`);
  }
  const value = { state };
  const financeType = trimmedOrNull(raw.finance_type);
  if (financeType !== null) {
    if (!FINANCE_TYPES.includes(financeType)) {
      return invalid(`finance_disclosure.finance_type must be one of: ${FINANCE_TYPES.join(', ')}`);
    }
    value.finance_type = financeType;
  }
  const lenderName = trimmedOrNull(raw.lender_name);
  if (lenderName !== null) value.lender_name = lenderName;
  return { ok: true, value };
}

export default {
  ACCIDENT_DISCLOSURE_STATES,
  INSURANCE_DISCLOSURE_STATES,
  FINANCE_DISCLOSURE_STATES,
  FINANCE_TYPES,
  PRIVATE_FINANCE_KEYS,
  normalizeAccidentDisclosure,
  normalizeInsuranceDisclosure,
  normalizeFinanceDisclosure,
};
