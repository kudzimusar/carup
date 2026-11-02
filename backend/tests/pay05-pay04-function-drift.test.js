/**
 * CARUP-PAY-05-LR01 — the twelve accepted functions PAY-05 replaces are the ACCEPTED text plus bounded Paynow hunks.
 *
 * Each function is re-derived here from migration 20261102110000 (PAY-04; it also carries the PAY-03B F5 transition
 * function as extended by PAY-04) by applying exactly the hunks below, and must equal the PAY-05 migration's text byte
 * for byte. A hunk that no longer applies exactly once, any other change to a replaced function, or PAY-05 redefining
 * any other accepted pay04_/pay03b_ function fails this test. No database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PAY04 = readFileSync(path.join(ROOT, "database/migrations/20261102110000_carup_pay04_garage_provider_payments.sql"), "utf8");
const PAY05 = readFileSync(path.join(ROOT, "database/migrations/20261103100000_carup_pay05_zimbabwe_paynow_collections.sql"), "utf8");

const HUNKS = {
  pay04_gateway_permitted: [
    [`  SELECT p_gateway = 'pay04_garage_provider_simulator'
     AND coalesce((SELECT garage_simulator_enabled FROM public.pay04_runtime_guard WHERE singleton), false);
`,
     `  SELECT (p_gateway = 'pay04_garage_provider_simulator'
     AND coalesce((SELECT garage_simulator_enabled FROM public.pay04_runtime_guard WHERE singleton), false))
      -- PAY-05: the garage's own Paynow integration, while CarUp has Paynow available in a permitted mode
      OR (p_gateway = 'paynow_zimbabwe'
          AND coalesce((SELECT paynow_available AND (paynow_simulator_enabled OR paynow_real_enabled)
                          FROM public.pay05_runtime_guard WHERE singleton), false));
`],
  ],
  pay04_guard_merchant_account: [
    [`  IF OLD.status <> 'simulated' OR NEW.status <> 'suspended'
`,
     `  IF NOT ((OLD.gateway = 'pay04_garage_provider_simulator' AND OLD.status = 'simulated' AND NEW.status = 'suspended')
          -- PAY-05: a Paynow merchant is verified or rejected once, and may always be suspended
          OR (OLD.gateway = 'paynow_zimbabwe' AND OLD.status = 'pending_verification' AND NEW.status IN ('verified', 'rejected', 'suspended'))
          OR (OLD.gateway = 'paynow_zimbabwe' AND OLD.status = 'verified' AND NEW.status = 'suspended'))
`],
  ],
  pay04_invoice_money: [
    [`             WHEN p.status IN ('pending', 'refund_pending', 'reconciliation_hold')
               OR EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies q
                           WHERE q.collection_id = c.id AND q.status = 'open'
                             AND q.discrepancy_type IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch'))
`,
     `             WHEN (p.status IN ('pending', 'refund_pending', 'reconciliation_hold')
                   -- PAY-05: an operator released this unpaid Paynow checkout's hold after an authenticated read
                   AND NOT (p.status = 'pending' AND public.pay05_hold_released(c.id)))
               OR EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies q
                           WHERE q.collection_id = c.id AND q.status = 'open'
                             AND q.discrepancy_type IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch',
                                                        'provider_disputed', 'provider_status_unrecognized'))
`],
  ],
  pay03b_payment_transition_target: [
    [`  v_intent_pattern := CASE WHEN p_row.gateway IN ('pay03b_local_provider_simulator', 'pay04_garage_provider_simulator') THEN '^sim_pi_[A-Za-z0-9_]+$'
                           ELSE '^pi_[A-Za-z0-9_]+$' END;
  v_refund_pattern := CASE WHEN p_row.gateway IN ('pay03b_local_provider_simulator', 'pay04_garage_provider_simulator') THEN '^sim_re_[A-Za-z0-9_]+$'
                           ELSE '^(re|pyr)_[A-Za-z0-9_]+$' END;
`,
     `  v_intent_pattern := CASE WHEN p_row.gateway IN ('pay03b_local_provider_simulator', 'pay04_garage_provider_simulator') THEN '^sim_pi_[A-Za-z0-9_]+$'
                           -- PAY-05: a Paynow payment is identified by its poll URL (pn_poll_<sha256 prefix>)
                           WHEN p_row.gateway = 'paynow_zimbabwe' THEN '^pn_poll_[0-9a-f]{40}$'
                           ELSE '^pi_[A-Za-z0-9_]+$' END;
  v_refund_pattern := CASE WHEN p_row.gateway IN ('pay03b_local_provider_simulator', 'pay04_garage_provider_simulator') THEN '^sim_re_[A-Za-z0-9_]+$'
                           -- PAY-05: Paynow issues no refund identifiers (refunds happen in its dashboard): none can match
                           WHEN p_row.gateway = 'paynow_zimbabwe' THEN '^pn_refund_[0-9a-f]{40}$'
                           ELSE '^(re|pyr)_[A-Za-z0-9_]+$' END;
`],
  ],
  pay04_reproject_garage_collection: [
    [`  IF EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies q WHERE q.collection_id = v_c.id AND q.status = 'open'
               AND q.discrepancy_type IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch')) THEN
`,
     `  IF EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies q WHERE q.collection_id = v_c.id AND q.status = 'open'
               -- PAY-05: nor while Paynow holds it in a dispute or reported a status no one has reviewed
               AND q.discrepancy_type IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch', 'provider_disputed',
                                          'provider_status_unrecognized')) THEN
`],
    [`    WHERE collection_id = v_c.id AND discrepancy_type IN ('unallocated_provider_money', 'refund_after_resolution') AND status = 'open';
`,
     `    WHERE collection_id = v_c.id AND discrepancy_type IN ('unallocated_provider_money', 'refund_after_resolution', 'provider_disputed') AND status = 'open';
`],
    [`        jsonb_build_object('discrepancy_type', 'unallocated_provider_money|refund_after_resolution', 'resolution', 'refunded_to_customer'));
`,
     `        jsonb_build_object('discrepancy_type', 'unallocated_provider_money|refund_after_resolution|provider_disputed', 'resolution', 'refunded_to_customer'));
`],
  ],
  pay04_begin_garage_collection: [
    [`  SELECT * INTO v_acct FROM public.pay04_garage_merchant_accounts
   WHERE tenant_id = v_inv.tenant_id AND status = 'simulated' ORDER BY registered_at DESC LIMIT 1;
`,
     `  SELECT * INTO v_acct FROM public.pay04_garage_merchant_accounts
   WHERE tenant_id = v_inv.tenant_id AND (status = 'simulated' OR (gateway = 'paynow_zimbabwe' AND status = 'verified'))
   ORDER BY registered_at DESC LIMIT 1;
`],
    [`  IF NOT (v_inv.currency = ANY (v_acct.currencies)) THEN RAISE EXCEPTION 'PAY04_MERCHANT_CURRENCY_UNSUPPORTED'; END IF;
`,
     `  IF NOT (v_inv.currency = ANY (v_acct.currencies)) THEN RAISE EXCEPTION 'PAY04_MERCHANT_CURRENCY_UNSUPPORTED'; END IF;
  -- PAY-05: a Paynow merchant collects a currency only through its own verified integration for that currency
  IF v_acct.gateway = 'paynow_zimbabwe' AND public.pay05_verified_integration(v_acct.id, v_inv.currency) IS NULL THEN
    RAISE EXCEPTION 'PAY04_MERCHANT_CURRENCY_UNSUPPORTED';
  END IF;
`],
  ],
  pay04_cancel_garage_collection: [
    [`  IF v_c.provider_payment_id IS NULL THEN
    PERFORM public.pay03b_payment_transition_target(v_p, v_c.amount_minor, 'cancelled', NULL, NULL, NULL, NULL, NULL, NULL, NULL);
`,
     `  -- PAY-05: a Paynow request whose reply was lost may exist at Paynow: it is held like a live checkout, never closed here
  IF v_c.provider_payment_id IS NULL AND NOT public.pay05_initiation_unresolved(v_c.id) THEN
    PERFORM public.pay03b_payment_transition_target(v_p, v_c.amount_minor, 'cancelled', NULL, NULL, NULL, NULL, NULL, NULL, NULL);
`],
    [`    'closed_without_provider', v_c.provider_payment_id IS NULL));
`,
     `    'closed_without_provider', v_c.provider_payment_id IS NULL AND NOT public.pay05_initiation_unresolved(v_c.id)));
`],
    [`    'payment_status', CASE WHEN v_c.provider_payment_id IS NULL THEN 'cancelled' ELSE v_p.status END);
`,
     `    'payment_status', CASE WHEN v_c.provider_payment_id IS NULL AND NOT public.pay05_initiation_unresolved(v_c.id)
                           THEN 'cancelled' ELSE v_p.status END);
`],
  ],
  pay04_close_expired_unattached_collection: [
    [`  IF v_c.provider_payment_id IS NOT NULL THEN RAISE EXCEPTION 'PAY04_COLLECTION_ATTACHED'; END IF;
`,
     `  IF v_c.provider_payment_id IS NOT NULL THEN RAISE EXCEPTION 'PAY04_COLLECTION_ATTACHED'; END IF;
  -- PAY-05: a Paynow request whose reply was lost may exist at Paynow: it closes only after authenticated traces find nothing
  IF public.pay05_initiation_unresolved(v_c.id) THEN RAISE EXCEPTION 'PAY05_INITIATION_UNRESOLVED'; END IF;
`],
  ],
  pay04_resolve_garage_payment_discrepancy: [
    [`    IF v_d.discrepancy_type <> 'unallocated_provider_money' THEN RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID'; END IF;
`,
     `    IF v_d.discrepancy_type NOT IN ('unallocated_provider_money', 'provider_paid_after_close')
       -- PAY-05: Paynow paid a different amount, or reported a word no one recognises, and the garage settled it in Paynow or
       -- with the customer (independent review D3a)
       AND NOT (v_c.gateway = 'paynow_zimbabwe' AND v_d.discrepancy_type IN ('amount_mismatch', 'provider_status_unrecognized')) THEN
      RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID';
    END IF;
`],
    [`    IF v_d.discrepancy_type NOT IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch') THEN
      RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID';
    END IF;
`,
     `    IF v_d.discrepancy_type NOT IN ('amount_mismatch', 'currency_mismatch', 'merchant_mismatch', 'provider_disputed',
                                    'provider_status_unrecognized') THEN
      RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID';
    END IF;
    -- PAY-05: a dispute is over only when Paynow itself reports the payment Paid again
    IF v_d.discrepancy_type = 'provider_disputed' AND public.pay05_latest_provider_status(v_d.collection_id) IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION 'PAY05_DISPUTE_NOT_RESOLVED_BY_PROVIDER';
    END IF;
`],
    [`    IF v_d.discrepancy_type <> 'refund_after_resolution' THEN RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID'; END IF;
`,
     `    IF v_d.discrepancy_type NOT IN ('refund_after_resolution', 'provider_status_unrecognized', 'provider_refund_unquantified',
                                    'provider_paid_after_close') THEN RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID'; END IF;
`],
    [`  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_d.payment_reference));
`,
     `  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_d.payment_reference));
  -- PAY-05: settled outside CarUp — the Paynow request's room is released and later reports of the same money are only
  -- recorded (independent review D3a)
  IF p_resolution = 'settled_off_platform' AND v_c.gateway = 'paynow_zimbabwe' THEN
    PERFORM public.pay05_mark_settled_off_platform(v_c.id, trim(p_actor_id), btrim(p_note));
  END IF;
`],
  ],
  pay04_suspend_garage_merchant_account: [
    [`  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_MERCHANT_ACCOUNT_NOT_FOUND'; END IF;
`,
     `  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_MERCHANT_ACCOUNT_NOT_FOUND'; END IF;
  -- PAY-05: a Paynow merchant is suspended through its own writer, which closes its integrations (independent review D4)
  IF v_row.gateway = 'paynow_zimbabwe' THEN RAISE EXCEPTION 'PAY05_USE_PAYNOW_PATH'; END IF;
`],
  ],
  pay04_request_garage_collection_refund: [
    [`  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_COLLECTION_NOT_FOUND'; END IF;
`,
     `  IF NOT FOUND THEN RAISE EXCEPTION 'PAY04_COLLECTION_NOT_FOUND'; END IF;
  -- PAY-05: Paynow has no merchant refund API — a garage refunds in its Paynow dashboard (independent review D4)
  IF v_probe.gateway = 'paynow_zimbabwe' THEN RAISE EXCEPTION 'PAY05_USE_PAYNOW_PATH'; END IF;
`],
  ],
};

function extract(text, name) {
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = /^(END )?\$\$;[ \t]*$/m;
  const tail = text.slice(start);
  const m = end.exec(tail);
  return tail.slice(0, m.index + m[0].length) + "\n";
}

for (const [name, hunks] of Object.entries(HUNKS)) {
  test(`${name}: accepted text + exactly its PAY-05 hunks`, () => {
    let derived = extract(PAY04, name);
    for (const [from, to] of hunks) {
      const count = derived.split(from).length - 1;
      assert.equal(count, 1, `a hunk of ${name} matches ${count} times`);
      derived = derived.replace(from, () => to);
    }
    assert.equal(extract(PAY05, name).trimEnd(), derived.trimEnd());
  });
}

// Independent review D8: every spelling counts (qualified or not, with or without OR REPLACE, any case), each replaced
// function is defined exactly once, and nothing alters or drops an accepted function.
const UP = PAY05.split(/^-- \+migrate Down/m)[0];

test("PAY-05 defines each replaced function exactly once and no other accepted pay04_/pay03b_ function, in any spelling", () => {
  const defs = [...UP.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?((?:pay04|pay03b)_[a-z0-9_]+)"?\s*\(/gi)]
    .map((m) => m[1].toLowerCase());
  const counts = {};
  for (const d of defs) counts[d] = (counts[d] || 0) + 1;
  assert.deepEqual(Object.keys(counts).sort(), Object.keys(HUNKS).sort());
  for (const [name, n] of Object.entries(counts)) assert.equal(n, 1, `${name} is defined ${n} times`);
});

test("PAY-05 never alters, drops or re-owns an accepted pay04_/pay03b_ function", () => {
  assert.doesNotMatch(UP, /\b(ALTER|DROP)\s+FUNCTION\s+(IF\s+EXISTS\s+)?(?:"?public"?\.)?"?(pay04|pay03b)_/i);
});

test("the statements PAY-05 aims at PAY-04 tables are exactly the reviewed ones", () => {
  const touching = UP.split("\n").filter((l) => /^(ALTER TABLE|DROP INDEX|CREATE (UNIQUE )?INDEX|DROP TRIGGER|CREATE TRIGGER|SELECT pg_temp\.pay05_drop_column_checks)/i.test(l)
    && /pay04_|pay03b_|payment_transactions/.test(l) && !/pay05_[a-z_]+ ON public\.pay05_|ON public\.pay05_/.test(l));
  assert.deepEqual(touching.map((l) => l.trim().replace(/\s+/g, " ")), [
    "SELECT pg_temp.pay05_drop_column_checks('public.pay04_garage_merchant_accounts', 'gateway');",
    "SELECT pg_temp.pay05_drop_column_checks('public.pay04_garage_merchant_accounts', 'merchant_reference');",
    "SELECT pg_temp.pay05_drop_column_checks('public.pay04_garage_merchant_accounts', 'status');",
    "ALTER TABLE public.pay04_garage_merchant_accounts",
    "DROP INDEX IF EXISTS public.uq_pay04_one_live_merchant_per_garage_gateway;",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_pay04_one_live_merchant_per_garage_gateway",
    "SELECT pg_temp.pay05_drop_column_checks('public.pay04_garage_collections', 'gateway');",
    "SELECT pg_temp.pay05_drop_column_checks('public.pay04_garage_collections', 'provider_checkout_id');",
    "SELECT pg_temp.pay05_drop_column_checks('public.pay04_garage_collections', 'provider_payment_id');",
    "ALTER TABLE public.pay04_garage_collections",
    "SELECT pg_temp.pay05_drop_column_checks('public.pay04_garage_payment_discrepancies', 'discrepancy_type');",
    "ALTER TABLE public.pay04_garage_payment_discrepancies ADD CONSTRAINT pay05_discrepancy_type CHECK (discrepancy_type IN (",
    "SELECT pg_temp.pay05_drop_column_checks('public.pay04_garage_collection_events', 'event_type');",
    "ALTER TABLE public.pay04_garage_collection_events ADD CONSTRAINT pay05_collection_event_type CHECK (event_type IN (",
  ]);
});

test("every hunk is marked as a PAY-05 change where it lands", () => {
  for (const [name, hunks] of Object.entries(HUNKS)) {
    const text = extract(PAY05, name);
    assert.ok(text.includes("PAY-05"), `${name} carries no PAY-05 marker`);
    for (const [, to] of hunks) assert.ok(text.includes(to), `${name}: hunk text missing`);
  }
});
