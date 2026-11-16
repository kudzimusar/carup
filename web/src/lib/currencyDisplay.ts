/** Currency codes as CarUp writes them: ISO upper case, except Zimbabwe Gold, which is "ZiG". */
export function displayCurrencyCode(currency: string) {
  const code = currency.trim().toUpperCase()
  return code === 'ZIG' ? 'ZiG' : code
}

/** Listing price as the Marketplace shows it: a missing price or currency is said, never guessed. */
export function formatMarketplacePrice(price: number | null, currency: string | null) {
  if (typeof price !== 'number' || !Number.isFinite(price)) return 'Price not recorded'
  if (!currency) return `${price.toLocaleString()} · currency not recorded`
  if (currency.toUpperCase() === 'USD') return `$${price.toLocaleString()}`
  return `${displayCurrencyCode(currency)} ${price.toLocaleString()}`
}
