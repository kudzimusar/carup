import { selectPaymentProvider } from '../diaspora/safetrade/safeTradePaymentProvider.js';
import { DurableSandboxPaymentProvider } from '../diaspora/safetrade/durableSandboxPaymentProvider.js';

/**
 * Marketplace-specific composition of the existing SafeTrade provider selector.
 *
 * SafeTrade remains the canonical provider abstraction/control plane. This adapter selection only
 * replaces the process-local synthetic provider with its PostgreSQL-backed implementation when a
 * real Marketplace transaction would persist the provider intent across requests/serverless workers.
 * Explicit provider injection is preserved for tests and future approved provider adapters.
 */
export function selectMarketplacePaymentProvider({ paymentProvider = null, client } = {}) {
  if (paymentProvider) return selectPaymentProvider({ paymentProvider });
  const selected = selectPaymentProvider();
  if (selected?.name === 'sandbox') return new DurableSandboxPaymentProvider({ client });
  return selected;
}

export default selectMarketplacePaymentProvider;
