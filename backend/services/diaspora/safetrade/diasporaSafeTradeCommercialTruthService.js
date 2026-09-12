/**
 * Trade OS T13 — canonical commercial truth resolver for SafeTrade creation.
 *
 * SafeTrade must not let a client re-price an accepted trade. The accepted RFQ quote is the
 * commercial authority when it carries the complete amount/currency/seller triple. Historical
 * Phase-9 fixtures/rows pre-date those quote fields, so they remain readable/creatable through an
 * explicit legacy fallback that records exactly which accepted-quote facts were absent. The fallback
 * is compatibility debt, not a second pricing authority.
 *
 * This module never performs FX conversion. T6 reference FX is presentation-only; settlement FX is
 * a T13 provider fact and customs FX remains T12.
 */
import { ForbiddenError, NotFoundError, ValidationError } from '../../../utils/errors.js';
import {
  requireUserContext,
  isOrderOwner,
  isPlatformAdmin,
  isPlatformReviewer,
  isTenantAdminForRecord,
  normalizeId,
} from '../diasporaAuthorization.js';

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeCurrency(value) {
  const currency = String(value ?? '').trim().toUpperCase();
  return currency || null;
}

function deriveBuyerId(order = {}) {
  return normalizeId(
    order.buyer_id
      ?? order.buyerId
      ?? order.owner_id
      ?? order.ownerId
      ?? order.user_id
      ?? order.userId
      ?? order.created_by
      ?? order.createdBy,
  );
}

function assertionDifferences({ sellerId, currency, totalAmount }, canonical) {
  const differences = [];
  const assertedSeller = normalizeId(sellerId);
  const assertedCurrency = normalizeCurrency(currency);
  const assertedAmount = totalAmount == null ? null : roundMoney(totalAmount);

  if (assertedSeller && assertedSeller !== canonical.sellerId) {
    differences.push({ field: 'sellerId', asserted: assertedSeller, canonical: canonical.sellerId });
  }
  if (assertedCurrency && assertedCurrency !== canonical.currency) {
    differences.push({ field: 'currency', asserted: assertedCurrency, canonical: canonical.currency });
  }
  if (assertedAmount != null && assertedAmount !== canonical.amount) {
    differences.push({ field: 'totalAmount', asserted: assertedAmount, canonical: canonical.amount });
  }
  return differences;
}

/**
 * Resolve the immutable commercial facts that a new SafeTrade transaction must inherit.
 *
 * Complete accepted quote:
 *   quote_amount + quote_currency + seller_id are authoritative. Caller values are assertions only
 *   and can never alter the stored transaction.
 *
 * Historical incomplete accepted quote:
 *   missing facts may fall back to the caller's already-existing Phase-9 inputs, but the resulting
 *   provenance is explicitly LEGACY_INCOMPLETE_ACCEPTED_QUOTE and lists the missing fields. This keeps
 *   old fixtures/data operable without pretending the fallback is accepted-quote truth.
 */
export async function resolveSafeTradeCommercialTruth(supabase, {
  importOrderId,
  userContext = {},
  sellerId = null,
  currency = null,
  totalAmount = null,
  tenantId = null,
} = {}) {
  const context = requireUserContext(userContext);
  if (!supabase || typeof supabase.from !== 'function') {
    throw new ValidationError('A database client is required to resolve SafeTrade commercial truth');
  }
  if (!importOrderId) throw new ValidationError('importOrderId is required');

  const { data: order, error: orderError } = await supabase
    .from('diaspora_import_orders')
    .select('*')
    .eq('id', importOrderId)
    .is('deleted_at', null)
    .maybeSingle();
  if (orderError || !order) throw new NotFoundError('Diaspora import order not found');

  const privileged = isPlatformAdmin(context)
    || isPlatformReviewer(context)
    || isTenantAdminForRecord(order, context);
  if (!isOrderOwner(order, context) && !privileged) {
    throw new ForbiddenError('Only the order buyer or a governed reviewer/admin may create SafeTrade for this order', {
      code: 'SAFETRADE_ORDER_AUTHORITY_REQUIRED',
    });
  }

  const orderTenantId = normalizeId(order.tenant_id ?? order.tenantId);
  const contextTenantId = normalizeId(context.tenantId);
  const requestedTenantId = normalizeId(tenantId);
  if (orderTenantId && contextTenantId && orderTenantId !== contextTenantId && !isPlatformAdmin(context) && !isPlatformReviewer(context)) {
    throw new ForbiddenError('The active tenant does not match the SafeTrade order tenant', {
      code: 'SAFETRADE_TENANT_MISMATCH',
    });
  }
  if (requestedTenantId && contextTenantId && requestedTenantId !== contextTenantId && !isPlatformAdmin(context) && !isPlatformReviewer(context)) {
    throw new ForbiddenError('A client-supplied tenant cannot change SafeTrade authority', {
      code: 'SAFETRADE_TENANT_MISMATCH',
    });
  }

  const buyerId = deriveBuyerId(order);
  if (!buyerId) {
    throw new ValidationError('The linked import order has no attributable buyer', {
      code: 'SAFETRADE_BUYER_UNKNOWN',
    });
  }

  const acceptedQuoteId = normalizeId(order?.metadata?.rfq?.acceptedQuoteId);
  if (!acceptedQuoteId) {
    throw new ValidationError('SafeTrade requires an accepted quote on the linked import order', {
      code: 'SAFETRADE_ACCEPTED_QUOTE_REQUIRED',
    });
  }

  const { data: quote, error: quoteError } = await supabase
    .from('diaspora_import_quotes')
    .select('*')
    .eq('id', acceptedQuoteId)
    .is('deleted_at', null)
    .maybeSingle();
  if (quoteError || !quote) throw new NotFoundError('Accepted Diaspora quote not found');
  if (normalizeId(quote.import_order_id) !== normalizeId(importOrderId) || String(quote.status || '').toUpperCase() !== 'ACCEPTED') {
    throw new ValidationError('SafeTrade quote must be the accepted quote for the linked import order', {
      code: 'SAFETRADE_ACCEPTED_QUOTE_INVALID',
    });
  }

  const quoteAmount = roundMoney(quote.quote_amount);
  const quoteCurrency = normalizeCurrency(quote.quote_currency);
  const quoteSellerId = normalizeId(quote.seller_id);
  const missingFields = [];
  if (quoteAmount == null) missingFields.push('quote_amount');
  if (!quoteCurrency) missingFields.push('quote_currency');
  if (!quoteSellerId) missingFields.push('seller_id');

  const complete = missingFields.length === 0;
  const fallbackAmount = roundMoney(totalAmount);
  const fallbackCurrency = normalizeCurrency(currency);
  const fallbackSellerId = normalizeId(sellerId);

  const amount = quoteAmount ?? fallbackAmount;
  const resolvedCurrency = quoteCurrency ?? fallbackCurrency;
  const resolvedSellerId = quoteSellerId ?? fallbackSellerId;
  if (amount == null) throw new ValidationError('SafeTrade amount is unavailable from both the accepted quote and the legacy assertion');
  if (!resolvedCurrency) throw new ValidationError('SafeTrade currency is unavailable from both the accepted quote and the legacy assertion');
  if (!resolvedSellerId) throw new ValidationError('SafeTrade seller is unavailable from both the accepted quote and the legacy assertion');

  const canonical = { amount, currency: resolvedCurrency, sellerId: resolvedSellerId };
  const ignoredAssertions = complete
    ? assertionDifferences({ sellerId, currency, totalAmount }, canonical)
    : [];

  return {
    order,
    quote,
    buyerId,
    sellerId: resolvedSellerId,
    currency: resolvedCurrency,
    amount,
    tenantId: orderTenantId ?? contextTenantId ?? (isPlatformAdmin(context) || isPlatformReviewer(context) ? requestedTenantId : null),
    acceptedQuoteId,
    provenance: {
      authority: 'diaspora_import_quotes',
      status: complete ? 'ACCEPTED_QUOTE' : 'LEGACY_INCOMPLETE_ACCEPTED_QUOTE',
      quoteId: acceptedQuoteId,
      amount,
      currency: resolvedCurrency,
      sellerId: resolvedSellerId,
      missingFields,
      ignoredAssertions,
      fx: null,
    },
  };
}
