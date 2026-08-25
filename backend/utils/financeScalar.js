/**
 * Coerce a finance money term to a finite number, accepting ONLY a primitive number or a nonblank
 * numeric string. Returns null for everything else.
 *
 * This is the single scalar guard shared by every finance money input (applicant requested amount,
 * lender APR, lender monthly payment). `Number()` silently coerces `false`→0, `true`→1, `[]`→0 and
 * `[5]`→5, so validating on `Number(val)` alone lets a boolean or a one-element array masquerade as a
 * real money term and be persisted into a numeric column. Rejecting by type first stops a non-scalar
 * from ever becoming a persisted amount, APR or payment.
 */
export function toFiniteFinanceNumber(val) {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}
