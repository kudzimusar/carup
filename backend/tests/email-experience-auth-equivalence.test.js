import assert from 'node:assert/strict';
import test from 'node:test';

import { AUTH_EMAIL_COPY, renderAuthEmail, listAuthEmailTemplateKeys } from '../services/communication/authEmailTemplates.js';
import { ResendEmailAdapter } from '../services/communication/adapters/providerAdapters.js';
import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';
import {
  AUTH_EQUIVALENCE_INVARIANTS,
  checkAuthEquivalence,
} from '../services/communication/emailExperience/authEquivalence.js';
import {
  CANONICALLY_RENDERED_AUTH_TEMPLATES,
  RENDER_FALLBACKS,
  renderEmailForNotification,
} from '../services/communication/emailExperience/renderEmail.js';

/**
 * G6 — R2 password reset, migrated to the canonical renderer and PROVEN equivalent.
 *
 * `authEmailTemplates.js` was physically certified: a human received it, in a real inbox, and
 * accepted it. Replacing it is only safe if the replacement holds every property that made the
 * certified artefact acceptable, and "it looks fine" is not a property.
 *
 * Byte-equality is impossible and is not the goal. The B1 identity freeze supersedes the certified
 * sign-off line, and the canonical footer links /support and /privacy — real routes that did not
 * exist when the original was certified. The SUBSTANCE must survive: same subject, same action
 * reachable the same two ways, same security meaning, same brand, same escaping, nothing marketing.
 */

const RESET_TOKEN = 'OPAQUE-RESET-TOKEN-g6';
const ACTION_URL = `https://carup.dev/auth/reset-password?token=${RESET_TOKEN}&next=%2Faccount`;
const ENV = {};
const RESEND_ENV = {
  RESEND_API_KEY: 'k',
  RESEND_FROM_EMAIL: 'notifications@mail.carup.dev',
  RESEND_AUTH_FROM_EMAIL: 'CarUp Security <auth@mail.carup.dev>',
};

function renderReset(overrides = {}) {
  return renderEmailForNotification({
    title: 'Reset your CarUp password',
    message: 'A password reset was requested for your CarUp account.',
    payload: {
      classification: 'security',
      auth_template_key: 'reset_password',
      action_url: ACTION_URL,
      email: 'user@example.test',
      ...overrides,
    },
  }, { env: ENV });
}

const certified = () => renderAuthEmail('reset_password', ENV, { action_url: ACTION_URL });

// ============================================================================
// A. THE MIGRATION HAPPENED
// ============================================================================

test('A1 R2 now renders canonically, and says so in its provenance', () => {
  const r = renderReset();
  assert.equal(r.ok, true);
  assert.equal(r.html_part_rendered, true, 'the canonical renderer produced the HTML');
  assert.equal(r.render_fallback_used, RENDER_FALLBACKS.NONE, 'no longer the auth compatibility path');
  assert.equal(r.auth_equivalence_verified, true);
  assert.equal(r.template_key, 'auth_password_reset_v1', 'the certified template identity is preserved');
});

test('A2 the OTHER auth templates are deliberately NOT migrated', () => {
  // Migrating three P0 flows because one was proven is how a careful migration becomes an outage.
  assert.deepEqual(CANONICALLY_RENDERED_AUTH_TEMPLATES, ['reset_password']);
  for (const key of listAuthEmailTemplateKeys().filter((k) => k !== 'reset_password')) {
    const r = renderEmailForNotification({
      title: 'x', message: 'y',
      payload: { classification: 'security', auth_template_key: key, action_url: 'https://carup.dev/auth/verify-email?token=z' },
    }, { env: ENV });
    assert.equal(r.html, null, `${key} must stay on the certified path`);
    assert.equal(r.render_fallback_used, RENDER_FALLBACKS.AUTH_COMPATIBILITY);
  }
});

// ============================================================================
// B. EQUIVALENCE — every invariant of the certified artefact
// ============================================================================

test('B1 every declared invariant holds for the canonical R2 render', () => {
  const r = renderReset();
  const verdict = checkAuthEquivalence({
    certified: certified(),
    certifiedSubject: certified().subject,
    canonicalHtml: r.html,
    canonicalText: r.text,
    canonicalSubject: r.subject,
    actionUrl: ACTION_URL,
    copy: AUTH_EMAIL_COPY.reset_password,
  });
  assert.deepEqual(verdict.failures, [], 'no invariant may be dropped silently');
  assert.equal(verdict.ok, true);
  assert.ok(AUTH_EQUIVALENCE_INVARIANTS.length >= 15, 'the contract is substantive, not two checks');
});

test('B2 the subject is IDENTICAL, not merely similar', () => {
  assert.equal(renderReset().subject, certified().subject);
  assert.equal(renderReset().subject, 'Reset your CarUp password');
});

test('B3 the action is clickable once AND copyable as text', () => {
  const r = renderReset();
  const href = ACTION_URL.replace(/&/g, '&amp;');
  assert.equal(r.html.split(`href="${href}"`).length - 1, 1, 'exactly one anchor');
  assert.ok(r.html.split(href).length - 1 >= 2, 'and repeated as visible text, as the certified layout does');
  assert.ok(r.text.includes(ACTION_URL), 'the plain-text part carries the working link');
});

test('B4 the action URL is escaped exactly once and decodes back to what was issued', () => {
  const r = renderReset();
  assert.ok(r.html.includes('token=OPAQUE-RESET-TOKEN-g6&amp;next=%2Faccount'));
  assert.ok(!r.html.includes('&amp;amp;'), 'a double-escaped link is a reset the customer cannot use');
  assert.ok(r.text.includes('token=OPAQUE-RESET-TOKEN-g6&next=%2Faccount'), 'literal in text');
});

test('B5 the security meaning survives in both representations', () => {
  const r = renderReset();
  for (const blob of [r.html, r.text]) {
    assert.ok(/used once/.test(blob));
    assert.ok(/expires within the hour/.test(blob));
    assert.ok(/current password stays active/.test(blob));
    assert.ok(/safely ignore this email/.test(blob));
  }
});

test('B6 the brand is the certified brand', () => {
  const r = renderReset();
  assert.ok(r.html.includes('#C2410C'), 'the WCAG-AA action colour');
  assert.ok(!r.html.includes('#F97316'), 'never the UI orange that fails contrast on white');
  assert.ok(r.html.includes('max-width:600px'));
  assert.match(r.html.trim(), /^<!doctype html>/i);
  assert.ok(r.html.includes('display:none!important'), 'the hidden preheader survives');
});

test('B7 nothing marketing, and no invented identity', () => {
  const r = renderReset();
  const blob = `${r.html}\n${r.text}`;
  assert.ok(!blob.includes('data-carup-unsubscribe'));
  assert.ok(!/unsubscribe/i.test(r.text));
  assert.ok(!/\bCEO\b/.test(blob));
  assert.ok(!/Tendai Moyo/i.test(blob));
  assert.ok(!/facebook|twitter|linkedin|instagram/i.test(blob));
  assert.ok(!/vercel\.app|carup\.app/.test(blob));
});

test('B8 the copy comes from ONE source, so the two renderers cannot drift', () => {
  const copy = AUTH_EMAIL_COPY.reset_password;
  const cert = certified().html;
  const r = renderReset();
  for (const line of [copy.heading, copy.intro, copy.actionLabel, copy.securityNote, copy.reasonReceived]) {
    assert.ok(cert.includes(line), `the certified renderer reads it: ${line.slice(0, 40)}`);
    assert.ok(r.html.includes(line), `and so does the canonical one: ${line.slice(0, 40)}`);
  }
});

// ============================================================================
// C. THE EQUIVALENCE GUARD IS REAL — it runs on every send, not only in tests
// ============================================================================

test('C1 a canonical render that BREAKS an invariant falls back to the certified artefact', () => {
  // The guard must be load-bearing. Drive it directly with a broken canonical artefact and confirm
  // it reports which property failed rather than a generic "not equivalent".
  const verdict = checkAuthEquivalence({
    certified: certified(),
    certifiedSubject: certified().subject,
    canonicalHtml: '<!doctype html><p>Reset your password</p>',   // no action, no brand, no note
    canonicalText: 'Reset your password',
    canonicalSubject: 'Something else entirely',
    actionUrl: ACTION_URL,
    copy: AUTH_EMAIL_COPY.reset_password,
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.failures.includes('subject_identical'));
  assert.ok(verdict.failures.includes('action_is_clickable'));
  assert.ok(verdict.failures.includes('security_note_present'));
  assert.ok(verdict.failures.length >= 5, 'it names every broken property, not just the first');
});

test('C1b the RENDERER consults the guard: a non-equivalent canonical artefact is NOT shipped', async () => {
  // C1 proves the guard works. This proves the renderer actually asks it — without which the check
  // could be deleted and every test would still pass.
  //
  // The trigger is a real producer bug: an action URL that already contains an HTML entity. Escaping
  // it once for the anchor yields `&amp;amp;`, which is a link the customer cannot use. The
  // equivalence contract catches that, so the certified artefact ships instead of a broken reset.
  const doubleEscaped = 'https://carup.dev/auth/reset-password?token=g6&amp;next=%2Faccount';
  const r = renderReset({ action_url: doubleEscaped });

  assert.equal(r.ok, true, 'the P0 Email is never lost');
  assert.equal(r.html, null, 'the canonical artefact was refused');
  assert.equal(r.render_fallback_used, RENDER_FALLBACKS.AUTH_EQUIVALENCE_FAILED,
    'and recorded as an equivalence failure, not as "never attempted"');
  assert.notEqual(r.auth_equivalence_verified, true);

  // The certified artefact still ships, and G4 says so.
  let captured = null;
  const adapter = new ResendEmailAdapter({
    env: RESEND_ENV,
    fetchImpl: async (_u, init) => { captured = JSON.parse(init.body); return { ok: true, status: 200, text: async () => '{}', headers: new Map() }; },
  });
  const result = await adapter.send({
    notificationId: 'c1b', recipient: { email: 'u@example.test' },
    content: {
      subject: r.subject, body: r.text, text: r.text,
      data: {
        classification: 'security', auth_template_key: 'reset_password', action_url: doubleEscaped, email: 'u@example.test',
        email_render_provenance: { render_fallback_used: r.render_fallback_used, auth_equivalence_verified: false },
      },
    },
  });
  assert.ok(captured.html.includes('<!doctype html>'), 'the certified artefact went on the wire');
  assert.equal(result.providerMetadata.auth_compatibility_html_used, true);
  assert.equal(result.providerMetadata.auth_equivalence_verified, false);
});

test('C2 a reset with NO action URL falls back rather than shipping a reset nobody can perform', () => {
  const r = renderReset({ action_url: undefined });
  assert.equal(r.ok, true, 'a P0 security Email is never lost');
  assert.equal(r.html, null, 'the certified path supplies the HTML');
  assert.equal(r.render_fallback_used, RENDER_FALLBACKS.AUTH_COMPATIBILITY);
});

test('C3 incomplete inputs are refused rather than treated as equivalent', () => {
  for (const args of [{}, { certified: certified() }, { canonicalHtml: '<p>x</p>' }]) {
    const verdict = checkAuthEquivalence(args);
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.failures, ['inputs_incomplete']);
  }
});

// ============================================================================
// D. TRANSPORT — the canonical artefact is what actually goes on the wire
// ============================================================================

async function sendReset(rendered) {
  let captured = null;
  const adapter = new ResendEmailAdapter({
    env: RESEND_ENV,
    fetchImpl: async (_u, init) => {
      captured = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'r1', message_id: '<m@x>' }), headers: new Map() };
    },
  });
  const result = await adapter.send({
    notificationId: 'n-1', idempotencyKey: 'k-1',
    recipient: { email: 'user@example.test' },
    content: {
      subject: rendered.subject,
      body: rendered.text,
      text: rendered.text,
      ...(rendered.html ? { html: rendered.html } : {}),
      data: {
        classification: 'security', auth_template_key: 'reset_password',
        action_url: ACTION_URL, email: 'user@example.test',
        email_render_provenance: {
          renderer_version: rendered.renderer_version,
          classification: rendered.classification,
          footer_family: rendered.footer_family,
          sender_persona: rendered.sender_persona,
          html_part_rendered: rendered.html_part_rendered,
          render_fallback_used: rendered.render_fallback_used,
          auth_equivalence_verified: rendered.auth_equivalence_verified ?? false,
          cta_href_canonical: rendered.cta_href_canonical,
          cta_route: rendered.cta_route,
        },
      },
    },
  });
  return { result, captured };
}

test('D1 the CANONICAL html is what Resend receives — the migration is not discarded at transport', () => {
  // The trap this closes: the adapter preferred `resolveAuthHtml` unconditionally, so a verified
  // canonical artefact would have been produced and then silently thrown away at the wire.
  const rendered = renderReset();
  return sendReset(rendered).then(({ result, captured }) => {
    assert.equal(result.accepted, true);
    assert.equal(captured.html, rendered.html, 'byte-for-byte the canonical render');
    assert.notEqual(captured.html, certified().html, 'and NOT the certified artefact');
    assert.equal(captured.subject, 'Reset your CarUp password');
  });
});

test('D2 G4 provenance now reports the migration, exactly as G4 said it would', async () => {
  const { result } = await sendReset(renderReset());
  const m = result.providerMetadata;
  assert.equal(m.html_source, 'renderer');
  assert.equal(m.auth_compatibility_html_used, false, 'the field G4 defined to make this visible');
  assert.equal(m.auth_equivalence_verified, true);
  assert.equal(m.html_part_sent, true);
  assert.equal(m.text_part_sent, true);
  assert.equal(m.classification, 'security');
});

test('D3 an unmigrated auth template still reports the compatibility path', async () => {
  const r = renderEmailForNotification({
    title: 'Confirm your CarUp account', message: 'Confirm this email address.',
    payload: { classification: 'security', auth_template_key: 'confirm_signup', action_url: 'https://carup.dev/auth/verify-email?token=z' },
  }, { env: ENV });

  let captured = null;
  const adapter = new ResendEmailAdapter({
    env: RESEND_ENV,
    fetchImpl: async (_u, init) => { captured = JSON.parse(init.body); return { ok: true, status: 200, text: async () => '{}', headers: new Map() }; },
  });
  const result = await adapter.send({
    notificationId: 'n-2', recipient: { email: 'u@example.test' },
    content: {
      subject: r.subject, body: r.text, text: r.text,
      data: { classification: 'security', auth_template_key: 'confirm_signup', email: 'u@example.test', email_render_provenance: { auth_equivalence_verified: false, render_fallback_used: r.render_fallback_used } },
    },
  });
  assert.equal(result.providerMetadata.auth_compatibility_html_used, true);
  assert.equal(result.providerMetadata.auth_equivalence_verified, false);
  assert.ok(captured.html.includes('<!doctype html>'), 'the certified artefact still ships for it');
});

test('D4 the security sender identity is unchanged', async () => {
  const { captured, result } = await sendReset(renderReset());
  assert.equal(captured.from, 'CarUp Security <auth@mail.carup.dev>');
  assert.equal(result.providerMetadata.sender_persona_consistent, true);
});

// ============================================================================
// E. SECRET SAFETY — the reset token is still not in any durable record
// ============================================================================

test('E1 the reset token reaches the inbox and nothing else', async () => {
  const rendered = renderReset();
  assert.ok(rendered.html.includes(RESET_TOKEN), 'the customer receives a working link');
  assert.ok(!JSON.stringify({
    cta_href_canonical: rendered.cta_href_canonical,
    cta_route: rendered.cta_route,
    render_fallback_used: rendered.render_fallback_used,
    auth_equivalence_verified: rendered.auth_equivalence_verified,
  }).includes(RESET_TOKEN), 'never in renderer provenance');

  const { result } = await sendReset(rendered);
  assert.ok(!JSON.stringify(result.providerMetadata).includes(RESET_TOKEN), 'never in send provenance');
  assert.equal(result.providerMetadata.cta_route, '/auth/reset-password', 'the route proves the flow');
});

test('E2 the token is absent from the persisted delivery attempt', async () => {
  const attempts = [];
  const worker = new CommunicationDeliveryWorker({
    repository: {
      list: async () => [], findOne: async () => null,
      insert: async (table, row) => { if (table === 'message_delivery_attempts') attempts.push(row); return { id: 'a' }; },
      updateById: async (_t, id) => ({ id }),
    },
    adapterRegistry: {
      get: () => new ResendEmailAdapter({
        env: RESEND_ENV,
        fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'r', message_id: '<m@x>' }), headers: new Map() }),
      }),
    },
  });
  await worker.deliverNotification({
    id: 'e2', channel: 'email', title: 'Reset your CarUp password',
    message: 'A password reset was requested for your CarUp account.',
    payload: { classification: 'security', auth_template_key: 'reset_password', action_url: ACTION_URL, email: 'user@example.test' },
  });

  assert.equal(attempts.length, 1);
  const serialized = JSON.stringify(attempts[0]);
  assert.ok(!serialized.includes(RESET_TOKEN), 'a durable audit record outlives the token it would carry');
  assert.equal(attempts[0].response_metadata.provider_metadata.auth_equivalence_verified, true);
  assert.equal(attempts[0].response_metadata.provider_metadata.auth_compatibility_html_used, false);
});

// ============================================================================
// F. THE CERTIFIED PATH IS PRESERVED, NOT DELETED
// ============================================================================

test('F1 the certified renderer still works and is still reachable', () => {
  // G2 §I: architecture neatness does not get to risk a password reset. `resolveAuthHtml` remains
  // the fallback for every unmigrated template and for a canonical render that was refused, and
  // retiring it is a separate, owner-gated decision.
  const cert = certified();
  assert.match(cert.html, /<!doctype html>/i);
  assert.equal(cert.subject, 'Reset your CarUp password');
  assert.equal(cert.classification, 'security');
  assert.ok(cert.html.includes(RESET_TOKEN));
  assert.deepEqual(listAuthEmailTemplateKeys().sort(), ['confirm_signup', 'password_changed', 'reset_password']);
});
