import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createAuthEmailService } from '../services/auth/authEmailService.js';

test('auth Email queues canonically before immediate serverless dispatch', async () => {
  const calls = [];
  const notification = { id: 'n1', message_id: 'm1', recipient_user_id: 'u1', channel: 'email' };
  const services = {
    notificationService: {
      async queueNotification(input) {
        calls.push(['queue', input.classification, input.channel]);
        return { notification };
      },
    },
    deliveryWorker: {
      async deliverNotification(row) {
        calls.push(['deliver', row.id]);
        return { status: 'sent' };
      },
    },
  };

  const service = createAuthEmailService({
    db: {},
    tokenService: {},
    services,
    env: {},
  });
  const result = await service.queueAuthEmail({
    user: { id: 'u1', email: 'uat@example.test' },
    templateKey: 'auth_email_verification_v1',
    authTemplateKey: 'confirm_signup',
    variables: { action_url: 'https://example.test/verify', dedupe_nonce: 'nonce-1' },
  });

  assert.deepEqual(calls, [['queue', 'security', 'email'], ['deliver', 'n1']]);
  assert.equal(result.delivery.status, 'sent');
});

test('existing Passport reuse is explicit and never rewrites ownership automatically', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const routes = readFileSync(new URL('../routes/vehiclesRoutes.js', import.meta.url), 'utf8');

  assert.match(server, /reuse_existing_passport/);
  assert.match(server, /SELLER_AUTHORITY_CLAIM_REQUIRED/);
  assert.match(server, /governedSellerEvidence/);
  assert.match(server, /reused_existing_passport: reusedExistingPassport/);
  assert.doesNotMatch(server, /governedSellerEvidence[\s\S]{0,1600}\.update\(\{[^}]*owner_id/);

  assert.match(routes, /SELLER_AUTHORITY_CLAIM_REQUESTED/);
  assert.match(routes, /status: 'evidence_required'/);
  assert.match(routes, /hasVerifiedSellerAuthorityEvidence/);
  assert.match(routes, /registration_document/);
  assert.match(routes, /ownership_transfer_document/);
});
