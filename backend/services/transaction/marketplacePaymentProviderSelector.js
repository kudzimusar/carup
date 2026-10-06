import { PaymentProviderError, selectPaymentProvider } from '../diaspora/safetrade/safeTradePaymentProvider.js';
import { DurableSandboxPaymentProvider } from '../diaspora/safetrade/durableSandboxPaymentProvider.js';
import { isDeployedRuntime } from '../../utils/runtimeEnvironment.js';

export function isMarketplaceSandboxRuntimeAllowed(env = process.env) {
  if (isDeployedRuntime(env)) return false;
  const nodeEnv = String(env.NODE_ENV || '').toLowerCase();
  return nodeEnv === 'test' || nodeEnv === 'development';
}

/**
 * Marketplace-specific composition of the existing SafeTrade provider selector.
 *
 * SafeTrade remains the canonical provider abstraction/control plane. This adapter selection only
 * replaces the process-local synthetic provider with its PostgreSQL-backed implementation when a
 * real Marketplace transaction would persist the provider intent across requests/serverless workers.
 * Explicit provider injection is preserved for tests and future approved provider adapters.
 *
 * The synthetic sandbox is test/staging infrastructure. Persisting fake provider state in a real
 * production transaction would be worse than being unavailable, so production fails closed until a
 * separately approved live adapter exists.
 */
export function selectMarketplacePaymentProvider({ paymentProvider = null, client, env = process.env } = {}) {
  if (paymentProvider) return selectPaymentProvider({ paymentProvider });
  const selected = selectPaymentProvider();
  if (selected?.name === 'sandbox') {
    if (!isMarketplaceSandboxRuntimeAllowed(env)) {
      throw new PaymentProviderError(
        'Marketplace sandbox payments are available only in local test/development runtimes',
        'SANDBOX_TEST_ONLY',
      );
    }
    return new DurableSandboxPaymentProvider({ client });
  }
  return selected;
}

export default selectMarketplacePaymentProvider;
