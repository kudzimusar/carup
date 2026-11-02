/**
 * OC-4D — the ported O2/P5 dealer decision event, proven by behaviour rather than by source text.
 *
 * #208 first shipped `dealer.compliance.decided` with the reviewer's free-text `reason` in the
 * payload; O2-X6 later corrected that (the reason stays in the governed ledger). Communications'
 * `variablesForEvent` maps ANY payload `reason` into the template variables, so a payload that
 * carried it would put a reviewer's private words one template edit away from a dealer's inbox.
 * The port takes the corrected shape. This file pins it by driving the real `recordDecision` and
 * reading what actually reached the outbox, and pins that the governed template the policy renders
 * is registered (an unregistered key fails closed once the registry exists).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { supabase } = await import('../db/supabase.js');
const dealer = await import('../services/dealer/dealerComplianceService.js');
const { NOTIFICATION_POLICIES } = await import('../services/communication/communicationNotificationService.js');
const { COMMUNICATION_EVENT_TYPES } = await import('../services/communication/communicationEventListeners.js');
const { CommunicationTemplateService } = await import('../services/communication/communicationTemplateService.js');

const PRIVATE_NOTE = 'PRIVATE-REVIEWER-NOTE the licence stamp looks altered';

/** Just enough of supabase-js for the dealer decision path: rows by table, filters by equality. */
function installTables(tables) {
  const saved = supabase.from;
  supabase.from = (table) => {
    const state = { filters: [], op: 'select', payload: null };
    const rows = () => (tables[table] ||= []);
    const matching = () => rows().filter((row) => state.filters.every(([k, v]) => row[k] === v));
    const run = (mode) => {
      if (state.op === 'insert') {
        const row = { id: `${table}-${rows().length + 1}`, ...state.payload };
        rows().push(row);
        return { data: mode === 'list' ? [row] : row, error: null };
      }
      if (state.op === 'update') {
        const hit = matching();
        hit.forEach((row) => Object.assign(row, state.payload));
        return { data: mode === 'list' ? hit : hit[0] ?? null, error: null };
      }
      const hit = matching();
      return { data: mode === 'list' ? hit : hit[0] ?? null, error: null };
    };
    const chain = {
      select() { return chain; },
      eq(k, v) { state.filters.push([k, v]); return chain; },
      order() { return chain; },
      limit() { return chain; },
      insert(payload) { state.op = 'insert'; state.payload = Array.isArray(payload) ? payload[0] : payload; return chain; },
      update(payload) { state.op = 'update'; state.payload = payload; return chain; },
      single: async () => run('one'),
      maybeSingle: async () => run('one'),
      then(resolve, reject) { return Promise.resolve(run('list')).then(resolve, reject); },
    };
    return chain;
  };
  return () => { supabase.from = saved; };
}

test('the dealer decision event carries safe structured facts only — the reviewer note stays in the ledger', async () => {
  const tables = {
    dealer_profiles: [{ id: 'dp-1', user_id: 'dealer-user-1', tenant_id: null, suspension_state: 'active', restriction_state: 'none', compliance_review_state: 'pending' }],
    dealer_compliance_requirements: [{ id: 'req-1', dealer_id: 'dp-1', requirement_key: 'business_licence', status: 'submitted', is_blocking: true }],
  };
  const restore = installTables(tables);
  try {
    await dealer.recordDecision('dp-1', {
      decision: 'reject_requirement', requirement_key: 'business_licence', reason: PRIVATE_NOTE,
    }, { id: 'admin-1', role: 'admin' });
  } finally {
    restore();
  }

  const ledger = tables.dealer_compliance_decisions || [];
  assert.equal(ledger.length, 1, 'the governed ledger row is written');
  assert.equal(ledger[0].reason, PRIVATE_NOTE, 'the reviewer reason is kept where it belongs — the ledger');

  const events = (tables.domain_events || []).filter((e) => e.event_type === 'dealer.compliance.decided');
  assert.equal(events.length, 1, 'the decision is announced to Communications exactly once');
  const { payload } = events[0];
  assert.deepEqual(
    Object.keys(payload).sort(),
    // OC-5C (O2-X6): whoMustAct joins the allow-list — a derived duty code, never free text.
    ['dealerId', 'decision', 'occurredAt', 'recipientUserId', 'requirementKey', 'schemaVersion', 'whoMustAct'],
    'the payload is an allow-list of structured facts',
  );
  // The canonical dealer projection over the post-decision facts: a rejected BLOCKING requirement is
  // the dealer's to replace. (#208 derived 'none' from the verb — telling them nobody had to act.)
  assert.equal(payload.whoMustAct, 'subject_action', 'a rejected blocking requirement is the dealer\u2019s move');
  assert.equal(payload.recipientUserId, 'dealer-user-1', 'the dealer is the recipient');
  assert.equal(payload.decision, 'reject_requirement');
  assert.equal(payload.requirementKey, 'business_licence');
  assert.ok(!JSON.stringify(payload).includes('PRIVATE-REVIEWER-NOTE'), 'no reviewer free text reaches the outbox');
});

test('Communications subscribes the event, renders it from a governed template, and that template is registered', () => {
  assert.ok(COMMUNICATION_EVENT_TYPES.includes('dealer.compliance.decided'));
  const policy = NOTIFICATION_POLICIES['dealer.compliance.decided'];
  assert.equal(policy?.templateKey, 'dealer_compliance_decision_v1');
  assert.deepEqual(policy.channels, ['in_app']);
  assert.equal(policy.transactional, true);

  const sql = readFileSync(new URL('../../database/migrations/20261004150000_o2_dealer_compliance_decision_template.sql', import.meta.url), 'utf8');
  assert.match(sql, /^-- \+migrate Up/m);
  assert.match(sql, /^-- \+migrate Down/m);
  assert.match(sql, /'dealer_compliance_decision_v1'/);
  assert.match(sql, /'approved'/, 'the registered version is approved, or delivery fails closed');
  assert.match(sql, /'\["decision"\]'::jsonb/, 'the only required variable is the governed decision verb');
  assert.doesNotMatch(sql, /\{\{\s*reason\s*\}\}/, 'the governed copy never renders a reviewer reason');

  // The in-code compatibility copy is the registered copy (fallback parity).
  const rendered = new CommunicationTemplateService().render('dealer_compliance_decision_v1', { decision: 'reject_requirement' });
  assert.equal(rendered.body, 'Your dealer application received a CarUp decision: reject_requirement.');
  assert.match(sql, /'Your dealer application received a CarUp decision: \{\{decision\}\}\.'/);
});
