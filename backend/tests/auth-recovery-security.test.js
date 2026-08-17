import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  AUTH_TOKEN_PURPOSES,
  AuthActionTokenService,
  generateRawAuthToken,
  hashAuthToken,
  timingSafeHashEquals,
} from '../services/auth/authActionTokenService.js';
import { AUTH_ROUTES, buildAuthActionUrl, renderAuthEmail } from '../services/communication/authEmailTemplates.js';
import { EmailTransportRouter } from '../services/communication/adapters/providerAdapters.js';
import { QUOTA_DECISION, emailPriority, evaluateSendAllowance } from '../config/emailProviderQuota.js';

/**
 * SA1J — security and abuse proofs for CarUp custom-auth password recovery.
 * Source/config level: no physical Email is sent and no user population is contacted.
 */

// --- an in-memory stand-in for the PostgREST surface the service uses ------------------------
function createFakeDb() {
  const rows = [];
  const matches = (row, filters) => filters.every((f) => {
    if (f.op === 'eq') return row[f.col] === f.val;
    if (f.op === 'is_null') return row[f.col] === null || row[f.col] === undefined;
    if (f.op === 'gt') return new Date(row[f.col]) > new Date(f.val);
    return true;
  });

  function builder(action, payload) {
    const filters = [];
    const api = {
      eq(col, val) { filters.push({ op: 'eq', col, val }); return api; },
      is(col, _null) { filters.push({ op: 'is_null', col }); return api; },
      gt(col, val) { filters.push({ op: 'gt', col, val }); return api; },
      select() { return api; },
      async maybeSingle() { return api.__run(); },
      async single() { return api.__run(); },
      then(resolve, reject) { return api.__run().then(resolve, reject); },
      async __run() {
        const hit = rows.filter((r) => matches(r, filters));
        if (action === 'update') {
          hit.forEach((r) => Object.assign(r, payload));
          return { data: hit[0] || null, error: null };
        }
        return { data: hit[0] || null, error: null };
      },
    };
    return api;
  }

  return {
    rows,
    from() {
      return {
        insert(payload) {
          const row = { id: crypto.randomUUID(), used_at: null, revoked_at: null, created_at: new Date().toISOString(), ...payload };
          if (rows.some((r) => r.token_hash === row.token_hash)) {
            return { select: () => ({ single: async () => ({ data: null, error: { message: 'duplicate token_hash' } }) }) };
          }
          rows.push(row);
          return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
        },
        update(payload) { return builder('update', payload); },
        select() { return builder('select'); },
      };
    },
  };
}

function createService() {
  const db = createFakeDb();
  return { db, service: new AuthActionTokenService({ supabase: db }) };
}

const PROD_ENV = { NODE_ENV: 'production' };
const STAGING_ENV = {
  VERCEL: '1', VERCEL_ENV: 'production',
  VERCEL_PROJECT_PRODUCTION_URL: 'carup-backend-staging.vercel.app', NODE_ENV: 'test',
};

// --- token primitive -------------------------------------------------------------------------

test('reset tokens are stored hashed, never raw', async () => {
  const { db, service } = createService();
  const { rawToken } = await service.issue({ userId: 'u_1', purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET });

  const stored = db.rows[0];
  assert.equal(stored.token_hash, hashAuthToken(rawToken));
  assert.notEqual(stored.token_hash, rawToken);
  assert.equal(stored.token_hash.length, 64);
  // The raw secret must appear nowhere in the persisted row.
  assert.ok(!JSON.stringify(stored).includes(rawToken), 'raw token must never be persisted');
});

test('tokens carry real entropy and are unique per issue', () => {
  const seen = new Set(Array.from({ length: 200 }, () => generateRawAuthToken()));
  assert.equal(seen.size, 200);
  assert.ok(generateRawAuthToken().length >= 40);
});

test('a reset token is single-use — replay is rejected', async () => {
  const { service } = createService();
  const { rawToken } = await service.issue({ userId: 'u_1', purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET });

  const first = await service.consume({ rawToken, purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET });
  assert.equal(first.ok, true);
  assert.equal(first.token.user_id, 'u_1');

  const replay = await service.consume({ rawToken, purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET });
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, 'already_used');
});

test('an expired token is rejected', async () => {
  const { service } = createService();
  const { rawToken } = await service.issue({ userId: 'u_1', purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET, ttlMinutes: -1 });
  const result = await service.consume({ rawToken, purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired');
});

test('a token cannot be used for a different purpose', async () => {
  const { service } = createService();
  const { rawToken } = await service.issue({ userId: 'u_1', purpose: AUTH_TOKEN_PURPOSES.EMAIL_VERIFICATION });
  const result = await service.consume({ rawToken, purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'wrong_purpose');
});

test('malformed and unknown tokens are rejected without revealing anything', async () => {
  const { service } = createService();
  for (const bad of ['', null, undefined, 'not-a-token', 'x'.repeat(64)]) {
    const result = await service.consume({ rawToken: bad, purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET });
    assert.equal(result.ok, false);
  }
});

test('issuing a new reset token supersedes the previous live one', async () => {
  const { service } = createService();
  const first = await service.issue({ userId: 'u_1', purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET });
  await service.issue({ userId: 'u_1', purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET });

  const old = await service.consume({ rawToken: first.rawToken, purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET });
  assert.equal(old.ok, false);
  assert.equal(old.reason, 'revoked');
});

test('revoked tokens stay rejected', async () => {
  const { service } = createService();
  const { rawToken } = await service.issue({ userId: 'u_1', purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET });
  await service.revokeLiveTokens({ userId: 'u_1', purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET });
  const result = await service.consume({ rawToken, purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'revoked');
});

test('hash comparison is timing-safe and length-checked', () => {
  const h = hashAuthToken('abc');
  assert.equal(timingSafeHashEquals(h, h), true);
  assert.equal(timingSafeHashEquals(h, hashAuthToken('abd')), false);
  assert.equal(timingSafeHashEquals(h, 'short'), false);
});

// --- canonical auth URLs ----------------------------------------------------------------------

test('production reset URLs are canonical carup.dev', () => {
  const url = buildAuthActionUrl({ route: AUTH_ROUTES.RESET_PASSWORD, token: 'tok', env: PROD_ENV });
  assert.match(url, /^https:\/\/carup\.dev\/auth\/reset-password\?token=tok$/);
});

test('staging reset URLs are canonical staging.carup.dev', () => {
  const url = buildAuthActionUrl({ route: AUTH_ROUTES.RESET_PASSWORD, token: 'tok', env: STAGING_ENV });
  assert.match(url, /^https:\/\/staging\.carup\.dev\/auth\/reset-password\?token=tok$/);
});

test('no auth URL is ever a *.vercel.app or provider host', () => {
  for (const env of [PROD_ENV, STAGING_ENV, {}]) {
    for (const route of Object.values(AUTH_ROUTES)) {
      const url = buildAuthActionUrl({ route, token: 'tok', env });
      assert.doesNotMatch(url, /vercel\.app/i);
      assert.doesNotMatch(url, /supabase\.co/i);
      assert.doesNotMatch(url, /resend\.com|brevo\.com|sendgrid/i);
    }
  }
});

test('a hostile configured origin cannot move the auth link off the CarUp domain', () => {
  for (const hostile of ['https://evil.example.com', 'https://carup.dev.evil.example.com', 'https://carup-staging.vercel.app']) {
    const url = buildAuthActionUrl({
      route: AUTH_ROUTES.RESET_PASSWORD, token: 'tok',
      env: { ...PROD_ENV, CARUP_PUBLIC_WEB_URL: hostile },
    });
    assert.match(url, /^https:\/\/carup\.dev\//);
  }
});

test('the token is URL-encoded so it survives transport intact', () => {
  const url = buildAuthActionUrl({ route: AUTH_ROUTES.RESET_PASSWORD, token: 'a+b/c=d', env: PROD_ENV });
  assert.ok(url.includes(encodeURIComponent('a+b/c=d')));
});

// --- branded auth Email -----------------------------------------------------------------------

test('auth Email renders the real one-time link, not a provider placeholder', () => {
  const actionUrl = buildAuthActionUrl({ route: AUTH_ROUTES.RESET_PASSWORD, token: 'tok123', env: PROD_ENV });
  const { html, subject, classification } = renderAuthEmail('reset_password', PROD_ENV, { action_url: actionUrl });
  assert.ok(html.includes(actionUrl));
  assert.equal(classification, 'security');
  assert.match(subject, /Reset your CarUp password/);
  assert.doesNotMatch(html, /\{\{/, 'no unsubstituted template placeholder may reach the user');
  assert.doesNotMatch(html, /vercel\.app|supabase\.co/i);
});

test('auth Email carries no marketing content', () => {
  const marketing = /\b(unsubscribe|newsletter|special offer|discount|promo(tion)?|shop now|limited time)\b/i;
  for (const key of ['reset_password', 'confirm_signup', 'password_changed']) {
    const { html, subject } = renderAuthEmail(key, PROD_ENV, { action_url: 'https://carup.dev/auth/reset-password?token=t' });
    assert.doesNotMatch(html, marketing);
    assert.doesNotMatch(subject, marketing);
  }
});

test('the password-changed notice states that sessions were signed out', () => {
  const { html } = renderAuthEmail('password_changed', PROD_ENV);
  assert.match(html, /signed out/i);
});

// --- transport routing ------------------------------------------------------------------------

test('auth/security Email routes to Resend and NEVER to Brevo', async () => {
  const router = new EmailTransportRouter({ env: { RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'a@mail.carup.dev' } });
  for (const classification of ['security', 'auth', 'transactional', 'conversational', 'service']) {
    const selected = router.selectAdapter({ content: { data: { classification } } });
    assert.equal(selected.adapter.provider, 'resend', `${classification} must route to Resend`);
    assert.notEqual(selected.adapter.provider, 'brevo');
  }
});

test('marketing never rides the transactional transport', () => {
  const router = new EmailTransportRouter({ env: { RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'a@mail.carup.dev' } });
  const selected = router.selectAdapter({ content: { data: { classification: 'marketing' } } });
  assert.notEqual(selected.adapter?.provider, 'resend');
  assert.equal(selected.reason, 'marketing_to_brevo');
});

test('marketing with no Brevo configured fails closed rather than falling back to Resend', async () => {
  const router = new EmailTransportRouter({ env: { RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'a@mail.carup.dev' } });
  const result = await router.send({ content: { data: { classification: 'marketing', email: 'x@example.test' } } });
  assert.equal(result.accepted, false);
  assert.equal(result.errorCode, 'provider_not_configured');
});

test('auth Email is P0 and survives quota pressure that suppresses marketing', () => {
  assert.equal(emailPriority('auth'), 0);
  assert.equal(emailPriority('security'), 0);
  assert.ok(emailPriority('security') < emailPriority('marketing'));

  const auth = evaluateSendAllowance({ provider: 'resend', classification: 'security', sentToday: 99 }, {});
  assert.equal(auth.decision, QUOTA_DECISION.ALLOW);
  assert.equal(auth.autoPurchase, false);

  const marketing = evaluateSendAllowance({ provider: 'brevo', classification: 'marketing', sentToday: 299 }, {});
  assert.equal(marketing.decision, QUOTA_DECISION.SUPPRESS);
});

test('the Resend adapter sends auth Email from the CarUp Security sender', () => {
  // Exercised through the router's configured adapter to avoid duplicating construction.
  const router = new EmailTransportRouter({ env: { RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'notifications@mail.carup.dev' } });
  const from = router.resend.fromAddress({ content: { data: { auth_template_key: 'reset_password' } } });
  assert.match(from, /auth@mail\.carup\.dev/);
  assert.match(from, /CarUp Security/);

  const normal = router.resend.fromAddress({ content: { data: {} } });
  assert.match(normal, /notifications@mail\.carup\.dev/);
  assert.doesNotMatch(normal, /auth@/);
});

test('every auth sender address is under the verified mail.carup.dev domain', () => {
  const router = new EmailTransportRouter({ env: { RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'notifications@mail.carup.dev' } });
  for (const data of [{ auth_template_key: 'reset_password' }, {}]) {
    assert.match(router.resend.fromAddress({ content: { data } }), /@mail\.carup\.dev/);
  }
});
