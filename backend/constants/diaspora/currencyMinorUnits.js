/**
 * ISO 4217 minor units for the currencies SafeTrade settles in.
 *
 * SafeTrade stores money in major units at numeric(14,2) and rounds to two decimals, which is exact
 * for USD/ZAR/GBP/EUR. JPY has NO minor unit: ¥2,400,000.50 is not an amount anyone can pay. The
 * database would store it, so the service must refuse it — never round it, which would silently
 * change a figure the buyer and seller agreed.
 */
import { ValidationError } from '../../utils/errors.js';

export const CURRENCY_MINOR_UNITS = Object.freeze({ USD: 2, ZAR: 2, GBP: 2, EUR: 2, JPY: 0 });

/** Decimal places a currency admits, or null when unknown (callers must refuse, not assume 2). */
export function minorUnitsFor(currency) {
  const code = String(currency ?? '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CURRENCY_MINOR_UNITS, code) ? CURRENCY_MINOR_UNITS[code] : null;
}

/** True when `amount` is exactly representable in `currency`'s smallest unit. */
export function amountFitsCurrency(amount, currency) {
  const units = minorUnitsFor(currency);
  const n = Number(amount);
  if (units === null || !Number.isFinite(n)) return false;
  const scaled = n * 10 ** units;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

export function assertAmountFitsCurrency(amount, currency, { field = 'amount', code = 'CURRENCY_MINOR_UNIT_VIOLATION' } = {}) {
  if (!amountFitsCurrency(amount, currency)) {
    const units = minorUnitsFor(currency);
    throw new ValidationError(
      units === 0
        ? `${field} ${amount} ${currency} is not a whole amount; ${currency} has no minor unit`
        : `${field} ${amount} is not representable in ${currency}`,
      { code, field, amount, currency, minorUnits: units },
    );
  }
}
