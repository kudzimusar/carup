/** Currency codes as CarUp writes them: ISO upper case, except Zimbabwe Gold, which is "ZiG". */
export function displayCurrencyCode(currency: string) {
  const code = currency.trim().toUpperCase()
  return code === 'ZIG' ? 'ZiG' : code
}
