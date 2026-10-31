import test from 'node:test';
import assert from 'node:assert/strict';
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
  listEligibleReportVehicles,
  inspectVehicleReportReadiness,
  createPay03aReportCheckout,
  listPay03aBuyerOrders,
  verifyPay03aBuyerOrder,
  readPay03aBuyerReport,
  createPay03aBuyerShareLink,
  listPay03aAdminOrders,
  readPay03aAdminOrder,
  refundPay03aAdminOrder,
} = await import('../services/payment/pay03aReportCommerceService.js');

const {
  reviewPay02GovernanceProposal,
  deliverVerifiedVehicleHistoryReport,
} = await import('../services/payment/pay02Service.js');

const { processPay01aWebhook } = await import('../services/payment/pay01aService.js');
const { getReportByShareToken } = await import('../services/report/reportService.js');
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
      },
    ],
  ]);

  const quotes = new Map();
  const quotesByPayerIdem = new Map();
  const payments = new Map();
  const paymentsByActorKey = new Map();
  const reportOrders = new Map();
  const reportOrdersByQuote = new Map();
  const reportVersions = new Map();

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
        const rows = await resolveRows();
        return { data: rows[0] || null, error: null };
      },
      async single() {
        const rows = await resolveRows();
        return { data: rows[0] || null, error: null };
      },
      then(onFulfilled, onRejected) {
        return resolveRows()
          .then((data) => ({ data, error: null }))
          .then(onFulfilled, onRejected);
      },
    };

    async function resolveRows() {
      let rows = [];
      if (table === 'vehicles') rows = Array.from(vehicles.values());
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
        pay.status = args.p_status;
        if (args.p_intent_id) pay.pay01a_intent_id = args.p_intent_id;
        if (args.p_refund_id) pay.pay01a_refund_id = args.p_refund_id;
        pay.updated_at = new Date().toISOString();
        return { data: { ...pay, duplicate_event: false }, error: null };
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

  // 7.4 Database update failure must throw an explicit error rather than returning success
  const failingUpdateDb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { message: 'simulated_db_write_failure' },
            }),
          }),
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
      db: failingUpdateDb,
      reportAssembler: async (_db, vin) => ({
        vin,
        audience: 'buyer',
        identity: { vin, make: 'BMW', model: '320i' },
        completeness: { lifecycle_source_coverage: 0.75 },
        limitations: ['Explicit limitation disclosure.'],
      }),
      versionGenerator: async (_db, vin) => ({
        id: 'rep_ver_fail_test',
        vin,
        version: 1,
        content_hash: 'hash_1',
        completeness: { lifecycle_source_coverage: 0.75 },
      }),
    }),
    /PAY02_REPORT_FULFILLMENT_PERSISTENCE_FAILED/,
  );
});

test('PAY03A Pre-Purchase Readiness: verifies real vehicle in public.vehicles, discloses limitations before payment, and refuses unknown or synthetic VINs', async () => {
  const harness = createInMemoryPay03aHarness();

  const list = await listEligibleReportVehicles({ db: harness.db });
  assert.equal(list.productCode, 'intel.report.vehicle_history_single');
  assert.equal(list.vehicles.length, 2);
  assert.equal(list.vehicles[0].vin, 'WBA3A5C51DF358101');

  const readiness = await inspectVehicleReportReadiness({
    vin: 'WBA3A5C51DF358101',
    buyerId: 'buyer-03a-1',
    db: harness.db,
  });
  assert.equal(readiness.eligibleForPurchase, true);
  assert.equal(readiness.vehicle.vin, 'WBA3A5C51DF358101');
  assert.equal(readiness.vehicle.make, 'BMW');
  assert.equal(readiness.commercialTerms.amountMinor, 100);
  assert.equal(readiness.commercialTerms.currency, 'JPY');
  assert.equal(readiness.commercialTerms.sandboxAccountId, 'acct_1UVnGaEjgXqvlsJk');
  assert.ok(readiness.readiness.limitations.length >= 1, 'Must disclose limitations before charging');

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
    assert.equal(vehBody.vehicles.length, 2);

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
