/**
 * Trade OS T13 — canonical commercial truth resolver for SafeTrade creation.
 *
 * SafeTrade must not let a client re-price an accepted trade. The accepted RFQ quote is the
 * commercial authority for seller, amount and currency. Incomplete historical quote rows remain
 * readable history, but they are not sufficient authority to create a new money-bearing SafeTrade
 * transaction. They must be repaired through a governed migration/review path rather than by trusting
 * caller-supplied financial assertions.
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
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeCurrency(value) {
  const currency = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
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
  const assertedCurrency = currency == null ? null : String(currency).trim().toUpperCase();
  const assertedAmount = totalAmount == null ? null : Number(totalAmount);

  if (assertedSeller && assertedSeller !== canonical.sellerId) {
    differences.push({ field: 'sellerId', asserted: assertedSeller, canonical: canonical.sellerId });
  }
  if (assertedCurrency && assertedCurrency !== canonical.currency) {
    differences.push({ field: 'currency', asserted: assertedCurrency, canonical: canonical.currency });
  }
  if (Number.isFinite(assertedAmount) && roundMoney(assertedAmount) !== canonical.amount) {
    differences.push({ field: 'totalAmount', asserted: roundMoney(assertedAmount), canonical: canonical.amount });
  }
  return differences;
}

/**
 * Resolve immutable commercial facts inherited by a new SafeTrade transaction.
 *
 * The accepted quote is authoritative. Caller values are assertions only and can never fill missing
 * quote money/seller facts. That fail-closed boundary prevents a historical incomplete quote from
 * becoming a client-controlled price or counterparty assignment.
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
  if (requestedTenantId && orderTenantId && requestedTenantId !== orderTenantId && !isPlatformAdmin(context) && !isPlatformReviewer(context)) {
    throw new ForbiddenError('A client-supplied tenant cannot differ from the linked order tenant', {
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

  const quoteTenantId = normalizeId(quote.tenant_id ?? quote.tenantId);
  if (quoteTenantId && orderTenantId && quoteTenantId !== orderTenantId) {
    throw new ValidationError('Accepted quote tenant does not match the linked import order tenant', {
      code: 'SAFETRADE_ACCEPTED_QUOTE_TENANT_MISMATCH',
    });
  }

  const quoteAmount = roundMoney(quote.quote_amount);
  const quoteCurrency = normalizeCurrency(quote.quote_currency);
  const quoteSellerId = normalizeId(quote.seller_id);
  const missingFields = [];
  if (quoteAmount == null) missingFields.push('quote_amount');
  if (!quoteCurrency) missingFields.push('quote_currency');
  if (!quoteSellerId) missingFields.push('seller_id');

  if (missingFields.length > 0) {
    throw new ValidationError('Accepted quote is incomplete and cannot authorize a new SafeTrade transaction', {
      code: 'SAFETRADE_ACCEPTED_QUOTE_INCOMPLETE',
      quoteId: acceptedQuoteId,
      missingFields,
      repairRequired: true,
    });
  }

  const canonical = { amount: quoteAmount, currency: quoteCurrency, sellerId: quoteSellerId };
  const ignoredAssertions = assertionDifferences({ sellerId, currency, totalAmount }, canonical);

  return {
    order,
    quote,
    buyerId,
    sellerId: quoteSellerId,
    currency: quoteCurrency,
    amount: quoteAmount,
    tenantId: orderTenantId ?? quoteTenantId ?? contextTenantId ?? (isPlatformAdmin(context) || isPlatformReviewer(context) ? requestedTenantId : null),
    acceptedQuoteId,
    provenance: {
      authority: 'diaspora_import_quotes',
      status: 'ACCEPTED_QUOTE',
      quoteId: acceptedQuoteId,
      amount: quoteAmount,
      currency: quoteCurrency,
      sellerId: quoteSellerId,
      missingFields: [],
      ignoredAssertions,
      fx: null,
    },
  };
}
