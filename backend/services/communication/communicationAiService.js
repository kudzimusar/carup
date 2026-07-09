import { isHumanHandoffRequired } from './communicationUtils.js';

const SAFE_FAQ = [
  { match: ['hours', 'open'], answer: 'CarUp support will respond in this thread. For urgent escrow, fraud, payment, or safety concerns, a human specialist is required.' },
  { match: ['share', 'listing'], answer: 'You can share CarUp listings with referral attribution through the share action. CarUp preserves listing, source, campaign, and referral context in the link.' },
  { match: ['escrow', 'safepay'], answer: 'SafePay status can only come from persisted CarUp escrow records. I can explain the status shown by CarUp, but I cannot approve or release escrow.' },
  { match: ['finance', 'loan'], answer: 'Finance decisions come only from CarUp financing records and authorized finance staff. I can help route your question to the finance team.' },
];

export class CommunicationAiService {
  classify(text = '', context = {}) {
    const lowered = String(text || '').toLowerCase();
    if (isHumanHandoffRequired(text, context)) {
      return { intent: lowered.includes('finance') ? 'finance_question' : lowered.includes('escrow') ? 'escrow_question' : 'human_request', confidence: 0.98, handoffRequired: true };
    }
    if (lowered.includes('price') || lowered.includes('listing') || lowered.includes('seller')) return { intent: 'marketplace_inquiry', confidence: 0.82, handoffRequired: false };
    if (lowered.includes('referral') || lowered.includes('coupon') || lowered.includes('code')) return { intent: 'referral_question', confidence: 0.84, handoffRequired: false };
    if (lowered.includes('complaint') || lowered.includes('angry') || lowered.includes('unhappy')) return { intent: 'complaint', confidence: 0.9, handoffRequired: true };
    return { intent: 'general_question', confidence: 0.68, handoffRequired: false };
  }

  safeAnswer(text = '', context = {}) {
    const lowered = String(text || '').toLowerCase();
    if (isHumanHandoffRequired(text, context)) {
      return {
        canSend: false,
        reply: 'I have routed this to a CarUp human specialist. I will not make finance, escrow, payment, trust, or legal decisions in chat.',
        handoffRequired: true,
      };
    }
    const faq = SAFE_FAQ.find((item) => item.match.some((needle) => lowered.includes(needle)));
    if (!faq) {
      return {
        canSend: true,
        reply: 'CarUp received your message. I can help with marketplace, referral, support, and status questions, and I will involve a human when the request needs one.',
        handoffRequired: false,
      };
    }
    return { canSend: true, reply: faq.answer, handoffRequired: false };
  }
}

