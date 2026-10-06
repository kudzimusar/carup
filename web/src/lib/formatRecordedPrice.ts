/** Format a recorded amount without converting or inventing an exchange rate. */
export function formatRecordedPrice(amount: number, currency: string | null | undefined): string {
  if (!Number.isFinite(amount)) return 'Price not recorded'
  const code = String(currency || '').trim()
  if (!code) return `${amount.toLocaleString()} · currency not recorded`
  if (code.toLowerCase() === 'zig') return `ZiG ${amount.toLocaleString()}`
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code.toUpperCase(),
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${code.toUpperCase()} ${amount.toLocaleString()}`
  }
}
