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

  console.log(`📡 [Automation Hooks] Internal event triggered: ${eventType}`);

  if (!enabled || !webhookUrl) {
    return { dispatched: false, reason: 'DISABLED_OR_NO_URL' };
  }

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

    if (!response.ok) {
      console.warn(`⚠️ [Automation Hooks] Webhook delivery returned non-2xx status: ${response.status}`);
      return { dispatched: false, error: `HTTP_${response.status}` };
    }

    console.log(`✅ [Automation Hooks] Webhook delivered successfully to ${provider}: ${eventType}`);
    return { dispatched: true };
  } catch (error) {
    console.error(`❌ [Automation Hooks] Webhook delivery failed:`, error.message);
    // Failure here MUST NOT interrupt any main task (fail safely)
    return { dispatched: false, error: error.message };
  }
}
