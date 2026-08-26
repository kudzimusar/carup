import assert from 'node:assert/strict';
import test from 'node:test';

import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';
import { renderAuthEmail } from '../services/communication/authEmailTemplates.js';
import { EMAIL_BRAND_IDENTITY } from '../services/communication/emailExperience/emailBrandIdentity.js';
import { EMAIL_BRAND_TOKENS } from '../services/communication/emailExperience/emailBrandTokens.js';
import { CANONICAL_EMAIL_ROUTES, canonicalEmailLink, unavailableRoutes } from '../services/communication/emailExperience/canonicalEmailLinks.js';
import { escapeAttr, escapeHtml, html, renderHtml, safeHtml } from '../services/communication/emailExperience/emailMarkup.js';
import { footerFamilyFor } from '../services/communication/emailExperience/emailFooters.js';
import {
  EMAIL_RENDERER_VERSION,
  RENDER_FALLBACKS,
  renderEmailForNotification,
} from '../services/communication/emailExperience/renderEmail.js';
import { validateMarketingUnsubscribePresentation } from '../services/communication/emailExperience/marketingUnsubscribePresentation.js';

/**
 * G2 — the canonical Email renderer.
 *
 * One rendering boundary, and two failure directions that point deliberately opposite ways: a
 * security Email degrades to its canonical plain text rather than being lost, and a marketing Email
 * refuses rather than shipping without an unsubscribe control.
 */

const UNSUB = 'https://carup.dev/api/communications/unsubscribe?token=g2&campaign=weekly';
const DESCRIPTOR = 'Automotive Intelligence & Trust Network';

function render(payload, { title = 'CarUp update', message = 'Body copy.' } = {}) {
  return renderEmailForNotification({ title, message, payload }, { env: {} });
}

// ============================================================================
// P. PLAIN TEXT — literal, always
// ============================================================================

test('P1 the text part preserves literal semantic characters', () => {
  const r = render({ classification: 'transactional' }, { title: `CarUp — ${DESCRIPTOR}`, message: `A < B > C & D "q" O'Brien` });
  assert.ok(r.text.includes(`A < B > C & D "q" O'Brien`));
  assert.ok(r.text.includes(DESCRIPTOR));
  for (const entity of ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;']) {
    assert.ok(!r.text.includes(entity), `the text part must never contain ${entity}`);
  }
});

test('P2 the subject is not an HTML document', () => {
  const r = render({ classification: 'transactional' }, { title: `Parts & Service` });
  assert.equal(r.subject, 'Parts & Service');
  assert.ok(!r.subject.includes('&amp;'));
});

// ============================================================================
// P. HTML — escaped exactly once
// ============================================================================

test('P3 HTML escapes exactly once — never &amp;amp;', () => {
  const r = render({ classification: 'transactional' }, { title: DESCRIPTOR, message: `From ${DESCRIPTOR}.` });
  assert.ok(r.html.includes('Automotive Intelligence &amp; Trust Network'));
  assert.ok(!r.html.includes('&amp;amp;'), 'THE G1 REGRESSION');
});

test('P4 user-controlled markup cannot become executable HTML', () => {
  const hostile = '<script>alert("x")</script><img src=x onerror=alert(1)>';
  const r = render({ classification: 'transactional' }, { message: hostile });
  assert.ok(r.text.includes(hostile), 'the text part keeps the literal characters');
  assert.ok(!r.html.includes('<script>'), 'raw script markup must never reach HTML');
  assert.ok(!r.html.includes('onerror=alert(1)>'), 'nor an event handler');
  assert.ok(r.html.includes('&lt;script&gt;'), 'it appears escaped instead');
});

test('P5 a URL is encoded as a URL, then attribute-escaped once on insertion', () => {
  const r = render({ classification: 'transactional', action_url: 'https://carup.dev/x?a=1&b=2', action_label: 'Open' });
  assert.ok(r.html.includes('href="https://carup.dev/x?a=1&amp;b=2"'), 'HTML representation');
  assert.ok(!r.html.includes('&amp;amp;'));
  assert.ok(r.text.includes('https://carup.dev/x?a=1&b=2'), 'the URL itself, in the text part');
  // G4 reclassification: `cta_href_canonical` was the full URL, which is an evidence-safety defect —
  // an auth action URL carries a live reset token and this object is persisted onto a delivery
  // attempt. It is now a boolean plus the route, neither of which can carry a secret.
  assert.equal(r.cta_href_canonical, true, 'the action points at a CarUp canonical origin');
  assert.equal(r.cta_route, '/x', 'the route, never the query where tokens live');
});

test('P6 the markup boundary treats an unmarked value as text and only safeHtml as markup', () => {
  assert.equal(escapeHtml('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;');
  assert.equal(escapeAttr('a"b'), 'a&quot;b');
  assert.equal(renderHtml(html`<p>${'<b>hi</b>'}</p>`), '<p>&lt;b&gt;hi&lt;/b&gt;</p>');
  assert.equal(renderHtml(html`<p>${safeHtml('<b>hi</b>')}</p>`), '<p><b>hi</b></p>');
  // Nesting composed markup must not escape it a second time.
  const inner = html`<em>${'A & B'}</em>`;
  assert.equal(renderHtml(html`<p>${inner}</p>`), '<p><em>A &amp; B</em></p>');
});

// ============================================================================
// P. MARKETING — exactly one G3 control, and it passes G3's own validator
// ============================================================================

test('P7 a marketing render carries exactly one G3 control that passes G3 validation', () => {
  const r = render({ classification: 'marketing', unsubscribe_url: UNSUB }, { title: 'CarUp Weekly', message: 'Weekly picks.' });
  assert.equal(r.ok, true);
  assert.equal(r.html.split('data-carup-unsubscribe=').length - 1, 1);
  assert.equal(r.text.split(UNSUB).length - 1, 1);

  const verdict = validateMarketingUnsubscribePresentation({ html: r.html, text: r.text, unsubscribeUrl: UNSUB, headerUrl: UNSUB });
  assert.equal(verdict.ok, true, 'the renderer output must satisfy the transport contract it will meet');
  assert.equal(verdict.counts.markers, 1);
});

test('P8 the visible HTML href and the plain-text URL are the same URL', () => {
  const r = render({ classification: 'marketing', unsubscribe_url: UNSUB }, { title: 'CarUp Weekly' });
  assert.ok(r.html.includes(`href="https://carup.dev/api/communications/unsubscribe?token=g2&amp;campaign=weekly"`));
  assert.ok(r.text.includes(UNSUB), 'literal in the text part');
  assert.ok(!r.text.includes('&amp;'));
});

test('P9 marketing with no unsubscribe URL is REFUSED — no unmarked text-only fallback', () => {
  const r = render({ classification: 'marketing' }, { title: 'CarUp Weekly' });
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'unsubscribe_action_missing');
});

// ============================================================================
// P. NON-MARKETING — zero marketing controls, still deliverable
// ============================================================================

test('P10 no non-marketing family carries a marketing unsubscribe control', () => {
  for (const classification of ['security', 'transactional', 'conversational', 'service']) {
    const r = render({ classification, unsubscribe_url: UNSUB });
    assert.equal(r.ok, true, `${classification} must remain deliverable`);
    assert.ok(!r.html.includes('data-carup-unsubscribe'), `${classification} must carry no marketing control`);
    assert.ok(!r.text.includes(UNSUB), `${classification} text part likewise`);
    assert.ok(!/Unsubscribe from CarUp marketing email/.test(r.html));
  }
});

test('P11 three footer families cover five classifications', () => {
  assert.equal(footerFamilyFor('security'), 'security');
  assert.equal(footerFamilyFor('marketing'), 'marketing');
  for (const c of ['transactional', 'service', 'conversational']) assert.equal(footerFamilyFor(c), 'transactional');
  assert.equal(footerFamilyFor('auth'), null);
});

// ============================================================================
// P. IDENTITY — nothing invented
// ============================================================================

test('P12 the footer makes no claim CarUp cannot support', () => {
  for (const classification of ['security', 'transactional', 'conversational', 'service']) {
    const r = render({ classification });
    const blob = `${r.html}\n${r.text}`;
    assert.ok(!/CEO/i.test(blob), 'CarUp has no CEO identity; the About page one is demo seed data');
    assert.ok(!/Tendai Moyo/i.test(blob), 'the seeded demo persona must never sign a customer Email');
    assert.ok(!/facebook|twitter|linkedin|instagram|x\.com/i.test(blob), 'no social links are approved');
    assert.ok(!/Registered (office|address)|Reg(istration)? No/i.test(blob), 'no statutory address is verified');
    assert.equal(r.leadership_identity_rendered, false);
  }
  assert.equal(EMAIL_BRAND_IDENTITY.registeredLegalAddress, null, 'DEFERRED_UNTIL_VERIFIED');
  assert.deepEqual(EMAIL_BRAND_IDENTITY.socialLinks, []);
  assert.equal(EMAIL_BRAND_IDENTITY.logoArtworkUrl, null, 'no logo artwork exists in the repository');
  assert.notEqual(EMAIL_BRAND_IDENTITY.leadership.title, 'CEO');
});

test('P13 the frozen descriptor and entity render correctly in both representations', () => {
  const r = render({ classification: 'transactional' });
  assert.ok(r.text.includes(`CarUp Technologies · ${DESCRIPTOR}`), 'literal in text');
  assert.ok(r.html.includes('CarUp Technologies · Automotive Intelligence &amp; Trust Network'), 'escaped once in HTML');
  assert.ok(!r.html.includes('&amp;amp;'));
});

test('P14 brand tokens are the certified auth values, so no family drifts', () => {
  assert.equal(EMAIL_BRAND_TOKENS.ACTION, '#C2410C', 'WCAG AA on white; #F97316 fails at ~2.9:1');
  assert.equal(EMAIL_BRAND_TOKENS.MAX_WIDTH, 600);
  const r = render({ classification: 'transactional' });
  assert.ok(r.html.includes('max-width:600px'));
});

// ============================================================================
// P. ROUTES — nothing links to a page that does not exist
// ============================================================================

test('P15 no Email links to a route that is not routed in the frontend', () => {
  // G12 reclassification. This asserted /support and /security were NOT linked, which was true while
  // they were approved-but-unrouted. G12 built both routes, so the same RULE — never link an
  // unrouted path — now produces the opposite expectation. The rule itself is pinned generically in
  // email-experience-public-prerequisites.test.js (`C4`), which reads the real router.
  assert.equal(unavailableRoutes().length, 0, 'every declared route is routed');

  for (const [key, route] of Object.entries(CANONICAL_EMAIL_ROUTES)) {
    assert.equal(Boolean(canonicalEmailLink(key, {})), route.available,
      `${key} must resolve to a link exactly when it is routed`);
  }

  for (const classification of ['security', 'transactional', 'conversational', 'service', 'marketing']) {
    const r = render({ classification, unsubscribe_url: UNSUB });
    const blob = `${r.html}\n${r.text}`;
    // Every family links the real legal pages, so this cannot pass by rendering nothing.
    assert.ok(blob.includes('carup.dev/privacy'), `${classification} links the real /privacy`);
    assert.ok(blob.includes('carup.dev/terms'));
    // And nothing links to a path the router does not have.
    assert.ok(!blob.includes('carup.dev/preferences'), 'no preference route exists');
    assert.ok(!blob.includes('carup.dev/unsubscribe-centre'));
  }

  // The security family carries CarUp's own Security and Support pages. The restraint that matters
  // is about REPLYING — the footer still says do not reply — not about linking pages a worried
  // reader needs. Withholding them does not make someone safer; it makes them search, which is
  // exactly where a fake support page wins.
  const security = render({ classification: 'security' });
  assert.ok(security.text.includes('carup.dev/security'));
  assert.ok(security.text.includes('carup.dev/support'));
  assert.ok(/do not reply/i.test(security.text), 'and it still does not invite a reply');
  // The transactional family DOES now carry the real Support link.
  const transactional = render({ classification: 'transactional' });
  assert.ok(transactional.text.includes('carup.dev/support'));
});

test('P15b the support CONTACT is a certified alias, which is not the same as a route', () => {
  const r = render({ classification: 'transactional' });
  assert.ok(r.text.includes('support@carup.dev'), 'one of the seven E7-certified aliases');
});

// ============================================================================
// I / J. AUTH SAFETY AND FAILURE SEMANTICS
// ============================================================================

test('I1 an auth Email renders NO html — the certified P0 path keeps producing it', () => {
  const r = render({ classification: 'security', auth_template_key: 'reset_password', email: 'u@example.test' },
    { title: 'Reset your CarUp password', message: 'A password reset was requested.' });
  assert.equal(r.ok, true);
  assert.equal(r.html, null, 'nothing may race authEmailTemplates.js until G6 proves equivalence');
  assert.equal(r.render_fallback_used, RENDER_FALLBACKS.AUTH_COMPATIBILITY);
  assert.equal(r.text, 'A password reset was requested.', 'the canonical text passes through untouched');
});

test('I2 the certified auth renderer is unchanged and still escapes its own HTML', () => {
  const { html: authHtml } = renderAuthEmail('reset_password', { CARUP_WEB_ORIGIN: 'https://carup.dev' }, { action_url: 'https://carup.dev/auth/reset-password?token=a&b=2' });
  assert.match(authHtml, /<!doctype html>/i);
  assert.ok(authHtml.includes('token=a&amp;b=2'), 'escaped once');
  assert.ok(!authHtml.includes('&amp;amp;'));
  assert.ok(!authHtml.includes('data-carup-unsubscribe'));
});

test('J1 a NON-marketing render fault degrades to the canonical plain text, recorded distinctly', async () => {
  const failing = () => { throw new Error('layout exploded'); };
  const { renderEmailForNotification: real } = await import('../services/communication/emailExperience/renderEmail.js');
  // Drive the real function with a layout that throws, by rendering a document the shell cannot
  // build: a frozen-identity lookup is not mockable, so this asserts the contract through the
  // worker's injected-renderer seam instead.
  let sent = null;
  const worker = new CommunicationDeliveryWorker({
    repository: { list: async () => [], findOne: async () => null, insert: async () => ({ id: 'a' }), updateById: async (_t, id) => ({ id }) },
    adapterRegistry: { get: () => ({ provider: 'resend', send: async (input) => { sent = input; return { accepted: true }; } }) },
    emailRenderer: (n, o) => {
      const out = real(n, o);
      return { ...out, html: null, render_fallback_used: RENDER_FALLBACKS.PLAIN_TEXT_DEGRADED };
    },
  });
  assert.equal(typeof failing, 'function');
  await worker.deliverNotification({
    id: 'j1', channel: 'email', title: 'Your password was changed',
    message: 'The password on your CarUp account was changed.',
    payload: { classification: 'security', email: 'u@example.test' },
  });
  assert.ok(sent, 'a P0 security Email must still be delivered');
  assert.ok(sent.content.body.includes('The password on your CarUp account was changed.'), 'the meaning survives');
  assert.equal(sent.content.data.email_render_provenance.render_fallback_used, RENDER_FALLBACKS.PLAIN_TEXT_DEGRADED);
});

test('J2 a MARKETING render failure REFUSES, with zero provider calls', async () => {
  let providerCalls = 0;
  const updates = [];
  const worker = new CommunicationDeliveryWorker({
    repository: { list: async () => [], findOne: async () => null, insert: async () => ({ id: 'a' }), updateById: async (_t, id, p) => { updates.push(p); return { id }; } },
    adapterRegistry: { get: () => ({ provider: 'brevo', send: async () => { providerCalls += 1; return { accepted: true }; } }) },
    emailRenderer: () => ({ ok: false, errorCode: 'marketing_render_failed', errorMessage: 'simulated' }),
  });
  await worker.deliverNotification({
    id: 'j2', channel: 'email', title: 'CarUp Weekly', message: 'Picks.',
    payload: { classification: 'marketing', email: 'r@example.test', unsubscribe_url: UNSUB },
  });
  assert.equal(providerCalls, 0, 'marketing may not fall back to an unmarked text-only send');
  assert.equal(updates.find((u) => u.last_error_code)?.last_error_code, 'marketing_render_failed');
});

test('J3 END TO END: a real non-compliant marketing render reaches no provider', async () => {
  // Not an injected failing renderer — the REAL one, given a body that quotes the unsubscribe URL,
  // which would produce two controls. It refuses, and nothing downstream gets a chance to send an
  // unmarked text-only marketing message instead.
  let providerCalls = 0;
  const updates = [];
  const worker = new CommunicationDeliveryWorker({
    repository: { list: async () => [], findOne: async () => null, insert: async () => ({ id: 'a' }), updateById: async (_t, id, p) => { updates.push(p); return { id }; } },
    adapterRegistry: { get: () => ({ provider: 'brevo', send: async () => { providerCalls += 1; return { accepted: true }; } }) },
  });
  await worker.deliverNotification({
    id: 'j3', channel: 'email', title: 'CarUp Weekly',
    message: `Prefer fewer emails? Use ${UNSUB} to stop them.`,
    payload: { classification: 'marketing', email: 'r@example.test', unsubscribe_url: UNSUB, campaign_id: 'c', campaign_delivery_id: 'd' },
  });
  assert.equal(providerCalls, 0, 'marketing may not degrade to an unmarked send');
  assert.equal(updates.find((u) => u.last_error_code)?.last_error_code, 'unsubscribe_presentation_duplicated');
});

// ============================================================================
// K / M. WORKER INSERTION AND PROVENANCE
// ============================================================================

test('K1 the provider payload carries the RENDERER text, not the stale pre-render body', async () => {
  let sent = null;
  const worker = new CommunicationDeliveryWorker({
    repository: { list: async () => [], findOne: async () => null, insert: async () => ({ id: 'a' }), updateById: async (_t, id) => ({ id }) },
    adapterRegistry: { get: () => ({ provider: 'resend', send: async (input) => { sent = input; return { accepted: true }; } }) },
  });
  await worker.deliverNotification({
    id: 'k1', channel: 'email', title: 'Update', message: 'ORIGINAL-BODY-MARKER',
    payload: { classification: 'transactional', email: 'u@example.test' },
  });
  // Same env as the worker: the canonical origin resolves from the environment, so comparing a
  // fixture rendered under a different one would fail on the link host rather than on the contract.
  const rendered = renderEmailForNotification(
    { title: 'Update', message: 'ORIGINAL-BODY-MARKER', payload: { classification: 'transactional', email: 'u@example.test' } },
    { env: process.env },
  );
  assert.equal(sent.content.body, rendered.text, '`body` is the renderer output');
  assert.equal(sent.content.text, rendered.text, '`text` too — textBody() reads body first, so a stale body would win');
  assert.ok(sent.content.body.includes('support@carup.dev'), 'the footer proves this is rendered, not the raw message');
  assert.ok(sent.content.html, 'and an HTML part exists');
});

test('K2 non-email channels never reach the renderer', async () => {
  const seen = [];
  const worker = new CommunicationDeliveryWorker({
    repository: { list: async () => [], findOne: async () => null, insert: async () => ({ id: 'a' }), updateById: async (_t, id) => ({ id }) },
    adapterRegistry: { get: () => ({ provider: 'x', send: async (input) => { seen.push(input); return { accepted: true }; } }) },
    emailRenderer: () => { throw new Error('the renderer must not be called for a non-email channel'); },
  });
  for (const channel of ['in_app', 'push']) {
    await worker.deliverNotification({ id: `k2-${channel}`, channel, title: 'T', message: 'M', payload: {} });
  }
  assert.equal(seen.length, 2);
  for (const input of seen) {
    assert.equal(input.content.body, 'M', 'byte-identical to the pre-G2 behaviour');
    assert.ok(!input.content.html);
    assert.ok(!input.content.data.email_render_provenance);
  }
});

test('M1 the renderer publishes deterministic provenance for G4', () => {
  const r = render({ classification: 'transactional', action_url: 'https://carup.dev/x', action_label: 'Open' }, { title: 'T', message: 'M' });
  assert.equal(r.renderer_version, EMAIL_RENDERER_VERSION);
  assert.equal(r.classification, 'transactional');
  assert.equal(r.footer_family, 'transactional');
  assert.equal(r.sender_persona, 'carup_notifications');
  assert.equal(r.html_part_rendered, true);
  assert.equal(r.text_part_rendered, true);
  assert.equal(r.cta_href_canonical, true);
  assert.equal(r.cta_route, '/x');
  assert.equal(r.leadership_identity_rendered, false);
  assert.equal(r.render_fallback_used, RENDER_FALLBACKS.NONE);

  // Truthful, not decorative: a message with no CTA reports none.
  const noCta = render({ classification: 'transactional' });
  assert.equal(noCta.cta_href_canonical, false);
  assert.equal(noCta.cta_route, null);
  assert.equal(noCta.html_part_rendered, true);
});

test('M2 provenance carries no secret and no raw database row', async () => {
  let sent = null;
  const worker = new CommunicationDeliveryWorker({
    repository: { list: async () => [], findOne: async () => null, insert: async () => ({ id: 'a' }), updateById: async (_t, id) => ({ id }) },
    adapterRegistry: { get: () => ({ provider: 'resend', send: async (input) => { sent = input; return { accepted: true }; } }) },
  });
  await worker.deliverNotification({
    id: 'm2', channel: 'email', title: 'T', message: 'M',
    payload: { classification: 'transactional', email: 'u@example.test' },
  });
  const provenance = JSON.stringify(sent.content.data.email_render_provenance);
  for (const forbidden of ['API_KEY', 'password_hash', 'service_role', 'secret', 'token=']) {
    assert.ok(!provenance.includes(forbidden), `provenance must not carry ${forbidden}`);
  }
  assert.deepEqual(Object.keys(sent.content.data.email_render_provenance).sort(), [
    // G6 added auth_equivalence_verified: the field that shows a migrated auth template's canonical
    // render passed the equivalence contract, rather than that being assumed.
    'auth_equivalence_verified',
    'classification', 'classification_source', 'cta_href_canonical', 'cta_route', 'footer_family',
    'html_part_rendered', 'leadership_identity_rendered', 'render_fallback_used',
    'renderer_version', 'sender_persona', 'template_key', 'template_version', 'text_part_rendered',
  ]);
});
