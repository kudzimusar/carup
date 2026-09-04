import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CommunicationNotificationService,
  projectAccountSecurityActivity,
} from '../services/communication/communicationNotificationService.js';

test('account/security activity is a safe status projection, never the token-bearing Email body', () => {
  const projected = projectAccountSecurityActivity({
    id: 489,
    template_key: 'auth_email_verification_v1',
    channel: 'email',
    status: 'delivered',
    message: 'Confirm account https://example.test/auth/verify-email?token=SECRET',
    payload: { action_url: 'https://example.test/auth/verify-email?token=SECRET', token: 'SECRET' },
    created_at: '2026-09-01T07:26:14Z',
    sent_at: '2026-09-01T07:26:17Z',
    delivered_at: '2026-09-01T07:26:22Z',
  });

  assert.equal(projected.title, 'Email verification');
  assert.equal(projected.status, 'delivered');
  assert.match(projected.summary, /reported delivered/i);
  const rendered = JSON.stringify(projected);
  assert.equal(rendered.includes('SECRET'), false);
  assert.equal(rendered.includes('/auth/verify-email'), false);
  assert.equal('message' in projected, false);
  assert.equal('payload' in projected, false);
});

test('account/security history includes auth Email transport rows only', async () => {
  const rows = [
    { id: 1, recipient_user_id: 'u1', channel: 'email', template_key: 'auth_email_verification_v1', status: 'sent' },
    { id: 2, recipient_user_id: 'u1', channel: 'email', template_key: 'marketplace_inquiry_received_v1', status: 'sent' },
    { id: 3, recipient_user_id: 'u1', channel: 'in_app', template_key: 'auth_email_verification_v1', status: 'sent' },
    { id: 4, recipient_user_id: 'u1', channel: 'email', template_key: 'auth_password_changed_v1', status: 'delivered' },
  ];
  const repository = {
    async list(table, filters) {
      assert.equal(table, 'notification_queue');
      return rows.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
    },
  };
  const service = new CommunicationNotificationService({ repository, threadService: {} });
  const activity = await service.listAccountSecurityActivityForUser('u1');

  assert.deepEqual(activity.map((row) => row.id), ['1', '4']);
  assert.deepEqual(activity.map((row) => row.activity_type), ['auth_email_verification_v1', 'auth_password_changed_v1']);
});
