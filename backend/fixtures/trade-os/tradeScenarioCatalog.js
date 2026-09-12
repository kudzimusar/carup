import {
  DEFAULT_SCENARIO_ALLOWED_ENVIRONMENTS,
  TRADE_SCENARIO_ASSERTION_TYPES,
  TRADE_SCENARIO_FIXTURE_CLASSES,
  TRADE_SCENARIO_IDS,
  TRADE_SCENARIO_SOURCE_TYPES,
} from '../../constants/diaspora/diasporaTradeScenarioConstants.js';

function buyerPack(referencePackId, profile) {
  return Object.freeze({
    referencePackId,
    version: 1,
    fixtureClass: TRADE_SCENARIO_FIXTURE_CLASSES.TEST_FIXTURE,
    sourceType: TRADE_SCENARIO_SOURCE_TYPES.TEST_FIXTURE,
    description: 'Synthetic scenario-scoped buyer profile. It is not a live customer record.',
    sheets: Object.freeze({ TRADE_PROFILES: Object.freeze([Object.freeze(profile)]) }),
  });
}

export const TRADE_REFERENCE_PACKS = Object.freeze({
  'REF-T5-BUYER-ALPHARD-V1': buyerPack('REF-T5-BUYER-ALPHARD-V1', {
    TRADE_PROFILE_ID: 'TP-BUYER-ALPHARD', USER_ID: 'fixture-buyer-alphard', COUNTRY: 'Zimbabwe', CITY: 'Harare', ROLE_TYPE: 'buyer', VERIFICATION_STATUS: 'PENDING_REVIEW', NOTES: 'Synthetic T5 fixture; not a live buyer.',
  }),
  'REF-T5-BUYER-PARTS-V1': buyerPack('REF-T5-BUYER-PARTS-V1', {
    TRADE_PROFILE_ID: 'TP-BUYER-PARTS', USER_ID: 'fixture-buyer-parts', COUNTRY: 'Zimbabwe', CITY: 'Harare', ROLE_TYPE: 'buyer', VERIFICATION_STATUS: 'PENDING_REVIEW', NOTES: 'Synthetic T5 fixture; not a live buyer.',
  }),
  'REF-T5-BUYER-BYO-V1': buyerPack('REF-T5-BUYER-BYO-V1', {
    TRADE_PROFILE_ID: 'TP-BUYER-BYO', USER_ID: 'fixture-buyer-byo', COUNTRY: 'Zimbabwe', CITY: 'Harare', ROLE_TYPE: 'buyer', VERIFICATION_STATUS: 'PENDING_REVIEW', NOTES: 'Synthetic T5 fixture; not a live buyer.',
  }),
  'REF-VEHICLES-JP-ZW-V1': Object.freeze({
    referencePackId: 'REF-VEHICLES-JP-ZW-V1',
    version: 1,
    fixtureClass: TRADE_SCENARIO_FIXTURE_CLASSES.TEST_FIXTURE,
    sourceType: TRADE_SCENARIO_SOURCE_TYPES.TEST_FIXTURE,
    description: 'Small synthetic Japan→Zimbabwe vehicle reference set for scenario matching and later freight-profile extension.',
    entities: Object.freeze({
      vehicles: Object.freeze([
        Object.freeze({ referenceVehicleId: 'REF-ALPHARD-2019', make: 'Toyota', model: 'Alphard', yearMin: 2019, bodyType: 'MPV', sourceType: 'TEST_FIXTURE', verificationState: 'UNVERIFIED' }),
        Object.freeze({ referenceVehicleId: 'REF-ELGRAND-2018', make: 'Nissan', model: 'Elgrand', yearMin: 2018, bodyType: 'MPV', sourceType: 'TEST_FIXTURE', verificationState: 'UNVERIFIED' }),
      ]),
    }),
  }),
  'REF-UMZ-PARTS-CLEAN-V1': Object.freeze({
    referencePackId: 'REF-UMZ-PARTS-CLEAN-V1',
    version: 1,
    fixtureClass: TRADE_SCENARIO_FIXTURE_CLASSES.TEST_FIXTURE,
    sourceType: TRADE_SCENARIO_SOURCE_TYPES.LEGACY_WORKBOOK,
    description: 'Small cleaned structural subset inspired by the Universal Motors legacy parts workbook. Commercial truth is intentionally not asserted.',
    entities: Object.freeze({
      parts: Object.freeze([
        Object.freeze({ partReferenceId: 'UMZ-HIACE-BRAKE-PAD-001', partName: 'Front brake pad set', vehicleFitment: 'Toyota Hiace', chassisFitment: 'KDH201', quantityUom: 'set', sourceType: 'LEGACY_WORKBOOK', verificationState: 'UNVERIFIED' }),
        Object.freeze({ partReferenceId: 'UMZ-HIACE-OIL-FILTER-001', partName: 'Oil filter', vehicleFitment: 'Toyota Hiace', chassisFitment: 'KDH201', quantityUom: 'piece', sourceType: 'LEGACY_WORKBOOK', verificationState: 'UNVERIFIED' }),
        Object.freeze({ partReferenceId: 'UMZ-HIACE-ALTERNATOR-001', partName: 'Alternator', vehicleFitment: 'Toyota Hiace', chassisFitment: 'KDH201', quantityUom: 'piece', sourceType: 'LEGACY_WORKBOOK', verificationState: 'UNVERIFIED' }),
      ]),
    }),
  }),
});

const ALPHARD_SCENARIO = Object.freeze({
  manifest: Object.freeze({
    scenarioId: TRADE_SCENARIO_IDS.ALPHARD_HARARE,
    title: 'Vehicle retail procurement — Toyota Alphard to Harare',
    description: 'Independent buyer RFQ with three competing Japanese provider quotes and preserved quote history.',
    scenarioVersion: 1,
    workbookSchemaVersion: '2026.09.t5-scenarios.xlsx-v2',
    environmentClass: 'NON_PRODUCTION',
    fixtureClass: TRADE_SCENARIO_FIXTURE_CLASSES.TEST_FIXTURE,
    allowedEnvironments: DEFAULT_SCENARIO_ALLOWED_ENVIRONMENTS,
    tags: Object.freeze(['T5', 'vehicle', 'rfq', 'multi-quote', 'Japan', 'Zimbabwe']),
    referencePackDependencies: Object.freeze(['REF-T5-BUYER-ALPHARD-V1', 'REF-VEHICLES-JP-ZW-V1']),
    expectedEntityCounts: Object.freeze({ DIASPORA_IMPORT_ORDERS: 1, IMPORT_QUOTES: 3, TRADE_PROFILES: 4 }),
    resetPolicy: 'ISOLATED_SCENARIO_NAMESPACE',
    sourceProvenance: Object.freeze({ sourceType: TRADE_SCENARIO_SOURCE_TYPES.TEST_FIXTURE, fixtureClass: TRADE_SCENARIO_FIXTURE_CLASSES.TEST_FIXTURE }),
    productionForbidden: true,
    assertions: Object.freeze([
      Object.freeze({ id: 'A1', type: TRADE_SCENARIO_ASSERTION_TYPES.DRY_RUN_CAN_IMPORT, expected: true }),
      Object.freeze({ id: 'A2', type: TRADE_SCENARIO_ASSERTION_TYPES.QUOTE_COUNT_FOR_ORDER, orderId: 'DIO-ALPHARD-001', expected: 3 }),
      Object.freeze({ id: 'A3', type: TRADE_SCENARIO_ASSERTION_TYPES.QUOTE_STATUS, quoteId: 'Q-ALPHARD-A', expected: 'SUBMITTED' }),
      Object.freeze({ id: 'A4', type: TRADE_SCENARIO_ASSERTION_TYPES.QUOTE_STATUS, quoteId: 'Q-ALPHARD-B', expected: 'EXPIRED' }),
      Object.freeze({ id: 'A5', type: TRADE_SCENARIO_ASSERTION_TYPES.QUOTE_STATUS, quoteId: 'Q-ALPHARD-C', expected: 'REJECTED' }),
      Object.freeze({ id: 'A6', type: TRADE_SCENARIO_ASSERTION_TYPES.QUOTE_CURRENCY, quoteId: 'Q-ALPHARD-A', expected: 'JPY' }),
      Object.freeze({ id: 'A7', type: TRADE_SCENARIO_ASSERTION_TYPES.ORDER_SERVICE_SCOPE, orderId: 'DIO-ALPHARD-001', expected: 'FULL_TRADE' }),
      Object.freeze({ id: 'A8', type: TRADE_SCENARIO_ASSERTION_TYPES.IMPORT_PLAN_BLOCKED_COUNT, expected: 0 }),
      Object.freeze({ id: 'A9', type: TRADE_SCENARIO_ASSERTION_TYPES.PRODUCTION_FORBIDDEN, expected: true }),
    ]),
    postImportAssertions: Object.freeze([
      'Q-ALPHARD-A may be awarded only through the governed RFQ quote-acceptance service.',
      'Q-ALPHARD-B (expired) and Q-ALPHARD-C (rejected) remain auditable after award.',
      'Exactly one accepted provider relationship exists after governed award.',
      'Replaying the same confirmed import creates no duplicate authoritative records.',
    ]),
  }),
  workbooks: Object.freeze([
    Object.freeze({
      inputId: 'buyer',
      templateType: 'buyer',
      sourceType: TRADE_SCENARIO_SOURCE_TYPES.BUYER_SUBMITTED,
      sheets: Object.freeze({
        DIASPORA_IMPORT_ORDERS: Object.freeze([
          Object.freeze({
            IMPORT_ORDER_ID: 'DIO-ALPHARD-001', BUYER_TRADE_PROFILE_ID: 'TP-BUYER-ALPHARD', ORDER_TYPE: 'vehicle_import', SERVICE_SCOPE: 'FULL_TRADE',
            ORIGIN_COUNTRY: 'Japan', ORIGIN_CITY: 'Yokohama', DESTINATION_COUNTRY: 'Zimbabwe', DESTINATION_CITY: 'Harare',
            STATUS: 'IMPORT_REQUESTED', BUDGET_CURRENCY: 'USD', BUDGET_AMOUNT: 18000, REQUESTED_MAKE: 'Toyota', REQUESTED_MODEL: 'Alphard',
            REQUESTED_YEAR_MIN: 2019, NOTES: 'T5 synthetic RFQ; no live vehicle availability is implied.',
          }),
        ]),
      }),
    }),
    Object.freeze({
      inputId: 'seller-a', templateType: 'seller', sourceType: TRADE_SCENARIO_SOURCE_TYPES.SELLER_SUBMITTED,
      sheets: Object.freeze({
        TRADE_PROFILES: Object.freeze([Object.freeze({ TRADE_PROFILE_ID: 'TP-SELLER-A', USER_ID: 'fixture-seller-a', COUNTRY: 'Japan', CITY: 'Yokohama', ROLE_TYPE: 'seller', VERIFICATION_STATUS: 'PENDING_REVIEW', NOTES: 'Synthetic seller A.' })]),
        IMPORT_QUOTES: Object.freeze([Object.freeze({ QUOTE_ID: 'Q-ALPHARD-A', IMPORT_ORDER_ID: 'DIO-ALPHARD-001', SELLER_TRADE_PROFILE_ID: 'TP-SELLER-A', QUOTE_AMOUNT: 2200000, QUOTE_CURRENCY: 'JPY', STATUS: 'SUBMITTED', VALID_UNTIL: '2026-10-31', LEAD_TIME_DAYS: 21, INCLUSIONS: 'Vehicle sourcing; export preparation', EXCLUSIONS: 'Destination duties; inland Zimbabwe delivery', NOTES: 'Synthetic quote A.' })]),
      }),
    }),
    Object.freeze({
      inputId: 'seller-b', templateType: 'seller', sourceType: TRADE_SCENARIO_SOURCE_TYPES.SELLER_SUBMITTED,
      sheets: Object.freeze({
        TRADE_PROFILES: Object.freeze([Object.freeze({ TRADE_PROFILE_ID: 'TP-SELLER-B', USER_ID: 'fixture-seller-b', COUNTRY: 'Japan', CITY: 'Nagoya', ROLE_TYPE: 'seller', VERIFICATION_STATUS: 'PENDING_REVIEW', NOTES: 'Synthetic seller B.' })]),
        IMPORT_QUOTES: Object.freeze([Object.freeze({ QUOTE_ID: 'Q-ALPHARD-B', IMPORT_ORDER_ID: 'DIO-ALPHARD-001', SELLER_TRADE_PROFILE_ID: 'TP-SELLER-B', QUOTE_AMOUNT: 2050000, QUOTE_CURRENCY: 'JPY', STATUS: 'EXPIRED', VALID_UNTIL: '2026-08-31', LEAD_TIME_DAYS: 28, NOTES: 'Synthetic expired quote used to prove history is retained.' })]),
      }),
    }),
    Object.freeze({
      inputId: 'seller-c', templateType: 'seller', sourceType: TRADE_SCENARIO_SOURCE_TYPES.SELLER_SUBMITTED,
      sheets: Object.freeze({
        TRADE_PROFILES: Object.freeze([Object.freeze({ TRADE_PROFILE_ID: 'TP-SELLER-C', USER_ID: 'fixture-seller-c', COUNTRY: 'Japan', CITY: 'Kobe', ROLE_TYPE: 'seller', VERIFICATION_STATUS: 'PENDING_REVIEW', NOTES: 'Synthetic seller C.' })]),
        IMPORT_QUOTES: Object.freeze([Object.freeze({ QUOTE_ID: 'Q-ALPHARD-C', IMPORT_ORDER_ID: 'DIO-ALPHARD-001', SELLER_TRADE_PROFILE_ID: 'TP-SELLER-C', QUOTE_AMOUNT: 15100, QUOTE_CURRENCY: 'USD', STATUS: 'REJECTED', VALID_UNTIL: '2026-10-15', LEAD_TIME_DAYS: 18, NOTES: 'Synthetic rejected quote used to prove competing history is preserved.' })]),
      }),
    }),
  ]),
});

const PARTS_SCENARIO = Object.freeze({
  manifest: Object.freeze({
    scenarioId: TRADE_SCENARIO_IDS.PARTS_CONTAINER,
    title: 'Parts procurement — Hiace service parts to Harare',
    description: 'Bulk parts demand using legacy-derived structural references and competing supplier quotes.',
    scenarioVersion: 1,
    workbookSchemaVersion: '2026.09.t5-scenarios.xlsx-v2',
    environmentClass: 'NON_PRODUCTION',
    fixtureClass: TRADE_SCENARIO_FIXTURE_CLASSES.TEST_FIXTURE,
    allowedEnvironments: DEFAULT_SCENARIO_ALLOWED_ENVIRONMENTS,
    tags: Object.freeze(['T5', 'parts', 'supplier', 'legacy-fixture', 'Japan', 'Zimbabwe']),
    referencePackDependencies: Object.freeze(['REF-T5-BUYER-PARTS-V1', 'REF-UMZ-PARTS-CLEAN-V1']),
    expectedEntityCounts: Object.freeze({ DIASPORA_IMPORT_ORDERS: 1, IMPORT_QUOTES: 2, TRADE_PROFILES: 3 }),
    resetPolicy: 'ISOLATED_SCENARIO_NAMESPACE',
    sourceProvenance: Object.freeze({ sourceType: TRADE_SCENARIO_SOURCE_TYPES.LEGACY_WORKBOOK, fixtureClass: TRADE_SCENARIO_FIXTURE_CLASSES.TEST_FIXTURE }),
    productionForbidden: true,
    assertions: Object.freeze([
      Object.freeze({ id: 'P1', type: TRADE_SCENARIO_ASSERTION_TYPES.DRY_RUN_CAN_IMPORT, expected: true }),
      Object.freeze({ id: 'P2', type: TRADE_SCENARIO_ASSERTION_TYPES.QUOTE_COUNT_FOR_ORDER, orderId: 'DIO-PARTS-001', expected: 2 }),
      Object.freeze({ id: 'P3', type: TRADE_SCENARIO_ASSERTION_TYPES.QUOTE_CURRENCY, quoteId: 'Q-PARTS-A', expected: 'JPY' }),
      Object.freeze({ id: 'P4', type: TRADE_SCENARIO_ASSERTION_TYPES.ORDER_SERVICE_SCOPE, orderId: 'DIO-PARTS-001', expected: 'PARTS_PROCUREMENT' }),
      Object.freeze({ id: 'P5', type: TRADE_SCENARIO_ASSERTION_TYPES.IMPORT_PLAN_BLOCKED_COUNT, expected: 0 }),
      Object.freeze({ id: 'P6', type: TRADE_SCENARIO_ASSERTION_TYPES.PRODUCTION_FORBIDDEN, expected: true }),
    ]),
    postImportAssertions: Object.freeze([
      'Supplier quote comparison preserves original currency, amount and lead-time facts.',
      'Legacy-derived part references remain TEST_FIXTURE / UNVERIFIED until separately verified.',
      'Container capacity is added in the governed container/cost phases rather than fabricated here.',
    ]),
  }),
  workbooks: Object.freeze([
    Object.freeze({
      inputId: 'buyer', templateType: 'buyer', sourceType: TRADE_SCENARIO_SOURCE_TYPES.BUYER_SUBMITTED,
      sheets: Object.freeze({
        DIASPORA_IMPORT_ORDERS: Object.freeze([Object.freeze({
          IMPORT_ORDER_ID: 'DIO-PARTS-001', BUYER_TRADE_PROFILE_ID: 'TP-BUYER-PARTS', ORDER_TYPE: 'parts_import', SERVICE_SCOPE: 'PARTS_PROCUREMENT',
          ORIGIN_COUNTRY: 'Japan', DESTINATION_COUNTRY: 'Zimbabwe', DESTINATION_CITY: 'Harare', STATUS: 'IMPORT_REQUESTED', BUDGET_CURRENCY: 'USD',
          BUDGET_AMOUNT: 4500, PART_ID: 'UMZ-HIACE-BRAKE-PAD-001', REQUESTED_MAKE: 'Toyota', REQUESTED_MODEL: 'Hiace',
          NOTES: 'Synthetic demand: 20 brake-pad sets plus related Hiace KDH201 service parts. Reference data is legacy-derived fixture data only.',
        })]),
      }),
    }),
    Object.freeze({
      inputId: 'supplier-a', templateType: 'supplier', sourceType: TRADE_SCENARIO_SOURCE_TYPES.SUPPLIER_SUBMITTED,
      sheets: Object.freeze({
        TRADE_PROFILES: Object.freeze([Object.freeze({ TRADE_PROFILE_ID: 'TP-SUPPLIER-A', USER_ID: 'fixture-supplier-a', COUNTRY: 'Japan', CITY: 'Osaka', ROLE_TYPE: 'supplier', VERIFICATION_STATUS: 'PENDING_REVIEW', NOTES: 'Synthetic parts supplier A.' })]),
        IMPORT_QUOTES: Object.freeze([Object.freeze({ QUOTE_ID: 'Q-PARTS-A', IMPORT_ORDER_ID: 'DIO-PARTS-001', SELLER_TRADE_PROFILE_ID: 'TP-SUPPLIER-A', QUOTE_AMOUNT: 420000, QUOTE_CURRENCY: 'JPY', STATUS: 'SUBMITTED', VALID_UNTIL: '2026-10-31', LEAD_TIME_DAYS: 12, INCLUSIONS: 'MOQ 20 brake-pad sets; export packing', EXCLUSIONS: 'International freight', NOTES: 'Synthetic supplier A response.' })]),
      }),
    }),
    Object.freeze({
      inputId: 'supplier-b', templateType: 'supplier', sourceType: TRADE_SCENARIO_SOURCE_TYPES.SUPPLIER_SUBMITTED,
      sheets: Object.freeze({
        TRADE_PROFILES: Object.freeze([Object.freeze({ TRADE_PROFILE_ID: 'TP-SUPPLIER-B', USER_ID: 'fixture-supplier-b', COUNTRY: 'Japan', CITY: 'Saitama', ROLE_TYPE: 'supplier', VERIFICATION_STATUS: 'PENDING_REVIEW', NOTES: 'Synthetic parts supplier B.' })]),
        IMPORT_QUOTES: Object.freeze([Object.freeze({ QUOTE_ID: 'Q-PARTS-B', IMPORT_ORDER_ID: 'DIO-PARTS-001', SELLER_TRADE_PROFILE_ID: 'TP-SUPPLIER-B', QUOTE_AMOUNT: 3050, QUOTE_CURRENCY: 'USD', STATUS: 'SUBMITTED', VALID_UNTIL: '2026-10-20', LEAD_TIME_DAYS: 20, INCLUSIONS: 'Mixed Hiace service-parts bundle', EXCLUSIONS: 'Freight; customs; final delivery', NOTES: 'Synthetic supplier B response.' })]),
      }),
    }),
  ]),
});

const BYO_SCENARIO = Object.freeze({
  manifest: Object.freeze({
    scenarioId: TRADE_SCENARIO_IDS.BYO_VEHICLE_SHIPPING,
    title: 'Bring Your Own Vehicle — shipping-only Japan to Zimbabwe',
    description: 'Customer already owns the vehicle and requests logistics service without CarUp vehicle procurement.',
    scenarioVersion: 1,
    workbookSchemaVersion: '2026.09.t5-scenarios.xlsx-v2',
    environmentClass: 'NON_PRODUCTION',
    fixtureClass: TRADE_SCENARIO_FIXTURE_CLASSES.TEST_FIXTURE,
    allowedEnvironments: DEFAULT_SCENARIO_ALLOWED_ENVIRONMENTS,
    tags: Object.freeze(['T5', 'vehicle', 'shipping-only', 'partial-journey', 'Japan', 'Zimbabwe']),
    referencePackDependencies: Object.freeze(['REF-T5-BUYER-BYO-V1', 'REF-VEHICLES-JP-ZW-V1']),
    expectedEntityCounts: Object.freeze({ DIASPORA_IMPORT_ORDERS: 1, IMPORT_QUOTES: 1, TRADE_PROFILES: 2 }),
    resetPolicy: 'ISOLATED_SCENARIO_NAMESPACE',
    sourceProvenance: Object.freeze({ sourceType: TRADE_SCENARIO_SOURCE_TYPES.TEST_FIXTURE, fixtureClass: TRADE_SCENARIO_FIXTURE_CLASSES.TEST_FIXTURE }),
    productionForbidden: true,
    assertions: Object.freeze([
      Object.freeze({ id: 'B1', type: TRADE_SCENARIO_ASSERTION_TYPES.DRY_RUN_CAN_IMPORT, expected: true }),
      Object.freeze({ id: 'B2', type: TRADE_SCENARIO_ASSERTION_TYPES.ORDER_SERVICE_SCOPE, orderId: 'DIO-BYO-001', expected: 'SHIPPING_ONLY' }),
      Object.freeze({ id: 'B3', type: TRADE_SCENARIO_ASSERTION_TYPES.ORDER_FIELD_PRESENT, orderId: 'DIO-BYO-001', field: 'LINKED_VEHICLE_VIN', expected: true }),
      Object.freeze({ id: 'B4', type: TRADE_SCENARIO_ASSERTION_TYPES.ORDER_FIELD_ABSENT, orderId: 'DIO-BYO-001', field: 'VEHICLE_ID', expected: true }),
      Object.freeze({ id: 'B5', type: TRADE_SCENARIO_ASSERTION_TYPES.QUOTE_COUNT_FOR_ORDER, orderId: 'DIO-BYO-001', expected: 1 }),
      Object.freeze({ id: 'B6', type: TRADE_SCENARIO_ASSERTION_TYPES.QUOTE_CURRENCY, quoteId: 'Q-BYO-LOGISTICS-A', expected: 'JPY' }),
      Object.freeze({ id: 'B7', type: TRADE_SCENARIO_ASSERTION_TYPES.IMPORT_PLAN_BLOCKED_COUNT, expected: 0 }),
      Object.freeze({ id: 'B8', type: TRADE_SCENARIO_ASSERTION_TYPES.PRODUCTION_FORBIDDEN, expected: true }),
    ]),
    postImportAssertions: Object.freeze([
      'The resulting Trade Order does not require a CarUp Marketplace vehicle purchase.',
      'The vehicle ownership/authority check remains a governed service-layer responsibility before operational execution.',
      'Later T6/T11/T12 layers may attach freight, shipment and customs state without changing the sourcing contract.',
    ]),
  }),
  workbooks: Object.freeze([
    Object.freeze({
      inputId: 'buyer', templateType: 'buyer', sourceType: TRADE_SCENARIO_SOURCE_TYPES.BUYER_SUBMITTED,
      sheets: Object.freeze({
        DIASPORA_IMPORT_ORDERS: Object.freeze([Object.freeze({
          IMPORT_ORDER_ID: 'DIO-BYO-001', BUYER_TRADE_PROFILE_ID: 'TP-BUYER-BYO', ORDER_TYPE: 'vehicle_import', SERVICE_SCOPE: 'SHIPPING_ONLY',
          ORIGIN_COUNTRY: 'Japan', ORIGIN_CITY: 'Yokohama', DESTINATION_COUNTRY: 'Zimbabwe', DESTINATION_CITY: 'Harare', STATUS: 'IMPORT_REQUESTED',
          BUDGET_CURRENCY: 'USD', LINKED_VEHICLE_VIN: 'BYOJPZW00000000001', REQUESTED_MAKE: 'Nissan', REQUESTED_MODEL: 'Elgrand', REQUESTED_YEAR_MIN: 2018,
          NOTES: 'Synthetic customer-owned vehicle. No CarUp vehicle procurement is requested.',
        })]),
      }),
    }),
    Object.freeze({
      inputId: 'logistics-provider-a', templateType: 'supplier', sourceType: TRADE_SCENARIO_SOURCE_TYPES.LOGISTICS_PROVIDER_SUBMITTED,
      sheets: Object.freeze({
        TRADE_PROFILES: Object.freeze([Object.freeze({ TRADE_PROFILE_ID: 'TP-LOGISTICS-A', USER_ID: 'fixture-logistics-a', COUNTRY: 'Japan', CITY: 'Yokohama', ROLE_TYPE: 'logistics_partner', VERIFICATION_STATUS: 'PENDING_REVIEW', NOTES: 'Synthetic logistics provider.' })]),
        IMPORT_QUOTES: Object.freeze([Object.freeze({ QUOTE_ID: 'Q-BYO-LOGISTICS-A', IMPORT_ORDER_ID: 'DIO-BYO-001', SELLER_TRADE_PROFILE_ID: 'TP-LOGISTICS-A', QUOTE_AMOUNT: 245000, QUOTE_CURRENCY: 'JPY', STATUS: 'SUBMITTED', VALID_UNTIL: '2026-10-31', LEAD_TIME_DAYS: 35, INCLUSIONS: 'Origin handling; ocean freight estimate', EXCLUSIONS: 'Zimbabwe duty; final inland delivery', NOTES: 'Synthetic shipping-only quote; not a live freight rate.' })]),
      }),
    }),
  ]),
});

export const TRADE_SCENARIOS = Object.freeze({
  [TRADE_SCENARIO_IDS.ALPHARD_HARARE]: ALPHARD_SCENARIO,
  [TRADE_SCENARIO_IDS.PARTS_CONTAINER]: PARTS_SCENARIO,
  [TRADE_SCENARIO_IDS.BYO_VEHICLE_SHIPPING]: BYO_SCENARIO,
});
