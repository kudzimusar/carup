import { MetaWhatsAppAdapter, trimmedEnvValue } from './adapters/providerAdapters.js';

function parseProviderTemplateReference(reference) {
  const raw = String(reference || '').trim();
  if (!raw) return null;
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.name) {
        return {
          name: String(parsed.name),
          language: String(parsed.language || parsed.language_code || 'en_US'),
        };
      }
    } catch {
      return null;
    }
  }
  const [name, language = 'en_US'] = raw.split('|').map((value) => value.trim());
  return name ? { name, language: language || 'en_US' } : null;
}

function normalizeTemplateParameters(values = []) {
  return (Array.isArray(values) ? values : [values])
    .filter((value) => value !== undefined && value !== null)
    .map((value) => ({ type: 'text', text: String(value) }));
}

/**
 * Meta WhatsApp adapter with explicit business-initiated template support.
 *
 * Free-form text remains valid only when the notification policy has marked the
 * message as a customer-service-window/session send. Outside that window the
 * notification must carry an approved governed provider template reference.
 */
export class CommunicationMetaWhatsAppGovernedAdapter extends MetaWhatsAppAdapter {
  async send(input = {}) {
    const data = input?.content?.data || {};
    const mode = String(
      data.whatsapp_delivery_mode
      || (data.event_type ? 'template' : 'session'),
    ).toLowerCase();
    if (mode !== 'template') return super.send(input);

    if (!this.validateConfiguration().available) return this.missingConfigurationResult();
    const recipient = input?.recipient || {};
    const to = String(
      recipient.phoneNumber
      || recipient.phone_number
      || recipient.address
      || data.phone_number
      || data.phone
      || data.to
      || data.address
      || '',
    ).trim();
    if (!to) {
      return {
        accepted: false,
        retryable: false,
        errorCode: 'recipient_missing',
        errorMessage: 'WhatsApp recipient phone number is required.',
      };
    }

    const template = parseProviderTemplateReference(data.provider_template_reference);
    if (!template) {
      return {
        accepted: false,
        retryable: false,
        errorCode: 'whatsapp_template_not_configured',
        errorMessage: 'Business-initiated WhatsApp delivery requires an approved Meta provider template reference.',
      };
    }

    const phoneNumberId = trimmedEnvValue(this.env, 'CARUP_META_PHONE_NUMBER_ID');
    const accessToken = trimmedEnvValue(this.env, 'CARUP_META_ACCESS_TOKEN');
    const bodyParameters = normalizeTemplateParameters(data.provider_template_parameters || []);
    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        ...(bodyParameters.length
          ? { components: [{ type: 'body', parameters: bodyParameters }] }
          : {}),
      },
    };

    const response = await this.requestJson(
      `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body,
      },
    );
    if (!response.ok) return this.providerFailure(response);
    return {
      accepted: true,
      providerRequestId: response.body?.messages?.[0]?.id || null,
      providerMessageId: response.body?.messages?.[0]?.id || null,
      providerStatus: 'accepted',
      deliveryMode: 'template',
      providerTemplateName: template.name,
    };
  }
}
