import assert from 'node:assert/strict';
import test from 'node:test';

import { CommunicationTemplateService } from '../services/communication/communicationTemplateService.js';
import { CommunicationGovernedTemplateService } from '../services/communication/communicationGovernedTemplateService.js';

/**
 * G1 — ONE ESCAPING AUTHORITY.
 *
 * The defect: both template services HTML-escaped variable values while building the CANONICAL
 * PLAIN-TEXT subject/body/text. So `Automotive Intelligence & Trust Network` became
 * `... &amp; ...` before it ever reached an HTML boundary, and a correct HTML producer escaping it
 * again would show the customer `&amp;amp;`.
 *
 * Ownership after this change:
 *   plain text / subject  preserve literal semantic characters
 *   HTML                  escape ONCE, at the HTML rendering boundary
 *   URL                   encode per URL semantics
 *   provider JSON         JSON serialization only; never pre-HTML-escape
 */

const DESCRIPTOR = 'Automotive Intelligence & Trust Network';

/** Governed service driven by a stub registry, so the governed path is genuinely exercised. */
function governedWith({ subject_template, body_template }) {
  const repository = {
    findOne: async (table) => (table === 'communication_templates'
      ? { id: 't1', template_key: 'g_v1', status: 'active', classification: 'transactional' }
      : null),
    list: async (table) => (table === 'communication_template_versions'
      ? [{
        id: 'v1', template_id: 't1', version: 1, channel: 'email', language: 'en',
        approval_status: 'approved', subject_template, body_template, required_variables: [],
      }]
      : []),
  };
  return new CommunicationGovernedTemplateService({
    repository,
    fallbackService: new CommunicationTemplateService(),
  });
}

// ---------- A. governed path ----------

test('GOVERNED: an ampersand stays literal in plain text', async () => {
  const svc = governedWith({ subject_template: 'CarUp — {{descriptor}}', body_template: 'From {{descriptor}}.' });
  const r = await svc.render('g_v1', { descriptor: DESCRIPTOR }, { channel: 'email' });
  assert.equal(r.body, `From ${DESCRIPTOR}.`);
  assert.equal(r.text, `From ${DESCRIPTOR}.`);
  assert.ok(!r.body.includes('&amp;'), 'plain text must never carry an HTML entity');
});

test('GOVERNED: subjects are not HTML — the ampersand stays literal', async () => {
  const svc = governedWith({ subject_template: 'Your CarUp update — {{topic}}', body_template: 'x' });
  const r = await svc.render('g_v1', { topic: 'Parts & Service' }, { channel: 'email' });
  assert.equal(r.subject, 'Your CarUp update — Parts & Service');
  assert.ok(!r.subject.includes('&amp;'), 'an RFC subject must not carry HTML entities');
});

test('GOVERNED: angle brackets, quotes and apostrophes stay literal', async () => {
  const svc = governedWith({ subject_template: 's', body_template: '{{a}} | {{b}}' });
  const r = await svc.render('g_v1', { a: 'A < B > C', b: `"CarUp" & O'Brien` }, { channel: 'email' });
  assert.equal(r.body, `A < B > C | "CarUp" & O'Brien`);
  for (const ent of ['&lt;', '&gt;', '&quot;', '&#39;', '&amp;']) {
    assert.ok(!r.body.includes(ent), `plain text must not contain ${ent}`);
  }
});

// ---------- B. fallback path — identical semantics ----------

test('FALLBACK: the pre-registry path preserves literals exactly like the governed path', () => {
  const svc = new CommunicationTemplateService();
  const r = svc.render('message_acknowledgement_v1', { topic: `A < B & C > D "q" O'Brien` });
  const blob = `${r.subject}\n${r.body}\n${r.text}`;
  assert.ok(blob.includes(`A < B & C > D "q" O'Brien`), 'fallback must preserve the literal value');
  for (const ent of ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;']) {
    assert.ok(!blob.includes(ent), `fallback plain text must not contain ${ent}`);
  }
});

test('FALLBACK: the descriptor survives intact', () => {
  const r = new CommunicationTemplateService().render('message_acknowledgement_v1', { topic: DESCRIPTOR });
  assert.ok(`${r.body}${r.text}${r.subject}`.includes(DESCRIPTOR));
});

// ---------- C. the HTML boundary escapes ONCE ----------

/**
 * Send a marketing body through the real chain and return the payload that reached the wire.
 *
 * G3 moved HTML synthesis out of the Brevo adapter: the Email Experience presentation authority
 * composes finished content, and transport validates and passes it through. The HTML boundary these
 * tests exercise therefore lives in `marketingUnsubscribePresentation.js` now — the boundary moved,
 * the contract did not. Composing here keeps this an end-to-end assertion about what a customer
 * actually receives, rather than a unit test of whichever module currently owns the escaping.
 */
async function synthesizedHtml(text, unsubscribeUrl = 'https://carup.dev/api/communications/unsubscribe?token=t') {
  const { BrevoMarketingAdapter } = await import('../services/communication/adapters/providerAdapters.js');
  const { applyMarketingUnsubscribePresentation } = await import('../services/communication/emailExperience/marketingUnsubscribePresentation.js');
  const composed = applyMarketingUnsubscribePresentation({ text, unsubscribeUrl });

  let captured = null;
  const adapter = new BrevoMarketingAdapter({
    env: { BREVO_API_KEY: 'k', BREVO_FROM_EMAIL: 'news@marketing.carup.dev' },
    fetchImpl: async (_u, init) => {
      captured = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ messageId: '<m@x>' }), headers: new Map() };
    },
  });
  const result = await adapter.send({
    content: {
      subject: 'S',
      body: composed.text,
      html: composed.html,
      data: {
        classification: 'marketing', email: 'x@example.test',
        campaign_id: 'c', campaign_delivery_id: 'd',
        unsubscribe_url: unsubscribeUrl,
        unsubscribe_presentation: composed.provenance,
      },
    },
  });
  if (!captured) throw new Error(`no provider call was made: ${result.errorCode}`);
  return { ...captured, receipt: result.providerMetadata };
}

test('HTML BOUNDARY: the ampersand is escaped EXACTLY once — no &amp;amp;', async () => {
  const body = new CommunicationTemplateService().render('message_acknowledgement_v1', { topic: DESCRIPTOR }).text;
  assert.ok(body.includes('&') && !body.includes('&amp;'), 'precondition: plain text is literal');

  const sent = await synthesizedHtml(body);
  assert.ok(sent.textContent.includes(DESCRIPTOR), 'the text part keeps the literal descriptor');
  assert.ok(!sent.textContent.includes('&amp;'), 'the text part must stay literal');
  assert.ok(sent.htmlContent.includes('Automotive Intelligence &amp; Trust Network'), 'HTML escapes once');
  assert.ok(!sent.htmlContent.includes('&amp;amp;'), 'THE REGRESSION: HTML must never double-escape');
});

test('HTML BOUNDARY: markup in a value cannot become executable HTML', async () => {
  const payload = '<script>alert("x")</script>';
  const body = new CommunicationTemplateService().render('message_acknowledgement_v1', { topic: payload }).text;
  assert.ok(body.includes(payload), 'text/plain preserves the literal semantic text');

  const sent = await synthesizedHtml(body);
  assert.ok(!sent.htmlContent.includes('<script>'), 'INJECTION: raw script markup must never reach HTML');
  assert.ok(sent.htmlContent.includes('&lt;script&gt;'), 'it must appear escaped instead');
});

// ---------- D. anti-vacuity ----------
// The discriminating power of these tests is proven by SOURCE mutation, recorded in
// docs/communications/EMAIL_EXPERIENCE_G1_ESCAPING_AUTHORITY.md — reverting substituteVariables to
// the old HTML-escaping behaviour fails the plain-text tests, and removing escapeHtmlText from the
// HTML boundary fails the injection test. This test only guards against the cheaper failure mode:
// an HTML assertion that passes because no HTML was ever produced.

test('ANTI-VACUITY: the HTML-safety tests actually exercise a synthesized HTML part', async () => {
  const sent = await synthesizedHtml('Plain body about Trust & Safety.');
  assert.ok(typeof sent.htmlContent === 'string' && sent.htmlContent.length > 0, 'an HTML part must exist');
  assert.match(sent.htmlContent, /<p style="margin:0 0 14px;">/, 'it must be the synthesized HTML, not the raw body');
  assert.notEqual(sent.htmlContent, sent.textContent, 'text and HTML must be distinct representations');
  assert.ok(sent.htmlContent.includes('Trust &amp; Safety'), 'and the HTML part is where escaping happens');
  assert.ok(sent.textContent.includes('Trust & Safety'), 'while the text part stays literal');
});

// ---------- E. the unsubscribe receipt reads the href as the HTML carries it ----------

test('RECEIPT: a multi-parameter unsubscribe URL is still reported as present', async () => {
  const url = 'https://carup.dev/api/communications/unsubscribe?token=t&campaign=c';
  const sent = await synthesizedHtml('Body.', url);

  assert.ok(sent.htmlContent.includes('href="https://carup.dev/api/communications/unsubscribe?token=t&amp;campaign=c"'),
    'the anchor escapes the URL once, as HTML requires');
  assert.ok(!sent.htmlContent.includes('&amp;amp;'), 'and only once');
  assert.equal(sent.receipt.marketing_html_anchor_present, true,
    'THE REGRESSION: the receipt must not report a present control as missing');
  assert.equal(sent.receipt.marketing_text_link_present, true, 'the text part carries the literal URL');
});
