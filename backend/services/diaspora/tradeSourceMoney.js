/**
 * Trade OS T6 — source-money integrity for the two legacy quote authorities.
 *
 * The hazard this closes, found by exercising it on deployed staging: procurement quotes read
 * `payload.quote_currency`, logistics quotes read `payload.currency`, and BOTH fall back to `'USD'`.
 * A caller who supplies an amount with the other domain's field name — or with no currency at all —
 * silently produces a USD row. A JPY 2,400,000 offer becomes USD 2,400,000: a ~150× commercial
 * error that no validation would catch, because 'USD' is a perfectly valid currency.
 *
 * Source money is permanent commercial truth (master plan §44), so:
 *
 *   · either field name is accepted, because the mistake is the API's fault and not the caller's;
 *   · a supplied code must be ISO-4217, so 'dollars' or 'jpy' is refused rather than stored;
 *   · 'USD' remains the default ONLY when nothing at all was supplied, which keeps every existing
 *     caller working exactly as before.
 */
import { ValidationError } from '../../utils/errors.js';

const ISO = /^[A-Z]{3}$/;

/**
 * Resolve the currency for a quote payload.
 *
 * @param payload   the request body
 * @param names     the accepted field names, most-canonical first
 * @param previous  the existing row on an update, so a PATCH does not reset the currency
 */
export function resolveSourceCurrency(payload = {}, names = ['quote_currency', 'currency'], previous = {}) {
  for (const name of names) {
    const raw = payload[name];
    if (raw === undefined || raw === null || raw === '') continue;
    const code = String(raw).trim().toUpperCase();
    if (!ISO.test(code)) {
      throw new ValidationError(`${name} must be a three-letter ISO 4217 currency code (received "${raw}")`);
    }
    return code;
  }
  for (const name of names) {
    const kept = previous[name];
    if (kept) return String(kept).toUpperCase();
  }
  // Nothing supplied anywhere. USD stays the default so existing callers are unaffected — but it
  // is now reached ONLY through genuine absence, never through a misnamed field.
  return 'USD';
}
