import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.CARUP_ENV = 'test';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-fixture-only';

const {
  PAY02_FAMILIES,
  PAY02_CATEGORIES,
  PAY02_CURRENCY_SCALES,
  PAY02_CATALOGUE,
  getPay02CatalogueItem,
} = await import('../services/payment/pay02CatalogueDefinitions.js');

const {
  assertMinorUnitAmount,
  formatMinorUnitsToMajorString,
  validateCatalogueEntry,
  evaluatePay02ProviderRoute,
  buildServerAuthorizedQuote,
  decomposeImportOrderObligations,
  requirePay02NonProduction,
} = await import('../services/payment/pay02Contract.js');

const {
  listPay02Catalogue,
  createPay02GovernanceProposal,
  reviewPay02GovernanceProposal,
  createAndPersistPay02Quote,
  computePay02FinancialTruthReport,
  deliverVerifiedVehicleHistoryReport,
} = await import('../services/payment/pay02Service.js');

test('PAY02-INV & PAY02-CAT: catalogue covers all mandatory families (66 service entries) and enforces Category A/B/C separation', () => {
  const listed = listPay02Catalogue();
  assert.equal(listed.summary.totalProducts, 66);
  assert.equal(listed.summary.liveActiveCount, 0, 'No product may be live active in PAY-02');

  // Verify every mandatory family has comprehensive entries
  for (const familyKey of PAY02_FAMILIES) {
    const familyRows = PAY02_CATALOGUE.filter((r) => r.family === familyKey);
    assert.ok(familyRows.length >= 2, `Missing coverage for mandatory family ${familyKey}`);
  }

  // Every item must pass fail-closed structural validation and include all 18 required matrix dimensions
  for (const item of PAY02_CATALOGUE) {
    const validation = validateCatalogueEntry(item);
    assert.equal(
      validation.valid,
      true,
      `Product ${item.productCode} failed structural validation: ${validation.errors.join(', ')}`,
    );
    assert.ok(item.sourceReferences.length >= 1, `${item.productCode} must record source references`);
    assert.ok(item.databaseAuthority.length >= 1, `${item.productCode} must record DB authority`);
    assert.ok(item.mobileChannelPolicy, `${item.productCode} missing mobile policy`);
    assert.notEqual(item.activationState, 'active', `${item.productCode} must not be live active in PAY-02`);
    assert.notEqual(
      item.activationState,
      'release_approved',
      `${item.productCode} must not be release_approved without Owner sign-off`,
    );
  }

  // Category C items must be prohibited from customer checkout and have zero Checkout providers
  const catC = PAY02_CATALOGUE.filter((item) => item.commercialCategory === PAY02_CATEGORIES.CORPORATE_TREASURY);
  assert.ok(catC.length >= 8, 'Catalogue must classify corporate finance / treasury items as Category C');
  for (const item of catC) {
    assert.equal(item.checkoutProhibited, true);
    assert.equal(item.activationState, 'blocked');
    assert.deepEqual(item.eligibleProviders, []);
  }

  // Verify the accepted PAY-01C synthetic demo product is explicitly preserved as sandbox_certified and distinct from the real report
  const demoItem = getPay02CatalogueItem('intel.report.demo_sandbox');
  const realPilot = getPay02CatalogueItem('intel.report.vehicle_history_single');
  assert.ok(demoItem);
  assert.ok(realPilot);
  assert.equal(demoItem.activationState, 'sandbox_certified');
  assert.equal(demoItem.certificationState, 'PHYSICALLY CERTIFIED');
  assert.equal(demoItem.approvedAmountMinor, 100);
  assert.equal(demoItem.approvedCurrency, 'JPY');

  assert.equal(realPilot.activationState, 'provider_eligible');
  assert.equal(realPilot.certificationState, 'SANDBOX READY');
  assert.equal(realPilot.commercialCategory, PAY02_CATEGORIES.FIRST_PARTY);
  assert.equal(realPilot.merchantOfRecord, 'carup_japan');
  assert.equal(realPilot.approvedAmountMinor, 100);
  assert.equal(realPilot.approvedCurrency, 'JPY');
});

test('PAY02-CAT: fail-closed validator rejects incomplete or contradictory commercial catalogue definitions', () => {
  const validPilot = getPay02CatalogueItem('intel.report.vehicle_history_single');
  const brokenNoMerchant = { ...validPilot, merchantOfRecord: '' };
  const brokenCheck = validateCatalogueEntry(brokenNoMerchant);
  assert.equal(brokenCheck.valid, false);
  assert.ok(brokenCheck.errors.includes('missing_merchant_of_record'));

  const brokenCategoryCWithCheckout = {
    ...getPay02CatalogueItem('cap.debt.corporate_facility'),
    checkoutProhibited: false,
    activationState: 'sandbox_certified',
    eligibleProviders: ['stripe_carup_japan_sandbox'],
  };
  const catCCheck = validateCatalogueEntry(brokenCategoryCWithCheckout);
  assert.equal(catCCheck.valid, false);
  assert.ok(catCCheck.errors.includes('category_c_must_prohibit_checkout_and_remain_blocked'));
});

test('PAY02-PRICE: integer minor-unit arithmetic and currency scale enforcement refuse floating-point values', () => {
  assert.deepEqual(assertMinorUnitAmount(100, 'JPY'), {
    amountMinor: 100,
    currency: 'JPY',
    currencyScale: 0,
    formattedMajor: '100',
  });
  assert.deepEqual(assertMinorUnitAmount(25000, 'USD'), {
    amountMinor: 25000,
    currency: 'USD',
    currencyScale: 2,
    formattedMajor: '250.00',
  });
  assert.equal(formatMinorUnitsToMajorString(100, 0), '100');
  assert.equal(formatMinorUnitsToMajorString(25050, 2), '250.50');
  assert.equal(formatMinorUnitsToMajorString(5, 2), '0.05');

  // Floating-point amounts, negative amounts, scale mismatch, and unknown currencies are refused
  assert.throws(() => assertMinorUnitAmount(19.99, 'USD'), /PAY02_FLOAT_OR_UNSAFE_AMOUNT_REFUSED/);
  assert.throws(() => assertMinorUnitAmount('100.50', 'JPY'), /PAY02_MINOR_UNIT_INTEGER_REQUIRED/);
  assert.throws(() => assertMinorUnitAmount(-10, 'JPY'), /PAY02_MINOR_UNIT_INVALID/);
  assert.throws(() => assertMinorUnitAmount(100, 'JPY', 2), /PAY02_CURRENCY_SCALE_MISMATCH/);
  assert.throws(() => assertMinorUnitAmount(100, 'CHF'), /PAY02_CURRENCY_UNSUPPORTED/);
});

test('PAY02-PRICE: server-governed quote builder is deterministic and refuses client amount, party, or FX overrides', async () => {
  const baseParams = {
    productCode: 'intel.report.vehicle_history_single',
    payerId: '00000000-0000-4000-8000-000000000101',
    payerRole: 'buyer',
    sourceObjectType: 'vehicle_report_versions',
    sourceObjectId: 'vin_WBA00000000000101',
    idempotencyKey: 'pay02_quote_test_key_0001',
    now: new Date('2026-10-31T05:00:00.000Z'),
  };

  const quote = buildServerAuthorizedQuote(baseParams);
  assert.equal(quote.productCode, 'intel.report.vehicle_history_single');
  assert.equal(quote.productVersion, 1);
  assert.equal(quote.currency, 'JPY');
  assert.equal(quote.currencyScale, PAY02_CURRENCY_SCALES.JPY);
  assert.equal(quote.subtotalMinor, 100);
  assert.equal(quote.taxMinor, 0);
  assert.equal(quote.totalMinor, 100);
  assert.equal(quote.merchantOfRecord, 'carup_japan');
  assert.equal(quote.legalBeneficiary, 'carup_japan');
  assert.equal(quote.fundsOwner, 'carup_japan');
  assert.equal(quote.selectedProvider, 'stripe_carup_japan_sandbox');
  assert.equal(quote.providerAccountId, 'acct_1UVnGaEjgXqvlsJk');

  // Calling with identical inputs produces the exact same quoteNumber
  const quoteRepeat = buildServerAuthorizedQuote(baseParams);
  assert.equal(quote.quoteNumber, quoteRepeat.quoteNumber);

  // Also test createAndPersistPay02Quote with a fake DB RPC
  let rpcArgs = null;
  const persisted = await createAndPersistPay02Quote({
    ...baseParams,
    db: {
      rpc: async (name, args) => {
        rpcArgs = { name, args };
        return { data: { id: 'quote_uuid_01', status: 'issued' }, error: null };
      },
    },
  });
  assert.equal(rpcArgs.name, 'pay02_issue_commercial_quote');
  assert.equal(persisted.id, 'quote_uuid_01');
  assert.equal(persisted.totalMinor, 100);

  // Refuses client-submitted amount, currency override, merchant override, beneficiary override, and FX conversion
  assert.throws(
    () => buildServerAuthorizedQuote({ ...baseParams, clientSubmittedAmount: 50 }),
    /PAY02_CLIENT_PRICE_OVERRIDE_REFUSED/,
  );
  assert.throws(
    () => buildServerAuthorizedQuote({ ...baseParams, clientSubmittedCurrency: 'USD' }),
    /PAY02_CLIENT_PRICE_OVERRIDE_REFUSED/,
  );
  assert.throws(
    () => buildServerAuthorizedQuote({ ...baseParams, clientSubmittedMerchant: 'attacker_llc' }),
    /PAY02_CLIENT_PARTY_OVERRIDE_REFUSED/,
  );
  assert.throws(
    () => buildServerAuthorizedQuote({ ...baseParams, clientSubmittedBeneficiary: 'attacker_llc' }),
    /PAY02_CLIENT_PARTY_OVERRIDE_REFUSED/,
  );
  assert.throws(
    () => buildServerAuthorizedQuote({ ...baseParams, fxTargetCurrency: 'USD' }),
    /PAY02_UNAPPROVED_FX_CONVERSION_REFUSED/,
  );

  // Refuses Category C items and unpriced/blocked items at quote time
  assert.throws(
    () =>
      buildServerAuthorizedQuote({
        ...baseParams,
        productCode: 'cap.debt.corporate_facility',
      }),
    /PAY02_CHECKOUT_PROHIBITED_FOR_PRODUCT/,
  );
  assert.throws(
    () =>
      buildServerAuthorizedQuote({
        ...baseParams,
        productCode: 'mkt.reservation.deposit',
      }),
    /PAY02_PRODUCT_NOT_COMMERCIALLY_ELIGIBLE/,
  );
});

test('PAY02-ROUTE: fail-closed provider routing enforces Japan sandbox boundaries and refuses Zimbabwe, USD/ZWG, escrow, and Category B/C on Stripe Japan', () => {
  // 1. Valid Japan sandbox route for first-party CarUp JP item in JPY
  const validJpRoute = evaluatePay02ProviderRoute({
    productCode: 'intel.report.vehicle_history_single',
    providerKey: 'stripe_carup_japan_sandbox',
    country: 'JP',
    currency: 'JPY',
    requestedCapabilities: ['collect_payment', 'refund'],
    liveRequested: false,
  });
  assert.equal(validJpRoute.allowed, true);
  assert.equal(validJpRoute.accountId, 'acct_1UVnGaEjgXqvlsJk');
  assert.equal(validJpRoute.sandboxOnly, true);
  assert.equal(validJpRoute.liveAuthorized, false);

  // 2. Live mode request is unconditionally refused in PAY-02
  assert.throws(
    () =>
      evaluatePay02ProviderRoute({
        productCode: 'intel.report.vehicle_history_single',
        providerKey: 'stripe_carup_japan_sandbox',
        country: 'JP',
        currency: 'JPY',
        liveRequested: true,
      }),
    /PAY02_LIVE_PAYMENT_FORBIDDEN/,
  );

  // 3. Stripe Japan sandbox refuses Zimbabwe country, USD/ZWG currency, and regulated escrow
  assert.throws(
    () =>
      evaluatePay02ProviderRoute({
        productCode: 'intel.report.vehicle_history_single',
        providerKey: 'stripe_carup_japan_sandbox',
        country: 'ZW',
        currency: 'JPY',
      }),
    /PAY02_PROVIDER_JURISDICTION_MISMATCH/,
  );
  assert.throws(
    () =>
      evaluatePay02ProviderRoute({
        productCode: 'intel.report.vehicle_history_single',
        providerKey: 'stripe_carup_japan_sandbox',
        country: 'JP',
        currency: 'USD',
      }),
    /PAY02_PROVIDER_CURRENCY_UNSUPPORTED/,
  );
  assert.throws(
    () =>
      evaluatePay02ProviderRoute({
        productCode: 'intel.report.vehicle_history_single',
        providerKey: 'stripe_carup_japan_sandbox',
        country: 'JP',
        currency: 'JPY',
        requestedCapabilities: ['collect_payment', 'regulated_escrow'],
      }),
    /PAY02_PROVIDER_CAPABILITY_UNSUPPORTED/,
  );

  // 4. Category B (third-party garage invoice) refused on Stripe Japan sandbox
  assert.throws(
    () =>
      evaluatePay02ProviderRoute({
        productCode: 'gar.invoice.customer_payment',
        providerKey: 'stripe_carup_japan_sandbox',
        country: 'JP',
        currency: 'JPY',
      }),
    /PAY02_PROVIDER_PROHIBITED_FOR_PRODUCT/,
  );

  // 5. Garage recorded external declaration cannot be used as an online payment processor
  assert.throws(
    () =>
      evaluatePay02ProviderRoute({
        productCode: 'gar.invoice.customer_payment',
        providerKey: 'garage_recorded_external',
        country: 'ZW',
        currency: 'USD',
      }),
    /PAY02_EXTERNAL_DECLARATION_NOT_GATEWAY/,
  );

  // 6. Paynow Zimbabwe adapter is dormant until merchant authority + E2E certification
  assert.throws(
    () =>
      evaluatePay02ProviderRoute({
        productCode: 'gar.invoice.customer_payment',
        providerKey: 'paynow_zimbabwe',
        country: 'ZW',
        currency: 'USD',
      }),
    /PAY02_PROVIDER_MERCHANT_AUTHORITY_PENDING/,
  );
});

test('PAY02-PRICE & PAY02-LIFE: multi-party import order decomposition separates supplier, freight, customs, inspection, and CarUp service fee', () => {
  const decomposed = decomposeImportOrderObligations({
    importOrderId: 'imp_order_9901',
    payerId: 'buyer_diaspora_01',
    lines: [
      {
        productCode: 'imp.vehicle.supplier_principal',
        legalBeneficiary: 'exporter_tokyo_motors',
        currency: 'USD',
        amountMinor: 650000, // $6,500.00
      },
      {
        productCode: 'imp.freight.ocean_carriage',
        legalBeneficiary: 'freight_nyk_roro',
        currency: 'USD',
        amountMinor: 145000, // $1,450.00
      },
      {
        productCode: 'imp.customs.duties_and_taxes',
        legalBeneficiary: 'zimra_customs_authority',
        currency: 'USD',
        amountMinor: 210000, // $2,100.00
      },
      {
        productCode: 'imp.export.documentation_charge',
        legalBeneficiary: 'inspector_qisj',
        currency: 'USD',
        amountMinor: 18000, // $180.00
      },
      {
        productCode: 'imp.sourcing.verification_fee',
        legalBeneficiary: 'carup_japan',
        currency: 'USD',
        amountMinor: 35000, // $350.00
      },
    ],
  });

  assert.equal(decomposed.allocations.length, 5);
  assert.equal(decomposed.totalsByCurrency.USD.totalObligationsMinor, 1058000);
  // Only the $350.00 CarUp sourcing/verification fee is CarUp revenue; $10,230.00 is third-party obligation
  assert.equal(decomposed.totalsByCurrency.USD.carUpFirstPartyRevenueMinor, 35000);
  assert.equal(decomposed.totalsByCurrency.USD.thirdPartyObligationsMinor, 1023000);

  // Refuses bundling all 5 lines into a single CarUp merchant-of-record charge
  assert.throws(
    () =>
      decomposeImportOrderObligations({
        importOrderId: 'imp_order_9901',
        payerId: 'buyer_diaspora_01',
        attemptCombinedCarUpMerchantCharge: true,
        lines: [
          {
            productCode: 'imp.vehicle.supplier_principal',
            legalBeneficiary: 'exporter_tokyo_motors',
            currency: 'USD',
            amountMinor: 650000,
          },
        ],
      }),
    /PAY02_UNDISCLOSED_MULTI_PARTY_BUNDLE_REFUSED/,
  );

  // Refuses misclassifying exporter FOB principal as CarUp revenue
  assert.throws(
    () =>
      decomposeImportOrderObligations({
        importOrderId: 'imp_order_9901',
        payerId: 'buyer_diaspora_01',
        lines: [
          {
            productCode: 'imp.vehicle.supplier_principal',
            legalBeneficiary: 'exporter_tokyo_motors',
            currency: 'USD',
            amountMinor: 650000,
            claimAsCarUpRevenue: true,
          },
        ],
      }),
    /PAY02_THIRD_PARTY_FUNDS_MISCLASSIFIED_AS_REVENUE/,
  );
});

test('PAY02-LIFE: financial truth report separates quotes, provider-confirmed collections, third-party liabilities, external garage declarations, and detects anomalies', () => {
  const report = computePay02FinancialTruthReport({
    quotes: [
      { id: 'q1', currency: 'JPY', totalMinor: 2500 },
      { id: 'q2', currency: 'USD', totalMinor: 50000 },
    ],
    canonicalPayments: [
      {
        reference: 'pay01a_001',
        status: 'paid',
        currency: 'JPY',
        amount: 2500,
        pay02_commercial_category: PAY02_CATEGORIES.FIRST_PARTY,
        pay01a_checkout_id: 'cs_test_001',
        pay01a_intent_id: 'pi_test_001',
        pay02_settlement_status: 'settled',
      },
      {
        reference: 'pay01a_002',
        status: 'refunded',
        currency: 'JPY',
        amount: 100,
        pay02_commercial_category: PAY02_CATEGORIES.FIRST_PARTY,
        pay01a_checkout_id: 'cs_test_002',
        pay01a_intent_id: 'pi_test_002',
        pay01a_refund_id: 're_test_002',
      },
      {
        reference: 'pay_anomaly_missing_provider',
        status: 'paid',
        currency: 'JPY',
        amount: 2500,
        pay02_commercial_category: PAY02_CATEGORIES.FIRST_PARTY,
      },
    ],
    externalGarageDeclarations: [
      {
        id: 'gpr_001',
        invoiceId: 'ginv_001',
        currency: 'USD',
        amountMinor: 12000,
        source: 'garage_recorded_external',
      },
    ],
    pilotEntitlements: [
      {
        id: 'ord_orphan_01',
        paymentReference: 'pay01a_002', // refunded payment still active!
        grantedAt: '2026-10-31T01:00:00Z',
        revokedAt: null,
      },
    ],
  });

  // Check currency separation
  assert.equal(report.byCurrency.JPY.quotedObligationsMinor, 2500);
  assert.equal(report.byCurrency.JPY.providerConfirmedGrossMinor, 2500);
  assert.equal(report.byCurrency.JPY.carUpEarnedRevenueMinor, 2500);
  assert.equal(report.byCurrency.JPY.refundedMinor, 100);
  assert.equal(report.byCurrency.JPY.settledMinor, 2500);

  // External garage declaration is isolated in its own non-settled bucket and NEVER counted as providerConfirmedGrossMinor
  assert.equal(report.byCurrency.USD.externalOffPlatformDeclaredMinor, 12000);
  assert.equal(report.byCurrency.USD.providerConfirmedGrossMinor, 0);
  assert.equal(report.byCurrency.USD.carUpEarnedRevenueMinor, 0);

  // Check reconciliation anomaly detection
  assert.equal(report.healthy, false);
  const anomalyTypes = report.exceptions.map((e) => e.type);
  assert.ok(anomalyTypes.includes('paid_status_missing_provider_intent_evidence'));
  assert.ok(anomalyTypes.includes('refund_succeeded_but_entitlement_still_active'));

  // Cross-currency summation is refused
  assert.throws(
    () => computePay02FinancialTruthReport({ AttemptCrossCurrencySum: true }),
    /PAY02_UNAPPROVED_CROSS_CURRENCY_SUM_REFUSED/,
  );
});

test('PAY02-ADMIN: governance proposal workflow enforces admin role, separation of duties (proposer != reviewer), and blocks live activation', async () => {
  const storedProposals = new Map();
  const fakeDb = {
    from: () => ({
      insert: (payload) => ({
        select: () => ({
          maybeSingle: async () => {
            const row = {
              id: 'prop_0001',
              ...payload,
              created_at: '2026-10-31T05:00:00.000Z',
            };
            storedProposals.set(row.id, row);
            return { data: row, error: null };
          },
        }),
      }),
      select: () => ({
        eq: (_col, id) => ({
          maybeSingle: async () => ({
            data: storedProposals.get(id) || null,
            error: null,
          }),
        }),
      }),
      update: (patch) => ({
        eq: (_col, id) => ({
          select: () => ({
            single: async () => {
              const row = { ...storedProposals.get(id), ...patch };
              storedProposals.set(id, row);
              return { data: row, error: null };
            },
          }),
        }),
      }),
    }),
  };

  const proposalResult = await createPay02GovernanceProposal({
    actorId: 'admin-proposer-001',
    actorRole: 'admin',
    productCode: 'intel.report.vehicle_history_single',
    proposedState: 'sandbox_certified',
    proposedAmountMinor: 100,
    proposedCurrency: 'JPY',
    approvalEvidenceRef: 'ISSUE-247-SANDBOX-GATE',
    rationale: 'Requesting sandbox certification state after PAY-03A checkout verification.',
    db: fakeDb,
  });

  assert.equal(proposalResult.proposal.status, 'pending_review');
  assert.equal(proposalResult.proposal.proposer_id, 'admin-proposer-001');

  // Non-admin cannot create proposals
  await assert.rejects(
    createPay02GovernanceProposal({
      actorId: 'buyer-001',
      actorRole: 'buyer',
      productCode: 'intel.report.vehicle_history_single',
      proposedState: 'sandbox_certified',
      rationale: 'Unauthorized buyer proposal attempt.',
      db: fakeDb,
    }),
    /PAY02_GOVERNANCE_ROLE_FORBIDDEN/,
  );

  // Live activation (`active` or `release_approved`) is refused in PAY-02
  await assert.rejects(
    createPay02GovernanceProposal({
      actorId: 'admin-proposer-001',
      actorRole: 'admin',
      productCode: 'intel.report.vehicle_history_single',
      proposedState: 'active',
      rationale: 'Attempt live activation without Owner authorization.',
      db: fakeDb,
    }),
    /PAY02_LIVE_RELEASE_REQUIRES_SEPARATE_OWNER_AUTHORITY/,
  );

  // Proposer cannot review/approve their own proposal (separation of duties)
  await assert.rejects(
    reviewPay02GovernanceProposal({
      proposalId: 'prop_0001',
      reviewerId: 'admin-proposer-001',
      reviewerRole: 'admin',
      decision: 'approved',
      reviewNotes: 'Self-approval attempt.',
      db: fakeDb,
    }),
    /PAY02_SELF_APPROVAL_FORBIDDEN/,
  );

  // Second distinct admin can review and approve
  const reviewed = await reviewPay02GovernanceProposal({
    proposalId: 'prop_0001',
    reviewerId: 'admin-reviewer-002',
    reviewerRole: 'admin',
    decision: 'approved',
    reviewNotes: 'Verified provenance and minor-unit pricing contract.',
    db: fakeDb,
  });
  assert.equal(reviewed.proposal.status, 'approved');
  assert.equal(reviewed.proposal.reviewer_id, 'admin-reviewer-002');
});

test('PAY02-PILOT: real vehicle history report readiness contract requires verified paid canonical payment and invokes canonical report assembly', async () => {
  const quote = buildServerAuthorizedQuote({
    productCode: 'intel.report.vehicle_history_single',
    payerId: 'buyer-pilot-01',
    payerRole: 'buyer',
    sourceObjectType: 'vehicle_report_versions',
    sourceObjectId: 'WBA00000000000101',
    idempotencyKey: 'pay02_pilot_quote_001',
  });

  const paidTx = {
    reference: 'pay01a_pilot_001',
    gateway: 'stripe_carup_japan_sandbox',
    status: 'paid',
    currency: 'JPY',
    amount: 100,
    pay01a_actor_id: 'buyer-pilot-01',
    pay01a_checkout_id: 'cs_test_pilot_001',
    pay01a_intent_id: 'pi_test_pilot_001',
  };

  const activeEntitlement = {
    buyerId: 'buyer-pilot-01',
    grantedAt: '2026-10-31T05:05:00.000Z',
    revokedAt: null,
  };

  let assembledCalledWith = null;
  const fakeAssembler = async (_db, vin) => {
    assembledCalledWith = vin;
    return {
      vin,
      sections: {
        identity: { vin, make: 'BMW', model: '320i' },
        trust: { trust_score: 92 },
      },
    };
  };
  const fakeVersionGen = async (_db, vin) => ({
    id: 'rep_ver_001',
    vin,
    version: 1,
    content_hash: 'sha256_canonical_report_001',
    completeness: 95,
  });

  const delivered = await deliverVerifiedVehicleHistoryReport({
    buyerId: 'buyer-pilot-01',
    vin: 'WBA00000000000101',
    quote,
    canonicalPayment: paidTx,
    entitlementOrder: activeEntitlement,
    reportAssembler: fakeAssembler,
    versionGenerator: fakeVersionGen,
  });

  assert.equal(assembledCalledWith, 'WBA00000000000101');
  assert.equal(delivered.productCode, 'intel.report.vehicle_history_single');
  assert.equal(delivered.reportVersionId, 'rep_ver_001');
  assert.equal(delivered.completeness, 95);

  // Unpaid or pending canonical transaction cannot unlock the real report
  await assert.rejects(
    deliverVerifiedVehicleHistoryReport({
      buyerId: 'buyer-pilot-01',
      vin: 'WBA00000000000101',
      quote,
      canonicalPayment: { ...paidTx, status: 'pending' },
      entitlementOrder: activeEntitlement,
      reportAssembler: fakeAssembler,
      versionGenerator: fakeVersionGen,
    }),
    /PAY02_PILOT_PAYMENT_NOT_VERIFIED_PAID/,
  );

  // Revoked entitlement on refund refuses report access
  await assert.rejects(
    deliverVerifiedVehicleHistoryReport({
      buyerId: 'buyer-pilot-01',
      vin: 'WBA00000000000101',
      quote,
      canonicalPayment: paidTx,
      entitlementOrder: { ...activeEntitlement, revokedAt: '2026-10-31T05:10:00.000Z' },
      reportAssembler: fakeAssembler,
      versionGenerator: fakeVersionGen,
    }),
    /PAY02_PILOT_ENTITLEMENT_NOT_ACTIVE/,
  );

  // Cross-buyer access is refused
  await assert.rejects(
    deliverVerifiedVehicleHistoryReport({
      buyerId: 'foreign-buyer-99',
      vin: 'WBA00000000000101',
      quote,
      canonicalPayment: paidTx,
      entitlementOrder: activeEntitlement,
      reportAssembler: fakeAssembler,
      versionGenerator: fakeVersionGen,
    }),
    /PAY02_PILOT_QUOTE_AUTHORITY_MISMATCH/,
  );
});

test('PAY02 schema and routes: additive migration reuses canonical payment_transactions and enforces authorizeSessionRole boundaries', () => {
  const source = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const migration = source('../database/migrations/20261031143000_carup_pay02_commercial_foundation.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pay02_commercial_products/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pay02_commercial_product_versions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pay02_activation_proposals/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pay02_commercial_quotes/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pay02_obligation_allocations/);
  assert.match(migration, /ALTER TABLE public\.payment_transactions/);
  assert.match(migration, /REFERENCES public\.payment_transactions\(reference\)/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.pay02_commercial_quotes FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/);

  const routes = source('routes/pay02Routes.js');
  assert.match(routes, /authenticatedSession = authorizeSessionRole\(\[\]\)/);
  assert.match(routes, /adminSession = authorizeSessionRole\(\['admin'\]\)/);
  assert.match(routes, /\/api\/pay02\/admin\/catalogue', adminSession/);
  assert.match(routes, /\/api\/pay02\/admin\/proposals', adminSession/);
  assert.match(routes, /\/api\/pay02\/admin\/proposals\/:proposalId\/review', adminSession/);
  assert.match(routes, /\/api\/pay02\/quotes', authenticatedSession/);
  assert.doesNotMatch(routes, /x-user-id/);
});

test('PAY02 non-production safety gate refuses production environment flags and production Supabase project', () => {
  assert.throws(
    () => requirePay02NonProduction({ NODE_ENV: 'production' }),
    /PAY02_PRODUCTION_RUNTIME_FORBIDDEN/,
  );
  assert.throws(
    () => requirePay02NonProduction({ CARUP_ENV: 'production' }),
    /PAY02_PRODUCTION_RUNTIME_FORBIDDEN/,
  );
  assert.throws(
    () => requirePay02NonProduction({ VERCEL_ENV: 'production' }),
    /PAY02_PRODUCTION_RUNTIME_FORBIDDEN/,
  );
  assert.throws(
    () =>
      requirePay02NonProduction({
        NODE_ENV: 'test',
        SUPABASE_URL: 'https://vhmnajoeicasaigiophh.supabase.co',
      }),
    /PAY02_PRODUCTION_DATABASE_FORBIDDEN/,
  );
});
