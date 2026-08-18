import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTH_EMAIL_TEMPLATES,
  BRAND,
  UNRECONCILED_SECURITY_TEMPLATES,
  listAuthEmailTemplateKeys,
  renderAuthEmail,
} from '../services/communication/authEmailTemplates.js';

/**
 * SA1.3 / SA1.I — design-system contract for CarUp authentication Email.
 *
 * PATH A: these templates render real CarUp action URLs and are delivered through CarUp
 * Communications -> Resend. Link-origin and routing proofs live in
 * auth-recovery-security.test.js; this file pins the visual/content contract.
 * No physical Email is sent.
 */

const ENV = { NODE_ENV: 'production' };
const ACTION_URL = 'https://carup.dev/auth/reset-password?token=abc123';
const ALL_KEYS = listAuthEmailTemplateKeys();

test('the SA1 template set covers the flows CarUp actually supports', () => {
  // Password recovery + signup verification + the password-changed notification. Nothing else,
  // because nothing else exists in the product yet.
  assert.deepEqual(ALL_KEYS.sort(), ['confirm_signup', 'password_changed', 'reset_password']);
  for (const key of ALL_KEYS) {
    assert.equal(AUTH_EMAIL_TEMPLATES[key].classification, 'security');
  }
});

test('every template renders a complete, mobile-safe 600px document', () => {
  for (const key of ALL_KEYS) {
    const { html, subject } = renderAuthEmail(key, ENV, { action_url: ACTION_URL });
    assert.ok(subject.length > 0, `${key} needs a subject`);
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /max-width:600px/);
    assert.match(html, /name="viewport"/);
    assert.match(html, /Car<span/, `${key} must carry CarUp branding`);
  }
});

test('no unsubstituted placeholder ever reaches a recipient', () => {
  for (const key of ALL_KEYS) {
    const { html } = renderAuthEmail(key, ENV, { action_url: ACTION_URL });
    assert.doesNotMatch(html, /\{\{/, `${key} leaked a template placeholder`);
    // Supabase-style variables must not survive, since Path A does not use Supabase Auth.
    assert.doesNotMatch(html, /\.TokenHash|\.ConfirmationURL|\.SiteURL/);
  }
});

test('action links appear as both a button and copyable text', () => {
  const { html } = renderAuthEmail('reset_password', ENV, { action_url: ACTION_URL });
  const occurrences = html.split(ACTION_URL).length - 1;
  assert.ok(occurrences >= 2, 'link must be clickable AND copyable as plain text');
});

test('the action URL is HTML-escaped so a crafted token cannot inject markup', () => {
  const hostile = 'https://carup.dev/auth/reset-password?token=a"><script>alert(1)</script>';
  const { html } = renderAuthEmail('reset_password', ENV, { action_url: hostile });
  assert.doesNotMatch(html, /<script>/);
  assert.ok(html.includes('&quot;') || html.includes('&lt;script&gt;'));
});

test('authentication Email carries no marketing or promotional content', () => {
  const marketing = /\b(unsubscribe|newsletter|special offer|discount|promo(tion)?|deal of|save \d+%|shop now|limited time)\b/i;
  for (const key of ALL_KEYS) {
    const { html, subject } = renderAuthEmail(key, ENV, { action_url: ACTION_URL });
    assert.doesNotMatch(html, marketing, `${key} body`);
    assert.doesNotMatch(subject, marketing, `${key} subject`);
  }
});

test('the primary action colour meets WCAG AA against white text', () => {
  // #C2410C vs #FFFFFF ≈ 5.2:1. The UI's #F97316 would be ~2.9:1 and is deliberately not used.
  assert.equal(BRAND.ACTION, '#C2410C');
  const luminance = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (luminance(BRAND.ACTION_TEXT) + 0.05) / (luminance(BRAND.ACTION) + 0.05);
  assert.ok(ratio >= 4.5, `contrast ${ratio.toFixed(2)}:1 must meet WCAG AA`);
});

test('security notifications for capabilities CarUp lacks stay disabled', () => {
  // SA1.3: never enable a security flow the product does not actually support.
  for (const key of ['email_changed', 'phone_changed', 'mfa_factor_added', 'mfa_factor_removed']) {
    assert.equal(UNRECONCILED_SECURITY_TEMPLATES[key].enabledByDefault, false, `${key} must be off`);
    assert.match(UNRECONCILED_SECURITY_TEMPLATES[key].requiresCapability, /NOT reconciled/);
  }
  // They must also not be renderable as if they were live templates.
  for (const key of Object.keys(UNRECONCILED_SECURITY_TEMPLATES)) {
    assert.throws(() => renderAuthEmail(key, ENV), /Unknown auth email template/);
  }
});

test('each template maps to its governed DB template key', () => {
  assert.equal(AUTH_EMAIL_TEMPLATES.reset_password.templateKey, 'auth_password_reset_v1');
  assert.equal(AUTH_EMAIL_TEMPLATES.password_changed.templateKey, 'auth_password_changed_v1');
  assert.equal(AUTH_EMAIL_TEMPLATES.confirm_signup.templateKey, 'auth_email_verification_v1');
});
