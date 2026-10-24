import { ValidationError } from './errors.js';

/**
 * GARAGE-1.0 money truth, in one place.
 *
 *  - A currency is ALWAYS explicit. There is no default, anywhere.
 *  - "No price" is `null` (not recorded). It is never coerced to 0.
 *  - Amounts are exact decimals. They travel as strings/numbers the caller supplied and are checked
 *    against the currency's minor-unit scale; they are never silently rounded.
 *  - Totals are computed by the database from stored lines. Nothing here produces accounting truth;
 *    it validates input and formats output.
 *
 * Mirrors garage_ops04_currency_scale() in SQL so JS and PostgreSQL never disagree about a currency.
 */

const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
// Three-decimal (and unit-of-account) currencies this schema cannot hold exactly: refused, never rounded.
const UNSUPPORTED = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND', 'CLF', 'UYW']);
// ICU is the source of "is this a real ISO 4217 code"; these are belt-and-braces for runtimes with a trimmed ICU.
const ALWAYS_REAL = ['USD', 'ZAR', 'ZWG', 'ZWL', 'GBP', 'EUR', 'JPY', 'BWP', 'MZN', 'ZMW', 'NAD', 'MWK', 'AOA', 'TZS', 'KES', 'UGX'];

let knownCodes = null;
function iso4217() {
  if (!knownCodes) {
    let list = [];
    try { list = Intl.supportedValuesOf('currency'); } catch { list = []; }
    knownCodes = new Set([...list, ...ALWAYS_REAL]);
  }
  return knownCodes;
}

/** Minor-unit digits for a currency, or null when it cannot be stored exactly. */
export function currencyScale(code) {
  if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) return null;
  if (UNSUPPORTED.has(code)) return null;
  return ZERO_DECIMAL.has(code) ? 0 : 2;
}

/** A required, explicit, real, exactly-storable currency code. */
export function requireCurrency(value, label = 'currency') {
  const code = String(value ?? '').trim();
  if (!code) throw new ValidationError(`${label} is required — a Garage amount never assumes a currency`);
  if (!/^[A-Z]{3}$/.test(code)) throw new ValidationError(`${label} must be a 3-letter ISO 4217 code in capitals (for example USD, ZAR, ZWG)`);
  if (!iso4217().has(code)) throw new ValidationError(`${code} is not a recognised ISO 4217 currency`);
  if (currencyScale(code) === null) throw new ValidationError(`${code} amounts cannot be recorded exactly; use another currency`);
  return code;
}

function decimalString(value, label) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ValidationError(`${label} must be a finite number`);
    // Number -> shortest round-trip string; avoids exponent forms for the ranges we accept.
    return value.toString().includes('e') ? value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : value.toString();
  }
  if (typeof value === 'string') return value.trim();
  throw new ValidationError(`${label} must be a number`);
}

/**
 * Validate an amount against its currency. `null`/`undefined`/'' mean "not recorded" and are returned
 * as null when `optional`; otherwise they are an error. Returns the canonical decimal string.
 */
export function moneyAmount(value, label, currency, { optional = false, max = 999999999999.99 } = {}) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    if (optional) return null;
    throw new ValidationError(`${label} is required`);
  }
  const text = decimalString(value, label);
  if (!/^\d+(\.\d+)?$/.test(text)) throw new ValidationError(`${label} must be a non-negative amount`);
  const scale = currencyScale(currency);
  if (scale === null) throw new ValidationError(`${currency || 'This currency'} amounts cannot be recorded exactly`);
  const fraction = text.includes('.') ? text.split('.')[1].replace(/0+$/, '') : '';
  if (fraction.length > scale) {
    throw new ValidationError(`${label} has more decimal places than ${currency} allows (${scale})`);
  }
  if (Number(text) > max) throw new ValidationError(`${label} is too large`);
  return text;
}

/** A positive quantity with at most 3 decimals (matches NUMERIC(12,3)). */
export function quantityValue(value, label = 'quantity') {
  const text = decimalString(value, label);
  if (!/^\d+(\.\d{1,3})?$/.test(text) || Number(text) <= 0) {
    throw new ValidationError(`${label} must be a positive number with at most 3 decimal places`);
  }
  if (Number(text) > 999999999) throw new ValidationError(`${label} is too large`);
  return text;
}

/** Exact sum of decimal strings in minor units (no float drift). Returns null if any term is unknown. */
export function sumMoney(values, currency) {
  const scale = currencyScale(currency);
  if (scale === null) return null;
  const factor = 10n ** BigInt(scale);
  let total = 0n;
  for (const v of values) {
    if (v === null || v === undefined) return null;
    const [whole, frac = ''] = String(v).split('.');
    total += BigInt(whole) * factor + BigInt((frac + '0'.repeat(scale)).slice(0, scale) || '0');
  }
  return formatMinor(total, scale);
}

function formatMinor(minor, scale) {
  if (scale === 0) return minor.toString();
  const s = minor.toString().padStart(scale + 1, '0');
  return `${s.slice(0, -scale)}.${s.slice(-scale)}`;
}

/** Display only. `null` stays "not recorded" — it is never rendered as 0. */
export function describeMoney(amount, currency) {
  if (amount === null || amount === undefined) return 'Not recorded';
  return `${amount} ${currency}`;
}

/** Add two amounts of the SAME currency; refuse to mix currencies. */
export function assertSameCurrency(a, b, what = 'amounts') {
  if (a !== b) throw new ValidationError(`${what} are in different currencies (${a} vs ${b}) and are never converted or added`);
}

export default { currencyScale, requireCurrency, moneyAmount, quantityValue, sumMoney, describeMoney, assertSameCurrency };
