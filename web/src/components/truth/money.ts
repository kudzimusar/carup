/**
 * RX-02A S1-3 — MoneyDisplay formatting authority (UI_DESIGN_REFERENCE_AND_TOKENS.md §6.3).
 *
 * Rules enforced here (and tested in money.test.ts):
 *  - Currency is mandatory and explicit. The currency CODE is always rendered visibly
 *    by MoneyDisplay — a bare "$" is ambiguous and is never the whole story.
 *  - ZiG is NEVER rendered as "$". Only USD may use the "$" glyph, and only with its
 *    visible "USD" code alongside it.
 *  - Grouping uses Intl.NumberFormat en-US grouping.
 *  - Missing / non-finite amounts never produce a fabricated figure (kind:'missing').
 *  - Currency provenance is distinguished, never conflated:
 *      · supported code (USD/ZiG/ZAR/BWP, ZWG/ZIG alias) → kind:'value';
 *      · a RECORDED but unsupported currency (a real currency code such as EUR) →
 *        kind:'unsupported-currency' — the amount and the verbatim recorded code are
 *        shown, explicitly flagged as unsupported. No conversion, no invented values;
 *      · an UNRECORDED currency (null/undefined/blank/non-string) →
 *        kind:'currency-not-recorded' — the amount is shown, the currency is labelled
 *        "not recorded". An absent currency must never be misrepresented as a
 *        supported/unsupported code.
 *  - No FX rates are assumed, no currencies are defaulted, no financial scope expands.
 */

export const SUPPORTED_CURRENCIES = ['USD', 'ZiG', 'ZAR', 'BWP'] as const
export type Currency = (typeof SUPPORTED_CURRENCIES)[number]

export const MONEY_SOURCE_LABELS = {
  asking: 'Asking price',
  agreed: 'Agreed price',
  estimate: 'Estimate',
  guide: 'Price guide',
} as const
export type MoneySource = keyof typeof MONEY_SOURCE_LABELS

/** Normalize an arbitrary runtime currency string; null when not recognizable. */
export function normalizeCurrency(raw: unknown): Currency | null {
  if (typeof raw !== 'string') return null
  const upper = raw.trim().toUpperCase()
  if (upper === 'ZWG' || upper === 'ZIG') return 'ZiG' // ISO 4217 code for Zimbabwe Gold
  const found = (SUPPORTED_CURRENCIES as readonly string[]).find((c) => c.toUpperCase() === upper)
  return (found as Currency | undefined) ?? null
}

/**
 * True when `code` is a real, recorded currency code (per Intl) that we simply do
 * not format. Used to distinguish "recorded but unsupported" (EUR) from "unrecorded"
 * (null/blank/garbage). Well-formedness only — no FX data is consulted.
 */
function isRecognizedCurrencyCode(code: string): boolean {
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(0)
    return true
  } catch {
    return false
  }
}

export type FormattedMoney =
  | { kind: 'value'; amountText: string; currency: Currency }
  | { kind: 'unsupported-currency'; amountText: string; code: string }
  | { kind: 'currency-not-recorded'; amountText: string }
  | { kind: 'missing' }

/**
 * Format an amount with an explicit currency code.
 *  - null/undefined/NaN/±Infinity amount → kind:'missing' (never a fabricated figure);
 *  - finite amount + supported currency → kind:'value' with the visible currency code;
 *  - finite amount + recorded-but-unsupported currency (e.g. EUR) → kind:'unsupported-currency'
 *    (amount + verbatim code, flagged unsupported — never converted);
 *  - finite amount + unrecorded currency → kind:'currency-not-recorded'
 *    (amount shown, currency labelled "not recorded").
 */
export function formatMoney(amount: unknown, currencyRaw: unknown): FormattedMoney {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return { kind: 'missing' }
  }
  const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount)
  const currency = normalizeCurrency(currencyRaw)
  if (currency !== null) {
    // Only USD gets the "$" glyph — and MoneyDisplay still renders the "USD" code visibly.
    const amountText = currency === 'USD' ? `$${grouped}` : grouped
    return { kind: 'value', amountText, currency }
  }
  if (typeof currencyRaw === 'string') {
    const trimmed = currencyRaw.trim()
    if (trimmed !== '' && isRecognizedCurrencyCode(trimmed.toUpperCase())) {
      return { kind: 'unsupported-currency', amountText: grouped, code: trimmed.toUpperCase() }
    }
  }
  return { kind: 'currency-not-recorded', amountText: grouped }
}
