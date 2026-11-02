/**
 * Format a recorded monetary amount without inventing an exchange rate or default currency.
 */
export function formatPrice(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return 'Price not recorded'
  const ccy = String(currency || '').trim().toUpperCase()
  if (!ccy) return amount.toLocaleString()
  try {
    return new Intl.NumberFormat('en-ZW', { style: 'currency', currency: ccy, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${ccy} ${amount.toLocaleString()}`
  }
}
