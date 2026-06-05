import { metricsHub } from '../metrics.js';
import { logger } from '../../utils/logger.js';
import { Sentry } from '../ai/sentry.js';

/**
 * CarUp OS — Automation Webhook Event Hook Dispatcher
 * 
 * Safe, disabled-by-default event hooks targeting custom automation providers (e.g. n8n).
 * Webhook delivery failure is completely non-fatal and fail-safe.
 */
export async function dispatchAutomationWebhook(eventType, payload) {
  const enabled = process.env.ENABLE_AUTOMATION_WEBHOOKS === 'true';
  const provider = process.env.AUTOMATION_PROVIDER || 'n8n';
  const webhookUrl = process.env.AUTOMATION_WEBHOOK_URL;

  logger.info('WEBHOOK', `Internal event triggered: ${eventType}`, { eventType, enabled });

  if (!enabled || !webhookUrl) {
    return { dispatched: false, reason: 'DISABLED_OR_NO_URL' };
  }

  const startTime = Date.now();
  try {
    const timestamp = new Date().toISOString();
    const body = {
      event: eventType,
      provider,
      timestamp,
      payload
    };

    // Use global fetch (native in Node 18+)
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CarUp-Event': eventType
      },
      body: JSON.stringify(body)
    });

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      logger.warn('WEBHOOK', `Webhook delivery returned non-2xx status: ${response.status}`, {
        webhookUrl,
        status: response.status,
        durationMs
      });
      metricsHub.recordWebhookDispatch(webhookUrl, durationMs, false);
      return { dispatched: false, error: `HTTP_${response.status}` };
    }

    logger.info('WEBHOOK', `Webhook delivered successfully to ${provider}: ${eventType}`, {
      webhookUrl,
      durationMs
    });
    metricsHub.recordWebhookDispatch(webhookUrl, durationMs, true);
    return { dispatched: true };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error('WEBHOOK', `Webhook delivery failed: ${error.message}`, {
      webhookUrl,
      durationMs,
      error
    });
    
    // Capture to Sentry as warning/breadcrumb level
    Sentry.addBreadcrumb(`Webhook dispatch failed: ${error.message}`, 'webhook', 'warning');
    
    metricsHub.recordWebhookDispatch(webhookUrl, durationMs, false);
    // Failure here MUST NOT interrupt any main task (fail safely)
    return { dispatched: false, error: error.message };
  }
}

