import { substituteVariables } from './templateVariableSubstitution.js';

const TEMPLATES = Object.freeze({
  message_acknowledgement_v1: {
    transactional: true,
    subject: 'CarUp received your message',
    body: 'CarUp received your message about {{topic}}. We will keep this thread updated.',
  },
  human_handoff_v1: {
    transactional: true,
    subject: 'A CarUp specialist is reviewing this',
    body: 'A CarUp {{team}} specialist has been asked to review this thread. Reference: {{reference}}.',
  },
  marketplace_inquiry_received_v1: {
    transactional: true,
    subject: 'Marketplace inquiry received',
    body: 'Your marketplace inquiry for {{listing_id}} was received. CarUp will notify the relevant seller or team.',
  },
  listing_shared_v1: {
    transactional: false,
    subject: 'CarUp listing shared',
    body: '{{share_text}} {{share_url}}',
  },
  escrow_status_v1: {
    transactional: true,
    subject: 'SafePay escrow update',
    body: 'SafePay escrow {{escrow_id}} is now {{status}}. This status comes from CarUp backend records.',
  },
  finance_status_v1: {
    transactional: true,
    subject: 'Finance application update',
    body: 'Finance application {{application_id}} status: {{status}}. This update comes from CarUp backend records.',
  },
  verification_decision_v1: {
    transactional: true,
    subject: 'Identity verification decision',
    body: 'Your CarUp identity verification ({{reference}}) has an outcome: {{decision}}. This decision comes from CarUp verification records.',
  },
  listing_moderation_v1: {
    transactional: true,
    subject: 'Marketplace listing update',
    body: 'Your listing {{listing_id}} received a moderation decision: {{decision}}. Current status: {{status}}.',
  },
  evidence_review_v1: {
    transactional: true,
    subject: 'Evidence review decision',
    body: 'Evidence {{reference}} for listing {{listing_id}} was reviewed: {{decision}}.',
  },
  support_resolved_v1: {
    transactional: true,
    subject: 'CarUp support thread resolved',
    body: 'Thread {{reference}} was marked resolved: {{summary}}',
  },
  delivery_failure_fallback_v1: {
    transactional: true,
    subject: 'CarUp delivery fallback',
    body: 'We could not deliver the previous message through {{failed_channel}}, so we are using this permitted fallback channel.',
  },
});

export class CommunicationTemplateService {
  getTemplate(key) {
    return TEMPLATES[key] || TEMPLATES.message_acknowledgement_v1;
  }

  render(templateKey, variables = {}) {
    const template = this.getTemplate(templateKey);
    // Escaping is owned by the representation, not by substitution — see templateVariableSubstitution.js.
    const replace = (text) => substituteVariables(text, variables);
    return {
      templateKey,
      transactional: template.transactional !== false,
      subject: replace(template.subject),
      body: replace(template.body),
      text: replace(template.body),
      data: variables,
    };
  }

  listTemplates() {
    return Object.keys(TEMPLATES);
  }
}

