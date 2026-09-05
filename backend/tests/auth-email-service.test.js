import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthEmailService } from '../services/auth/authEmailService.js';
import { AUTH_TOKEN_PURPOSES } from '../services/auth/authActionTokenService.js';

function harness({ deliveryResult = { status: 'sent' }, deliveryError = null } = {}) {
  const queued = [];
  const delivered = [];
  const issued = [];
  const notification = { id: 'auth-notification-1', template_key: 'auth_email_verification_v1' };

  const services = {
    notificationService: {
      async queueNotification(payload) {
        queued.push(payload);
        return { notification, duplicate: false };
      },
    },
    deliveryWorker: {
      async deliverNotification(row) {
        delivered.push(row);
        if (deliveryError) throw deliveryError;
        return deliveryResult;
      },
    },
  };

  const tokenService = {
    async issue(input) {
      issued.push(input);
      return {
        rawToken: 'verification-token-123',
        record: { id: 'tok-1', expires_at: '2026-09-01T00:00:00.000Z' },
      };
    },
  };

  const service = createAuthEmailService({
    db: {},
    tokenService,
    services,
    env: {
      NODE_ENV: 'test',
      VERCEL: '1',
      VERCEL_ENV: 'production',
      VERCEL_PROJECT_PRODUCTION_URL: 'carup-backend-staging.vercel.app',
    },
  });

  return { service, queued, delivered, issued, notification };
}

test('auth Email enters the canonical queue and is immediately delivered in preview/serverless semantics', async () => {
  const h = harness();
  const result = await h.service.queueAuthEmail({
    user: { id: 'u_1', email: 'owner@example.test' },
    templateKey: 'auth_password_reset_v1',
    authTemplateKey: 'reset_password',
    variables: { action_url: 'https://staging.carup.dev/auth/reset-password?token=t', dedupe_nonce: 'nonce-1' },
  });

  assert.equal(h.queued.length, 1);
  assert.equal(h.delivered.length, 1);
  assert.equal(h.delivered[0], h.notification);
  assert.equal(result.delivery.status, 'sent');

  const payload = h.queued[0];
  assert.equal(payload.channel, 'email');
  assert.equal(payload.priority, 'high');
  assert.equal(payload.transactional, true);
  assert.equal(payload.classification, 'security');
  assert.deepEqual(payload.fallbackChannels, []);
  assert.equal(payload.payload.email, 'owner@example.test');
  assert.equal(payload.payload.auth_template_key, 'reset_password');
});

test('immediate auth delivery failure is returned truthfully and never relabelled as sent', async () => {
  const h = harness({ deliveryError: new Error('provider unavailable') });
  const result = await h.service.queueAuthEmail({
    user: { id: 'u_2', email: 'owner2@example.test' },
    templateKey: 'auth_email_verification_v1',
    authTemplateKey: 'confirm_signup',
    variables: { action_url: 'https://staging.carup.dev/auth/verify-email?token=t', dedupe_nonce: 'nonce-2' },
  });

  assert.equal(h.queued.length, 1, 'the durable queue remains the first boundary');
  assert.equal(h.delivered.length, 1, 'preview delivery is attempted immediately');
  assert.equal(result.delivery.status, 'delivery_failed');
  assert.equal(result.delivery.errorCode, 'auth_immediate_dispatch_failed');
  assert.match(result.delivery.errorMessage, /provider unavailable/);
});

test('email verification issues the correct-purpose token and sends the canonical staging action URL', async () => {
  const h = harness();
  const result = await h.service.issueEmailVerification({
    user: { id: 'u_3', email: 'verify@example.test' },
    requestedIp: '127.0.0.1',
    userAgent: 'test-agent',
    source: 'registration',
  });

  assert.equal(h.issued.length, 1);
  assert.equal(h.issued[0].userId, 'u_3');
  assert.equal(h.issued[0].purpose, AUTH_TOKEN_PURPOSES.EMAIL_VERIFICATION);
  assert.equal(h.issued[0].source, 'registration');

  assert.equal(h.queued.length, 1);
  const queued = h.queued[0];
  assert.equal(queued.templateKey, 'auth_email_verification_v1');
  assert.equal(queued.payload.auth_template_key, 'confirm_signup');
  assert.match(queued.variables.action_url, /^https:\/\/staging\.carup\.dev\/auth\/verify-email\?token=/);
  assert.ok(queued.variables.action_url.includes(encodeURIComponent('verification-token-123')));
  assert.equal(result.delivery.status, 'sent');
  assert.equal(result.record.expires_at, '2026-09-01T00:00:00.000Z');
});
