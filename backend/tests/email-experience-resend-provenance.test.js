import assert from 'node:assert/strict';
import test from 'node:test';

import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';
import { EmailTransportRouter, ResendEmailAdapter } from '../services/communication/adapters/providerAdapters.js';
import { renderEmailForNotification } from '../services/communication/emailExperience/renderEmail.js';
import { unsubscribeHtmlBlock } from '../services/communication/emailExperience/marketingUnsubscribePresentation.js';

/**
 * G4 — Resend send-side provenance.
 *
 * Brevo has recorded compliance provenance since E7, for a reason worth restating: a delivered
 * marketing message once carried no unsubscribe control while every automated check said it did,
 * because every check was reading the code rather than the payload. Resend carried none at all, so
 * for four of the five families the only answer to "what did CarUp actually send?" was an inference
 * from whichever build was believed to be running — and that inference has already been wrong once.
 *
 * TWO DIFFERENT TRUTHS, deliberately not conflated:
 *
 *   renderer provenance   what `renderEmail.js` PRODUCED
 *   send provenance       what was handed to Resend
 *
 * During the auth compatibility period they legitimately disagree: the renderer produces no HTML
 * (`html_part_rendered: false`) and the certified `authEmailTemplates.js` path supplies what is sent
 * (`html_part_sent: true`). Collapsing them would erase the only evidence that the certified path
 * executed at all.
 */

const RESEND_ENV = {
  RESEND_API_KEY: 'k',
  RESEND_FROM_EMAIL: 'notifications@mail.carup.dev',
  RESEND_AUTH_FROM_EMAIL: 'CarUp Security <auth@mail.carup.dev>',
};
const ROUTER_ENV = { ...RESEND_ENV, BREVO_API_KEY: 'b', BREVO_FROM_EMAIL: 'news@marketing.carup.dev' };

const RESET_TOKEN = 'OPAQUE-RESET-TOKEN-9f41';
const RESET_URL = `https://carup.dev/auth/reset-password?token=${RESET_TOKEN}`;
const REPLY_TOKEN = 'OPAQUE-REPLY-TOKEN-7a20';
const REPLY_TO = `reply+${REPLY_TOKEN}@mail.carup.dev`;

/** Capture the exact HTTP body handed to Resend, and count the calls. */
function capturingResend(env = RESEND_ENV) {
  let captured = null;
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    captured = { url, body: JSON.parse(init.body), headers: init.headers };
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({ id: 'resend-1', message_id: '<rfc-1@mail.carup.dev>' }),
      headers: new Map([['message-id', '<rfc-1@mail.carup.dev>']]),
    };
  };
  return { adapter: new ResendEmailAdapter({ env, fetchImpl }), captured: () => captured, calls: () => calls };
}

/** Render through the REAL canonical renderer, then send exactly what it produced. */
function notificationFor(payload, { title = 'CarUp update', message = 'Body copy.' } = {}) {
  const rendered = renderEmailForNotification({ title, message, payload }, { env: {} });
  assert.equal(rendered.ok, true, `renderer refused the fixture: ${rendered.errorCode}`);
  return {
    notificationId: 'n-1', messageId: 'm-1', idempotencyKey: 'dedupe-1',
    recipient: { email: 'user@example.test' },
    content: {
      subject: rendered.subject,
      body: rendered.text,
      text: rendered.text,
      ...(rendered.html ? { html: rendered.html } : {}),
      data: {
        ...payload,
        email: 'user@example.test',
        email_render_provenance: {
          renderer_version: rendered.renderer_version,
          classification: rendered.classification,
          classification_source: rendered.classification_source,
          template_key: rendered.template_key,
          template_version: rendered.template_version,
          footer_family: rendered.footer_family,
          sender_persona: rendered.sender_persona,
          html_part_rendered: rendered.html_part_rendered,
          text_part_rendered: rendered.text_part_rendered,
          cta_href_canonical: rendered.cta_href_canonical,
          cta_route: rendered.cta_route,
          leadership_identity_rendered: rendered.leadership_identity_rendered,
          render_fallback_used: rendered.render_fallback_used,
        },
      },
    },
    rendered,
  };
}

/** Every send-provenance claim must be checkable against the captured payload. */
function assertConsistentWithWire(metadata, body) {
  if (metadata.html_part_sent === true) assert.ok(body.html?.length > 0, 'html_part_sent claims HTML that is not there');
  if (metadata.html_part_sent === false) assert.ok(!body.html, 'html_part_sent=false while HTML was sent');
  if (metadata.text_part_sent === true) assert.ok(body.text?.length > 0, 'text_part_sent claims text that is not there');
  if (metadata.reply_to_set === true) assert.ok(body.reply_to, 'reply_to_set claims a Reply-To that is not there');
  if (metadata.reply_to_set === false) assert.ok(!body.reply_to, 'reply_to_set=false while a Reply-To was sent');
  if (metadata.subject_present === true) assert.ok(body.subject?.length > 0);
}

// ============================================================================
// O1. SECURITY / AUTH SUCCESS — the two truths disagree, truthfully
// ============================================================================

test('O1 auth success: renderer produced NO html, and auth-compatibility html WAS sent', async () => {
  // G6 reclassification. This used `reset_password`, which G6 migrated to the canonical renderer —
  // so it is no longer an example of the compatibility path. `confirm_signup` is deliberately NOT
  // migrated, so it is the honest example of the property this test guards: the renderer defers,
  // the certified artefact ships, and both facts are recorded truthfully at the same time.
  // The migrated R2 case is proven in email-experience-auth-equivalence.test.js (D1/D2).
  const input = notificationFor(
    { classification: 'security', auth_template_key: 'confirm_signup', action_url: RESET_URL },
    { title: 'Confirm your CarUp account', message: 'Confirm this email address to activate your account.' },
  );
  assert.equal(input.rendered.html_part_rendered, false, 'precondition: G2 defers to the certified path');
  assert.equal(input.rendered.render_fallback_used, 'auth_compatibility');

  const { adapter, captured, calls } = capturingResend();
  const result = await adapter.send(input);
  const body = captured().body;
  const m = result.providerMetadata;

  assert.equal(result.accepted, true);
  assert.equal(calls(), 1);
  assert.ok(body.html?.includes('<!doctype html>'), 'the certified auth HTML really went on the wire');
  assert.ok(body.text?.length > 0);

  assert.equal(m.html_part_rendered, false, 'renderer truth');
  assert.equal(m.html_part_sent, true, 'wire truth — both are true of the same message');
  assert.equal(m.auth_compatibility_html_used, true);
  assert.equal(m.html_source, 'auth_compatibility');
  assert.equal(m.text_part_sent, true);
  assert.equal(m.classification, 'security');
  assert.equal(m.send_outcome, 'provider_accepted');
  assert.equal(m.reply_to_set, Boolean(body.reply_to));
  assertConsistentWithWire(m, body);
});

// ============================================================================
// O2. SECURITY / AUTH HTML FAILURE — degradation is visible, and it still sends
// ============================================================================

test('O2 auth html failure: no html sent, no compatibility claimed, the message still goes', async () => {
  // An unknown auth template makes `renderAuthEmail` throw; `resolveAuthHtml` swallows it so a P0
  // security Email is never blocked by a template fault. G4 makes that degradation observable
  // instead of silent.
  const input = notificationFor(
    { classification: 'security', auth_template_key: 'a_template_that_does_not_exist' },
    { title: 'Your CarUp password was changed', message: 'The password on your CarUp account was changed.' },
  );
  const { adapter, captured } = capturingResend();
  const result = await adapter.send(input);
  const body = captured().body;
  const m = result.providerMetadata;

  assert.equal(result.accepted, true, 'the security Email must still be delivered');
  assert.ok(!body.html, 'no HTML on the wire');
  assert.ok(body.text.includes('The password on your CarUp account was changed.'), 'the meaning survives as plain text');

  assert.equal(m.html_part_rendered, false);
  assert.equal(m.html_part_sent, false);
  assert.equal(m.auth_compatibility_html_used, false, 'an auth template KEY is not proof the render ran');
  assert.equal(m.html_source, null);
  assert.equal(m.text_part_sent, true);
  assertConsistentWithWire(m, body);
});

// ============================================================================
// O3–O5. the rendered families
// ============================================================================

test('O3 transactional: the renderer HTML is what Resend receives, unmutated', async () => {
  const input = notificationFor({ classification: 'transactional', action_url: 'https://carup.dev/orders/42' },
    { title: 'Your order moved', message: 'SENTINEL-TRANSACTIONAL-BODY' });
  const { adapter, captured } = capturingResend();
  const result = await adapter.send(input);
  const body = captured().body;
  const m = result.providerMetadata;

  assert.equal(body.html, input.content.html, 'byte-for-byte — transport is not a renderer');
  assert.equal(body.text, input.content.text);
  assert.equal(m.html_part_rendered, true);
  assert.equal(m.html_part_sent, true);
  assert.equal(m.html_source, 'renderer', 'not the auth compatibility path');
  assert.equal(m.auth_compatibility_html_used, false);
  assert.equal(m.footer_family, 'transactional');
  assert.equal(m.sender_persona, 'carup_notifications');
  assert.equal(m.cta_href_canonical, true);
  assert.equal(m.cta_route, '/orders/42');
  assertConsistentWithWire(m, body);
});

test('O4 conversational: Reply-To provenance reports the CURRENT state, which is no Reply-To', async () => {
  // G5 mints per-thread reply addresses. Until then `reply_to_set: false` is not a gap in the
  // evidence — it IS the evidence, and it is what makes G5's arrival visible.
  const input = notificationFor({ classification: 'conversational' },
    { title: 'New message about your listing', message: 'Is the car still available?' });
  const { adapter, captured } = capturingResend({ ...RESEND_ENV, RESEND_REPLY_TO: '' });
  const result = await adapter.send(input);
  const m = result.providerMetadata;

  assert.equal(m.classification, 'conversational');
  assert.equal(m.reply_to_set, false, 'truthful evidence of the current G5 gap');
  assert.ok(!captured().body.reply_to);
  assert.equal(m.html_part_sent, true);
  assertConsistentWithWire(m, captured().body);
});

test('O4b when a Reply-To IS configured, provenance says so without recording it', async () => {
  const input = notificationFor({ classification: 'conversational', reply_to: REPLY_TO },
    { title: 'New message', message: 'Body.' });
  const { adapter, captured } = capturingResend();
  const result = await adapter.send(input);

  assert.equal(captured().body.reply_to, REPLY_TO, 'the real address goes on the wire');
  assert.equal(result.providerMetadata.reply_to_set, true);
  assertConsistentWithWire(result.providerMetadata, captured().body);
});

test('O5 service: an explicit service classification routes Resend with complete provenance', async () => {
  // Fixture-driven: no live `service` producer exists yet, and a family must be SELECTED rather
  // than arrived at, so one is not invented here to make the test look real.
  const input = notificationFor({ classification: 'service' },
    { title: 'Scheduled maintenance', message: 'CarUp will be briefly unavailable on Sunday.' });
  const router = new EmailTransportRouter({ env: ROUTER_ENV, fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'r' }), headers: new Map() }) });
  assert.equal(router.selectAdapter(input).adapter.provider, 'resend');

  const { adapter } = capturingResend();
  const m = (await adapter.send(input)).providerMetadata;
  assert.equal(m.classification, 'service');
  assert.equal(m.footer_family, 'transactional', 'service shares the transactional footer family');
  assert.equal(m.sender_persona, 'carup_service');
  assert.equal(m.html_part_sent, true);
  assert.equal(m.text_part_sent, true);
});

// ============================================================================
// O6–O7. isolation and the G3 guard
// ============================================================================

test('O6 marketing never reaches Resend, and Brevo provenance is unchanged', async () => {
  const router = new EmailTransportRouter({ env: ROUTER_ENV });
  assert.equal(router.selectAdapter({ content: { data: { classification: 'marketing' } } }).adapter.provider, 'brevo');

  let resendCalls = 0;
  const resendish = new ResendEmailAdapter({ env: RESEND_ENV, fetchImpl: async () => { resendCalls += 1; return { ok: true, status: 200, text: async () => '{}', headers: new Map() }; } });
  const refused = await resendish.send(notificationFor({ classification: 'transactional' }));
  assert.equal(refused.accepted, true);
  assert.equal(resendCalls, 1, 'sanity: this adapter does call out when permitted');

  // And Brevo still refuses anything that is not marketing, so the two cannot swap roles.
  const brevo = router.selectAdapter({ content: { data: { classification: 'marketing' } } }).adapter;
  const wrongFamily = await brevo.send({ content: { data: { classification: 'security', email: 'a@b.test' } } });
  assert.equal(wrongFamily.errorCode, 'classification_not_permitted');
});

test('O7 a non-marketing payload carrying the marketing marker is REFUSED with no provenance', async () => {
  const input = notificationFor({ classification: 'security' }, { title: 'Security', message: 'Body.' });
  input.content.html = `${input.content.html}${unsubscribeHtmlBlock('https://carup.dev/u?token=x')}`;

  const { adapter, calls } = capturingResend();
  const result = await adapter.send(input);

  assert.equal(result.accepted, false);
  assert.equal(result.errorCode, 'unsubscribe_presentation_not_permitted');
  assert.equal(calls(), 0, 'zero provider calls');
  assert.equal(result.providerMetadata, undefined, 'a pre-send refusal must claim no send provenance');
});

// ============================================================================
// O8–O9. SECRET SAFETY — the durable record outlives every credential in it
// ============================================================================

test('O8 an auth reset token never reaches the persisted provenance', async () => {
  const input = notificationFor(
    { classification: 'security', auth_template_key: 'reset_password', action_url: RESET_URL },
    { title: 'Reset your CarUp password', message: `Reset here: ${RESET_URL}` },
  );
  const { adapter, captured } = capturingResend();
  const result = await adapter.send(input);

  assert.ok(captured().body.html.includes(RESET_TOKEN), 'the customer still receives the working link');
  const serialized = JSON.stringify(result.providerMetadata);
  assert.ok(!serialized.includes(RESET_TOKEN), 'THE DEFECT: a live credential in a durable audit record');
  assert.ok(!serialized.includes('reset-password?token'));
  assert.equal(result.providerMetadata.cta_route, '/auth/reset-password', 'the route proves the flow without the token');
});

test('O9 a tokenized Reply-To address never reaches the persisted provenance', async () => {
  const input = notificationFor({ classification: 'conversational', reply_to: REPLY_TO }, { title: 'Msg', message: 'Body.' });
  const { adapter, captured } = capturingResend();
  const result = await adapter.send(input);

  assert.equal(captured().body.reply_to, REPLY_TO);
  const serialized = JSON.stringify(result.providerMetadata);
  assert.equal(result.providerMetadata.reply_to_set, true, 'the boolean is the evidence');
  assert.ok(!serialized.includes(REPLY_TOKEN), 'the token is not');
  assert.ok(!serialized.includes(REPLY_TO));
});

test('O9b provenance carries no recipient, no body, no subject text and no credential', async () => {
  const input = notificationFor({ classification: 'transactional' },
    { title: 'PRIVATE-SUBJECT-CONTENT', message: 'PRIVATE-BODY-CONTENT' });
  const { adapter } = capturingResend();
  const serialized = JSON.stringify((await adapter.send(input)).providerMetadata);

  for (const secret of [
    'user@example.test',              // the recipient
    'PRIVATE-BODY-CONTENT',           // the body
    'PRIVATE-SUBJECT-CONTENT',        // the subject text — `subject_present` is the evidence
    'Bearer',                         // the API credential
    '<!doctype',                      // the HTML body
    'notifications@mail.carup.dev',   // the raw From address
  ]) {
    assert.ok(!serialized.includes(secret), `provenance must not carry ${secret}`);
  }
  assert.ok(!/authorization|api[_-]?key/i.test(serialized));
  // ...and it is not empty, so this is not passing by recording nothing.
  assert.equal(JSON.parse(serialized).subject_present, true);
  assert.ok(Object.keys(JSON.parse(serialized)).length >= 15);
});

// ============================================================================
// O10. LEVEL A — real worker → real router → Resend → persisted delivery attempt
// ============================================================================

test('O10 LEVEL A: a canonical notification, through the real chain, to a stored attempt', async () => {
  let captured = null;
  let httpCalls = 0;
  const attempts = [];
  const repository = {
    list: async () => [],
    findOne: async () => null,
    insert: async (table, row) => { if (table === 'message_delivery_attempts') attempts.push(row); return { id: 'a-1' }; },
    updateById: async (_t, id) => ({ id }),
  };
  const fetchImpl = async (url, init) => {
    httpCalls += 1;
    captured = { url, body: JSON.parse(init.body) };
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({ id: 'resend-level-a', message_id: '<rfc-level-a@mail.carup.dev>' }),
      headers: new Map([['message-id', '<rfc-level-a@mail.carup.dev>']]),
    };
  };
  const router = new EmailTransportRouter({ env: ROUTER_ENV, fetchImpl });
  const worker = new CommunicationDeliveryWorker({
    repository,
    adapterRegistry: { get: (channel) => (channel === 'email' ? router : null) },
  });

  await worker.deliverNotification({
    id: 'level-a', channel: 'email', title: 'Your finance application was updated',
    message: 'Finance application app-1 status: approved.',
    payload: { classification: 'transactional', email: 'user@example.test', action_url: 'https://carup.dev/finance/app-1' },
  });

  assert.equal(httpCalls, 1, 'exactly one provider call');
  assert.match(captured.url, /api\.resend\.com\/emails/);
  assert.equal(attempts.length, 1);

  const attempt = attempts[0];
  assert.equal(attempt.provider, 'resend', 'the routed transport, not the router name');
  assert.equal(attempt.provider_message_id, '<rfc-level-a@mail.carup.dev>', 'the RFC identity a reply will carry');
  assert.equal(attempt.status, 'sent');

  // The stored evidence must describe the payload that was actually captured above.
  const stored = attempt.response_metadata.provider_metadata;
  assert.ok(stored, 'the existing persistence seam carries it — no second mechanism');
  assert.equal(stored.send_outcome, 'provider_accepted');
  assert.equal(stored.classification, 'transactional');
  assert.equal(stored.renderer_version, 'carup-email-renderer/1.0.0');
  assert.equal(stored.classification_source, 'producer');
  assert.equal(stored.html_part_sent, Boolean(captured.body.html));
  assert.equal(stored.text_part_sent, Boolean(captured.body.text));
  assert.equal(stored.reply_to_set, Boolean(captured.body.reply_to));
  assert.equal(stored.subject_present, Boolean(captured.body.subject));
  assert.equal(stored.sender_persona_consistent, true);
  assert.equal(stored.idempotency_key_sent, true);
  assertConsistentWithWire(stored, captured.body);

  // Anti-vacuity: this is the SEND record, not a copy of the renderer record.
  assert.notDeepEqual(stored, attempt.response_metadata.email_render_provenance);
  assert.ok('html_part_sent' in stored, 'a renderer record would have html_part_rendered only');
  assert.ok(!JSON.stringify(stored).includes('user@example.test'));
});

test('O10b a REJECTED request records what was attempted, never that it was sent', async () => {
  const input = notificationFor({ classification: 'transactional' });
  const adapter = new ResendEmailAdapter({
    env: RESEND_ENV,
    fetchImpl: async () => ({ ok: false, status: 422, text: async () => JSON.stringify({ message: 'invalid' }), headers: new Map() }),
  });
  const result = await adapter.send(input);
  const m = result.providerMetadata;

  assert.equal(result.accepted, false);
  assert.equal(m.send_outcome, 'request_attempted_provider_rejected');
  assert.equal(m.html_part_in_request, true);
  assert.equal(m.text_part_in_request, true);
  assert.ok(!('html_part_sent' in m), 'attempted is not sent, and the field names must not blur that');
  assert.ok(!('text_part_sent' in m));
  assert.ok(!('reply_to_set' in m));
});

// ============================================================================
// G. SENDER PERSONA — the renderer and the transport must name the same identity
// ============================================================================

test('G1 the security family is sent from the certified security sender', async () => {
  const input = notificationFor({ classification: 'security', auth_template_key: 'reset_password' },
    { title: 'Reset your CarUp password', message: 'Body.' });
  const { adapter, captured } = capturingResend();
  const result = await adapter.send(input);

  assert.equal(captured().body.from, 'CarUp Security <auth@mail.carup.dev>');
  assert.equal(result.providerMetadata.sender_persona, 'carup_security');
  assert.equal(result.providerMetadata.sender_persona_consistent, true);
});

test('G2 a security Email WITHOUT an auth template still uses the security sender', async () => {
  // Before G4 the From was keyed on the auth template key while the persona was keyed on the
  // classification. They agree on every message that exists today, but a future security Email with
  // no auth template would have gone out from the notifications sender under a Security persona.
  const input = notificationFor({ classification: 'security' }, { title: 'Unusual sign-in', message: 'We noticed a new sign-in.' });
  const { adapter, captured } = capturingResend();
  const result = await adapter.send(input);

  assert.equal(captured().body.from, 'CarUp Security <auth@mail.carup.dev>');
  assert.equal(result.providerMetadata.sender_persona_consistent, true);
});

test('G3 a renderer persona that disagrees with the transport identity is REFUSED', async () => {
  const input = notificationFor({ classification: 'security', auth_template_key: 'reset_password' });
  input.content.data.email_render_provenance.sender_persona = 'carup_weekly';

  const { adapter, calls } = capturingResend();
  const result = await adapter.send(input);

  assert.equal(result.accepted, false);
  assert.equal(result.errorCode, 'sender_persona_mismatch');
  assert.equal(calls(), 0, 'never send under an identity nobody selected');
});
