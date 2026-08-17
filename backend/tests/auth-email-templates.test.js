import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTH_EMAIL_TEMPLATES,
  BRAND,
  SECURITY_NOTIFICATION_TEMPLATES,
  buildAuthActionUrl,
  listAuthEmailTemplateKeys,
  renderAuthEmail,
} from '../services/communication/authEmailTemplates.js';
import { EMAIL_PRIORITY, QUOTA_DECISION, emailPriority, evaluateSendAllowance } from '../config/emailProviderQuota.js';

/**
 * SA1.6 — source/config proof for the branded authentication Email set.
 * No physical Email is sent and no user population is contacted.
 */

const PROD_ENV = { NODE_ENV: 'production' };
const STAGING_ENV = {
  VERCEL: '1',
  VERCEL_ENV: 'production',
  VERCEL_PROJECT_PRODUCTION_URL: 'carup-backend-staging.vercel.app',
  NODE_ENV: 'test',
};

const ALL_KEYS = listAuthEmailTemplateKeys();

test('the six authentication templates and the security notifications all render', () => {
  for (const key of ['confirm_signup', 'invite_user', 'magic_link', 'change_email', 'reset_password', 'reauthentication']) {
    assert.ok(AUTH_EMAIL_TEMPLATES[key], `missing authentication template: ${key}`);
  }
  for (const key of ALL_KEYS) {
    const { subject, html } = renderAuthEmail(key, PROD_ENV);
    assert.ok(subject && subject.length > 0, `${key} must have a subject`);
    assert.match(html, /<!doctype html>/i, `${key} must be a complete document`);
  }
});

test('production auth links use carup.dev', () => {
  for (const key of ALL_KEYS) {
    const { html } = renderAuthEmail(key, PROD_ENV);
    const links = html.match(/https?:\/\/[^"'\s<]+/g) || [];
    for (const link of links) {
      assert.match(link, /^https:\/\/carup\.dev\//, `${key} link must be on carup.dev: ${link}`);
    }
  }
});

test('staging auth links use staging.carup.dev', () => {
  for (const key of ALL_KEYS) {
    const { html } = renderAuthEmail(key, STAGING_ENV);
    const links = html.match(/https?:\/\/[^"'\s<]+/g) || [];
    for (const link of links) {
      assert.match(link, /^https:\/\/staging\.carup\.dev\//, `${key} link must be on staging.carup.dev: ${link}`);
    }
  }
});

test('no canonical auth email link uses *.vercel.app', () => {
  for (const env of [PROD_ENV, STAGING_ENV, {}]) {
    for (const key of ALL_KEYS) {
      const { html } = renderAuthEmail(key, env);
      assert.doesNotMatch(html, /vercel\.app/i, `${key} must never link to a Vercel alias`);
    }
  }
});

test('no durable branded auth link exposes project-ref.supabase.co', () => {
  for (const env of [PROD_ENV, STAGING_ENV]) {
    for (const key of ALL_KEYS) {
      const { html } = renderAuthEmail(key, env);
      assert.doesNotMatch(html, /supabase\.co/i, `${key} must not expose a Supabase project-ref host`);
      // {{ .ConfirmationURL }} resolves to the raw Supabase host, so it must not be the durable link.
      assert.doesNotMatch(html, /\{\{\s*\.ConfirmationURL\s*\}\}/, `${key} must use TokenHash routing, not ConfirmationURL`);
    }
  }
});

test('auth action links carry the Supabase TokenHash variable and a typed flow', () => {
  const typed = {
    confirm_signup: 'signup',
    invite_user: 'invite',
    magic_link: 'magiclink',
    change_email: 'email_change',
    reset_password: 'recovery',
  };
  for (const [key, type] of Object.entries(typed)) {
    const { html } = renderAuthEmail(key, PROD_ENV);
    assert.match(html, /\{\{\s*\.TokenHash\s*\}\}/, `${key} must carry {{ .TokenHash }}`);
    assert.ok(html.includes(`type=${type}`), `${key} must declare type=${type}`);
  }
});

test('an arbitrary redirect destination cannot become the auth link origin', () => {
  // The link origin comes from the governed canonical resolver, never from caller input.
  for (const hostile of ['https://evil.example.com', 'https://carup.dev.evil.example.com', 'https://carup-staging.vercel.app']) {
    const url = buildAuthActionUrl({ type: 'recovery', env: { ...PROD_ENV, CARUP_PUBLIC_WEB_URL: hostile } });
    assert.match(url, /^https:\/\/carup\.dev\//, `hostile origin must be ignored: ${hostile}`);
  }
});

test('password recovery and signup confirmation return to the correct CarUp route', () => {
  const recovery = buildAuthActionUrl({ type: 'recovery', env: PROD_ENV });
  assert.match(recovery, /^https:\/\/carup\.dev\/auth\/confirm\?/);
  assert.ok(recovery.includes('type=recovery'));

  const signup = buildAuthActionUrl({ type: 'signup', env: PROD_ENV });
  assert.match(signup, /^https:\/\/carup\.dev\/auth\/confirm\?/);
  assert.ok(signup.includes('type=signup'));
});

test('authentication emails contain no marketing or promotional content', () => {
  const marketingWords = /\b(unsubscribe|newsletter|special offer|discount|promo(tion)?|deal of|save \d+%|shop now|browse (our )?(deals|inventory)|limited time)\b/i;
  for (const key of ALL_KEYS) {
    const { html, subject } = renderAuthEmail(key, PROD_ENV);
    assert.doesNotMatch(html, marketingWords, `${key} body must contain no marketing copy`);
    assert.doesNotMatch(subject, marketingWords, `${key} subject must contain no marketing copy`);
  }
});

test('templates preserve plain-text meaning and are mobile-safe at 600px', () => {
  for (const key of ALL_KEYS) {
    const { html } = renderAuthEmail(key, PROD_ENV);
    assert.match(html, /max-width:600px/, `${key} must cap content width at 600px`);
    assert.match(html, /name="viewport"/, `${key} must be mobile-safe`);
    // Any action link must also appear as copyable plain text, not only as a button.
    const action = (html.match(/https:\/\/carup\.dev\/auth\/confirm\?[^"'\s<]+/g) || []);
    if (action.length) {
      assert.ok(action.length >= 2, `${key} must render its link as copyable text as well as a button`);
    }
  }
});

test('the primary action colour meets WCAG AA against white text', () => {
  // #C2410C vs #FFFFFF ≈ 5.2:1. The UI's #F97316 would be ~2.9:1 and is deliberately not used here.
  assert.equal(BRAND.ACTION, '#C2410C');
  assert.equal(BRAND.ACTION_TEXT, '#FFFFFF');

  const luminance = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (luminance(BRAND.ACTION_TEXT) + 0.05) / (luminance(BRAND.ACTION) + 0.05);
  assert.ok(ratio >= 4.5, `action contrast ${ratio.toFixed(2)}:1 must meet WCAG AA (4.5:1)`);
});

test('security notifications for unreconciled capabilities are OFF by default', () => {
  // SA1.3: do not enable a security flow the product does not actually support.
  assert.equal(SECURITY_NOTIFICATION_TEMPLATES.phone_changed.enabledByDefault, false);
  assert.equal(SECURITY_NOTIFICATION_TEMPLATES.mfa_factor_added.enabledByDefault, false);
  assert.equal(SECURITY_NOTIFICATION_TEMPLATES.mfa_factor_removed.enabledByDefault, false);
  for (const key of ['phone_changed', 'mfa_factor_added', 'mfa_factor_removed']) {
    assert.match(SECURITY_NOTIFICATION_TEMPLATES[key].requiresCapability, /NOT reconciled/);
  }
});

test('auth/security Email is P0 and is never deferred by quota pressure', () => {
  assert.equal(EMAIL_PRIORITY.auth, 0);
  assert.equal(EMAIL_PRIORITY.security, 0);
  assert.ok(emailPriority('auth') < emailPriority('conversational'));
  assert.ok(emailPriority('conversational') < emailPriority('transactional'));
  assert.ok(emailPriority('transactional') < emailPriority('service'));
  assert.ok(emailPriority('service') < emailPriority('marketing'));
  assert.ok(emailPriority('unknown_class') > emailPriority('marketing'));

  // At critical quota, auth still sends while marketing is suppressed.
  const auth = evaluateSendAllowance({ provider: 'resend', classification: 'auth', sentToday: 99 }, {});
  assert.equal(auth.decision, QUOTA_DECISION.ALLOW);
  assert.equal(auth.autoPurchase, false);
  const marketing = evaluateSendAllowance({ provider: 'resend', classification: 'marketing', sentToday: 99 }, {});
  assert.equal(marketing.decision, QUOTA_DECISION.SUPPRESS);
});
