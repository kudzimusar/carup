/**
 * RX-02A S1-3 — MoneyDisplay formatting authority (UI_DESIGN_REFERENCE_AND_TOKENS.md §6.3).
 *
 * Rules enforced here (and tested in money.test.ts):
 *  - Currency is mandatory and explicit. No value is ever rendered without its code.
 *  - ZiG is NEVER rendered as "$". Only USD may use the "$" glyph.
 *  - Grouping uses Intl.NumberFormat en-US grouping; the currency code is always visible.
 *  - Missing / non-finite amounts never produce a fabricated figure.
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

export type FormattedMoney =
  | { kind: 'value'; text: string; currency: Currency }
  | { kind: 'missing' }

/**
 * Format an amount with an explicit currency code.
 * Returns kind:'missing' for null/undefined/NaN/±Infinity — callers must render a
 * labelled missing-value state, never a fabricated figure.
 */
export function formatMoney(amount: unknown, currencyRaw: unknown): FormattedMoney {
  const currency = normalizeCurrency(currencyRaw)
  if (typeof amount !== 'number' || !Number.isFinite(amount) || currency === null) {
    return { kind: 'missing' }
  }
  const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount)
  // Only USD gets the "$" glyph; every other currency keeps its explicit code prefix.
  const text = currency === 'USD' ? `$${grouped}` : `${currency} ${grouped}`
  return { kind: 'value', text, currency }
}
