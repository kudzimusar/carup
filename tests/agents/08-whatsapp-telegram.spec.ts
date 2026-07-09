import { expect, test } from '@playwright/test';
import { MemoryCommunicationRepository } from '../../backend/services/communication/communicationRepository.js';
import { CommunicationIdentityService } from '../../backend/services/communication/communicationIdentityService.js';
import { CommunicationThreadService } from '../../backend/services/communication/communicationThreadService.js';
import { CommunicationNotificationService } from '../../backend/services/communication/communicationNotificationService.js';
import { CommunicationInboundService } from '../../backend/services/communication/communicationInboundService.js';
import { CommunicationWebhookService } from '../../backend/services/communication/communicationWebhookService.js';
import { CommunicationDeliveryWorker } from '../../backend/services/communication/communicationDeliveryWorker.js';
import { FakeCommunicationAdapter } from '../../backend/services/communication/adapters/fakeCommunicationAdapter.js';

process.env.NODE_ENV = 'test';
process.env.CARUP_TELEGRAM_WEBHOOK_SECRET_TOKEN = 'agent8-telegram-secret';

function harness(adapter = new FakeCommunicationAdapter({ channel: 'in_app' })) {
  const repository = new MemoryCommunicationRepository();
  const identityService = new CommunicationIdentityService({ repository });
  const threadService = new CommunicationThreadService({ repository });
  const notificationService = new CommunicationNotificationService({ repository, threadService });
  const inboundService = new CommunicationInboundService({
    repository,
    identityService,
    threadService,
    notificationService,
    referralChannelGateway: {
      async processInbound(channel: string, input: any) {
        const valid = String(input.text || '').includes('AGENT8');
        return {
          success: true,
          channel,
          extracted_referral_code: valid ? 'AGENT8-CODE' : null,
          validation: valid ? { valid: true, code: { id: 'code-agent8', campaign_id: 'campaign-agent8' } } : null,
          reply: 'CarUp received your message.',
        };
      },
    },
  });
  const webhookService = new CommunicationWebhookService({ repository, inboundService });
  const deliveryWorker = new CommunicationDeliveryWorker({ repository, adapterRegistry: { get: () => adapter, health: () => [] } });
  return { repository, threadService, notificationService, webhookService, deliveryWorker };
}

test.describe('Agent 8 - WhatsApp & Telegram Validation Agent', () => {
  test('WhatsApp share notification preserves marketplace and referral attribution', async () => {
    const { notificationService, threadService } = harness();
    const thread = (await threadService.resolveOrCreateThread({ primary_user_id: 'user-agent8', thread_type: 'marketplace_inquiry' })).thread;
    const queued = await notificationService.queueNotification({
      recipientUserId: 'user-agent8',
      thread,
      notificationType: 'listing_shared',
      channel: 'in_app',
      templateKey: 'listing_shared_v1',
      variables: {
        share_text: 'View listing',
        share_url: 'https://carup.test/marketplace/listing/VIN-8?ref=AGENT8-CODE&campaign_id=campaign-agent8&channel=whatsapp',
      },
      dedupeParts: ['agent8-share', 'VIN-8', 'AGENT8-CODE', 'whatsapp'],
      payload: { listing_id: 'VIN-8', referral_code: 'AGENT8-CODE', campaign_id: 'campaign-agent8', channel: 'whatsapp' },
    });
    expect(queued.notification.payload).toMatchObject({ listing_id: 'VIN-8', referral_code: 'AGENT8-CODE', channel: 'whatsapp' });
    expect(queued.notification.message).toContain('AGENT8-CODE');
  });

  test('Telegram webhook dedupe creates one canonical inbound message', async () => {
    const { repository, webhookService } = harness();
    const payload = { update_id: 808, message: { message_id: 18, text: '/start AGENT8-CODE', from: { id: 'tg-agent8' }, chat: { id: 'tg-chat-agent8' } } };
    const headers = { 'x-telegram-bot-api-secret-token': 'agent8-telegram-secret' };
    const first = await webhookService.handleWebhook('telegram', 'telegram', payload, { headers });
    const second = await webhookService.handleWebhook('telegram', 'telegram', payload, { headers });
    expect(first.count).toBe(1);
    expect(second.duplicate).toBe(true);
    expect(await repository.list('messages')).toHaveLength(1);
    expect(await repository.list('webhook_logs')).toHaveLength(1);
  });

  test('retryable provider failure schedules retry and later succeeds without duplicate message', async () => {
    const adapter = new FakeCommunicationAdapter({ channel: 'in_app', failPlan: [{ retryable: true, errorCode: 'timeout' }] });
    const { repository, threadService, notificationService, deliveryWorker } = harness(adapter);
    const thread = (await threadService.resolveOrCreateThread({ primary_user_id: 'user-agent8', thread_type: 'support' })).thread;
    const { notification } = await notificationService.queueNotification({
      recipientUserId: 'user-agent8',
      thread,
      notificationType: 'message_acknowledgement',
      channel: 'in_app',
      templateKey: 'message_acknowledgement_v1',
      variables: { topic: 'support' },
      dedupeParts: ['agent8-retry', 'user-agent8'],
    });
    await deliveryWorker.deliverNotification(notification);
    const retry = await repository.findOne('notification_queue', { id: notification.id });
    expect(retry.status).toBe('retry_scheduled');
    await deliveryWorker.deliverNotification(retry);
    expect((await repository.findOne('notification_queue', { id: notification.id })).status).toBe('delivered');
    expect(await repository.list('messages')).toHaveLength(1);
  });
});
