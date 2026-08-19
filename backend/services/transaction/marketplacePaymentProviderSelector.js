import { PaymentProviderError, selectPaymentProvider } from '../diaspora/safetrade/safeTradePaymentProvider.js';
import { DurableSandboxPaymentProvider } from '../diaspora/safetrade/durableSandboxPaymentProvider.js';

export function isMarketplaceSandboxRuntimeAllowed(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || '').toLowerCase();
  const vercelEnv = String(env.VERCEL_ENV || '').toLowerCase();
  const carupEnv = String(env.CARUP_ENV || env.APP_ENV || '').toLowerCase();

  // Deployment-specific signals outrank NODE_ENV. Vercel previews commonly execute with
  // NODE_ENV=production, while an actual production deployment must never be reopened by a stale
  // CARUP_ENV=staging value.
  if (vercelEnv) return vercelEnv === 'preview' || vercelEnv === 'development';
  if (carupEnv) return carupEnv === 'staging' || carupEnv === 'development' || carupEnv === 'test';
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
        'Marketplace sandbox payments are available only in test/development/staging runtimes',
        'SANDBOX_TEST_ONLY',
      );
    }
    return new DurableSandboxPaymentProvider({ client });
  }
  return selected;
}

export default selectMarketplacePaymentProvider;
