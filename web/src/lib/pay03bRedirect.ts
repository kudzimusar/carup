/**
 * CARUP-PAY-03B — the single place the subscription UI leaves CarUp for a provider page
 * (checkout, hosted invoice, payment-method update).
 *
 * Kept in its own module so the navigation can be observed in tests (jsdom cannot navigate) and so
 * only an absolute http(s) address returned by the backend is ever followed. Leaving for the
 * provider is never treated as payment: CarUp grants access only after it confirms the payment with
 * the provider on return.
 */
export class Pay03bRedirectError extends Error {
  code = 'PAY03B_REDIRECT_URL_INVALID'
  constructor() {
    super('PAY03B_REDIRECT_URL_INVALID')
    this.name = 'Pay03bRedirectError'
  }
}

export function redirectToPay03bProvider(url: string): void {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw new Pay03bRedirectError()
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Pay03bRedirectError()
  window.location.assign(target.toString())
}
