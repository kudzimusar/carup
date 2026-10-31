/**
 * CARUP-PAY-02 — Commercial Authority, Pricing, Quote & Provider Routing Contract
 * Authority: GitHub Issue #247 & Owner Master Long-Run Implementation Directive
 *
 * Enforces the 7 mandatory financial questions for every event:
 * 1. What is being purchased or paid for? (productCode, version, sourceObjectType, sourceObjectId)
 * 2. Who owes the money? (payerId, payerRole)
 * 3. Who is legally entitled to the money? (contractualSeller, legalBeneficiary, merchantOfRecord, fundsOwner, revenueBeneficiary)
 * 4. How much is owed, and in which currency? (integer minor units + explicit currencyScale; zero floating-point math)
 * 5. Which provider may process the transaction? (fail-closed provider routing by jurisdiction, category, account, capability)
 * 6. What does payment actually authorize? (fulfillmentContract bound to owning subsystem)
 * 7. How do we reconcile the outcome? (canonical payment_transactions reference + provider evidence + settlement status)
 */
import crypto from 'node:crypto';
import { PAY01A_ACCOUNT } from './pay01aContract.js';
import {
  PAY02_CATEGORIES,
  PAY02_ACTIVATION_STATES,
  PAY02_CURRENCY_SCALES,
  getPay02CatalogueItem,
} from './pay02CatalogueDefinitions.js';

export const FORBIDDEN_PRODUCTION_SUPABASE_PROJECT = 'vhmnajoeicasaigiophh';

export const PAY02_ELIGIBLE_QUOTE_STATES = new Set([
  'commercially_approved',
  'provider_eligible',
  'sandbox_certified',
  'staging_certified',
]);

export const PAY02_PROVIDER_PROFILES = Object.freeze({
  stripe_carup_japan_sandbox: Object.freeze({
    providerKey: 'stripe_carup_japan_sandbox',
    providerClass: 'direct_merchant_gateway',
    displayName: 'Stripe Japan (CarUp Sandbox Direct Merchant)',
    accountId: PAY01A_ACCOUNT,
    merchantIdentity: 'carup_japan',
    supportedCountries: Object.freeze(['JP']),
    supportedCurrencies: Object.freeze(['JPY']),
    supportedCategories: Object.freeze([PAY02_CATEGORIES.FIRST_PARTY]),
    supportedCapabilities: Object.freeze([
      'collect_payment',
      'refund',
      'retrieve_status',
      'webhook_verify',
      'webhook_replay_resistant',
    ]),
    unsupportedCapabilities: Object.freeze([
      'regulated_escrow',
      'delayed_release',
      'payout_to_seller',
      'split_payment',
      'partial_refund',
    ]),
    sandboxOnly: true,
    liveAuthorized: false,
    callableInTest: true,
  }),
  paynow_zimbabwe: Object.freeze({
    providerKey: 'paynow_zimbabwe',
    providerClass: 'local_collection_candidate',
    displayName: 'Paynow Zimbabwe (Candidate — Merchant Authority Pending)',
    accountId: null,
    merchantIdentity: 'carup_zimbabwe_pending',
    supportedCountries: Object.freeze(['ZW']),
    supportedCurrencies: Object.freeze(['USD', 'ZWG']),
    supportedCategories: Object.freeze([PAY02_CATEGORIES.FIRST_PARTY]),
    supportedCapabilities: Object.freeze([]),
    unsupportedCapabilities: Object.freeze([
      'regulated_escrow',
      'delayed_release',
      'payout_to_seller',
    ]),
    sandboxOnly: true,
    liveAuthorized: false,
    callableInTest: false,
    blockedReason: 'PAY02_PROVIDER_MERCHANT_AUTHORITY_PENDING',
  }),
  bank_transfer_governed: Object.freeze({
    providerKey: 'bank_transfer_governed',
    providerClass: 'bank_settlement_rail',
    displayName: 'Governed Bank Transfer & Treasury Settlement (Pending)',
    accountId: null,
    merchantIdentity: null,
    supportedCountries: Object.freeze(['ZW', 'JP', 'GLOBAL']),
    supportedCurrencies: Object.freeze(['USD', 'JPY', 'ZWG', 'ZAR', 'GBP']),
    supportedCategories: Object.freeze([
      PAY02_CATEGORIES.FIRST_PARTY,
      PAY02_CATEGORIES.THIRD_PARTY,
    ]),
    supportedCapabilities: Object.freeze([]),
    unsupportedCapabilities: Object.freeze(['collect_payment']),
    sandboxOnly: true,
    liveAuthorized: false,
    callableInTest: false,
    blockedReason: 'PAY02_BANK_SETTLEMENT_AUTHORITY_PENDING',
  }),
  regulated_escrow_partner: Object.freeze({
    providerKey: 'regulated_escrow_partner',
    providerClass: 'regulated_escrow_settlement',
    displayName: 'Regulated Escrow & Conditional Settlement Partner (Blocked)',
    accountId: null,
    merchantIdentity: null,
    supportedCountries: Object.freeze(['ZW', 'JP']),
    supportedCurrencies: Object.freeze(['USD', 'JPY']),
    supportedCategories: Object.freeze([PAY02_CATEGORIES.THIRD_PARTY]),
    supportedCapabilities: Object.freeze([]),
    unsupportedCapabilities: Object.freeze([]),
    sandboxOnly: true,
    liveAuthorized: false,
    callableInTest: false,
    blockedReason: 'PAY02_REGULATED_ESCROW_BLOCKED',
  }),
  licensed_insurer_partner: Object.freeze({
    providerKey: 'licensed_insurer_partner',
    providerClass: 'regulated_insurer',
    displayName: 'Licensed Insurer Premium & Claims Authority (Blocked)',
    accountId: null,
    merchantIdentity: null,
    supportedCountries: Object.freeze(['ZW']),
    supportedCurrencies: Object.freeze(['USD', 'ZWG']),
    supportedCategories: Object.freeze([PAY02_CATEGORIES.THIRD_PARTY]),
    supportedCapabilities: Object.freeze([]),
    unsupportedCapabilities: Object.freeze([]),
    sandboxOnly: true,
    liveAuthorized: false,
    callableInTest: false,
    blockedReason: 'PAY02_LICENSED_INSURER_AUTHORITY_REQUIRED',
  }),
  licensed_lender_partner: Object.freeze({
    providerKey: 'licensed_lender_partner',
    providerClass: 'regulated_lender',
    displayName: 'Licensed Bank / Lender Facility Authority (Blocked)',
    accountId: null,
    merchantIdentity: null,
    supportedCountries: Object.freeze(['ZW']),
    supportedCurrencies: Object.freeze(['USD', 'ZWG']),
    supportedCategories: Object.freeze([PAY02_CATEGORIES.THIRD_PARTY]),
    supportedCapabilities: Object.freeze([]),
    unsupportedCapabilities: Object.freeze([]),
    sandboxOnly: true,
    liveAuthorized: false,
    callableInTest: false,
    blockedReason: 'PAY02_LICENSED_LENDER_AUTHORITY_REQUIRED',
  }),
  garage_recorded_external: Object.freeze({
    providerKey: 'garage_recorded_external',
    providerClass: 'external_off_platform_declaration',
    displayName: 'Garage-Recorded External Payment (Not Processed or Verified by CarUp)',
    accountId: null,
    merchantIdentity: null,
    supportedCountries: Object.freeze(['ZW']),
    supportedCurrencies: Object.freeze(['USD', 'ZWG']),
    supportedCategories: Object.freeze([PAY02_CATEGORIES.THIRD_PARTY]),
    supportedCapabilities: Object.freeze([]),
    unsupportedCapabilities: Object.freeze(['collect_payment', 'refund', 'regulated_escrow']),
    sandboxOnly: false,
    liveAuthorized: false,
    callableInTest: false,
    blockedReason: 'PAY02_EXTERNAL_DECLARATION_NOT_GATEWAY',
  }),
});

export class Pay02Error extends Error {
  constructor(code, status = 409, details = null) {
    super(code);
    this.name = 'Pay02Error';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Enforces non-production runtime and forbids the production Supabase project.
 */
export function requirePay02NonProduction(env = process.env) {
  const deployment = String(env.VERCEL_ENV || '').toLowerCase();
  const app = String(env.CARUP_ENV || env.APP_ENV || '').toLowerCase();
  const node = String(env.NODE_ENV || '').toLowerCase();
  const supabaseUrl = String(env.SUPABASE_URL || '').toLowerCase();

  if (supabaseUrl.includes(FORBIDDEN_PRODUCTION_SUPABASE_PROJECT)) {
    throw new Pay02Error('PAY02_PRODUCTION_DATABASE_FORBIDDEN', 403);
  }
  if (
    deployment === 'production'
    || app === 'production'
    || (node === 'production' && !['preview', 'development'].includes(deployment))
  ) {
    throw new Pay02Error('PAY02_PRODUCTION_RUNTIME_FORBIDDEN', 403);
  }
  return { environment: app || deployment || node || 'test' };
}

/**
 * Validates exact integer minor units and currency scale with zero floating-point arithmetic.
 */
export function assertMinorUnitAmount(amountMinor, currency, expectedScale = null) {
  const normalizedCurrency = String(currency || '').trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(PAY02_CURRENCY_SCALES, normalizedCurrency)) {
    throw new Pay02Error('PAY02_CURRENCY_UNSUPPORTED', 400, { currency: normalizedCurrency });
  }
  const canonicalScale = PAY02_CURRENCY_SCALES[normalizedCurrency];
  if (expectedScale !== null && expectedScale !== undefined && Number(expectedScale) !== canonicalScale) {
    throw new Pay02Error('PAY02_CURRENCY_SCALE_MISMATCH', 400, {
      currency: normalizedCurrency,
      expectedScale: canonicalScale,
      receivedScale: expectedScale,
    });
  }
  if (typeof amountMinor === 'number' && !Number.isSafeInteger(amountMinor)) {
    throw new Pay02Error('PAY02_FLOAT_OR_UNSAFE_AMOUNT_REFUSED', 400);
  }
  if (typeof amountMinor === 'string' && !/^\d+$/.test(amountMinor)) {
    throw new Pay02Error('PAY02_MINOR_UNIT_INTEGER_REQUIRED', 400);
  }
  const parsed = typeof amountMinor === 'bigint' ? Number(amountMinor) : Number(amountMinor);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Pay02Error('PAY02_MINOR_UNIT_INVALID', 400);
  }
  return {
    amountMinor: parsed,
    currency: normalizedCurrency,
    currencyScale: canonicalScale,
    formattedMajor: formatMinorUnitsToMajorString(parsed, canonicalScale),
  };
}

/**
 * Pure integer string formatting from minor units to fixed-scale decimal representation.
 * Never uses floating-point division.
 */
export function formatMinorUnitsToMajorString(amountMinor, scale) {
  const big = BigInt(amountMinor);
  if (scale === 0) return big.toString();
  const divisor = 10n ** BigInt(scale);
  const whole = big / divisor;
  const fraction = (big % divisor).toString().padStart(scale, '0');
  return `${whole.toString()}.${fraction}`;
}

/**
 * Validates a commercial catalogue entry against PAY-02 completeness and fail-closed rules.
 */
export function validateCatalogueEntry(entry) {
  const errors = [];
  if (!entry || typeof entry !== 'object') {
    throw new Pay02Error('PAY02_CATALOGUE_ENTRY_INVALID', 400);
  }
  if (!entry.productCode || !/^[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+$/.test(entry.productCode)) {
    errors.push('invalid_product_code');
  }
  if (!Number.isInteger(entry.version) || entry.version < 1) {
    errors.push('invalid_version');
  }
  if (!Object.values(PAY02_CATEGORIES).includes(entry.commercialCategory)) {
    errors.push('invalid_commercial_category');
  }
  if (!PAY02_ACTIVATION_STATES.includes(entry.activationState)) {
    errors.push('invalid_activation_state');
  }
  if (['release_approved', 'active'].includes(entry.activationState)) {
    errors.push('live_activation_forbidden_in_pay02');
  }
  if (
    entry.commercialCategory === PAY02_CATEGORIES.CORPORATE_TREASURY
    && (entry.checkoutProhibited !== true || !['blocked', 'draft'].includes(entry.activationState))
  ) {
    errors.push('category_c_must_prohibit_checkout_and_remain_blocked');
  }

  if (PAY02_ELIGIBLE_QUOTE_STATES.has(entry.activationState)) {
    if (!entry.contractualSeller) errors.push('missing_contractual_seller');
    if (!entry.legalBeneficiary) errors.push('missing_legal_beneficiary');
    if (!entry.merchantOfRecord) errors.push('missing_merchant_of_record');
    if (!entry.fundsOwner) errors.push('missing_funds_owner');
    if (!entry.revenueBeneficiary) errors.push('missing_revenue_beneficiary');
    if (!Array.isArray(entry.permittedCurrencies) || entry.permittedCurrencies.length === 0) {
      errors.push('missing_permitted_currencies');
    }
    if (!Array.isArray(entry.eligibleProviders) || entry.eligibleProviders.length === 0) {
      errors.push('missing_eligible_providers');
    }
    if (!entry.approvalEvidenceRef || !entry.approvedBy) {
      errors.push('missing_approval_evidence');
    }
    if (entry.checkoutProhibited && entry.productCode !== 'adj.order.refund_reversal') {
      errors.push('checkout_prohibited_item_cannot_be_quote_eligible');
    }
    if (entry.priceAuthorityType === 'unapproved_missing') {
      errors.push('unapproved_price_authority');
    }
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

/**
 * Fail-closed Provider Capability and Routing Engine (Phase 4, Section 15).
 * Evaluates country/jurisdiction, merchant eligibility, legal funds ownership,
 * commercial category, payment currency, provider account, and required capabilities.
 */
export function evaluatePay02ProviderRoute({
  productCode,
  providerKey,
  country,
  currency,
  merchantOfRecord = null,
  fundsOwner = null,
  commercialCategory = null,
  requestedCapabilities = ['collect_payment'],
  liveRequested = false,
  env = process.env,
} = {}) {
  requirePay02NonProduction(env);

  if (liveRequested === true || String(env.DIASPORA_BILLING_LIVE || '').toLowerCase() === 'true') {
    throw new Pay02Error('PAY02_LIVE_PAYMENT_FORBIDDEN', 403, { providerKey, productCode });
  }

  const catalogueItem = getPay02CatalogueItem(productCode);
  if (!catalogueItem) {
    throw new Pay02Error('PAY02_PRODUCT_UNKNOWN', 404, { productCode });
  }

  if (
    catalogueItem.commercialCategory === PAY02_CATEGORIES.CORPORATE_TREASURY
    || commercialCategory === PAY02_CATEGORIES.CORPORATE_TREASURY
  ) {
    throw new Pay02Error('PAY02_CATEGORY_C_CHECKOUT_PROHIBITED', 403, { productCode });
  }

  const normalizedProvider = String(providerKey || '').trim().toLowerCase();
  const profile = PAY02_PROVIDER_PROFILES[normalizedProvider];
  if (!profile) {
    throw new Pay02Error('PAY02_PROVIDER_NOT_REGISTERED', 400, { providerKey: normalizedProvider });
  }

  if (catalogueItem.prohibitedProviders.includes(normalizedProvider)) {
    throw new Pay02Error('PAY02_PROVIDER_PROHIBITED_FOR_PRODUCT', 403, {
      productCode,
      providerKey: normalizedProvider,
    });
  }

  if (normalizedProvider === 'garage_recorded_external') {
    throw new Pay02Error('PAY02_EXTERNAL_DECLARATION_NOT_GATEWAY', 409, {
      productCode,
      providerKey: normalizedProvider,
      message: 'garage_recorded_external is an off-platform garage declaration, not a CarUp payment gateway.',
    });
  }

  if (!profile.callableInTest) {
    throw new Pay02Error(profile.blockedReason || 'PAY02_PROVIDER_NOT_ELIGIBLE', 409, {
      productCode,
      providerKey: normalizedProvider,
    });
  }

  const effectiveCategory = commercialCategory || catalogueItem.commercialCategory;
  if (!profile.supportedCategories.includes(effectiveCategory)) {
    throw new Pay02Error('PAY02_PROVIDER_CATEGORY_MISMATCH', 403, {
      productCode,
      providerKey: normalizedProvider,
      commercialCategory: effectiveCategory,
    });
  }

  const effectiveCountry = String(country || catalogueItem.jurisdiction || '').trim().toUpperCase();
  if (!profile.supportedCountries.includes(effectiveCountry)) {
    throw new Pay02Error('PAY02_PROVIDER_JURISDICTION_MISMATCH', 403, {
      productCode,
      providerKey: normalizedProvider,
      country: effectiveCountry,
      supportedCountries: profile.supportedCountries,
    });
  }

  const effectiveCurrency = String(currency || catalogueItem.approvedCurrency || '').trim().toUpperCase();
  if (!profile.supportedCurrencies.includes(effectiveCurrency)) {
    throw new Pay02Error('PAY02_PROVIDER_CURRENCY_UNSUPPORTED', 400, {
      productCode,
      providerKey: normalizedProvider,
      currency: effectiveCurrency,
      supportedCurrencies: profile.supportedCurrencies,
    });
  }

  const effectiveMerchant = merchantOfRecord || catalogueItem.merchantOfRecord;
  if (!effectiveMerchant || effectiveMerchant !== profile.merchantIdentity) {
    throw new Pay02Error('PAY02_MERCHANT_OF_RECORD_MISMATCH', 403, {
      productCode,
      providerKey: normalizedProvider,
      expectedMerchant: profile.merchantIdentity,
      receivedMerchant: effectiveMerchant,
    });
  }

  const effectiveFundsOwner = fundsOwner || catalogueItem.fundsOwner;
  if (effectiveFundsOwner !== 'carup_japan') {
    throw new Pay02Error('PAY02_FUNDS_OWNER_MISMATCH', 403, {
      productCode,
      providerKey: normalizedProvider,
      fundsOwner: effectiveFundsOwner,
    });
  }

  const capabilitiesToCheck = Array.from(
    new Set([...(catalogueItem.requiredCapabilities || []), ...(requestedCapabilities || [])]),
  );
  for (const cap of capabilitiesToCheck) {
    if (profile.unsupportedCapabilities.includes(cap) || !profile.supportedCapabilities.includes(cap)) {
      throw new Pay02Error('PAY02_PROVIDER_CAPABILITY_UNSUPPORTED', 409, {
        productCode,
        providerKey: normalizedProvider,
        capability: cap,
      });
    }
  }

  if (!catalogueItem.eligibleProviders.includes(normalizedProvider)) {
    throw new Pay02Error('PAY02_PROVIDER_NOT_ALLOWLISTED_FOR_PRODUCT', 403, {
      productCode,
      providerKey: normalizedProvider,
    });
  }

  return Object.freeze({
    allowed: true,
    providerKey: profile.providerKey,
    providerClass: profile.providerClass,
    accountId: profile.accountId,
    merchantOfRecord: profile.merchantIdentity,
    country: effectiveCountry,
    currency: effectiveCurrency,
    sandboxOnly: profile.sandboxOnly,
    liveAuthorized: false,
  });
}

/**
 * Builds a deterministic, server-authorized commercial quote snapshot (Phase 3, Sections 10-12).
 * Refuses client-supplied economics, unapproved FX conversions, missing prices, or party overrides.
 */
export function buildServerAuthorizedQuote({
  productCode,
  payerId,
  payerRole = 'buyer',
  sourceObjectType,
  sourceObjectId,
  currency = null,
  providerKey = null,
  idempotencyKey,
  // Client override traps — any attempt by a client to pass these is deterministically refused:
  clientSubmittedAmount = undefined,
  clientSubmittedCurrency = undefined,
  clientSubmittedMerchant = undefined,
  clientSubmittedBeneficiary = undefined,
  fxTargetCurrency = undefined,
  now = new Date(),
  env = process.env,
} = {}) {
  requirePay02NonProduction(env);

  if (
    clientSubmittedAmount !== undefined
    || clientSubmittedCurrency !== undefined
  ) {
    throw new Pay02Error('PAY02_CLIENT_PRICE_OVERRIDE_REFUSED', 400);
  }
  if (
    clientSubmittedMerchant !== undefined
    || clientSubmittedBeneficiary !== undefined
  ) {
    throw new Pay02Error('PAY02_CLIENT_PARTY_OVERRIDE_REFUSED', 400);
  }
  if (fxTargetCurrency !== undefined && fxTargetCurrency !== null) {
    throw new Pay02Error('PAY02_UNAPPROVED_FX_CONVERSION_REFUSED', 409, {
      fxTargetCurrency,
      message: 'Reference FX snapshots may never be used for payment settlement without an approved FX quotation authority.',
    });
  }

  if (typeof payerId !== 'string' || !payerId.trim()) {
    throw new Pay02Error('PAY02_PAYER_AUTHENTICATION_REQUIRED', 401);
  }
  if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,96}$/.test(idempotencyKey)) {
    throw new Pay02Error('PAY02_QUOTE_IDEMPOTENCY_KEY_REQUIRED', 400);
  }

  const product = getPay02CatalogueItem(productCode);
  if (!product) {
    throw new Pay02Error('PAY02_PRODUCT_UNKNOWN', 404, { productCode });
  }

  if (product.commercialCategory === PAY02_CATEGORIES.CORPORATE_TREASURY || product.checkoutProhibited) {
    throw new Pay02Error('PAY02_CHECKOUT_PROHIBITED_FOR_PRODUCT', 403, {
      productCode,
      commercialCategory: product.commercialCategory,
    });
  }

  const validation = validateCatalogueEntry(product);
  if (!validation.valid || !PAY02_ELIGIBLE_QUOTE_STATES.has(product.activationState)) {
    throw new Pay02Error('PAY02_PRODUCT_NOT_COMMERCIALLY_ELIGIBLE', 409, {
      productCode,
      activationState: product.activationState,
      blockerClass: product.blockerClass,
      blockerReason: product.blockerReason,
      validationErrors: validation.errors,
    });
  }

  if (
    product.priceAuthorityType === 'unapproved_missing'
    || product.approvedAmountMinor === null
    || product.approvedAmountMinor === undefined
    || product.approvedAmountMinor <= 0
    || !product.approvedCurrency
  ) {
    throw new Pay02Error('PAY02_PRICE_AUTHORITY_MISSING', 409, { productCode });
  }

  if (sourceObjectType !== product.sourceObjectType) {
    throw new Pay02Error('PAY02_SOURCE_OBJECT_TYPE_MISMATCH', 400, {
      productCode,
      expectedSourceObjectType: product.sourceObjectType,
      receivedSourceObjectType: sourceObjectType,
    });
  }
  if (typeof sourceObjectId !== 'string' || !sourceObjectId.trim()) {
    throw new Pay02Error('PAY02_SOURCE_OBJECT_ID_REQUIRED', 400, { productCode });
  }

  const resolvedCurrency = String(currency || product.approvedCurrency).trim().toUpperCase();
  if (
    resolvedCurrency !== product.approvedCurrency
    || !product.permittedCurrencies.includes(resolvedCurrency)
  ) {
    throw new Pay02Error('PAY02_CURRENCY_NOT_PERMITTED_FOR_PRODUCT', 400, {
      productCode,
      requestedCurrency: resolvedCurrency,
      approvedCurrency: product.approvedCurrency,
    });
  }

  const monetary = assertMinorUnitAmount(
    product.approvedAmountMinor,
    resolvedCurrency,
    product.currencyScale,
  );

  const selectedProvider = providerKey || product.eligibleProviders[0] || null;
  const routeDecision = evaluatePay02ProviderRoute({
    productCode: product.productCode,
    providerKey: selectedProvider,
    country: product.jurisdiction,
    currency: monetary.currency,
    merchantOfRecord: product.merchantOfRecord,
    fundsOwner: product.fundsOwner,
    commercialCategory: product.commercialCategory,
    requestedCapabilities: ['collect_payment'],
    env,
  });

  const issuedAt = now instanceof Date ? now : new Date(now);
  const expiresAt = new Date(issuedAt.getTime() + 30 * 60 * 1000); // 30-minute deterministic quote validity window
  const quoteDigest = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        productCode: product.productCode,
        version: product.version,
        payerId: payerId.trim(),
        sourceObjectType,
        sourceObjectId: sourceObjectId.trim(),
        idempotencyKey,
      }),
    )
    .digest('hex');

  return Object.freeze({
    quoteNumber: `QT-PAY02-${quoteDigest.slice(0, 16).toUpperCase()}`,
    productCode: product.productCode,
    productVersion: product.version,
    productTitle: product.title,
    commercialCategory: product.commercialCategory,
    owningSubsystem: product.owningSubsystem,
    sourceObjectType: product.sourceObjectType,
    sourceObjectId: sourceObjectId.trim(),
    payerId: payerId.trim(),
    payerRole: String(payerRole || product.payerRole).trim(),
    contractualSeller: product.contractualSeller,
    legalBeneficiary: product.legalBeneficiary,
    merchantOfRecord: product.merchantOfRecord,
    fundsOwner: product.fundsOwner,
    revenueBeneficiary: product.revenueBeneficiary,
    jurisdiction: product.jurisdiction,
    currency: monetary.currency,
    currencyScale: monetary.currencyScale,
    subtotalMinor: monetary.amountMinor,
    taxMinor: 0,
    platformFeeMinor: product.commercialCategory === PAY02_CATEGORIES.FIRST_PARTY ? monetary.amountMinor : 0,
    thirdPartyMinor: product.commercialCategory === PAY02_CATEGORIES.THIRD_PARTY ? monetary.amountMinor : 0,
    totalMinor: monetary.amountMinor,
    formattedTotalMajor: monetary.formattedMajor,
    pricingProvenance: `${product.priceAuthorityType}:v${product.version}:${product.approvalEvidenceRef}`,
    selectedProvider: routeDecision.providerKey,
    providerAccountId: routeDecision.accountId,
    fulfillmentContract: product.fulfillmentContract,
    refundPolicy: product.refundPolicy,
    idempotencyKey,
    status: 'issued',
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    sandboxOnly: true,
  });
}

/**
 * Decomposes a multi-party import order into distinct beneficiary-owned obligations (Section 5.6 & Issue #247 Deliverable E).
 * Strictly refuses combining third-party supplier principal, ocean freight, or ZIMRA customs duties into
 * an undifferentiated CarUp direct-merchant charge.
 */
export function decomposeImportOrderObligations({
  importOrderId,
  payerId,
  lines = [],
  attemptCombinedCarUpMerchantCharge = false,
} = {}) {
  if (typeof importOrderId !== 'string' || !importOrderId.trim()) {
    throw new Pay02Error('PAY02_IMPORT_ORDER_ID_REQUIRED', 400);
  }
  if (typeof payerId !== 'string' || !payerId.trim()) {
    throw new Pay02Error('PAY02_PAYER_AUTHENTICATION_REQUIRED', 401);
  }
  if (attemptCombinedCarUpMerchantCharge === true) {
    throw new Pay02Error('PAY02_UNDISCLOSED_MULTI_PARTY_BUNDLE_REFUSED', 403, {
      importOrderId,
      message: 'Supplier principal, ocean freight, customs duties, and CarUp service fees belong to legally distinct beneficiaries and cannot be bundled into a single CarUp merchant charge.',
    });
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Pay02Error('PAY02_IMPORT_OBLIGATION_LINES_REQUIRED', 400);
  }

  const allocations = [];
  for (const line of lines) {
    const item = getPay02CatalogueItem(line.productCode);
    if (!item || item.family !== 'imports_trade') {
      throw new Pay02Error('PAY02_INVALID_IMPORT_OBLIGATION_PRODUCT', 400, {
        productCode: line?.productCode,
      });
    }
    const monetary = assertMinorUnitAmount(line.amountMinor, line.currency);
    const isCarUpFirstParty = item.commercialCategory === PAY02_CATEGORIES.FIRST_PARTY;

    if (!isCarUpFirstParty && line.claimAsCarUpRevenue === true) {
      throw new Pay02Error('PAY02_THIRD_PARTY_FUNDS_MISCLASSIFIED_AS_REVENUE', 403, {
        productCode: item.productCode,
        legalBeneficiary: item.legalBeneficiary,
      });
    }
    if (!isCarUpFirstParty && line.merchantOfRecord === 'carup_japan') {
      throw new Pay02Error('PAY02_THIRD_PARTY_OBLIGATION_ON_DIRECT_MERCHANT_REFUSED', 403, {
        productCode: item.productCode,
        legalBeneficiary: item.legalBeneficiary,
      });
    }

    allocations.push(
      Object.freeze({
        importOrderId: importOrderId.trim(),
        payerId: payerId.trim(),
        productCode: item.productCode,
        title: item.title,
        commercialCategory: item.commercialCategory,
        contractualSeller: item.contractualSeller,
        legalBeneficiary: line.legalBeneficiary || item.legalBeneficiary,
        fundsOwner: item.fundsOwner,
        merchantOfRecord: isCarUpFirstParty ? item.merchantOfRecord : null,
        isCarUpRevenue: isCarUpFirstParty,
        currency: monetary.currency,
        currencyScale: monetary.currencyScale,
        amountMinor: monetary.amountMinor,
        formattedMajor: monetary.formattedMajor,
        collectionMode: isCarUpFirstParty ? 'direct_carup_merchant' : 'regulated_partner_blocked',
        activationState: item.activationState,
        blockerClass: item.blockerClass,
      }),
    );
  }

  // Note: multi-currency obligations are grouped per currency and NEVER summed across currencies without approved FX!
  const totalsByCurrency = {};
  for (const alloc of allocations) {
    if (!totalsByCurrency[alloc.currency]) {
      totalsByCurrency[alloc.currency] = {
        currency: alloc.currency,
        currencyScale: alloc.currencyScale,
        carUpFirstPartyRevenueMinor: 0,
        thirdPartyObligationsMinor: 0,
        totalObligationsMinor: 0,
      };
    }
    const bucket = totalsByCurrency[alloc.currency];
    if (alloc.isCarUpRevenue) {
      bucket.carUpFirstPartyRevenueMinor += alloc.amountMinor;
    } else {
      bucket.thirdPartyObligationsMinor += alloc.amountMinor;
    }
    bucket.totalObligationsMinor += alloc.amountMinor;
  }

  return Object.freeze({
    importOrderId: importOrderId.trim(),
    payerId: payerId.trim(),
    allocations: Object.freeze(allocations),
    totalsByCurrency: Object.freeze(totalsByCurrency),
  });
}
