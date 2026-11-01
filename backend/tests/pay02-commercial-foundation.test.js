import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.CARUP_ENV = 'test';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-fixture-only';

const {
  PAY02_FAMILIES,
  PAY02_CATEGORIES,
  PAY02_CURRENCY_SCALES,
  PAY02_MAX_SAFE_MINOR_UNITS,
  PAY02_REPORT_ISSUANCE_POLICY,
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
  loadPay02CatalogueWithPersistence,
  getPay02ProductDetailWithHistory,
  createPay02GovernanceProposal,
  reviewPay02GovernanceProposal,
  verifyPay02SourceObjectAuthority,
  previewPay02Quote,
  createAndPersistPay02Quote,
  computePay02FinancialTruthReport,
  reconcilePay02OperationalFinancialTruth,
  verifyVehicleReportProvenance,
  deliverVerifiedVehicleHistoryReport,
} = await import('../services/payment/pay02Service.js');

const { supabase } = await import('../db/supabase.js');
const pay02Routes = (await import('../routes/pay02Routes.js')).default;

test('PAY02-INV & PAY02-CAT (R1-A): catalogue covers all mandatory families (66 service entries), reconciles DB rows, and enforces Category A/B/C separation', async () => {
  const listed = listPay02Catalogue();
  assert.equal(listed.summary.totalProducts, 66);
  assert.equal(listed.summary.liveActiveCount, 0, 'No product may be live active in PAY-02');
  assert.ok(listed.reportIssuancePolicy.previewBeforePurchase);
  assert.ok(listed.reportIssuancePolicy.revokedAccess);

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

  // Verify PAY-01C demo product and PAY-02-PILOT (`intel.report.vehicle_history_single`)
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
  assert.equal(realPilot.sourceObjectType, 'vehicles', 'Pre-purchase source object must be public.vehicles');
  assert.equal(realPilot.merchantOfRecord, 'carup_japan');
  assert.equal(realPilot.approvedAmountMinor, 100);
  assert.equal(realPilot.approvedCurrency, 'JPY');

  // Verify DB-to-catalogue reconciliation reflects version advancement in PostgreSQL
  const reconciled = await loadPay02CatalogueWithPersistence({
    db: {
      from: (table) => ({
        select: async () => {
          if (table === 'pay02_commercial_products') {
            return {
              data: PAY02_CATALOGUE.map((item) => ({
                product_code: item.productCode,
                current_version: item.productCode === 'sub.diaspora.buyer_pro' ? 2 : item.version,
                activation_state:
                  item.productCode === 'sub.diaspora.buyer_pro' ? 'reviewed' : item.activationState,
                approved_amount_minor: item.approvedAmountMinor,
                approved_currency: item.approvedCurrency,
                currency_scale: item.currencyScale,
              })),
              error: null,
            };
          }
          return { data: [], error: null };
        },
      }),
    },
  });
  assert.equal(reconciled.summary.persistedDatabaseCount, 66);
  assert.equal(reconciled.summary.catalogueSynchronized, true);
  assert.equal(reconciled.summary.persistenceStatus, 'database_reconciled');
  const advancedItem = reconciled.products.find((p) => p.productCode === 'sub.diaspora.buyer_pro');
  assert.equal(advancedItem.version, 2);
  assert.equal(advancedItem.activationState, 'reviewed');
  assert.equal(advancedItem.persistenceStatus, 'version_advanced_in_db');
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

test('PAY02-PRICE (R1-D): integer minor-unit arithmetic, safe-integer upper bound, and currency scale enforcement refuse floating-point values', () => {
  assert.deepEqual(assertMinorUnitAmount(100, 'JPY'), {
    amountMinor: 100,
    amountMinorString: '100',
    currency: 'JPY',
    currencyScale: 0,
    formattedMajor: '100',
  });
  assert.deepEqual(assertMinorUnitAmount(25000, 'USD'), {
    amountMinor: 25000,
    amountMinorString: '25000',
    currency: 'USD',
    currencyScale: 2,
    formattedMajor: '250.00',
  });
  assert.equal(formatMinorUnitsToMajorString(100, 0), '100');
  assert.equal(formatMinorUnitsToMajorString(25050, 2), '250.50');
  assert.equal(formatMinorUnitsToMajorString(5, 2), '0.05');

  // Floating-point amounts, negative amounts, scale mismatch, unsafe integer overflow, and unknown currencies are refused
  assert.throws(() => assertMinorUnitAmount(19.99, 'USD'), /PAY02_FLOAT_OR_UNSAFE_AMOUNT_REFUSED/);
  assert.throws(() => assertMinorUnitAmount('100.50', 'JPY'), /PAY02_MINOR_UNIT_INTEGER_REQUIRED/);
  assert.throws(() => assertMinorUnitAmount(-10, 'JPY'), /PAY02_MINOR_UNIT_INVALID/);
  assert.throws(
    () => assertMinorUnitAmount(PAY02_MAX_SAFE_MINOR_UNITS + 1, 'JPY'),
    /PAY02_AMOUNT_EXCEEDS_SAFE_INTEGER_BOUND/,
  );
  assert.throws(() => assertMinorUnitAmount(100, 'JPY', 2), /PAY02_CURRENCY_SCALE_MISMATCH/);
  assert.throws(() => assertMinorUnitAmount(100, 'CHF'), /PAY02_CURRENCY_UNSUPPORTED/);
});

test('PAY02-PRICE & R1-B: separates non-authoritative preview from durable DB-persisted quotes, verifies real vehicle source authority, and enforces idempotency', async () => {
  const baseParams = {
    productCode: 'intel.report.vehicle_history_single',
    payerId: '00000000-0000-4000-8000-000000000101',
    payerRole: 'buyer',
    sourceObjectType: 'vehicles',
    sourceObjectId: 'WBA00000000000101',
    idempotencyKey: 'pay02_quote_test_key_0001',
    now: new Date('2026-10-31T05:00:00.000Z'),
  };

  // 1. Non-authoritative preview is explicitly labelled and never checkout-eligible
  const preview = previewPay02Quote(baseParams);
  assert.equal(preview.mode, 'preview_only');
  assert.equal(preview.authoritative, false);
  assert.equal(preview.persisted, false);
  assert.equal(preview.checkoutEligible, false);
  assert.equal(preview.id, null);
  assert.match(preview.authorityWarning, /PREVIEW ONLY/);

  // 2. Durable quote issuance fails closed when database persistence is missing (never falls back to preview)
  await assert.rejects(
    createAndPersistPay02Quote({ ...baseParams, db: null }),
    /PAY02_QUOTE_PERSISTENCE_REQUIRED/,
  );

  // 3. Rejects post-payment `vehicle_report_versions` or `rep_ver_*` as pre-purchase source object
  await assert.rejects(
    verifyPay02SourceObjectAuthority({
      db: { from: () => ({}) },
      product: getPay02CatalogueItem('intel.report.vehicle_history_single'),
      sourceObjectType: 'vehicles',
      sourceObjectId: 'rep_ver_fake_post_payment_01',
      payerId: baseParams.payerId,
    }),
    /PAY02_OUTPUT_REPORT_VERSION_CANNOT_BE_PRE_PURCHASE_SOURCE/,
  );

  // 4. Rejects quote issuance when vehicle VIN does not exist in `public.vehicles`
  const dbMissingVehicle = {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === 'pay02_commercial_products' ? null : null,
            error: null,
          }),
        }),
      }),
    }),
    rpc: async () => ({ data: { id: 'should_not_be_called' }, error: null }),
  };
  await assert.rejects(
    createAndPersistPay02Quote({
      ...baseParams,
      sourceObjectId: 'UNKNOWN-VIN-999999',
      db: dbMissingVehicle,
    }),
    /PAY02_SOURCE_VEHICLE_NOT_FOUND/,
  );

  // 5. Persists durable quote when vehicle exists in `public.vehicles`, and enforces idempotency replay vs conflict
  const persistedQuotesByIdem = new Map();
  const fakeQuoteDb = {
    from: (table) => ({
      select: () => ({
        eq: (_col, val) => ({
          maybeSingle: async () => {
            if (table === 'vehicles' && val === 'WBA00000000000101') {
              return {
                data: { id: 'veh_uuid_101', vin: 'WBA00000000000101', make: 'BMW', model: '320i' },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
    rpc: async (name, args) => {
      assert.equal(name, 'pay02_issue_commercial_quote');
      const key = `${args.p_payer_id}:${args.p_idempotency_key}`;
      const existing = persistedQuotesByIdem.get(key);
      if (existing) {
        if (
          existing.p_product_code !== args.p_product_code
          || existing.p_source_object_id !== args.p_source_object_id
          || existing.p_total_minor !== args.p_total_minor
        ) {
          return { data: null, error: { message: 'PAY02_QUOTE_IDEMPOTENCY_CONFLICT' } };
        }
        return {
          data: {
            id: existing.id,
            quote_number: existing.p_quote_number,
            product_version: existing.p_product_version,
            status: 'issued',
            idempotent_replay: true,
          },
          error: null,
        };
      }
      const created = { ...args, id: 'quote_uuid_01' };
      persistedQuotesByIdem.set(key, created);
      return {
        data: {
          id: created.id,
          quote_number: created.p_quote_number,
          product_version: created.p_product_version,
          status: 'issued',
          idempotent_replay: false,
        },
        error: null,
      };
    },
  };

  const persisted = await createAndPersistPay02Quote({
    ...baseParams,
    db: fakeQuoteDb,
  });
  assert.equal(persisted.id, 'quote_uuid_01');
  assert.equal(persisted.mode, 'issued_authoritative');
  assert.equal(persisted.authoritative, true);
  assert.equal(persisted.persisted, true);
  assert.equal(persisted.checkoutEligible, true);
  assert.equal(persisted.idempotentReplay, false);
  assert.equal(persisted.totalMinor, 100);
  assert.equal(persisted.verifiedSourceObject.vin, 'WBA00000000000101');

  // Idempotent replay with identical parameters returns the exact same quote
  const replayed = await createAndPersistPay02Quote({
    ...baseParams,
    db: fakeQuoteDb,
  });
  assert.equal(replayed.id, 'quote_uuid_01');
  assert.equal(replayed.idempotentReplay, true);

  // Conflicting parameters with the same idempotency key fail closed
  await assert.rejects(
    createAndPersistPay02Quote({
      ...baseParams,
      db: {
        ...fakeQuoteDb,
        from: (table) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data:
                  table === 'vehicles'
                    ? { id: 'veh_uuid_202', vin: 'WBA00000000000202' }
                    : null,
                error: null,
              }),
            }),
          }),
        }),
      },
      sourceObjectId: 'WBA00000000000202',
    }),
    /PAY02_QUOTE_IDEMPOTENCY_CONFLICT/,
  );

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
        amountMinor: 650000,
      },
      {
        productCode: 'imp.freight.ocean_carriage',
        legalBeneficiary: 'freight_nyk_roro',
        currency: 'USD',
        amountMinor: 145000,
      },
      {
        productCode: 'imp.customs.duties_and_taxes',
        legalBeneficiary: 'zimra_customs_authority',
        currency: 'USD',
        amountMinor: 210000,
      },
      {
        productCode: 'imp.export.documentation_charge',
        legalBeneficiary: 'inspector_qisj',
        currency: 'USD',
        amountMinor: 18000,
      },
      {
        productCode: 'imp.sourcing.verification_fee',
        legalBeneficiary: 'carup_japan',
        currency: 'USD',
        amountMinor: 35000,
      },
    ],
  });

  assert.equal(decomposed.allocations.length, 5);
  assert.equal(decomposed.totalsByCurrency.USD.totalObligationsMinor, 1058000);
  assert.equal(decomposed.totalsByCurrency.USD.carUpFirstPartyRevenueMinor, 35000);
  assert.equal(decomposed.totalsByCurrency.USD.thirdPartyObligationsMinor, 1023000);

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

test('PAY02-LIFE & R1-D: financial truth report distinguishes operational DB reconciliation from simulation, separates recognized revenue vs deferred liability vs platform fee, and detects all 9 anomaly classes', async () => {
  const report = computePay02FinancialTruthReport({
    quotes: [
      { id: 'q1', currency: 'JPY', currency_scale: 0, totalMinor: 2500 },
      { id: 'q2', currency: 'USD', currency_scale: 2, totalMinor: 50000 },
      { id: 'q_bad_scale', currency: 'JPY', currency_scale: 2, totalMinor: 100 },
    ],
    canonicalPayments: [
      {
        reference: 'pay01a_001',
        pay02_quote_id: 'q1',
        pay02_product_code: 'imp.sourcing.verification_fee',
        status: 'paid',
        currency: 'JPY',
        amount: 2500,
        pay02_commercial_category: PAY02_CATEGORIES.FIRST_PARTY,
        pay01a_checkout_id: 'cs_test_001',
        pay01a_intent_id: 'pi_test_001',
        pay02_settlement_status: 'settled',
        pay02_provider_settlement_ref: 'po_stripe_001',
        pay02_bank_settlement_ref: 'bank_tx_001',
      },
      {
        reference: 'pay01a_deferred_003',
        pay02_product_code: 'intel.report.vehicle_history_single',
        status: 'paid',
        currency: 'JPY',
        amount: 100,
        pay02_commercial_category: PAY02_CATEGORIES.FIRST_PARTY,
        pay01a_checkout_id: 'cs_test_003',
        pay01a_intent_id: 'pi_test_003',
        pay02_settlement_status: 'unsettled',
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
      {
        id: 'gpr_bad_verified',
        invoiceId: 'ginv_002',
        currency: 'USD',
        amountMinor: 5000,
        claimProviderVerified: true,
      },
    ],
    pilotEntitlements: [
      {
        id: 'ord_fulfilled_001',
        paymentReference: 'pay01a_001',
        entitlement_status: 'entitled',
        grantedAt: '2026-10-31T01:00:00Z',
        revokedAt: null,
      },
      {
        id: 'ord_unfulfilled_003',
        paymentReference: 'pay01a_deferred_003',
        entitlement_status: 'awaiting_payment',
        grantedAt: null,
        revokedAt: null,
      },
      {
        id: 'ord_orphan_01',
        paymentReference: 'pay01a_002', // refunded payment still active!
        grantedAt: '2026-10-31T01:00:00Z',
        revokedAt: null,
      },
    ],
  });

  // Simulation mode banner
  assert.equal(report.simulated, true);
  assert.equal(report.authorityBanner, 'SIMULATED INPUT — NOT AUTHORITATIVE FINANCIAL REPORTING');

  // Check currency separation and recognized vs deferred liability vs platform service fee
  assert.equal(report.byCurrency.JPY.quotedObligationsMinor, 2600);
  assert.equal(report.byCurrency.JPY.providerConfirmedGrossMinor, 2600);
  assert.equal(report.byCurrency.JPY.carUpRecognizedRevenueMinor, 2500);
  assert.equal(report.byCurrency.JPY.carUpDeferredCustomerLiabilityMinor, 100);
  assert.equal(report.byCurrency.JPY.platformServiceFeeMinor, 2500);
  assert.equal(report.byCurrency.JPY.refundedMinor, 100);
  assert.equal(report.byCurrency.JPY.providerSettledMinor, 2500);
  assert.equal(report.byCurrency.JPY.bankSettledMinor, 2500);
  assert.ok(report.byCurrency.JPY.unverifiedTaxTreatmentCount >= 1);

  // External garage declaration is isolated in its own non-settled bucket and NEVER counted as providerConfirmedGrossMinor
  assert.equal(report.byCurrency.USD.externalOffPlatformDeclaredMinor, 12000);
  assert.equal(report.byCurrency.USD.providerConfirmedGrossMinor, 0);
  assert.equal(report.byCurrency.USD.carUpEarnedRevenueMinor, 0);

  // Check reconciliation anomaly detection
  assert.equal(report.healthy, false);
  const anomalyTypes = report.exceptions.map((e) => e.type);
  assert.ok(anomalyTypes.includes('paid_status_missing_provider_intent_evidence'));
  assert.ok(anomalyTypes.includes('refund_succeeded_but_entitlement_still_active'));
  assert.ok(anomalyTypes.includes('provider_paid_but_carup_fulfillment_pending'));
  assert.ok(anomalyTypes.includes('invalid_currency_scale_for_currency'));
  assert.ok(anomalyTypes.includes('external_garage_receipt_misclassified_as_provider_verified'));

  // Operational reconciliation rejects caller-supplied evidence arrays
  await assert.rejects(
    reconcilePay02OperationalFinancialTruth({
      callerSuppliedPayload: { canonicalPayments: [] },
      db: { from: () => ({}) },
    }),
    /PAY02_CALLER_SUPPLIED_EVIDENCE_FORBIDDEN/,
  );

  // Cross-currency summation is refused
  assert.throws(
    () => computePay02FinancialTruthReport({ AttemptCrossCurrencySum: true }),
    /PAY02_UNAPPROVED_CROSS_CURRENCY_SUM_REFUSED/,
  );
});

test('PAY02-ADMIN & R1-C: governance proposal workflow fails closed without DB, enforces separation of duties, advances product version on approval, and refuses double/stale reviews', async () => {
  // 1. Fails closed when persistence is unavailable — never fabricates a proposal ID
  await assert.rejects(
    createPay02GovernanceProposal({
      actorId: 'admin-proposer-001',
      actorRole: 'admin',
      productCode: 'intel.report.vehicle_history_single',
      proposedState: 'sandbox_certified',
      approvalEvidenceRef: 'ISSUE-247-SANDBOX-GATE',
      rationale: 'Requesting sandbox certification state.',
      db: null,
    }),
    /PAY02_PROPOSAL_PERSISTENCE_UNAVAILABLE/,
  );

  // 2. Rejects unstructured approval evidence for quote-eligible state
  const storedProposals = new Map();
  const storedProducts = new Map([
    [
      'intel.report.vehicle_history_single',
      {
        product_code: 'intel.report.vehicle_history_single',
        current_version: 1,
        activation_state: 'provider_eligible',
        approved_amount_minor: 100,
        approved_currency: 'JPY',
        currency_scale: 0,
        price_authority_type: 'fixed_catalogue',
        approval_evidence_ref: 'ISSUE-247-PAY02-PILOT-SEED',
      },
    ],
  ]);
  const storedVersions = [];

  const fakeDb = {
    from: (table) => ({
      insert: (payload) => {
        if (table === 'pay02_commercial_product_versions') {
          storedVersions.push(payload);
          return Promise.resolve({ data: payload, error: null });
        }
        return {
          select: () => ({
            maybeSingle: async () => {
              const row = {
                id: `prop_000${storedProposals.size + 1}`,
                ...payload,
                created_at: '2026-10-31T05:00:00.000Z',
              };
              storedProposals.set(row.id, row);
              return { data: row, error: null };
            },
          }),
        };
      },
      select: () => ({
        eq: (_col, id) => ({
          maybeSingle: async () => {
            if (table === 'pay02_commercial_products') {
              return { data: storedProducts.get(id) || null, error: null };
            }
            return { data: storedProposals.get(id) || null, error: null };
          },
        }),
      }),
      update: (patch) => ({
        eq: (_col, id) => ({
          select: () => ({
            single: async () => {
              if (table === 'pay02_commercial_products') {
                const updated = { ...storedProducts.get(id), ...patch };
                storedProducts.set(id, updated);
                return { data: updated, error: null };
              }
              const row = { ...storedProposals.get(id), ...patch };
              storedProposals.set(id, row);
              return { data: row, error: null };
            },
          }),
        }),
      }),
    }),
    rpc: async (fnName, args) => {
      assert.equal(fnName, 'pay02_review_activation_proposal');
      const existing = storedProposals.get(args.p_proposal_id);
      if (!existing) return { data: null, error: { message: 'PAY02_PROPOSAL_NOT_FOUND' } };
      if (existing.status !== 'pending_review') {
        return { data: null, error: { message: 'PAY02_PROPOSAL_ALREADY_DECIDED' } };
      }
      if (existing.proposer_id === args.p_reviewer_id) {
        return { data: null, error: { message: 'PAY02_SELF_APPROVAL_FORBIDDEN' } };
      }
      const dbProduct = storedProducts.get(existing.product_code);
      if (
        Number(existing.product_version) !== Number(dbProduct.current_version)
        || existing.from_state !== dbProduct.activation_state
      ) {
        return { data: null, error: { message: 'PAY02_STALE_PROPOSAL_VERSION_CONFLICT' } };
      }
      if (args.p_decision === 'approved') {
        const nextVer = Number(dbProduct.current_version) + 1;
        const updatedProd = {
          ...dbProduct,
          current_version: nextVer,
          activation_state: existing.proposed_state,
          approved_amount_minor: existing.proposed_amount_minor ?? dbProduct.approved_amount_minor,
          approved_currency: existing.proposed_currency ?? dbProduct.approved_currency,
        };
        storedProducts.set(existing.product_code, updatedProd);
        storedVersions.push({
          product_code: existing.product_code,
          version: nextVer,
          snapshot: updatedProd,
          recorded_by: args.p_reviewer_id,
        });
        const updatedProp = {
          ...existing,
          status: 'approved',
          resulting_version: nextVer,
          effect_status: 'effective_in_sandbox_catalogue',
          reviewer_id: args.p_reviewer_id,
          reviewer_role: args.p_reviewer_role,
          review_notes: args.p_review_notes,
        };
        storedProposals.set(existing.id, updatedProp);
        return { data: updatedProp, error: null };
      }
      const rejectedProp = {
        ...existing,
        status: 'rejected',
        effect_status: 'rejected_no_state_change',
      };
      storedProposals.set(existing.id, rejectedProp);
      return { data: rejectedProp, error: null };
    },
  };

  // Non-atomic DB (without `db.rpc`) must fail closed on governance review (Section 7.1)
  await assert.rejects(
    reviewPay02GovernanceProposal({
      proposalId: 'prop_0001',
      reviewerId: 'admin-reviewer-002',
      reviewerRole: 'admin',
      decision: 'approved',
      reviewNotes: 'Attempting review without atomic RPC.',
      db: { from: fakeDb.from },
    }),
    /PAY02_ATOMIC_GOVERNANCE_RPC_REQUIRED/,
  );

  await assert.rejects(
    createPay02GovernanceProposal({
      actorId: 'admin-proposer-001',
      actorRole: 'admin',
      productCode: 'intel.report.vehicle_history_single',
      proposedState: 'sandbox_certified',
      approvalEvidenceRef: 'bad ref with spaces',
      rationale: 'Requesting sandbox certification with malformed evidence.',
      db: fakeDb,
    }),
    /PAY02_STRUCTURED_APPROVAL_EVIDENCE_REQUIRED/,
  );

  // Create two proposals on product_version = 1 to verify version advancement + stale conflict
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
  const staleProposalResult = await createPay02GovernanceProposal({
    actorId: 'admin-proposer-001',
    actorRole: 'admin',
    productCode: 'intel.report.vehicle_history_single',
    proposedState: 'sandbox_certified',
    proposedAmountMinor: 100,
    proposedCurrency: 'JPY',
    approvalEvidenceRef: 'ISSUE-247-SANDBOX-STALE',
    rationale: 'Second concurrent proposal on version 1.',
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
      proposalId: proposalResult.proposal.id,
      reviewerId: 'admin-proposer-001',
      reviewerRole: 'admin',
      decision: 'approved',
      reviewNotes: 'Self-approval attempt.',
      db: fakeDb,
    }),
    /PAY02_SELF_APPROVAL_FORBIDDEN/,
  );

  // Second distinct admin approves -> product version advances to v2 and version row is appended
  const reviewed = await reviewPay02GovernanceProposal({
    proposalId: proposalResult.proposal.id,
    reviewerId: 'admin-reviewer-002',
    reviewerRole: 'admin',
    decision: 'approved',
    reviewNotes: 'Verified provenance and minor-unit pricing contract.',
    db: fakeDb,
  });
  assert.equal(reviewed.proposal.status, 'approved');
  assert.equal(reviewed.proposal.resulting_version, 2);
  assert.equal(reviewed.proposal.effect_status, 'effective_in_sandbox_catalogue');
  assert.equal(storedProducts.get('intel.report.vehicle_history_single').current_version, 2);
  assert.equal(storedVersions.length, 1);
  assert.equal(storedVersions[0].version, 2);

  // Double-review of already approved proposal is refused
  await assert.rejects(
    reviewPay02GovernanceProposal({
      proposalId: proposalResult.proposal.id,
      reviewerId: 'admin-reviewer-002',
      reviewerRole: 'admin',
      decision: 'approved',
      reviewNotes: 'Second approval attempt.',
      db: fakeDb,
    }),
    /PAY02_PROPOSAL_ALREADY_DECIDED/,
  );

  // Reviewing stale proposal on base version 1 after product moved to version 2 is refused
  await assert.rejects(
    reviewPay02GovernanceProposal({
      proposalId: staleProposalResult.proposal.id,
      reviewerId: 'admin-reviewer-002',
      reviewerRole: 'admin',
      decision: 'approved',
      reviewNotes: 'Stale approval attempt.',
      db: fakeDb,
    }),
    /PAY02_STALE_PROPOSAL_VERSION_CONFLICT/,
  );
});

test('PAY02-PILOT & R1-E: real vehicle history report enforces bidirectional DB cross-reference checks, vehicle provenance, idempotent version generation, and refund revocation', async () => {
  const quote = {
    ...buildServerAuthorizedQuote({
      productCode: 'intel.report.vehicle_history_single',
      payerId: 'buyer-pilot-01',
      payerRole: 'buyer',
      sourceObjectType: 'vehicles',
      sourceObjectId: 'WBA00000000000101',
      idempotencyKey: 'pay02_pilot_quote_001',
    }),
    id: 'quote-uuid-pilot-001',
    payment_reference: 'pay01a_pilot_001',
  };

  const paidTx = {
    reference: 'pay01a_pilot_001',
    pay02_quote_id: 'quote-uuid-pilot-001',
    gateway: 'stripe_carup_japan_sandbox',
    pay01a_account_id: 'acct_1UVnGaEjgXqvlsJk',
    status: 'paid',
    currency: 'JPY',
    amount: 100,
    pay01a_actor_id: 'buyer-pilot-01',
    pay01a_checkout_id: 'cs_test_pilot_001',
    pay01a_intent_id: 'pi_test_pilot_001',
  };

  const activeEntitlement = {
    id: 'order-uuid-pilot-001',
    product_code: 'intel.report.vehicle_history_single',
    product_version: 1,
    buyer_id: 'buyer-pilot-01',
    quote_id: 'quote-uuid-pilot-001',
    payment_reference: 'pay01a_pilot_001',
    vin: 'WBA00000000000101',
    entitlement_status: 'entitled',
    granted_at: '2026-10-31T05:05:00.000Z',
    revoked_at: null,
  };

  const vehicleRow = {
    id: 'veh-uuid-101',
    vin: 'WBA00000000000101',
    make: 'BMW',
    model: '320i',
  };

  let assembledCount = 0;
  let versionGenCount = 0;
  const fakeAssembler = async (_db, vin) => {
    assembledCount += 1;
    return {
      vin,
      audience: 'buyer',
      identity: { vin, make: 'BMW', model: '320i' },
      completeness: {
        lifecycle_source_coverage: 0.75,
        source_diversity: 3,
        classes_unavailable: ['auction'],
      },
      limitations: [
        'Report reflects recorded sources at assembly time; unrecorded off-platform events are not guaranteed.',
      ],
    };
  };
  const fakeVersionGen = async (_db, vin) => {
    versionGenCount += 1;
    return {
      id: 'rep_ver_001',
      vin,
      version: 1,
      content_hash: 'sha256_canonical_report_001',
      completeness: { lifecycle_source_coverage: 0.75 },
    };
  };

  let rpcFulfillCalls = 0;
  // R1-E: Missing atomic fulfillment RPC must fail closed without multi-step fallback
  await assert.rejects(
    deliverVerifiedVehicleHistoryReport({
      buyerId: 'buyer-pilot-01',
      vin: 'WBA00000000000101',
      quote,
      canonicalPayment: paidTx,
      entitlementOrder: activeEntitlement,
      vehicleRecord: vehicleRow,
      db: null,
      reportAssembler: fakeAssembler,
      versionGenerator: fakeVersionGen,
    }),
    /PAY03A_ATOMIC_FULFILLMENT_RPC_REQUIRED/,
  );
  assert.equal(assembledCount, 1);

  assembledCount = 0;
  const delivered = await deliverVerifiedVehicleHistoryReport({
    buyerId: 'buyer-pilot-01',
    vin: 'WBA00000000000101',
    quote,
    canonicalPayment: paidTx,
    entitlementOrder: activeEntitlement,
    vehicleRecord: vehicleRow,
    db: {
      rpc: async (fnName, params) => {
        assert.equal(fnName, 'pay03a_complete_report_fulfillment');
        assert.equal(params.p_order_id, activeEntitlement.id);
        assert.equal(params.p_buyer_id, 'buyer-pilot-01');
        assert.equal(params.p_vin, 'WBA00000000000101');
        rpcFulfillCalls += 1;
        return {
          data: {
            report_version_id: 'rep_ver_001',
            report_version_number: 1,
            content_hash: 'sha256_canonical_report_001',
            completeness: { lifecycle_source_coverage: 0.75 },
            idempotent_replay: false,
          },
          error: null,
        };
      },
    },
    reportAssembler: fakeAssembler,
    versionGenerator: fakeVersionGen,
  });

  assert.equal(assembledCount, 1);
  assert.equal(rpcFulfillCalls, 1);
  assert.equal(versionGenCount, 0, 'Must use atomic RPC rather than multi-step versionGenerator fallback');
  assert.equal(delivered.productCode, 'intel.report.vehicle_history_single');
  assert.equal(delivered.reportVersionId, 'rep_ver_001');
  assert.equal(delivered.idempotentReplay, false);
  assert.equal(
    delivered.provenance.completenessState,
    'partial_with_explicit_missing_source_disclosures',
  );

  // Idempotent replay when order already has `report_version_id` bound in DB
  const replayed = await deliverVerifiedVehicleHistoryReport({
    buyerId: 'buyer-pilot-01',
    vin: 'WBA00000000000101',
    quote,
    canonicalPayment: paidTx,
    entitlementOrder: { ...activeEntitlement, report_version_id: 'rep_ver_001' },
    vehicleRecord: vehicleRow,
    db: {
      from: (table) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (table === 'report_versions') {
                return {
                  data: {
                    id: 'rep_ver_001',
                    version: 1,
                    content_hash: 'sha256_canonical_report_001',
                    completeness: { lifecycle_source_coverage: 0.75 },
                    payload: await fakeAssembler(null, 'WBA00000000000101'),
                  },
                  error: null,
                };
              }
              return { data: null, error: null };
            },
          }),
        }),
      }),
    },
    reportAssembler: fakeAssembler,
    versionGenerator: fakeVersionGen,
  });
  assert.equal(replayed.idempotentReplay, true);
  assert.equal(replayed.reportVersionId, 'rep_ver_001');
  assert.equal(rpcFulfillCalls, 1, 'Must not generate a second report version for the same paid order');

  // Unrelated paid transaction (wrong quote correlation) is refused
  await assert.rejects(
    deliverVerifiedVehicleHistoryReport({
      buyerId: 'buyer-pilot-01',
      vin: 'WBA00000000000101',
      quote,
      canonicalPayment: { ...paidTx, pay02_quote_id: 'different-quote-id-999' },
      entitlementOrder: activeEntitlement,
      vehicleRecord: vehicleRow,
      db: null,
      reportAssembler: fakeAssembler,
      versionGenerator: fakeVersionGen,
    }),
    /PAY02_PILOT_CANONICAL_PAYMENT_MISMATCH/,
  );

  // Unknown VIN (missing vehicle row) is refused
  await assert.rejects(
    deliverVerifiedVehicleHistoryReport({
      buyerId: 'buyer-pilot-01',
      vin: 'WBA00000000000101',
      quote,
      canonicalPayment: paidTx,
      entitlementOrder: activeEntitlement,
      vehicleRecord: null,
      db: null,
      reportAssembler: fakeAssembler,
      versionGenerator: fakeVersionGen,
    }),
    /PAY02_PILOT_VEHICLE_RECORD_NOT_FOUND/,
  );

  // Refund pending suspends access
  await assert.rejects(
    deliverVerifiedVehicleHistoryReport({
      buyerId: 'buyer-pilot-01',
      vin: 'WBA00000000000101',
      quote,
      canonicalPayment: { ...paidTx, status: 'refund_pending' },
      entitlementOrder: activeEntitlement,
      vehicleRecord: vehicleRow,
      db: null,
      reportAssembler: fakeAssembler,
      versionGenerator: fakeVersionGen,
    }),
    /PAY02_PILOT_ENTITLEMENT_SUSPENDED_ON_REFUND_PENDING/,
  );

  // Revoked entitlement on refund refuses report access
  await assert.rejects(
    deliverVerifiedVehicleHistoryReport({
      buyerId: 'buyer-pilot-01',
      vin: 'WBA00000000000101',
      quote,
      canonicalPayment: paidTx,
      entitlementOrder: {
        ...activeEntitlement,
        entitlement_status: 'revoked_refunded',
        revoked_at: '2026-10-31T05:10:00.000Z',
      },
      vehicleRecord: vehicleRow,
      db: null,
      reportAssembler: fakeAssembler,
      versionGenerator: fakeVersionGen,
    }),
    /PAY02_PILOT_ENTITLEMENT_NOT_ACTIVE/,
  );

  // Provenance check refuses report missing limitations disclosure
  assert.throws(
    () =>
      verifyVehicleReportProvenance(
        {
          vin: 'WBA00000000000101',
          audience: 'buyer',
          identity: { vin: 'WBA00000000000101' },
          completeness: { lifecycle_source_coverage: 0.5 },
          limitations: [],
        },
        vehicleRow,
      ),
    /PAY02_REPORT_LIMITATIONS_DISCLOSURE_MISSING/,
  );
});

test('PAY02 R1-G (Section 10.4): local API-to-Database integration proof for quotes, catalogue version history, governance proposals/reviews, and operational vs simulated reconciliation', async () => {
  const dbProducts = new Map(
    PAY02_CATALOGUE.map((item) => [
      item.productCode,
      {
        product_code: item.productCode,
        current_version: item.version,
        family: item.family,
        title: item.title,
        commercial_event: item.commercialEvent,
        commercial_category: item.commercialCategory,
        owning_subsystem: item.owningSubsystem,
        source_object_type: item.sourceObjectType,
        payer_role: item.payerRole,
        contractual_seller: item.contractualSeller,
        legal_beneficiary: item.legalBeneficiary,
        merchant_of_record: item.merchantOfRecord,
        funds_owner: item.fundsOwner,
        revenue_beneficiary: item.revenueBeneficiary,
        jurisdiction: item.jurisdiction,
        permitted_currencies: item.permittedCurrencies,
        price_authority_type: item.priceAuthorityType,
        approved_amount_minor: item.approvedAmountMinor,
        approved_currency: item.approvedCurrency,
        currency_scale: item.currencyScale,
        eligible_providers: item.eligibleProviders,
        prohibited_providers: item.prohibitedProviders,
        fulfillment_contract: item.fulfillmentContract,
        mobile_channel_policy: item.mobileChannelPolicy,
        checkout_prohibited: item.checkoutProhibited,
        activation_state: item.activationState,
        certification_state: item.certificationState,
        approval_evidence_ref: item.approvalEvidenceRef,
        approved_by: item.approvedBy,
      },
    ]),
  );
  const dbVersions = new Map(
    PAY02_CATALOGUE.map((item) => [
      item.productCode,
      [
        {
          product_code: item.productCode,
          version: 1,
          activation_state: item.activationState,
          approved_currency: item.approvedCurrency,
          approved_amount_minor: item.approvedAmountMinor,
          approval_evidence_ref: item.approvalEvidenceRef,
          recorded_by: 'pay02_migration',
        },
      ],
    ]),
  );
  const dbProposals = new Map();
  const dbQuotes = [];
  const dbPayments = [
    {
      reference: 'pay01a_int_001',
      pay02_quote_id: 'quote_int_001',
      pay02_product_code: 'intel.report.vehicle_history_single',
      pay02_commercial_category: 'category_a_first_party',
      status: 'paid',
      currency: 'JPY',
      amount: 100,
      pay01a_actor_id: 'buyer-int-1',
      pay01a_checkout_id: 'cs_test_int_001',
      pay01a_intent_id: 'pi_test_int_001',
      pay02_settlement_status: 'not_applicable_sandbox',
    },
  ];
  const dbReportOrders = [
    {
      id: 'ord_int_001',
      quote_id: 'quote_int_001',
      payment_reference: 'pay01a_int_001',
      buyer_id: 'buyer-int-1',
      vin: 'WBA00000000000101',
      entitlement_status: 'entitled',
      granted_at: '2026-10-31T06:00:00Z',
    },
  ];

  const dbSessions = new Map([
    [
      'tok-buyer-int-1',
      { user_id: 'buyer-int-1', is_valid: true, expires_at: '2099-01-01T00:00:00Z' },
    ],
    [
      'tok-admin-int-1',
      { user_id: 'admin-int-1', is_valid: true, expires_at: '2099-01-01T00:00:00Z' },
    ],
    [
      'tok-admin-int-2',
      { user_id: 'admin-int-2', is_valid: true, expires_at: '2099-01-01T00:00:00Z' },
    ],
  ]);
  const dbUsers = new Map([
    ['buyer-int-1', { id: 'buyer-int-1', role: 'buyer', is_verified: true }],
    ['admin-int-1', { id: 'admin-int-1', role: 'admin', is_verified: true }],
    ['admin-int-2', { id: 'admin-int-2', role: 'admin', is_verified: true }],
  ]);

  const integrationDb = {
    from: (table) => ({
      select: () => {
        const promise = Promise.resolve({
          data:
            table === 'pay02_commercial_products'
              ? Array.from(dbProducts.values())
              : table === 'pay02_activation_proposals'
                ? Array.from(dbProposals.values())
                : table === 'payment_transactions'
                  ? dbPayments
                  : table === 'pay02_commercial_quotes'
                    ? dbQuotes
                    : table === 'pay02_report_orders'
                      ? dbReportOrders
                      : [],
          error: null,
        });
        promise.eq = (_col, val) => {
          const eqPromise = Promise.resolve({
            data:
              table === 'pay02_commercial_product_versions'
                ? dbVersions.get(val) || []
                : table === 'pay02_activation_proposals'
                  ? Array.from(dbProposals.values()).filter((p) => p.product_code === val)
                  : [],
            error: null,
          });
          eqPromise.single = async () => {
            if (table === 'user_sessions') {
              return { data: dbSessions.get(val) || null, error: null };
            }
            if (table === 'users') {
              return { data: dbUsers.get(val) || null, error: null };
            }
            return { data: null, error: null };
          };
          eqPromise.maybeSingle = async () => {
            if (table === 'pay02_commercial_products') {
              return { data: dbProducts.get(val) || null, error: null };
            }
            if (table === 'vehicles' && val === 'WBA00000000000101') {
              return { data: { id: 'veh_101', vin: 'WBA00000000000101' }, error: null };
            }
            if (table === 'pay02_activation_proposals') {
              return { data: dbProposals.get(val) || null, error: null };
            }
            return { data: null, error: null };
          };
          return eqPromise;
        };
        return promise;
      },
      insert: (payload) => ({
        select: () => ({
          maybeSingle: async () => {
            const row = { id: `prop_int_${dbProposals.size + 1}`, ...payload };
            dbProposals.set(row.id, row);
            return { data: row, error: null };
          },
        }),
      }),
    }),
    rpc: async (fnName, args) => {
      if (fnName === 'pay02_issue_commercial_quote') {
        const q = {
          id: `quote_int_${dbQuotes.length + 1}`,
          quote_number: args.p_quote_number,
          product_code: args.p_product_code,
          product_version: args.p_product_version,
          currency: args.p_currency,
          currency_scale: args.p_currency_scale,
          total_minor: args.p_total_minor,
          status: 'issued',
          idempotent_replay: false,
        };
        dbQuotes.push(q);
        return { data: q, error: null };
      }
      if (fnName === 'pay02_review_activation_proposal') {
        const prop = dbProposals.get(args.p_proposal_id);
        const prod = dbProducts.get(prop.product_code);
        const nextVer = prod.current_version + 1;
        prod.current_version = nextVer;
        prod.activation_state = prop.proposed_state;
        dbVersions.get(prop.product_code).push({
          product_code: prop.product_code,
          version: nextVer,
          activation_state: prop.proposed_state,
          recorded_by: args.p_reviewer_id,
        });
        const updated = {
          ...prop,
          status: args.p_decision,
          resulting_version: nextVer,
          effect_status: 'effective_in_sandbox_catalogue',
          reviewer_id: args.p_reviewer_id,
        };
        dbProposals.set(prop.id, updated);
        return { data: updated, error: null };
      }
      return { data: null, error: { message: 'UNKNOWN_RPC' } };
    },
  };

  const origFrom = supabase.from.bind(supabase);
  const origRpc = supabase.rpc.bind(supabase);
  supabase.from = integrationDb.from;
  supabase.rpc = integrationDb.rpc;

  const app = express();
  app.use(express.json());
  app.use(pay02Routes);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Issue durable quote via POST /api/pay02/quotes
    const quoteRes = await fetch(`${baseUrl}/api/pay02/quotes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-token': 'tok-buyer-int-1',
        'idempotency-key': 'pay02_api_int_idem_0001',
      },
      body: JSON.stringify({
        productCode: 'intel.report.vehicle_history_single',
        sourceObjectType: 'vehicles',
        sourceObjectId: 'WBA00000000000101',
      }),
    });
    assert.equal(quoteRes.status, 201);
    const quoteBody = await quoteRes.json();
    assert.equal(quoteBody.quote.persisted, true);
    assert.equal(quoteBody.quote.mode, 'issued_authoritative');
    assert.equal(quoteBody.quote.totalMinor, 100);

    // 2. Submit proposal & review with distinct admin via HTTP routes
    const propRes = await fetch(`${baseUrl}/api/pay02/admin/proposals`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-token': 'tok-admin-int-1',
      },
      body: JSON.stringify({
        productCode: 'sub.diaspora.buyer_pro',
        proposedState: 'reviewed',
        rationale: 'API integration test governance review proposal.',
      }),
    });
    assert.equal(propRes.status, 201);
    const propBody = await propRes.json();

    const reviewRes = await fetch(
      `${baseUrl}/api/pay02/admin/proposals/${propBody.proposal.id}/review`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-session-token': 'tok-admin-int-2',
        },
        body: JSON.stringify({
          decision: 'approved',
          reviewNotes: 'Approved by distinct reviewer in API integration test.',
        }),
      },
    );
    assert.equal(reviewRes.status, 200);
    const reviewBody = await reviewRes.json();
    assert.equal(reviewBody.proposal.status, 'approved');
    assert.equal(reviewBody.proposal.resulting_version, 2);

    // 3. Inspect product detail & version history via GET /api/pay02/admin/catalogue/:productCode
    const detailRes = await fetch(
      `${baseUrl}/api/pay02/admin/catalogue/sub.diaspora.buyer_pro`,
      {
        headers: {
          'x-session-token': 'tok-admin-int-2',
        },
      },
    );
    assert.equal(detailRes.status, 200);
    const detailBody = await detailRes.json();
    assert.equal(detailBody.product.version, 2);
    assert.equal(detailBody.versions.length, 2);

    // 4. Authoritative DB reconciliation via GET /api/pay02/admin/reporting/reconcile
    const recRes = await fetch(`${baseUrl}/api/pay02/admin/reporting/reconcile`, {
      headers: {
        'x-session-token': 'tok-admin-int-2',
      },
    });
    assert.equal(recRes.status, 200);
    const recBody = await recRes.json();
    assert.equal(recBody.report.reportingMode, 'AUTHORITATIVE_DATABASE_RECONCILIATION');
    assert.equal(recBody.report.simulated, false);
    assert.equal(recBody.report.carUpRecognizedRevenueMinor, 100);

    // 5. Rejects caller-supplied arrays on POST /api/pay02/admin/reporting/reconcile
    const badRecRes = await fetch(`${baseUrl}/api/pay02/admin/reporting/reconcile`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-token': 'tok-admin-int-2',
      },
      body: JSON.stringify({ canonicalPayments: [] }),
    });
    assert.equal(badRecRes.status, 400);
    const badRecBody = await badRecRes.json();
    assert.equal(badRecBody.code, 'PAY02_CALLER_SUPPLIED_EVIDENCE_FORBIDDEN');
  } finally {
    supabase.from = origFrom;
    supabase.rpc = origRpc;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PAY02 schema and routes: additive migration reuses canonical payment_transactions and enforces authorizeSessionRole boundaries', () => {
  const source = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const migration = source('../database/migrations/20261031143000_carup_pay02_commercial_foundation.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pay02_commercial_products/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pay02_commercial_product_versions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pay02_activation_proposals/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pay02_commercial_quotes/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pay02_report_orders/);
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
  assert.match(routes, /\/api\/pay02\/quotes\/preview', authenticatedSession/);
  assert.match(routes, /\/api\/pay02\/admin\/reporting\/reconcile', adminSession/);
  assert.match(routes, /\/api\/pay02\/admin\/reporting\/simulate', adminSession/);
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
