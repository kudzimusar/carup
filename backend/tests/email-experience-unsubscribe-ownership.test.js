import assert from 'node:assert/strict';
import test from 'node:test';

import { BrevoMarketingAdapter, ResendEmailAdapter } from '../services/communication/adapters/providerAdapters.js';
import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';
import {
  MARKETING_CONSENT_DISPOSITIONS,
  MARKETING_CONSENT_STATES,
  classifyConsentLookupFailure,
  evaluateMarketingConsent,
} from '../services/communication/marketingConsentState.js';
import {
  UNSUBSCRIBE_PRESENTATION_ERRORS,
  assertNoMarketingUnsubscribePresentation,
  unsubscribeHtmlBlock,
  unsubscribeTextBlock,
  validateMarketingUnsubscribePresentation,
} from '../services/communication/emailExperience/marketingUnsubscribePresentation.js';
import { renderEmailForNotification } from '../services/communication/emailExperience/renderEmail.js';

/**
 * Finished marketing content, from the canonical G2 renderer.
 *
 * G2 reclassification: these tests used `applyMarketingUnsubscribePresentation`, the interim
 * composer that existed only while no renderer did. It is retired — the canonical shell now renders
 * the marketing family and composes G3's block through `emailFooters.js`. The G3 contracts asserted
 * below are unchanged; the content now comes from the real producer.
 */
function composeMarketing(text, unsubscribeUrl = UNSUB) {
  const rendered = renderEmailForNotification(
    { title: 'CarUp Weekly', message: text, payload: { classification: 'marketing', unsubscribe_url: unsubscribeUrl } },
    { env: {} },
  );
  if (!rendered.ok) throw new Error(`renderer refused the fixture: ${rendered.errorCode}`);
  return rendered;
}

/**
 * G3 — one unsubscribe owner, and fail-closed marketing consent.
 *
 * Two defects close here.
 *
 * 1. `marketingSuppressionFor(...).catch(() => null)` made every way of FAILING to establish consent
 *    state indistinguishable from "not suppressed", so a database fault was silently converted into
 *    permission to mail someone who may have unsubscribed.
 *
 * 2. The Brevo adapter authored the visible unsubscribe footer itself, inside the function that
 *    called the provider. Customer-facing copy lived in a transport component, and the component
 *    that would have to detect a duplicate control was the component adding one.
 */

const BREVO_ENV = { BREVO_API_KEY: 'k', BREVO_FROM_EMAIL: 'news@marketing.carup.dev' };
const UNSUB = 'https://carup.dev/api/communications/unsubscribe?token=tok-g3';
const SENTINEL = 'SENTINEL-BODY-DO-NOT-TOUCH — Weekly picks for you.';

function marketingData(extra = {}) {
  return {
    classification: 'marketing', email: 'reader@example.test',
    campaign_id: 'c1', campaign_delivery_id: 'd1',
    unsubscribe_url: UNSUB, ...extra,
  };
}

/** Send through Brevo, capturing the exact payload and counting provider calls. */
async function brevoSend({ body = '', html = null, data = marketingData() } = {}) {
  let captured = null;
  let calls = 0;
  const adapter = new BrevoMarketingAdapter({
    env: BREVO_ENV,
    fetchImpl: async (_url, init) => {
      calls += 1;
      captured = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ messageId: '<m@x>' }), headers: new Map() };
    },
  });
  const result = await adapter.send({ content: { subject: 'News', body, ...(html ? { html } : {}), data } });
  return { result, captured, calls };
}

/** A repository stub whose suppression reads are observable and can be made to fail. */
function repositoryStub({ suppressions = [], listThrows = null, users = {} } = {}) {
  const suppressionQueries = [];
  const updates = [];
  return {
    suppressionQueries,
    updates,
    repository: {
      list: async (table, filters) => {
        if (table === 'communication_suppressions') {
          suppressionQueries.push(filters);
          if (listThrows) throw listThrows;
          return suppressions.filter((r) => r.channel === filters.channel && r.address === filters.address);
        }
        if (table === 'channel_identities') return [];
        return [];
      },
      findOne: async (table, filters) => (table === 'users' ? users[filters.id] || null : null),
      insert: async () => ({ id: 'attempt-1' }),
      updateById: async (_t, id, patch) => { updates.push(patch); return { id }; },
    },
  };
}

function workerWith(repository) {
  let providerCalls = 0;
  const sent = [];
  const adapterRegistry = {
    get: () => ({
      provider: 'brevo',
      send: async (input) => { providerCalls += 1; sent.push(input); return { accepted: true }; },
    }),
  };
  const worker = new CommunicationDeliveryWorker({ repository, adapterRegistry });
  return { worker, sent, providerCalls: () => providerCalls };
}

// ============================================================================
// J. SEND-TIME CONSENT — the gate fails closed
// ============================================================================

test('J1 a suppressed marketing recipient never reaches a provider', async () => {
  const { repository, updates } = repositoryStub({
    suppressions: [{ channel: 'email', address: 'gone@example.test', scope: 'marketing', reason: 'unsubscribe', released_at: null }],
  });
  const { worker, providerCalls } = workerWith(repository);

  await worker.deliverNotification({ id: 1, channel: 'email', payload: { classification: 'marketing', email: 'gone@example.test' } });

  assert.equal(providerCalls(), 0, 'zero provider calls');
  assert.ok(updates.some((u) => u.last_error_code === 'recipient_suppressed'));
  assert.ok(updates.some((u) => u.status === 'dead_letter'), 'a refusal a person made is durable, not retried');
});

test('J2 an unsuppressed marketing recipient proceeds', async () => {
  const { repository } = repositoryStub({ suppressions: [] });
  const { worker, providerCalls } = workerWith(repository);

  await worker.deliverNotification({
    id: 2, channel: 'email', message: 'Copy.',
    payload: { classification: 'marketing', email: 'ok@example.test', unsubscribe_url: UNSUB, campaign_id: 'c', campaign_delivery_id: 'd' },
  });

  assert.equal(providerCalls(), 1);
});

test('J3 a TRANSIENT consent lookup fault sends nothing and retries', async () => {
  const transient = Object.assign(new Error('communication_suppressions list failed: connection terminated unexpectedly'), {});
  const { repository, updates } = repositoryStub({ listThrows: transient });
  const { worker, providerCalls } = workerWith(repository);

  await worker.deliverNotification({
    id: 3, channel: 'email', attempt_count: 1,
    payload: { classification: 'marketing', email: 'ok@example.test', unsubscribe_url: UNSUB },
  });

  assert.equal(providerCalls(), 0, 'THE DEFECT: a lookup failure must never become permission to send');
  const patch = updates.find((u) => u.last_error_code);
  assert.equal(patch.last_error_code, 'marketing_consent_unavailable:transient');
  assert.equal(patch.status, 'retry_scheduled', 'a fault worth re-asking about is retried');
  assert.ok(!updates.some((u) => u.last_error_code === 'recipient_suppressed'),
    'our fault must NOT be recorded as the customer having unsubscribed');
});

test('J4 a DURABLE consent lookup fault sends nothing and fails distinctly', async () => {
  const durable = Object.assign(new Error('communication_suppressions list failed: permission denied for table communication_suppressions'), { code: '42501' });
  const { repository, updates } = repositoryStub({ listThrows: durable });
  const { worker, providerCalls } = workerWith(repository);

  await worker.deliverNotification({
    id: 4, channel: 'email',
    payload: { classification: 'marketing', email: 'ok@example.test', unsubscribe_url: UNSUB },
  });

  assert.equal(providerCalls(), 0);
  const patch = updates.find((u) => u.last_error_code);
  assert.equal(patch.last_error_code, 'marketing_consent_unavailable:durable');
  assert.equal(patch.status, 'dead_letter');
  assert.notEqual(patch.last_error_code, 'recipient_suppressed', 'unavailable is not suppressed');
});

test('J5 a row inserted straight into notification_queue cannot bypass the send-time gate', async () => {
  // Queue-time suppression is enforced by the notification service. A backfill, a script or a future
  // code path that writes the queue row itself never goes near it. This is the check that makes that
  // shortcut harmless.
  const { repository, updates } = repositoryStub({
    suppressions: [{ channel: 'email', address: 'gone@example.test', scope: 'all', reason: 'complaint', released_at: null }],
  });
  const { worker, providerCalls } = workerWith(repository);

  const smuggled = {
    id: 5, channel: 'email', status: 'queued', message: 'Copy.',
    payload: { classification: 'marketing', email: 'gone@example.test', unsubscribe_url: UNSUB },
  };
  repository.claimDueNotifications = async () => [smuggled];
  await worker.processDueNotifications({ limit: 10 });

  assert.equal(providerCalls(), 0, 'direct queue insertion must not reach a provider');
  assert.ok(updates.some((u) => u.last_error_code === 'recipient_suppressed'));
});

test('J6 consent is evaluated against the G0-RESOLVED address, not a payload guess', async () => {
  // The address consent is checked for must be the address the message is actually delivered to.
  // Deriving it twice is how the two drift apart and consent is checked for one person while mail
  // goes to another.
  const { repository, suppressionQueries, updates } = repositoryStub({
    users: { 'u-1': { id: 'u-1', email: 'Resolved@Example.test' } },
    suppressions: [{ channel: 'email', address: 'resolved@example.test', scope: 'marketing', reason: 'unsubscribe', released_at: null }],
  });
  const { worker, providerCalls } = workerWith(repository);

  await worker.deliverNotification({
    id: 6, channel: 'email', recipient_user_id: 'u-1',
    payload: { classification: 'marketing', unsubscribe_url: UNSUB }, // no address on the payload at all
  });

  assert.deepEqual(suppressionQueries, [{ channel: 'email', address: 'resolved@example.test' }],
    'the suppression lookup key is the resolved address, lowercased');
  assert.equal(providerCalls(), 0);
  assert.ok(updates.some((u) => u.last_error_code === 'recipient_suppressed'));
});

test('J7 a MARKETING unsubscribe never blocks security or transactional Email', async () => {
  // Physically certified during Email 1.0 and must stay true: opting out of marketing is not opting
  // out of being told your password was reset.
  const { repository, suppressionQueries } = repositoryStub({
    suppressions: [{ channel: 'email', address: 'gone@example.test', scope: 'marketing', reason: 'unsubscribe', released_at: null }],
  });
  const { worker, providerCalls } = workerWith(repository);

  // The four canonical non-marketing families. G2 retired 'auth' — account protection is `security`.
  for (const classification of ['security', 'transactional', 'conversational', 'service']) {
    await worker.deliverNotification({
      id: `s-${classification}`, channel: 'email', message: 'Account notice.',
      payload: { classification, email: 'gone@example.test' },
    });
  }

  assert.equal(providerCalls(), 4, 'every non-marketing family still sends');
  assert.equal(suppressionQueries.length, 0, 'the marketing consent store is not even consulted for them');
});

test('J8 a marketing consent fault must not block a P0 security Email either', async () => {
  const { repository } = repositoryStub({ listThrows: new Error('everything is on fire') });
  const { worker, providerCalls } = workerWith(repository);

  await worker.deliverNotification({ id: 8, channel: 'email', payload: { classification: 'security', email: 'user@example.test' } });

  assert.equal(providerCalls(), 1, 'fail-closed is scoped to marketing; security mail is not held hostage by it');
});

// ---------- the consent authority in isolation ----------

test('J9 lookup-failure classification is a narrow transient allow-list', () => {
  for (const [error, expected] of [
    [Object.assign(new Error('x'), { code: '08006' }), MARKETING_CONSENT_DISPOSITIONS.TRANSIENT],
    [Object.assign(new Error('x'), { code: '53300' }), MARKETING_CONSENT_DISPOSITIONS.TRANSIENT],
    [new Error('list failed: fetch failed'), MARKETING_CONSENT_DISPOSITIONS.TRANSIENT],
    [new Error('list failed: socket hang up'), MARKETING_CONSENT_DISPOSITIONS.TRANSIENT],
    [new Error('list failed: statement timeout'), MARKETING_CONSENT_DISPOSITIONS.TRANSIENT],
    [Object.assign(new Error('relation does not exist'), { code: '42P01' }), MARKETING_CONSENT_DISPOSITIONS.DURABLE],
    [new Error('something nobody has seen before'), MARKETING_CONSENT_DISPOSITIONS.DURABLE],
  ]) {
    assert.equal(classifyConsentLookupFailure(error), expected, error.message);
  }
});

test('J10 a consent reader that returns a non-list has not established state', async () => {
  const verdict = await evaluateMarketingConsent({
    notification: { channel: 'email', payload: { classification: 'marketing' } },
    repository: { list: async () => null },
    channel: 'email',
    address: 'x@example.test',
  });
  assert.equal(verdict.state, MARKETING_CONSENT_STATES.UNAVAILABLE);
  assert.equal(verdict.disposition, MARKETING_CONSENT_DISPOSITIONS.DURABLE);
});

test('J11 a released suppression does not suppress', async () => {
  const verdict = await evaluateMarketingConsent({
    notification: { channel: 'email', payload: { classification: 'marketing' } },
    repository: { list: async () => [{ scope: 'marketing', reason: 'unsubscribe', released_at: '2026-01-01T00:00:00Z' }] },
    channel: 'email',
    address: 'x@example.test',
  });
  assert.equal(verdict.state, MARKETING_CONSENT_STATES.PERMITTED);
});

// ============================================================================
// K. THE EXACTLY-ONE PRESENTATION CONTRACT
// ============================================================================

test('K1 ZERO canonical unsubscribe blocks → refuse, provider not called', async () => {
  const { result, calls } = await brevoSend({ body: 'Raw copy with no control.' });
  assert.equal(result.accepted, false);
  assert.equal(result.errorCode, UNSUBSCRIBE_PRESENTATION_ERRORS.MISSING);
  assert.equal(result.retryable, false);
  assert.equal(calls, 0, 'zero provider calls');
});

test('K2 EXACTLY ONE canonical unsubscribe block → accepted', async () => {
  const composed = composeMarketing(SENTINEL);
  const { result, captured, calls } = await brevoSend({ body: composed.text, html: composed.html });

  assert.equal(result.accepted, true);
  assert.equal(calls, 1);
  assert.equal(result.providerMetadata.marketing_unsubscribe_blocks, 1);
  // one canonical action in each representation
  assert.equal(captured.htmlContent.split('data-carup-unsubscribe=').length - 1, 1);
  assert.equal(captured.textContent.split(UNSUB).length - 1, 1);
});

test('K3 TWO canonical unsubscribe blocks → refuse, provider not called', async () => {
  const once = composeMarketing(SENTINEL);
  // A second block, as a duplicated footer or a renderer that ran twice would produce.
  const twice = {
    html: `${once.html}${unsubscribeHtmlBlock(UNSUB)}`,
    text: `${once.text}\n\n${unsubscribeTextBlock(UNSUB)}`,
  };
  const { result, calls } = await brevoSend({ body: twice.text, html: twice.html });

  assert.equal(result.accepted, false);
  assert.equal(result.errorCode, UNSUBSCRIBE_PRESENTATION_ERRORS.DUPLICATED);
  assert.equal(calls, 0, 'zero provider calls');
});

test('K4 the adapter does not alter the supplied body — byte-for-byte pass-through', async () => {
  const composed = composeMarketing(SENTINEL);
  const { captured, result } = await brevoSend({ body: composed.text, html: composed.html });

  assert.equal(captured.textContent, composed.text, 'transport must not rewrite the text part');
  assert.equal(captured.htmlContent, composed.html, 'transport must not rewrite the HTML part');
  assert.equal(result.providerMetadata.marketing_content_unmodified_by_transport, true);
  // and the original editorial copy is intact inside it
  assert.ok(captured.textContent.includes(SENTINEL));
  assert.ok(captured.htmlContent.includes('SENTINEL-BODY-DO-NOT-TOUCH'));
});

test('K5 the marker distinguishes the canonical control from copy that merely says "unsubscribe"', () => {
  const editorial = 'You can unsubscribe from CarUp marketing email at any time. Unsubscribe means unsubscribe.';
  const composed = composeMarketing(editorial);
  const verdict = validateMarketingUnsubscribePresentation({
    html: composed.html, text: composed.text, unsubscribeUrl: UNSUB, headerUrl: UNSUB,
  });
  assert.equal(verdict.ok, true, 'three mentions of the word must not read as three controls');
  assert.equal(verdict.counts.markers, 1);
});

test('K6 the renderer REFUSES rather than emitting a second control', () => {
  // Editorial copy that quotes the unsubscribe link — a "manage your preferences" newsletter is
  // exactly this. The renderer proves compliance itself rather than leaving it to transport, so the
  // refusal happens before anything is queued for a provider at all.
  const rendered = renderEmailForNotification(
    { title: 'CarUp Weekly', message: `Prefer fewer emails? Use ${UNSUB} to stop them.`, payload: { classification: 'marketing', unsubscribe_url: UNSUB } },
    { env: {} },
  );
  assert.equal(rendered.ok, false);
  assert.equal(rendered.errorCode, UNSUBSCRIBE_PRESENTATION_ERRORS.DUPLICATED);

  // And the ordinary case still produces exactly one.
  const clean = composeMarketing(SENTINEL);
  assert.equal(clean.html.split('data-carup-unsubscribe=').length - 1, 1);
  assert.equal(clean.text.split(UNSUB).length - 1, 1);
});

test('K7 the E7 control survives: marketing with no unsubscribe URL is refused before any provider call', async () => {
  const data = marketingData();
  delete data.unsubscribe_url;
  const { result, calls } = await brevoSend({ body: 'hi', data });
  assert.equal(result.accepted, false);
  assert.equal(result.errorCode, 'unsubscribe_action_missing');
  assert.equal(calls, 0);
});

test('K8 a control that links somewhere other than the canonical URL is refused', async () => {
  const composed = composeMarketing(SENTINEL, 'https://carup.dev/api/communications/unsubscribe?token=OTHER');
  const { result, calls } = await brevoSend({ body: composed.text.replace('token=OTHER', 'token=tok-g3'), html: composed.html });
  assert.equal(result.accepted, false);
  assert.equal(result.errorCode, UNSUBSCRIBE_PRESENTATION_ERRORS.INCONSISTENT);
  assert.equal(calls, 0);
});

// ============================================================================
// G. VISIBLE URL == TEXT URL == TRANSPORT TARGET
// ============================================================================

test('G1 the visible href, the plain-text URL and the List-Unsubscribe target are one identity', async () => {
  // Two query parameters, so the HTML representation genuinely differs from the URL itself.
  const url = 'https://carup.dev/api/communications/unsubscribe?token=tok-g3&campaign=c1';
  const data = marketingData({ unsubscribe_url: url, unsubscribe_mailto: 'unsubscribe+tok-g3@mail.carup.dev' });
  const composed = composeMarketing(SENTINEL, url);
  const { captured, result } = await brevoSend({ body: composed.text, html: composed.html, data });

  // HTML representation: escaped exactly once (G1).
  assert.ok(captured.htmlContent.includes(`href="https://carup.dev/api/communications/unsubscribe?token=tok-g3&amp;campaign=c1"`));
  assert.ok(!captured.htmlContent.includes('&amp;amp;'));
  // Text representation: the URL itself, never HTML-escaped.
  assert.ok(captured.textContent.includes(url));
  assert.ok(!captured.textContent.includes('&amp;'));
  // Transport representation: the raw URL, never HTML-escaped.
  assert.equal(captured.headers['List-Unsubscribe'], `<${url}>, <mailto:unsubscribe+tok-g3@mail.carup.dev>`);
  assert.equal(captured.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

  assert.equal(result.providerMetadata.list_unsubscribe_target_matches_visible_url, true);
  assert.equal(result.providerMetadata.marketing_html_anchor_present, true);
  assert.equal(result.providerMetadata.marketing_text_link_present, true);
});

test('G2 a header target that disagrees with the visible control is refused', () => {
  const composed = composeMarketing(SENTINEL);
  const verdict = validateMarketingUnsubscribePresentation({
    html: composed.html, text: composed.text, unsubscribeUrl: UNSUB,
    headerUrl: 'https://carup.dev/api/communications/unsubscribe?token=DIFFERENT',
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.errorCode, UNSUBSCRIBE_PRESENTATION_ERRORS.INCONSISTENT);
});

test('G3 the mailto fallback may exist but the HTTPS action stays authoritative', async () => {
  const data = marketingData({ unsubscribe_mailto: 'unsubscribe+tok-g3@mail.carup.dev' });
  const composed = composeMarketing(SENTINEL);
  const { captured } = await brevoSend({ body: composed.text, html: composed.html, data });
  assert.ok(captured.headers['List-Unsubscribe'].startsWith(`<${UNSUB}>`), 'the https URI comes first');
  assert.ok(captured.headers['List-Unsubscribe'].includes('<mailto:'), 'the RFC 2369 fallback is retained');
});

// ============================================================================
// H. NON-MARKETING FAMILIES
// ============================================================================

test('H1 a non-marketing Email gains no marketing unsubscribe presentation', async () => {
  const { repository } = repositoryStub({ suppressions: [] });
  const { worker, sent } = workerWith(repository);

  for (const classification of ['security', 'conversational', 'transactional', 'service']) {
    await worker.deliverNotification({
      id: `n-${classification}`, channel: 'email', message: 'Your CarUp account was accessed.',
      // Even carrying an unsubscribe_url, which a shared component could otherwise pick up.
      payload: { classification, email: 'user@example.test', unsubscribe_url: UNSUB },
    });
  }

  assert.equal(sent.length, 4);
  for (const input of sent) {
    // G2 gave these families a real HTML part. The rule is therefore stated in its durable form:
    // not "they have no HTML", but "whatever HTML they have carries no marketing control".
    assert.ok(input.content.body.includes('Your CarUp account was accessed.'), 'the meaning survives');
    assert.ok(!String(input.content.html || '').includes('data-carup-unsubscribe'),
      'no marketing unsubscribe control in a non-marketing Email');
    assert.ok(!input.content.body.includes(UNSUB), 'nor in the text part');
    assert.ok(!/Unsubscribe from CarUp marketing email/.test(String(input.content.html || '')));
  }
});

test('H1b the contract reads BOTH ways — a non-marketing Email may not CARRY the control', async () => {
  // H1 proves nothing is added. This proves nothing may arrive. The distinction matters because G2
  // introduces one footer module switching between three families, and a wrong branch there would
  // ship a security Email inviting the reader to unsubscribe from mail they cannot unsubscribe from.
  // Stated as "its HTML carries no marker" rather than "it has no HTML", so it survives a renderer
  // that legitimately gives these families an HTML part.
  let calls = 0;
  const resend = new ResendEmailAdapter({
    env: { RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'notifications@mail.carup.dev' },
    fetchImpl: async () => { calls += 1; return { ok: true, status: 200, text: async () => '{}', headers: new Map() }; },
  });
  const contaminated = `<div><p>Your password was reset.</p></div>${unsubscribeHtmlBlock(UNSUB)}`;
  const r = await resend.send({
    content: { subject: 'Security', body: 'Your password was reset.', html: contaminated, data: { classification: 'security', email: 'u@example.test' } },
  });

  assert.equal(r.accepted, false);
  assert.equal(r.errorCode, UNSUBSCRIBE_PRESENTATION_ERRORS.NOT_PERMITTED);
  assert.equal(calls, 0, 'zero provider calls');
});

test('H1c the reverse guard keys on the marker, never on the word', () => {
  // A transactional Email may legitimately discuss unsubscribing, and a support thread about it must
  // still be deliverable.
  const talksAboutIt = '<p>You asked how to unsubscribe from CarUp marketing email. Here is how.</p>';
  assert.equal(assertNoMarketingUnsubscribePresentation({ html: talksAboutIt }).ok, true);
  assert.equal(assertNoMarketingUnsubscribePresentation({ html: unsubscribeHtmlBlock(UNSUB) }).ok, false);
});

test('H2 marketing unsubscribe is not a general footer — non-marketing keeps its own links', async () => {
  // The auth family renders its own footer through authEmailTemplates.js, which G3 does not touch.
  const { renderAuthEmail } = await import('../services/communication/authEmailTemplates.js');
  const { html } = renderAuthEmail('reset_password', { CARUP_WEB_ORIGIN: 'https://carup.dev' }, { action_url: 'https://carup.dev/reset?token=t' });
  assert.ok(!html.includes('data-carup-unsubscribe'), 'a security Email must never carry a marketing unsubscribe control');
  assert.ok(!/Unsubscribe from CarUp marketing email/.test(html));
});

// ============================================================================
// L. THE COMPLIANCE RECEIPT DESCRIBES THE ACTUAL PAYLOAD
// ============================================================================

test('L1 providerMetadata reports what was put on the wire, field by field', async () => {
  const composed = composeMarketing(SENTINEL);
  const { result, captured } = await brevoSend({ body: composed.text, html: composed.html });
  const m = result.providerMetadata;

  assert.equal(m.marketing_unsubscribe_url_present, true);
  assert.equal(m.marketing_html_part_sent, true);
  assert.equal(m.marketing_html_anchor_present, true);
  assert.equal(m.marketing_text_link_present, true);
  assert.equal(m.list_unsubscribe_header_sent, true);
  assert.equal(m.list_unsubscribe_post_header_sent, true);
  assert.equal(m.marketing_unsubscribe_blocks, 1);
  assert.equal(m.marketing_unsubscribe_presentation_validated, true);
  assert.equal(m.marketing_content_unmodified_by_transport, true);

  // Anti-vacuity: each claim is checkable against the captured payload independently.
  assert.ok(captured.htmlContent.length > 0);
  assert.ok(captured.headers['List-Unsubscribe']);
});

test('L2 the worker persists the receipt onto the delivery attempt', async () => {
  const attempts = [];
  const repository = {
    list: async () => [],
    findOne: async () => null,
    insert: async (table, row) => { if (table === 'message_delivery_attempts') attempts.push(row); return { id: 'a' }; },
    updateById: async (_t, id) => ({ id }),
  };
  const adapterRegistry = {
    get: () => ({
      provider: 'brevo',
      send: async () => ({ accepted: true, providerStatus: 'accepted', providerMetadata: { marketing_unsubscribe_blocks: 1 } }),
    }),
  };
  const worker = new CommunicationDeliveryWorker({ repository, adapterRegistry });
  await worker.deliverNotification({ id: 'l2', channel: 'email', message: 'x', payload: { classification: 'marketing', email: 'a@example.test', unsubscribe_url: UNSUB } });

  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].response_metadata.provider_metadata.marketing_unsubscribe_blocks, 1);
});

// ============================================================================
// B. G0 ORDERING IS PRESERVED
// ============================================================================

test('B1 recipient resolution still runs BEFORE the consent lookup', async () => {
  // The consent key is the resolved address, so resolution has to have happened first. If the order
  // ever inverts, the lookup below is made with an empty address and this fails.
  const order = [];
  const repository = {
    list: async (table, filters) => {
      if (table === 'channel_identities') { order.push('resolve'); return []; }
      if (table === 'communication_suppressions') { order.push(`consent:${filters.address}`); return []; }
      return [];
    },
    findOne: async (table) => (table === 'users' ? { id: 'u-9', email: 'late@example.test' } : null),
    insert: async () => ({ id: 'x' }),
    updateById: async (_t, id) => ({ id }),
  };
  const { worker } = workerWith(repository);
  await worker.deliverNotification({
    id: 'b1', channel: 'email', recipient_user_id: 'u-9',
    payload: { classification: 'marketing', unsubscribe_url: UNSUB },
  });

  assert.deepEqual(order, ['resolve', 'consent:late@example.test']);
});

test('B2 an unresolved recipient is refused before consent is ever consulted', async () => {
  const { repository, suppressionQueries } = repositoryStub({ suppressions: [] });
  const { worker, providerCalls } = workerWith(repository);

  await worker.deliverNotification({ id: 'b2', channel: 'email', payload: { classification: 'marketing' } });

  assert.equal(providerCalls(), 0);
  assert.equal(suppressionQueries.length, 0, 'no address means nothing to look consent up by');
});

// ============================================================================
// A2. THE SAME FAIL-OPEN ONE LAYER UP — queue-time canonical suppression
// ============================================================================

test('A2 a queue-time consent lookup fault suppresses MARKETING but never security mail', async () => {
  const { CommunicationNotificationService } = await import('../services/communication/communicationNotificationService.js');
  const repository = {
    list: async (table) => { if (table === 'communication_suppressions') throw new Error('lookup exploded'); return []; },
    findOne: async () => null,
  };
  const service = new CommunicationNotificationService({ repository });

  const marketing = await service.suppressedByCanonicalState({ address: 'a@example.test', transactional: false }, 'email');
  assert.equal(marketing, 'suppressed_consent_state_unavailable', 'failing to read consent is not consent');

  const security = await service.suppressedByCanonicalState({ address: 'a@example.test', transactional: true }, 'email');
  assert.equal(security, null, 'a consent fault must never hold a password reset');
});

test('A3 a campaign channel-identity fault suppresses the recipient instead of guessing an address', async () => {
  const { CommunicationCampaignService } = await import('../services/communication/communicationCampaignService.js');
  const service = new CommunicationCampaignService({
    repository: {
      list: async (table) => { if (table === 'channel_identities') throw new Error('lookup exploded'); return []; },
    },
    preferenceService: { getPreferences: async () => ({}), isChannelAllowed: () => true },
  });
  service.frequencyCapped = async () => false;

  const route = await service.resolveRecipient({ id: 'u-1', email: 'fallback@example.test' }, { id: 'c', channel: 'email' });
  assert.equal(route.allowed, false, 'THE DEFECT: it used to fall back to user.email, skipping the opted_out filter entirely');
  assert.equal(route.reason, 'channel_consent_state_unavailable');
});
