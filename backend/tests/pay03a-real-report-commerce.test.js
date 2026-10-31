import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.CARUP_ENV = 'test';
process.env.CARUP_PAY01A_ENABLED = 'true';
process.env.CARUP_PAY02_ENABLED = 'true';
process.env.CARUP_PAY03A_ENABLED = 'true';
process.env.CARUP_PAY01A_STRIPE_ACCOUNT_ID = 'acct_1UVnGaEjgXqvlsJk';
process.env.CARUP_PAY01A_STRIPE_SECRET_KEY = 'sk_test_pay03a_deterministic_fixture_key';
process.env.CARUP_PAY01A_STRIPE_WEBHOOK_SECRET = 'whsec_pay03adeterministicwebhooksecret';
process.env.CARUP_PAY01A_RETURN_ORIGIN = 'http://localhost:5173';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-fixture-only';

const {
  PAY03A_DELIVERABLE_COMPARISON,
  listEligibleReportVehicles,
  inspectVehicleReportReadiness,
  createPay03aReportCheckout,
  listPay03aBuyerOrders,
  verifyPay03aBuyerOrder,
  readPay03aBuyerReport,
  createPay03aBuyerShareLink,
  listPay03aAdminOrders,
  readPay03aAdminOrder,
  reconcileAndFulfillPay03aAdminOrder,
  refundPay03aAdminOrder,
} = await import('../services/payment/pay03aReportCommerceService.js');

const {
  reviewPay02GovernanceProposal,
  deliverVerifiedVehicleHistoryReport,
} = await import('../services/payment/pay02Service.js');

const { processPay01aWebhook } = await import('../services/payment/pay01aService.js');
const {
  assembleReport,
  createShareLink,
  getReportByShareToken,
} = await import('../services/report/reportService.js');
const { supabase } = await import('../db/supabase.js');
const pay03aRoutes = (await import('../routes/pay03aRoutes.js')).default;

function createInMemoryPay03aHarness() {
  const vehicles = new Map([
    [
      'WBA3A5C51DF358101',
      {
        vin: 'WBA3A5C51DF358101',
        make: 'BMW',
        model: '320i',
        generation: 'F30',
        trim: 'M Sport',
        year: 2019,
        color: 'Alpine White',
        mileage: 54200,
        fuel_type: 'Petrol',
        transmission: 'Automatic',
        import_source: 'Japan (Yokohama)',
        duty_paid: true,
        police_verified: true,
        status: 'Available',
        trust_score: 91.5,
        specifications: {
          pay03a_synthetic_fixture: true,
          fixture_authority: 'backend/tests/sql/fixtures/pay03a-synthetic-vehicle-fixtures.sql',
        },
      },
    ],
    [
      'JTDBR32E820112202',
      {
        vin: 'JTDBR32E820112202',
        make: 'Toyota',
        model: 'Hilux',
        generation: 'AN120',
        trim: 'GD-6 Double Cab',
        year: 2021,
        color: 'Silver Metallic',
        mileage: 68400,
        fuel_type: 'Diesel',
        transmission: 'Automatic',
        import_source: 'Japan (Nagoya)',
        duty_paid: true,
        police_verified: true,
        status: 'Available',
        trust_score: 94.0,
        specifications: {
          pay03a_synthetic_fixture: true,
          fixture_authority: 'backend/tests/sql/fixtures/pay03a-synthetic-vehicle-fixtures.sql',
        },
      },
    ],
    [
      'DBA-GRS204-0005303',
      {
        vin: 'DBA-GRS204-0005303',
        make: 'Toyota',
        model: 'Crown Athlete',
        generation: 'S200',
        trim: '3.5G Package',
        year: 2011,
        color: 'Black',
        mileage: 112500,
        fuel_type: 'Petrol',
        transmission: 'Automatic',
        import_source: 'Japan (Osaka)',
        duty_paid: true,
        police_verified: true,
        status: 'Available',
        trust_score: 88.0,
        specifications: {
          pay03a_synthetic_fixture: true,
          pay03a_fixture_role: 'metadata_only_ineligible_control',
        },
      },
    ],
  ]);

  const vehicleEvidence = [
    {
      id: 'ev-wba-1',
      vin: 'WBA3A5C51DF358101',
      evidence_type: 'export_inspection_certificate',
      evidence_class: 'inspection',
      title: 'JEVIC Pre-Export Odometer & Structural Inspection (Yokohama)',
      source_type: 'inspection_agency',
      verification_status: 'verified',
      visibility_level: 'public_safe',
      odometer_value: 53800,
      odometer_unit: 'km',
      event_date: '2026-08-15',
      captured_at: '2026-08-15T09:30:00Z',
    },
    {
      id: 'ev-jtd-1',
      vin: 'JTDBR32E820112202',
      evidence_type: 'export_inspection_certificate',
      evidence_class: 'inspection',
      title: 'JAAI Pre-Shipment Roadworthiness Inspection (Nagoya)',
      source_type: 'inspection_agency',
      verification_status: 'verified',
      visibility_level: 'public_safe',
      odometer_value: 68100,
      odometer_unit: 'km',
      event_date: '2026-09-01',
      captured_at: '2026-09-01T10:00:00Z',
    },
  ];

  const quotes = new Map();
  const quotesByPayerIdem = new Map();
  const payments = new Map();
  const paymentsByActorKey = new Map();
  const reportOrders = new Map();
  const reportOrdersByQuote = new Map();
  const reportVersions = new Map();
  const seenWebhookEvents = new Set();
  const faultInjection = {
    failOrderLookup: false,
    failPaymentLookup: false,
    failNextFulfillmentRpc: false,
  };

  const sessions = new Map([
    ['tok-buyer-1', { user_id: 'buyer-03a-1', is_valid: true, expires_at: '2099-01-01T00:00:00Z' }],
    ['tok-buyer-2', { user_id: 'buyer-03a-2', is_valid: true, expires_at: '2099-01-01T00:00:00Z' }],
    ['tok-admin-1', { user_id: 'admin-03a-1', is_valid: true, expires_at: '2099-01-01T00:00:00Z' }],
  ]);
  const users = new Map([
    ['buyer-03a-1', { id: 'buyer-03a-1', role: 'buyer', is_verified: true }],
    ['buyer-03a-2', { id: 'buyer-03a-2', role: 'buyer', is_verified: true }],
    ['admin-03a-1', { id: 'admin-03a-1', role: 'admin', is_verified: true }],
  ]);

  let quoteSeq = 0;
  let orderSeq = 0;
  let paymentSeq = 0;
  let versionSeq = 0;

  const stripeState = {
    accountId: 'acct_1UVnGaEjgXqvlsJk',
    sessions: new Map(),
    intents: new Map(),
    refundsByIntent: new Map(),
    checkoutSeq: 0,
    intentSeq: 0,
    refundSeq: 0,
  };

  const stripeMock = {
    accounts: {
      retrieve: async () => ({ id: stripeState.accountId }),
    },
    checkout: {
      sessions: {
        create: async (payload) => {
          stripeState.checkoutSeq += 1;
          const id = `cs_test_pay03a_${stripeState.checkoutSeq}`;
          const sessionObj = {
            id,
            url: `https://checkout.stripe.com/c/pay/${id}`,
            mode: payload.mode,
            livemode: false,
            client_reference_id: payload.client_reference_id,
            metadata: payload.metadata,
            currency: payload.line_items[0].price_data.currency,
            amount_total: payload.line_items[0].price_data.unit_amount,
            payment_status: 'unpaid',
            status: 'open',
            payment_intent: null,
          };
          stripeState.sessions.set(id, sessionObj);
          return sessionObj;
        },
        retrieve: async (id) => {
          const s = stripeState.sessions.get(id);
          if (!s) throw new Error('checkout_not_found');
          return s;
        },
      },
    },
    paymentIntents: {
      retrieve: async (id) => {
        const pi = stripeState.intents.get(id);
        if (!pi) throw new Error('intent_not_found');
        return pi;
      },
    },
    refunds: {
      list: async ({ payment_intent }) => ({
        has_more: false,
        data: stripeState.refundsByIntent.get(payment_intent) || [],
      }),
      create: async ({ payment_intent, metadata }) => {
        const existing = stripeState.refundsByIntent.get(payment_intent) || [];
        if (existing.length > 0) return existing[0];
        stripeState.refundSeq += 1;
        const refund = {
          id: `re_test_pay03a_${stripeState.refundSeq}`,
          payment_intent,
          amount: 100,
          currency: 'jpy',
          status: 'succeeded',
          livemode: false,
          metadata,
        };
        stripeState.refundsByIntent.set(payment_intent, [refund]);
        return refund;
      },
    },
    webhooks: {
      constructEvent: (rawBody, signature) => {
        if (signature !== 'valid_sig') throw new Error('bad_signature');
        return JSON.parse(rawBody.toString('utf8'));
      },
    },
    markCheckoutPaid(checkoutId) {
      const s = stripeState.sessions.get(checkoutId);
      stripeState.intentSeq += 1;
      const intentId = `pi_test_pay03a_${stripeState.intentSeq}`;
      const intent = {
        id: intentId,
        livemode: false,
        metadata: s.metadata,
        currency: 'jpy',
        amount: 100,
        amount_received: 100,
        status: 'succeeded',
      };
      stripeState.intents.set(intentId, intent);
      s.payment_status = 'paid';
      s.status = 'complete';
      s.payment_intent = intentId;
      return { session: s, intent };
    },
    markCheckoutExpired(checkoutId) {
      const s = stripeState.sessions.get(checkoutId);
      s.payment_status = 'unpaid';
      s.status = 'expired';
      return s;
    },
  };

  function makeSelectQuery(table) {
    const filters = [];
    const builder = {
      eq(col, val) {
        filters.push([col, val]);
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      async maybeSingle() {
        if (table === 'pay02_report_orders' && faultInjection.failOrderLookup) {
          return { data: null, error: { message: 'simulated_order_lookup_failure' } };
        }
        if (table === 'payment_transactions' && faultInjection.failPaymentLookup) {
          return { data: null, error: { message: 'simulated_payment_lookup_failure' } };
        }
        const rows = await resolveRows();
        return { data: rows[0] || null, error: null };
      },
      async single() {
        const rows = await resolveRows();
        return { data: rows[0] || null, error: null };
      },
      then(onFulfilled, onRejected) {
        if (table === 'pay02_report_orders' && faultInjection.failOrderLookup) {
          return Promise.resolve({
            data: null,
            error: { message: 'simulated_order_lookup_failure' },
          }).then(onFulfilled, onRejected);
        }
        if (table === 'payment_transactions' && faultInjection.failPaymentLookup) {
          return Promise.resolve({
            data: null,
            error: { message: 'simulated_payment_lookup_failure' },
          }).then(onFulfilled, onRejected);
        }
        return resolveRows()
          .then((data) => ({ data, error: null }))
          .then(onFulfilled, onRejected);
      },
    };

    async function resolveRows() {
      let rows = [];
      if (table === 'vehicles') rows = Array.from(vehicles.values());
      else if (table === 'vehicle_evidence') rows = vehicleEvidence.slice();
      else if (table === 'pay02_commercial_quotes') rows = Array.from(quotes.values());
      else if (table === 'payment_transactions') rows = Array.from(payments.values());
      else if (table === 'pay02_report_orders') rows = Array.from(reportOrders.values());
      else if (table === 'report_versions') rows = Array.from(reportVersions.values());
      else if (table === 'user_sessions') {
        const tokenFilter = filters.find(([k]) => k === 'token');
        const sess = tokenFilter ? sessions.get(tokenFilter[1]) : null;
        return sess ? [sess] : [];
      } else if (table === 'users') {
        const idFilter = filters.find(([k]) => k === 'id');
        const u = idFilter ? users.get(idFilter[1]) : null;
        return u ? [u] : [];
      } else {
        rows = [];
      }
      for (const [col, val] of filters) {
        rows = rows.filter((r) => r && r[col] === val);
      }
      return rows;
    }

    return builder;
  }

  const db = {
    from(table) {
      return {
        select() {
          return makeSelectQuery(table);
        },
        insert(row) {
          return {
            async select() {
              if (table === 'report_versions') {
                versionSeq += 1;
                const created = {
                  id: `00000000-0000-4000-8000-00000000090${versionSeq}`,
                  revoked: false,
                  ...row,
                };
                reportVersions.set(created.id, created);
                return { data: [created], error: null };
              }
              return { data: [row], error: null };
            },
          };
        },
        update(patch) {
          return {
            eq(col, val) {
              const applyUpdate = () => {
                let targetMap = null;
                if (table === 'report_versions') targetMap = reportVersions;
                else if (table === 'pay02_report_orders') targetMap = reportOrders;
                else if (table === 'pay02_commercial_quotes') targetMap = quotes;
                if (!targetMap) return null;
                for (const [k, existing] of targetMap.entries()) {
                  if (existing[col] === val) {
                    const updated = { ...existing, ...patch };
                    targetMap.set(k, updated);
                    return updated;
                  }
                }
                return null;
              };
              const updatedRow = applyUpdate();
              return {
                select() {
                  const resPromise = Promise.resolve({
                    data: updatedRow ? [updatedRow] : [],
                    error: updatedRow ? null : { message: 'update_matched_zero_rows' },
                  });
                  resPromise.maybeSingle = async () => ({
                    data: updatedRow,
                    error: updatedRow ? null : { message: 'update_matched_zero_rows' },
                  });
                  return resPromise;
                },
                then(onFulfilled, onRejected) {
                  return Promise.resolve({
                    data: updatedRow,
                    error: updatedRow ? null : { message: 'update_matched_zero_rows' },
                  }).then(onFulfilled, onRejected);
                },
              };
            },
          };
        },
      };
    },
    async rpc(fnName, args) {
      if (fnName === 'pay02_issue_commercial_quote') {
        const key = `${args.p_payer_id}:${args.p_idempotency_key}`;
        const existing = quotesByPayerIdem.get(key);
        if (existing) {
          if (existing.source_object_id !== args.p_source_object_id) {
            return { data: null, error: { message: 'PAY02_QUOTE_IDEMPOTENCY_CONFLICT' } };
          }
          return { data: { ...existing, idempotent_replay: true }, error: null };
        }
        quoteSeq += 1;
        const created = {
          id: `00000000-0000-4000-8000-00000000010${quoteSeq}`,
          quote_number: args.p_quote_number,
          product_code: args.p_product_code,
          product_version: args.p_product_version,
          commercial_category: 'category_a_first_party',
          source_object_type: args.p_source_object_type,
          source_object_id: args.p_source_object_id,
          payer_id: args.p_payer_id,
          payer_role: args.p_payer_role,
          contractual_seller: 'carup_japan',
          legal_beneficiary: 'carup_japan',
          merchant_of_record: 'carup_japan',
          funds_owner: 'carup_japan',
          revenue_beneficiary: 'carup_japan',
          currency: args.p_currency,
          currency_scale: args.p_currency_scale,
          total_minor: args.p_total_minor,
          selected_provider: args.p_selected_provider,
          idempotency_key: args.p_idempotency_key,
          payment_reference: null,
          status: 'issued',
          idempotent_replay: false,
        };
        quotes.set(created.id, created);
        quotesByPayerIdem.set(key, created);
        return { data: created, error: null };
      }

      if (fnName === 'pay02_claim_quote_checkout') {
        const q = quotes.get(args.p_quote_id);
        if (!q || q.payer_id !== args.p_actor_id) {
          return { data: null, error: { message: 'PAY02_QUOTE_OWNERSHIP_REFUSED' } };
        }
        const actorKey = `${args.p_actor_id}:${args.p_request_key}`;
        let pay = paymentsByActorKey.get(actorKey);
        if (!pay) {
          paymentSeq += 1;
          const ref = `pay01a_00000000-0000-4000-8000-00000000020${paymentSeq}`;
          pay = {
            reference: ref,
            gateway: 'stripe_carup_japan_sandbox',
            amount: q.total_minor,
            currency: q.currency,
            status: 'pending',
            pay01a_actor_id: q.payer_id,
            pay01a_request_key: args.p_request_key,
            pay01a_account_id: 'acct_1UVnGaEjgXqvlsJk',
            pay01a_checkout_id: null,
            pay01a_intent_id: null,
            pay01a_refund_id: null,
            pay02_quote_id: q.id,
            pay02_product_code: q.product_code,
            pay02_product_version: q.product_version,
            pay02_commercial_category: q.commercial_category,
            pay02_funds_owner: q.funds_owner,
            pay02_legal_beneficiary: q.legal_beneficiary,
            pay02_settlement_status: 'not_applicable_sandbox',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          payments.set(ref, pay);
          paymentsByActorKey.set(actorKey, pay);
        }
        q.payment_reference = pay.reference;
        q.status = 'payment_initiated';

        let ord = reportOrdersByQuote.get(q.id);
        if (!ord) {
          orderSeq += 1;
          ord = {
            id: `00000000-0000-4000-8000-00000000030${orderSeq}`,
            product_code: q.product_code,
            product_version: q.product_version,
            buyer_id: q.payer_id,
            quote_id: q.id,
            vehicle_id: q.source_object_id,
            vin: q.source_object_id,
            payment_reference: pay.reference,
            entitlement_status: 'awaiting_payment',
            report_version_id: null,
            report_version_number: null,
            report_content_hash: null,
            completeness_summary: null,
            granted_at: null,
            revoked_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          reportOrders.set(ord.id, ord);
          reportOrdersByQuote.set(q.id, ord);
        }
        return {
          data: {
            ...pay,
            pay02_quote_id: q.id,
            quote_number: q.quote_number,
            quote_status: q.status,
            pay02_report_order_id: ord.id,
          },
          error: null,
        };
      }

      if (fnName === 'pay01a_attach_checkout') {
        const pay = payments.get(args.p_reference);
        if (!pay) return { data: null, error: { message: 'not_found' } };
        pay.pay01a_checkout_id = args.p_checkout_id;
        pay.updated_at = new Date().toISOString();
        return { data: pay, error: null };
      }

      if (fnName === 'pay01a_apply_provider_snapshot') {
        const pay = payments.get(args.p_reference);
        if (!pay) return { data: null, error: { message: 'not_found' } };
        const duplicateEvent = Boolean(args.p_event_id && seenWebhookEvents.has(args.p_event_id));
        if (args.p_event_id) seenWebhookEvents.add(args.p_event_id);
        pay.status = args.p_status;
        if (args.p_intent_id) pay.pay01a_intent_id = args.p_intent_id;
        if (args.p_refund_id) pay.pay01a_refund_id = args.p_refund_id;
        pay.updated_at = new Date().toISOString();
        return { data: { ...pay, duplicate_event: duplicateEvent }, error: null };
      }

      if (fnName === 'pay01a_begin_refund') {
        const pay = payments.get(args.p_reference);
        if (!pay) return { data: null, error: { message: 'not_found' } };
        pay.status = 'refund_pending';
        return { data: pay, error: null };
      }

      if (fnName === 'pay02_sync_quote_from_canonical_payment') {
        const pay = payments.get(args.p_reference);
        if (!pay) return { data: null, error: { message: 'PAY02_CANONICAL_PAYMENT_NOT_FOUND' } };
        const q = quotes.get(pay.pay02_quote_id);
        if (!q) return { data: null, error: null };
        const ord = reportOrdersByQuote.get(q.id);
        if (pay.status === 'paid') {
          if (q.status !== 'fulfilled') q.status = 'paid_verified';
          if (ord && ord.entitlement_status !== 'revoked_refunded') {
            ord.entitlement_status = 'entitled';
            ord.granted_at = ord.granted_at || new Date().toISOString();
          }
        } else if (pay.status === 'refund_pending') {
          if (ord && ord.entitlement_status !== 'revoked_refunded') {
            ord.entitlement_status = 'refund_suspended';
            if (ord.report_version_id && reportVersions.has(ord.report_version_id)) {
              reportVersions.get(ord.report_version_id).revoked = true;
            }
          }
        } else if (pay.status === 'refunded') {
          q.status = 'refunded';
          if (ord) {
            ord.entitlement_status = 'revoked_refunded';
            ord.revoked_at = ord.revoked_at || new Date().toISOString();
            if (ord.report_version_id && reportVersions.has(ord.report_version_id)) {
              reportVersions.get(ord.report_version_id).revoked = true;
            }
          }
        } else if (pay.status === 'cancelled') {
          q.status = 'cancelled';
        }
        return {
          data: {
            quote_id: q.id,
            quote_number: q.quote_number,
            quote_status: q.status,
            payment_reference: pay.reference,
            payment_status: pay.status,
            report_order_id: ord?.id || null,
            report_entitlement_status: ord?.entitlement_status || null,
            vin: ord?.vin || null,
          },
          error: null,
        };
      }

      if (fnName === 'pay03a_complete_report_fulfillment') {
        if (faultInjection.failNextFulfillmentRpc) {
          faultInjection.failNextFulfillmentRpc = false;
          return { data: null, error: { message: 'simulated_transient_fulfillment_rpc_failure' } };
        }
        const ord = reportOrders.get(args.p_order_id);
        if (!ord) return { data: null, error: { message: 'PAY02_PILOT_ENTITLEMENT_NOT_ACTIVE' } };
        const q = quotes.get(ord.quote_id);
        const pay = payments.get(ord.payment_reference);
        if (
          ord.buyer_id !== args.p_buyer_id
          || ord.vin !== args.p_vin
          || q.payer_id !== args.p_buyer_id
          || pay.pay01a_actor_id !== args.p_buyer_id
        ) {
          return { data: null, error: { message: 'PAY02_PILOT_ORDER_CORRELATION_MISMATCH' } };
        }
        if (pay.status === 'refund_pending' || ord.entitlement_status === 'refund_suspended') {
          return { data: null, error: { message: 'PAY02_PILOT_ENTITLEMENT_SUSPENDED_ON_REFUND_PENDING' } };
        }
        if (pay.status === 'refunded' || ord.entitlement_status === 'revoked_refunded') {
          return { data: null, error: { message: 'PAY02_PILOT_ENTITLEMENT_REVOKED_ON_REFUND' } };
        }
        if (pay.status !== 'paid' || ord.entitlement_status !== 'entitled') {
          return { data: null, error: { message: 'PAY02_PILOT_ENTITLEMENT_NOT_ACTIVE' } };
        }
        if (ord.report_version_id) {
          const existingVer = reportVersions.get(ord.report_version_id);
          return {
            data: {
              order_id: ord.id,
              quote_id: q.id,
              quote_status: q.status,
              payment_reference: pay.reference,
              report_version_id: existingVer.id,
              report_version_number: existingVer.version,
              report_content_hash: existingVer.content_hash,
              completeness_summary: existingVer.completeness,
              payload: existingVer.payload,
              idempotent_replay: true,
            },
            error: null,
          };
        }
        versionSeq += 1;
        const verRow = {
          id: `00000000-0000-4000-8000-00000000090${versionSeq}`,
          vin: args.p_vin,
          version: versionSeq,
          generated_at: new Date().toISOString(),
          payload: args.p_payload,
          content_hash: args.p_content_hash,
          completeness: args.p_completeness,
          report_tier: 'pay03a_commercial_snapshot',
          pay03a_order_id: ord.id,
          share_token: null,
          share_expires_at: null,
          revoked: false,
          correction_notice: null,
        };
        reportVersions.set(verRow.id, verRow);
        ord.report_version_id = verRow.id;
        ord.report_version_number = verRow.version;
        ord.report_content_hash = verRow.content_hash;
        ord.completeness_summary = verRow.completeness;
        q.status = 'fulfilled';
        return {
          data: {
            order_id: ord.id,
            quote_id: q.id,
            quote_status: q.status,
            payment_reference: pay.reference,
            report_version_id: verRow.id,
            report_version_number: verRow.version,
            report_content_hash: verRow.content_hash,
            completeness_summary: verRow.completeness,
            payload: verRow.payload,
            idempotent_replay: false,
          },
          error: null,
        };
      }

      return { data: null, error: { message: `unknown_rpc_${fnName}` } };
    },
  };

  return {
    db,
    stripeMock,
    vehicles,
    quotes,
    payments,
    reportOrders,
    reportVersions,
    faultInjection,
  };
}

test('PAY03A Section 7: Pre-Checkout Contract Hardening (atomic governance RPC, mandatory non-null correlation, concurrency-safe fulfillment, and DB update failure handling)', async () => {
  // 7.1 Operational approval fails closed if atomic RPC is unavailable
  await assert.rejects(
    reviewPay02GovernanceProposal({
      proposalId: 'prop-1',
      reviewerId: 'admin-2',
      reviewerRole: 'admin',
      decision: 'approved',
      db: { from: () => ({}) }, // no db.rpc
    }),
    /PAY02_ATOMIC_GOVERNANCE_RPC_REQUIRED/,
  );

  // 7.2 Mandatory non-null correlation: missing quote.payment_reference or payment.pay02_quote_id or payment.pay01a_account_id fails closed
  const baseQuote = {
    id: 'quote-uuid-1',
    quote_number: 'QT-PAY02-0000000000000001',
    product_code: 'intel.report.vehicle_history_single',
    product_version: 1,
    payer_id: 'buyer-1',
    source_object_type: 'vehicles',
    source_object_id: 'WBA3A5C51DF358101',
    payment_reference: 'pay01a_ref_1',
    total_minor: 100,
    currency: 'JPY',
  };
  const basePayment = {
    reference: 'pay01a_ref_1',
    pay02_quote_id: 'quote-uuid-1',
    gateway: 'stripe_carup_japan_sandbox',
    pay01a_account_id: 'acct_1UVnGaEjgXqvlsJk',
    pay01a_actor_id: 'buyer-1',
    amount: 100,
    currency: 'JPY',
    status: 'paid',
    pay01a_checkout_id: 'cs_test_1',
    pay01a_intent_id: 'pi_test_1',
  };
  const baseOrder = {
    id: 'order-uuid-1',
    product_code: 'intel.report.vehicle_history_single',
    product_version: 1,
    buyer_id: 'buyer-1',
    quote_id: 'quote-uuid-1',
    payment_reference: 'pay01a_ref_1',
    vin: 'WBA3A5C51DF358101',
    entitlement_status: 'entitled',
    granted_at: '2026-10-31T08:00:00Z',
    revoked_at: null,
  };
  const baseVehicle = {
    vin: 'WBA3A5C51DF358101',
    make: 'BMW',
    model: '320i',
    year: 2019,
  };

  // Null quote.payment_reference must fail closed (cannot bypass correlation check)
  await assert.rejects(
    deliverVerifiedVehicleHistoryReport({
      buyerId: 'buyer-1',
      vin: 'WBA3A5C51DF358101',
      quote: { ...baseQuote, payment_reference: null },
      canonicalPayment: basePayment,
      entitlementOrder: baseOrder,
      vehicleRecord: baseVehicle,
      db: null,
    }),
    /PAY02_PILOT_QUOTE_AUTHORITY_MISMATCH/,
  );

  // Null payment.pay02_quote_id must fail closed
  await assert.rejects(
    deliverVerifiedVehicleHistoryReport({
      buyerId: 'buyer-1',
      vin: 'WBA3A5C51DF358101',
      quote: baseQuote,
      canonicalPayment: { ...basePayment, pay02_quote_id: null },
      entitlementOrder: baseOrder,
      vehicleRecord: baseVehicle,
      db: null,
    }),
    /PAY02_PILOT_CANONICAL_PAYMENT_MISMATCH/,
  );

  // Wrong or missing pay01a_account_id must fail closed
  await assert.rejects(
    deliverVerifiedVehicleHistoryReport({
      buyerId: 'buyer-1',
      vin: 'WBA3A5C51DF358101',
      quote: baseQuote,
      canonicalPayment: { ...basePayment, pay01a_account_id: 'acct_wrong' },
      entitlementOrder: baseOrder,
      vehicleRecord: baseVehicle,
      db: null,
    }),
    /PAY02_PILOT_CANONICAL_PAYMENT_MISMATCH/,
  );

  // Null order.quote_id or order.payment_reference or mismatched product_version must fail closed
  await assert.rejects(
    deliverVerifiedVehicleHistoryReport({
      buyerId: 'buyer-1',
      vin: 'WBA3A5C51DF358101',
      quote: baseQuote,
      canonicalPayment: basePayment,
      entitlementOrder: { ...baseOrder, quote_id: null },
      vehicleRecord: baseVehicle,
      db: null,
    }),
    /PAY02_PILOT_ORDER_CORRELATION_MISMATCH/,
  );
  await assert.rejects(
    deliverVerifiedVehicleHistoryReport({
      buyerId: 'buyer-1',
      vin: 'WBA3A5C51DF358101',
      quote: baseQuote,
      canonicalPayment: basePayment,
      entitlementOrder: { ...baseOrder, product_version: 2 },
      vehicleRecord: baseVehicle,
      db: null,
    }),
    /PAY02_PILOT_ORDER_CORRELATION_MISMATCH/,
  );

  // 7.4 Missing atomic RPC or RPC failure must throw an explicit error rather than returning partial state
  const noRpcDb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  };
  await assert.rejects(
    deliverVerifiedVehicleHistoryReport({
      buyerId: 'buyer-1',
      vin: 'WBA3A5C51DF358101',
      quote: baseQuote,
      canonicalPayment: basePayment,
      entitlementOrder: baseOrder,
      vehicleRecord: baseVehicle,
      db: noRpcDb,
      reportAssembler: async (_db, vin) => ({
        vin,
        audience: 'buyer',
        identity: { vin, make: 'BMW', model: '320i' },
        completeness: { lifecycle_source_coverage: 0.75 },
        limitations: ['Explicit limitation disclosure.'],
      }),
    }),
    /PAY03A_ATOMIC_FULFILLMENT_RPC_REQUIRED/,
  );

  const failingRpcDb = {
    rpc: async () => ({
      data: null,
      error: { message: 'simulated_db_write_failure' },
    }),
  };
  await assert.rejects(
    deliverVerifiedVehicleHistoryReport({
      buyerId: 'buyer-1',
      vin: 'WBA3A5C51DF358101',
      quote: baseQuote,
      canonicalPayment: basePayment,
      entitlementOrder: baseOrder,
      vehicleRecord: baseVehicle,
      db: failingRpcDb,
      reportAssembler: async (_db, vin) => ({
        vin,
        audience: 'buyer',
        identity: { vin, make: 'BMW', model: '320i' },
        completeness: { lifecycle_source_coverage: 0.75 },
        limitations: ['Explicit limitation disclosure.'],
      }),
    }),
    /PAY02_REPORT_FULFILLMENT_PERSISTENCE_FAILED/,
  );
});

test('PAY03A Pre-Purchase Readiness & R1-B Evidence Policy: verifies real vehicle in public.vehicles, enforces historical evidence eligibility, discloses Free vs Paid deliverables, and refuses metadata-only or unknown VINs', async () => {
  const harness = createInMemoryPay03aHarness();

  const list = await listEligibleReportVehicles({ db: harness.db });
  assert.equal(list.productCode, 'intel.report.vehicle_history_single');
  assert.equal(list.vehicles.length, 3);
  assert.equal(list.vehicles[0].vin, 'WBA3A5C51DF358101');
  assert.equal(list.vehicles[0].eligibleForReport, true);
  assert.equal(list.vehicles[0].eligibilityStatus, 'eligible_evidence_backed');
  assert.equal(list.vehicles[0].isSyntheticFixture, true);
  assert.equal(list.vehicles[2].vin, 'DBA-GRS204-0005303');
  assert.equal(list.vehicles[2].eligibleForReport, false);
  assert.equal(list.vehicles[2].eligibilityStatus, 'ineligible_metadata_only_vehicle');
  assert.equal(list.vehicles[2].ineligibilityReason, 'PAY03A_INELIGIBLE_METADATA_ONLY_VEHICLE');
  assert.equal(
    list.deliverableComparison.policyStatus,
    'CANDIDATE_SANDBOX_DIFFERENTIATION_PENDING_OWNER_APPROVAL',
  );

  const readiness = await inspectVehicleReportReadiness({
    vin: 'WBA3A5C51DF358101',
    buyerId: 'buyer-03a-1',
    db: harness.db,
  });
  assert.equal(readiness.eligibleForPurchase, true);
  assert.equal(readiness.eligibilityStatus, 'eligible_evidence_backed');
  assert.equal(readiness.vehicle.vin, 'WBA3A5C51DF358101');
  assert.equal(readiness.vehicle.make, 'BMW');
  assert.equal(readiness.vehicle.isSyntheticFixture, true);
  assert.ok(readiness.readiness.historicalEventCount >= 1);
  assert.ok(readiness.readiness.evidenceIndexCount >= 1);
  assert.equal(readiness.commercialTerms.amountMinor, 100);
  assert.equal(readiness.commercialTerms.currency, 'JPY');
  assert.equal(readiness.commercialTerms.sandboxAccountId, 'acct_1UVnGaEjgXqvlsJk');
  assert.ok(readiness.readiness.limitations.length >= 1, 'Must disclose limitations before charging');
  assert.deepEqual(readiness.deliverableComparison, PAY03A_DELIVERABLE_COMPARISON);

  // R1-B: Free live route (`assembleReport`) vs Paid deliverable comparison
  const freeLiveReport = await assembleReport(harness.db, 'WBA3A5C51DF358101', { audience: 'buyer' });
  assert.equal(freeLiveReport.vin, 'WBA3A5C51DF358101');
  assert.equal(
    freeLiveReport.commercial_snapshot,
    undefined,
    'Free live route must not attach paid commercial_snapshot metadata or report_versions binding',
  );

  // R1-B: Metadata-only vehicle (`DBA-GRS204-0005303`) is marked ineligible and refused before charging
  const metadataOnlyReadiness = await inspectVehicleReportReadiness({
    vin: 'DBA-GRS204-0005303',
    buyerId: 'buyer-03a-1',
    db: harness.db,
  });
  assert.equal(metadataOnlyReadiness.eligibleForPurchase, false);
  assert.equal(metadataOnlyReadiness.eligibilityStatus, 'ineligible_metadata_only_vehicle');
  assert.equal(metadataOnlyReadiness.ineligibilityReason, 'PAY03A_INELIGIBLE_METADATA_ONLY_VEHICLE');
  assert.equal(metadataOnlyReadiness.readiness.historicalEventCount, 0);
  assert.equal(metadataOnlyReadiness.readiness.evidenceIndexCount, 0);

  await assert.rejects(
    createPay03aReportCheckout({
      buyerId: 'buyer-03a-1',
      vin: 'DBA-GRS204-0005303',
      requestKey: 'pay03a_req_metadata_only_01',
      db: harness.db,
      stripe: harness.stripeMock,
    }),
    (err) => err && err.code === 'PAY03A_INELIGIBLE_METADATA_ONLY_VEHICLE' && err.status === 422,
  );
  assert.equal(harness.quotes.size, 0, 'Must not issue a commercial quote for an ineligible metadata-only VIN');
  assert.equal(harness.payments.size, 0, 'Must not claim a payment transaction for an ineligible metadata-only VIN');

  // Unknown VIN is refused before creating a quote or charging
  await assert.rejects(
    inspectVehicleReportReadiness({
      vin: 'UNKNOWNVIN9999999',
      buyerId: 'buyer-03a-1',
      db: harness.db,
    }),
    /PAY03A_VEHICLE_NOT_FOUND/,
  );

  // Synthetic demo identifier or post-payment report version ID is refused
  await assert.rejects(
    inspectVehicleReportReadiness({
      vin: 'DEMO-VEHICLE-NOT-A-VIN',
      buyerId: 'buyer-03a-1',
      db: harness.db,
    }),
    /PAY03A_SYNTHETIC_OR_OUTPUT_ID_FORBIDDEN/,
  );
  await assert.rejects(
    inspectVehicleReportReadiness({
      vin: 'rep_ver_0001',
      buyerId: 'buyer-03a-1',
      db: harness.db,
    }),
    /PAY03A_SYNTHETIC_OR_OUTPUT_ID_FORBIDDEN/,
  );
});

test('PAY03A End-to-End Customer Journey: Quote -> Checkout -> Webhook & Manual Verify Convergence -> Single Report Version -> Share Link -> Admin Refund & Revocation', async () => {
  const harness = createInMemoryPay03aHarness();

  // 1. Refuse client price or merchant overrides on Checkout initiation
  await assert.rejects(
    createPay03aReportCheckout({
      buyerId: 'buyer-03a-1',
      vin: 'WBA3A5C51DF358101',
      requestKey: 'pay03a_req_override_0001',
      clientSubmittedAmount: 50,
      db: harness.db,
      stripe: harness.stripeMock,
    }),
    /PAY02_CLIENT_PRICE_OVERRIDE_REFUSED/,
  );

  // 2. Create governed PAY-03A Checkout for `WBA3A5C51DF358101`
  const checkoutRes = await createPay03aReportCheckout({
    buyerId: 'buyer-03a-1',
    vin: 'WBA3A5C51DF358101',
    requestKey: 'pay03a_req_valid_0000001',
    db: harness.db,
    stripe: harness.stripeMock,
  });

  assert.equal(checkoutRes.productCode, 'intel.report.vehicle_history_single');
  assert.equal(checkoutRes.vin, 'WBA3A5C51DF358101');
  assert.equal(checkoutRes.amountMinor, 100);
  assert.equal(checkoutRes.currency, 'JPY');
  assert.equal(checkoutRes.paymentStatus, 'pending');
  assert.equal(checkoutRes.entitlementStatus, 'awaiting_payment');
  assert.equal(checkoutRes.reportAvailable, false);
  assert.equal(checkoutRes.reportVersionId, null);
  assert.match(checkoutRes.checkoutUrl, /^https:\/\/checkout\.stripe\.com\//);

  // 3. Unpaid order cannot access the report (`readPay03aBuyerReport` fails closed)
  await assert.rejects(
    readPay03aBuyerReport({
      buyerId: 'buyer-03a-1',
      orderId: checkoutRes.orderId,
      db: harness.db,
      stripe: harness.stripeMock,
    }),
    /PAY02_PILOT_PAYMENT_NOT_VERIFIED_PAID/,
  );

  // 4. Mark Stripe Checkout session paid, then run both signed webhook AND manual verify to prove idempotent single-version convergence
  harness.stripeMock.markCheckoutPaid(checkoutRes.checkoutId);

  const webhookEvent = {
    id: 'evt_pay03a_test_001',
    type: 'checkout.session.completed',
    livemode: false,
    account: 'acct_1UVnGaEjgXqvlsJk',
    data: {
      object: {
        id: checkoutRes.checkoutId,
        client_reference_id: checkoutRes.paymentReference,
        metadata: {
          carup_reference: checkoutRes.paymentReference,
        },
      },
    },
  };

  const webhookResult = await processPay01aWebhook({
    rawBody: Buffer.from(JSON.stringify(webhookEvent), 'utf8'),
    signature: 'valid_sig',
    db: harness.db,
    stripe: harness.stripeMock,
  });
  assert.equal(webhookResult.verified, true);
  assert.equal(webhookResult.status, 'paid');

  // Manual verify after webhook must converge on the exact same report_version_id without creating a second version
  const verifiedOrder = await verifyPay03aBuyerOrder({
    buyerId: 'buyer-03a-1',
    orderId: checkoutRes.orderId,
    refresh: true,
    db: harness.db,
    stripe: harness.stripeMock,
  });
  assert.equal(verifiedOrder.paymentStatus, 'paid');
  assert.equal(verifiedOrder.entitlementStatus, 'entitled');
  assert.equal(verifiedOrder.reportAvailable, true);
  assert.ok(verifiedOrder.reportVersionId);
  assert.equal(verifiedOrder.reportVersionNumber, 1);
  assert.equal(harness.reportVersions.size, 1, 'Webhook + manual verify must create only 1 report_versions row');

  // 5. Buyer reads the fulfilled report; foreign buyer is refused
  const buyerReport = await readPay03aBuyerReport({
    buyerId: 'buyer-03a-1',
    orderId: checkoutRes.orderId,
    db: harness.db,
    stripe: harness.stripeMock,
  });
  assert.equal(buyerReport.reportVersionId, verifiedOrder.reportVersionId);
  assert.equal(buyerReport.idempotentReplay, true);
  assert.equal(buyerReport.report.vin, 'WBA3A5C51DF358101');
  assert.equal(buyerReport.report.identity.make, 'BMW');
  assert.ok(buyerReport.report.limitations.length >= 1);

  await assert.rejects(
    readPay03aBuyerReport({
      buyerId: 'buyer-03a-2',
      orderId: checkoutRes.orderId,
      db: harness.db,
      stripe: harness.stripeMock,
    }),
    /PAY03A_ORDER_NOT_FOUND/,
  );

  // 6. Buyer creates an expiring share link; `getReportByShareToken` resolves it while entitled
  const shareRes = await createPay03aBuyerShareLink({
    buyerId: 'buyer-03a-1',
    orderId: checkoutRes.orderId,
    db: harness.db,
    stripe: harness.stripeMock,
  });
  assert.ok(shareRes.shareToken);

  const resolvedBeforeRefund = await getReportByShareToken(harness.db, shareRes.shareToken);
  assert.equal(resolvedBeforeRefund.ok, true);
  assert.equal(resolvedBeforeRefund.report.vin, 'WBA3A5C51DF358101');

  // 7. Admin inspects orders and issues a governed sandbox refund -> revokes order entitlement and share token
  const adminList = await listPay03aAdminOrders({ db: harness.db });
  assert.equal(adminList.orders.length, 1);
  assert.equal(adminList.orders[0].orderId, checkoutRes.orderId);

  const refundedOrder = await refundPay03aAdminOrder({
    orderId: checkoutRes.orderId,
    db: harness.db,
    stripe: harness.stripeMock,
  });
  assert.equal(refundedOrder.paymentStatus, 'refunded');
  assert.equal(refundedOrder.quoteStatus, 'refunded');
  assert.equal(refundedOrder.entitlementStatus, 'revoked_refunded');
  assert.equal(refundedOrder.reportAvailable, false);
  assert.equal(refundedOrder.shareRevoked, true);
  assert.ok(refundedOrder.refundId);

  // 8. Repeat admin refund is idempotent
  const refundedRepeat = await refundPay03aAdminOrder({
    orderId: checkoutRes.orderId,
    db: harness.db,
    stripe: harness.stripeMock,
  });
  assert.equal(refundedRepeat.idempotentReplay, true);
  assert.equal(refundedRepeat.entitlementStatus, 'revoked_refunded');

  // 9. Post-refund buyer report access and shared report token access are both refused
  await assert.rejects(
    readPay03aBuyerReport({
      buyerId: 'buyer-03a-1',
      orderId: checkoutRes.orderId,
      db: harness.db,
      stripe: harness.stripeMock,
    }),
    /PAY02_PILOT_ENTITLEMENT_REVOKED_ON_REFUND/,
  );

  const resolvedAfterRefund = await getReportByShareToken(harness.db, shareRes.shareToken);
  assert.equal(resolvedAfterRefund.ok, false);
  assert.equal(resolvedAfterRefund.reason, 'revoked');
});

test('PAY03A HTTP Routes: enforces session role boundaries, Cache-Control headers, and end-to-end API flow', async () => {
  const harness = createInMemoryPay03aHarness();
  const origFrom = supabase.from;
  supabase.from = harness.db.from.bind(harness.db);

  const app = express();
  app.use(express.json());
  app.locals.pay03aDb = harness.db;
  app.locals.pay03aStripe = harness.stripeMock;
  app.use(pay03aRoutes);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Unauthenticated caller is refused on buyer & admin endpoints
    const unauthRes = await fetch(`${baseUrl}/api/pay03a/vehicles`);
    assert.equal(unauthRes.status, 401);

    // 2. Buyer cannot access admin endpoints
    const buyerOnAdmin = await fetch(`${baseUrl}/api/pay03a/admin/orders`, {
      headers: { 'x-session-token': 'tok-buyer-1' },
    });
    assert.equal(buyerOnAdmin.status, 403);

    // 3. Buyer lists eligible vehicles and inspects readiness
    const vehRes = await fetch(`${baseUrl}/api/pay03a/vehicles`, {
      headers: { 'x-session-token': 'tok-buyer-1' },
    });
    assert.equal(vehRes.status, 200);
    const vehBody = await vehRes.json();
    assert.equal(vehBody.vehicles.length, 3);

    // Metadata-only VIN is refused at HTTP checkout with 422 before charging
    const ineligibleCheckoutRes = await fetch(`${baseUrl}/api/pay03a/orders/checkout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-token': 'tok-buyer-1',
        'Idempotency-Key': 'pay03a_http_ineligible_0001',
      },
      body: JSON.stringify({ vin: 'DBA-GRS204-0005303' }),
    });
    assert.equal(ineligibleCheckoutRes.status, 422);
    const ineligibleBody = await ineligibleCheckoutRes.json();
    assert.equal(ineligibleBody.code, 'PAY03A_INELIGIBLE_METADATA_ONLY_VEHICLE');

    const readyRes = await fetch(`${baseUrl}/api/pay03a/vehicles/JTDBR32E820112202/readiness`, {
      headers: { 'x-session-token': 'tok-buyer-1' },
    });
    assert.equal(readyRes.status, 200);
    const readyBody = await readyRes.json();
    assert.equal(readyBody.vehicle.make, 'Toyota');
    assert.equal(readyBody.commercialTerms.amountMinor, 100);

    // 4. Buyer initiates Checkout
    const checkoutRes = await fetch(`${baseUrl}/api/pay03a/orders/checkout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-token': 'tok-buyer-1',
        'Idempotency-Key': 'pay03a_http_test_key_0001',
      },
      body: JSON.stringify({ vin: 'JTDBR32E820112202' }),
    });
    assert.equal(checkoutRes.status, 201);
    const checkoutBody = await checkoutRes.json();
    assert.ok(checkoutBody.orderId);
    assert.equal(checkoutBody.vin, 'JTDBR32E820112202');

    // 5. Mark paid in Stripe, verify order via HTTP, and read report with private no-store cache headers
    harness.stripeMock.markCheckoutPaid(checkoutBody.checkoutId);

    const verifyRes = await fetch(`${baseUrl}/api/pay03a/orders/${checkoutBody.orderId}/verify`, {
      method: 'POST',
      headers: { 'x-session-token': 'tok-buyer-1' },
    });
    assert.equal(verifyRes.status, 200);
    const verifyBody = await verifyRes.json();
    assert.equal(verifyBody.reportAvailable, true);

    const reportRes = await fetch(`${baseUrl}/api/pay03a/orders/${checkoutBody.orderId}/report`, {
      headers: { 'x-session-token': 'tok-buyer-1' },
    });
    assert.equal(reportRes.status, 200);
    assert.match(reportRes.headers.get('cache-control') || '', /no-store/);
    const reportBody = await reportRes.json();
    assert.equal(reportBody.report.vin, 'JTDBR32E820112202');

    // 6. Admin refunds via HTTP and buyer report access is immediately revoked (403)
    const adminRefundRes = await fetch(
      `${baseUrl}/api/pay03a/admin/orders/${checkoutBody.orderId}/refund`,
      {
        method: 'POST',
        headers: { 'x-session-token': 'tok-admin-1' },
      },
    );
    assert.equal(adminRefundRes.status, 200);
    const adminRefundBody = await adminRefundRes.json();
    assert.equal(adminRefundBody.entitlementStatus, 'revoked_refunded');

    const postRefundReportRes = await fetch(
      `${baseUrl}/api/pay03a/orders/${checkoutBody.orderId}/report`,
      {
        headers: { 'x-session-token': 'tok-buyer-1' },
      },
    );
    assert.equal(postRefundReportRes.status, 403);
  } finally {
    supabase.from = origFrom;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PAY03A R1-A & R1-C: Product migration contains zero synthetic vehicle inserts or canonical table fallback redefinitions and preserves report_versions guard', async () => {
  const migrationPath = path.resolve(
    process.cwd(),
    'database/migrations/20261031160000_carup_pay03a_real_report_commerce.sql',
  );
  const fixturePath = path.resolve(
    process.cwd(),
    'backend/tests/sql/fixtures/pay03a-synthetic-vehicle-fixtures.sql',
  );
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  const fixtureSql = fs.readFileSync(fixturePath, 'utf8');

  // R1-A: Zero synthetic vehicle inserts in product migration
  assert.ok(!/INSERT\s+INTO\s+public\.vehicles/i.test(migrationSql));
  assert.ok(!/WBA3A5C51DF358101/.test(migrationSql));
  assert.ok(!/JTDBR32E820112202/.test(migrationSql));
  assert.ok(!/DBA-GRS204-0005303/.test(migrationSql));

  // R1-C: Zero fallback CREATE TABLE for canonical vehicles or report_versions
  assert.ok(!/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.vehicles/i.test(migrationSql));
  assert.ok(!/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.report_versions/i.test(migrationSql));
  assert.ok(!/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.carup_report_version_guard/i.test(migrationSql));

  // Explicit dependency checks and restrictive RLS guard exist in migration
  assert.match(migrationSql, /PAY03A_REQUIRES_CANONICAL_VEHICLE_AND_REPORT_SCHEMA/);
  assert.match(migrationSql, /PAY03A_REQUIRES_CANONICAL_REPORT_VERSION_GUARD/);
  assert.match(migrationSql, /pay03a_paid_report_entitlement_guard/);
  assert.match(migrationSql, /AS\s+RESTRICTIVE/i);

  // Synthetic fixtures live exclusively in segregated test fixture file with database guard
  assert.match(fixtureSql, /PAY03A_SYNTHETIC_FIXTURE_FORBIDDEN_OUTSIDE_DISPOSABLE_TEST_DB/);
  assert.match(fixtureSql, /WBA3A5C51DF358101/);
  assert.match(fixtureSql, /JTDBR32E820112202/);
  assert.match(fixtureSql, /DBA-GRS204-0005303/);
});

test('PAY03A R1-D: Paid Report Share-Link Entitlement Matrix (all 10 positive/negative cases, fail-closed DB error handling, legacy compatibility, and direct-route guard)', async () => {
  const harness = createInMemoryPay03aHarness();

  // Create and fulfill a paid order for WBA3A5C51DF358101
  const checkoutRes = await createPay03aReportCheckout({
    buyerId: 'buyer-03a-1',
    vin: 'WBA3A5C51DF358101',
    requestKey: 'pay03a_r1d_matrix_key_001',
    db: harness.db,
    stripe: harness.stripeMock,
  });
  harness.stripeMock.markCheckoutPaid(checkoutRes.checkoutId);
  const verifiedOrder = await verifyPay03aBuyerOrder({
    buyerId: 'buyer-03a-1',
    orderId: checkoutRes.orderId,
    refresh: true,
    db: harness.db,
    stripe: harness.stripeMock,
  });
  const paidVerId = verifiedOrder.reportVersionId;
  assert.ok(paidVerId);

  // Case 10: Direct call to createShareLink on a paid commercial snapshot without authorizedPay03aOrderId is refused
  await assert.rejects(
    createShareLink(harness.db, paidVerId, { ttlSeconds: 3600 }),
    (err) => err && err.code === 'PAY03A_DIRECT_SHARE_ROUTE_FORBIDDEN',
  );

  // Case 1: Valid paid share link via governed buyer order endpoint before refund succeeds
  const shareRes = await createPay03aBuyerShareLink({
    buyerId: 'buyer-03a-1',
    orderId: checkoutRes.orderId,
    ttlSeconds: 3600,
    db: harness.db,
    stripe: harness.stripeMock,
  });
  assert.match(shareRes.shareToken, /^pay03a_shr_/);
  const case1 = await getReportByShareToken(harness.db, shareRes.shareToken);
  assert.equal(case1.ok, true);
  assert.equal(case1.entitlement_verified, true);
  assert.equal(case1.order_id, checkoutRes.orderId);

  // Case 6a: Database lookup error on pay02_report_orders fails closed (`entitlement_unavailable`)
  harness.faultInjection.failOrderLookup = true;
  const case6a = await getReportByShareToken(harness.db, shareRes.shareToken);
  assert.equal(case6a.ok, false);
  assert.equal(case6a.reason, 'entitlement_unavailable');
  harness.faultInjection.failOrderLookup = false;

  // Case 6b: Database lookup error on payment_transactions fails closed (`entitlement_unavailable`)
  harness.faultInjection.failPaymentLookup = true;
  const case6b = await getReportByShareToken(harness.db, shareRes.shareToken);
  assert.equal(case6b.ok, false);
  assert.equal(case6b.reason, 'entitlement_unavailable');
  harness.faultInjection.failPaymentLookup = false;

  // Case 4: Order in `refund_pending` / `refund_suspended` is denied immediately
  const payRow = harness.payments.get(checkoutRes.paymentReference);
  const ordRow = harness.reportOrders.get(checkoutRes.orderId);
  payRow.status = 'refund_pending';
  ordRow.entitlement_status = 'refund_suspended';
  const case4 = await getReportByShareToken(harness.db, shareRes.shareToken);
  assert.equal(case4.ok, false);
  assert.equal(case4.reason, 'revoked');
  payRow.status = 'paid';
  ordRow.entitlement_status = 'entitled';

  // Case 2: Expired share link is denied
  const paidVerRow = harness.reportVersions.get(paidVerId);
  const validExpiry = paidVerRow.share_expires_at;
  paidVerRow.share_expires_at = '2020-01-01T00:00:00.000Z';
  const case2 = await getReportByShareToken(harness.db, shareRes.shareToken);
  assert.equal(case2.ok, false);
  assert.equal(case2.reason, 'expired');
  paidVerRow.share_expires_at = validExpiry;

  // Case 3: Explicitly revoked share link is denied
  paidVerRow.revoked = true;
  const case3 = await getReportByShareToken(harness.db, shareRes.shareToken);
  assert.equal(case3.ok, false);
  assert.equal(case3.reason, 'revoked');
  paidVerRow.revoked = false;

  // Case 8: A different report_versions row for the same VIN cannot inherit the paid order's entitlement
  const otherVerId = '00000000-0000-4000-8000-000000000999';
  harness.reportVersions.set(otherVerId, {
    id: otherVerId,
    vin: 'WBA3A5C51DF358101',
    version: 99,
    generated_at: new Date().toISOString(),
    payload: paidVerRow.payload,
    content_hash: 'hash_other_99',
    completeness: {},
    report_tier: 'pay03a_commercial_snapshot',
    pay03a_order_id: checkoutRes.orderId,
    share_token: 'pay03a_shr_other_version_spoof',
    share_expires_at: validExpiry,
    revoked: false,
  });
  const case8 = await getReportByShareToken(harness.db, 'pay03a_shr_other_version_spoof');
  assert.equal(case8.ok, false);
  assert.equal(case8.reason, 'revoked');

  // Case 7: Paid commercial snapshot whose pay02_report_orders row is missing fails closed
  const orphanVerId = '00000000-0000-4000-8000-000000000998';
  harness.reportVersions.set(orphanVerId, {
    id: orphanVerId,
    vin: 'WBA3A5C51DF358101',
    version: 98,
    generated_at: new Date().toISOString(),
    payload: { vin: 'WBA3A5C51DF358101' },
    content_hash: 'hash_orphan_98',
    completeness: {},
    report_tier: 'pay03a_commercial_snapshot',
    pay03a_order_id: null,
    share_token: 'pay03a_shr_orphan_missing_order',
    share_expires_at: validExpiry,
    revoked: false,
  });
  const case7 = await getReportByShareToken(harness.db, 'pay03a_shr_orphan_missing_order');
  assert.equal(case7.ok, false);
  assert.equal(case7.reason, 'revoked');

  // Case 5: Full refund revokes order entitlement and denies share token access
  await refundPay03aAdminOrder({
    orderId: checkoutRes.orderId,
    db: harness.db,
    stripe: harness.stripeMock,
  });
  const case5 = await getReportByShareToken(harness.db, shareRes.shareToken);
  assert.equal(case5.ok, false);
  assert.equal(case5.reason, 'revoked');

  // Case 9: Legacy Milestone 4 report version (`report_tier = 'legacy_version'`) remains functional
  const legacyVerId = '00000000-0000-4000-8000-000000000997';
  harness.reportVersions.set(legacyVerId, {
    id: legacyVerId,
    vin: 'WBA3A5C51DF358101',
    version: 1,
    generated_at: new Date().toISOString(),
    payload: { vin: 'WBA3A5C51DF358101', schema: 'vehicle_history_report.v1' },
    content_hash: 'hash_legacy_01',
    completeness: {},
    report_tier: 'legacy_version',
    pay03a_order_id: null,
    share_token: null,
    share_expires_at: null,
    revoked: false,
  });
  const legacyLink = await createShareLink(harness.db, legacyVerId, { ttlSeconds: 3600 });
  assert.ok(!legacyLink.share_token.startsWith('pay03a_shr_'));
  const case9 = await getReportByShareToken(harness.db, legacyLink.share_token);
  assert.equal(case9.ok, true);
  assert.equal(case9.report.vin, 'WBA3A5C51DF358101');
});

test('PAY03A R1-E: Interrupted Fulfillment Recovery (duplicate signed webhook retry, buyer manual verify, and admin /reconcile recover without duplicate payment or report version)', async () => {
  const harness = createInMemoryPay03aHarness();

  // Part 1: Webhook payment succeeds, first fulfillment RPC fails transiently, duplicate signed webhook retry recovers idempotently
  const checkout1 = await createPay03aReportCheckout({
    buyerId: 'buyer-03a-1',
    vin: 'WBA3A5C51DF358101',
    requestKey: 'pay03a_r1e_webhook_retry_01',
    db: harness.db,
    stripe: harness.stripeMock,
  });
  harness.stripeMock.markCheckoutPaid(checkout1.checkoutId);

  const signedWebhook1 = {
    id: 'evt_pay03a_r1e_retry_001',
    type: 'checkout.session.completed',
    livemode: false,
    account: 'acct_1UVnGaEjgXqvlsJk',
    data: {
      object: {
        id: checkout1.checkoutId,
        client_reference_id: checkout1.paymentReference,
        metadata: { carup_reference: checkout1.paymentReference },
      },
    },
  };

  // Inject transient failure in `pay03a_complete_report_fulfillment` on first webhook delivery
  harness.faultInjection.failNextFulfillmentRpc = true;
  await assert.rejects(
    processPay01aWebhook({
      rawBody: Buffer.from(JSON.stringify(signedWebhook1), 'utf8'),
      signature: 'valid_sig',
      db: harness.db,
      stripe: harness.stripeMock,
    }),
    /PAY02_REPORT_FULFILLMENT_PERSISTENCE_FAILED/,
  );

  // Payment is now `paid` and quote is `paid_verified`, but report version was not created yet
  assert.equal(harness.payments.get(checkout1.paymentReference).status, 'paid');
  assert.equal(harness.quotes.get(checkout1.quoteId).status, 'paid_verified');
  assert.equal(harness.reportOrders.get(checkout1.orderId).report_version_id, null);
  assert.equal(harness.reportVersions.size, 0);

  // Retrying the EXACT SAME signed webhook event (`evt_pay03a_r1e_retry_001`) succeeds and completes fulfillment
  const retryWebhookRes = await processPay01aWebhook({
    rawBody: Buffer.from(JSON.stringify(signedWebhook1), 'utf8'),
    signature: 'valid_sig',
    db: harness.db,
    stripe: harness.stripeMock,
  });
  assert.equal(retryWebhookRes.verified, true);
  assert.equal(retryWebhookRes.duplicateEvent, true);
  assert.equal(harness.quotes.get(checkout1.quoteId).status, 'fulfilled');
  assert.ok(harness.reportOrders.get(checkout1.orderId).report_version_id);
  assert.equal(harness.reportVersions.size, 1);

  // Part 2: Admin reconciliation/recovery (`reconcileAndFulfillPay03aAdminOrder`) recovers an interrupted order
  const checkout2 = await createPay03aReportCheckout({
    buyerId: 'buyer-03a-2',
    vin: 'JTDBR32E820112202',
    requestKey: 'pay03a_r1e_admin_recover_02',
    db: harness.db,
    stripe: harness.stripeMock,
  });
  harness.stripeMock.markCheckoutPaid(checkout2.checkoutId);

  // First buyer verification fails during fulfillment RPC
  harness.faultInjection.failNextFulfillmentRpc = true;
  await assert.rejects(
    verifyPay03aBuyerOrder({
      buyerId: 'buyer-03a-2',
      orderId: checkout2.orderId,
      refresh: true,
      db: harness.db,
      stripe: harness.stripeMock,
    }),
    /PAY02_REPORT_FULFILLMENT_PERSISTENCE_FAILED/,
  );
  assert.equal(harness.quotes.get(checkout2.quoteId).status, 'paid_verified');
  assert.equal(harness.reportOrders.get(checkout2.orderId).report_version_id, null);

  // Admin triggers `/reconcile` (`reconcileAndFulfillPay03aAdminOrder`) -> fulfills atomically
  const adminRecovered = await reconcileAndFulfillPay03aAdminOrder({
    orderId: checkout2.orderId,
    db: harness.db,
    stripe: harness.stripeMock,
  });
  assert.equal(adminRecovered.quoteStatus, 'fulfilled');
  assert.equal(adminRecovered.entitlementStatus, 'entitled');
  assert.equal(adminRecovered.reportAvailable, true);
  assert.equal(adminRecovered.fulfillmentRecovery.recovered, true);
  assert.equal(adminRecovered.fulfillmentRecovery.idempotentReplay, false);

  // Second admin `/reconcile` call is an idempotent replay with zero duplicate report versions
  const adminRecoveredReplay = await reconcileAndFulfillPay03aAdminOrder({
    orderId: checkout2.orderId,
    db: harness.db,
    stripe: harness.stripeMock,
  });
  assert.equal(adminRecoveredReplay.fulfillmentRecovery.idempotentReplay, true);
  assert.equal(adminRecoveredReplay.reportVersionId, adminRecovered.reportVersionId);
  assert.equal(harness.reportVersions.size, 2, 'Total report versions across both orders must remain 2');
});
