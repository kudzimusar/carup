import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiasporaNotificationRow,
  queueDiasporaNotification,
} from '../services/diaspora/diasporaNotificationService.js';

function insertClient(responses, insertedRows) {
  let insertAttempt = 0;
  return {
    from(table) {
      assert.equal(table, 'notification_queue');
      return {
        insert(row) {
          insertedRows.push(row);
          const response = responses[Math.min(insertAttempt, responses.length - 1)];
          insertAttempt += 1;
          return {
            select() {
              return {
                async single() {
                  return response;
                },
              };
            },
          };
        },
      };
    },
  };
}

test('diaspora notification row satisfies legacy and current queue contracts', () => {
  const input = {
    recipientId: 'user-1',
    tenantId: 'tenant-1',
    type: 'DIASPORA_DOCUMENT_UPLOADED',
    title: 'Trade document uploaded',
    message: 'A diaspora trade document has been uploaded for review.',
    importOrderId: 'order-1',
    channels: ['IN_APP', 'EMAIL_READY'],
    metadata: { documentId: 'document-1', documentType: 'commercial_invoice' },
    now: '2026-07-31T00:00:00.000Z',
  };

  const row = buildDiasporaNotificationRow(input);
  const replay = buildDiasporaNotificationRow(input);

  assert.equal(row.recipient_id, 'user-1');
  assert.equal(row.recipient_user_id, 'user-1');
  assert.equal(row.message_content, input.message);
  assert.equal(row.message, input.message);
  assert.equal(row.status, 'QUEUED');
  assert.equal(row.channel, 'IN_APP');
  assert.equal(row.created_at, input.now);
  assert.equal(row.scheduled_at, input.now);
  assert.equal(row.read, false);
  assert.equal(row.metadata.importOrderId, 'order-1');
  assert.deepEqual(row.metadata.channels, ['IN_APP', 'EMAIL_READY']);
  assert.equal(row.dedupe_key, replay.dedupe_key);
  assert.match(row.dedupe_key, /^diaspora:[a-f0-9]{64}$/);
});

test('queueDiasporaNotification inserts the caller-scoped current-schema row', async () => {
  const insertedRows = [];
  const client = insertClient([
    { data: { id: 'notification-1' }, error: null },
  ], insertedRows);

  const result = await queueDiasporaNotification({
    recipientId: 'user-1',
    tenantId: 'tenant-1',
    type: 'DIASPORA_DOCUMENT_UPLOADED',
    title: 'Trade document uploaded',
    message: 'Uploaded for review.',
    importOrderId: 'order-1',
    metadata: { documentId: 'document-1' },
  }, client);

  assert.deepEqual(result, { id: 'notification-1' });
  assert.equal(insertedRows.length, 1);
  assert.equal(insertedRows[0].recipient_user_id, 'user-1');
  assert.equal(insertedRows[0].recipient_id, 'user-1');
  assert.equal(insertedRows[0].message_content, 'Uploaded for review.');
  assert.ok(insertedRows[0].dedupe_key);
});

test('queueDiasporaNotification retries with an explicit id for historical text-id queues', async () => {
  const insertedRows = [];
  const client = insertClient([
    { data: null, error: { message: 'null value in column "id" violates not-null constraint' } },
    { data: { id: 'generated-notification' }, error: null },
  ], insertedRows);

  const result = await queueDiasporaNotification({
    recipientId: 'user-2',
    type: 'DIASPORA_DOCUMENT_UPLOADED',
    title: 'Trade document uploaded',
    message: 'Uploaded for review.',
    importOrderId: 'order-2',
    metadata: { documentId: 'document-2' },
  }, client);

  assert.deepEqual(result, { id: 'generated-notification' });
  assert.equal(insertedRows.length, 2);
  assert.equal(insertedRows[0].id, undefined);
  assert.match(insertedRows[1].id, /^[0-9a-f-]{36}$/i);
  assert.equal(insertedRows[1].recipient_user_id, 'user-2');
});
