import test from 'node:test';
import assert from 'node:assert/strict';

import { CommunicationNotificationService } from '../services/communication/communicationNotificationService.js';
import { CommunicationCanonicalConversationService } from '../services/communication/communicationCanonicalConversationService.js';

test('ordinary-user notification list asks only for in-app rows', async () => {
  let filters = null;
  const repository = { async list(table, nextFilters) { assert.equal(table, 'notification_queue'); filters = nextFilters; return []; } };
  const service = new CommunicationNotificationService({ repository, threadService: {}, preferenceService: {}, templateService: {} });
  await service.listNotificationsForUser('user-1');
  assert.deepEqual(filters, { recipient_user_id: 'user-1', channel: 'in_app' });
});

test('account/security threads stay canonical but are not projected as conversations', async () => {
  const repository = {
    async list(table) {
      if (table === 'message_participants') return [
        { id: 'p-account', user_id: 'u', thread_id: 't-account', permissions: { read: true } },
        { id: 'p-market', user_id: 'u', thread_id: 't-market', permissions: { read: true } },
      ];
      if (table === 'message_threads') return [
        { id: 't-account', thread_type: 'account', status: 'open', created_at: '2026-09-02T00:00:00Z' },
        { id: 't-market', thread_type: 'marketplace_inquiry', status: 'open', created_at: '2026-09-02T00:00:01Z' },
      ];
      if (table === 'messages') return [
        { id: 'm-account', thread_id: 't-account', content_text: 'Confirm your email', channel: 'email', created_at: '2026-09-02T00:00:00Z' },
        { id: 'm-market', thread_id: 't-market', content_text: 'Is this available?', channel: 'in_app', created_at: '2026-09-02T00:00:01Z' },
      ];
      return [];
    },
    async findOne(table, filters) {
      if (table !== 'message_threads') return null;
      return filters.id === 't-market' ? { id: 't-market', thread_type: 'marketplace_inquiry' } : { id: 't-account', thread_type: 'account' };
    },
  };
  const service = new CommunicationCanonicalConversationService({ repository, threadService: {}, identityService: {}, notificationService: {} });
  const rows = await service.listConversationsForUser('u');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 't-market');
});
