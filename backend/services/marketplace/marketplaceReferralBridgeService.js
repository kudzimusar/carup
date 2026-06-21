/**
 * Marketplace -> Referral event bridge.
 *
 * Marketplace EMITS attribution events; the referral engine OWNS rewards. This bridge maps marketplace
 * actions to ReferralEngineService.recordReferralEvent and NEVER creates or transitions wallet
 * transactions (plan rules 8, lines 537/991-992/1502). Emission is best-effort: a referral/engine
 * failure must never break the marketplace action (parallels the AI advisory-only principle).
 */

import { supabase } from '../../db/supabase.js';
import { ReferralEngineService } from '../referral/referralEngineService.js';
import { REFERRAL_CHANNELS, ACTOR_TYPES } from '../../constants/referral/referralConstants.js';
import { MARKETPLACE_REFERRAL_EVENT_TYPES } from './marketplaceEventTypes.js';

const SOURCE_CHANNEL_MAP = {
  web: REFERRAL_CHANNELS.WEB,
  mobile: REFERRAL_CHANNELS.MOBILE,
  whatsapp: REFERRAL_CHANNELS.WHATSAPP,
  telegram: REFERRAL_CHANNELS.TELEGRAM,
  facebook: REFERRAL_CHANNELS.FACEBOOK,
  qr: REFERRAL_CHANNELS.QR,
  operator: REFERRAL_CHANNELS.ADMIN,
};

function toReferralChannel(sourceChannel) {
  return SOURCE_CHANNEL_MAP[String(sourceChannel || '').toLowerCase()] || REFERRAL_CHANNELS.WEB;
}

export class MarketplaceReferralBridgeService {
  constructor({ client = supabase, referralService = null } = {}) {
    this.referralService = referralService || new ReferralEngineService({ client });
  }

  isSupportedEvent(eventType) {
    return MARKETPLACE_REFERRAL_EVENT_TYPES.includes(eventType);
  }

  /**
   * Emit a marketplace referral event. Best-effort; resolves to a small result object and never throws.
   * @param {object} args
   * @param {string} args.eventType one of MARKETPLACE_REFERRAL_EVENT_TYPES
   * @param {string} [args.listingId]
   * @param {string} [args.inquiryId]
   * @param {string} [args.referralCode]
   * @param {string} [args.campaignCode]
   * @param {string} [args.sourceChannel]
   * @param {object} [args.actor] { actor_user_id, actor_type, actor_tenant_id }
   * @param {object} [args.metadata]
   */
  async emitMarketplaceReferralEvent({
    eventType,
    listingId,
    inquiryId,
    referralCode,
    campaignCode,
    sourceChannel,
    actor = {},
    metadata = {},
  } = {}) {
    if (!this.isSupportedEvent(eventType)) {
      // Reject unknown types loudly to the caller — this is a programming error, not a runtime outage.
      return { recorded: false, referral_attributed: false, reason: 'unsupported_event_type', event_type: eventType };
    }

    const channel = toReferralChannel(sourceChannel);
    let code_id = null;
    let campaign_id = null;
    let referral_attributed = false;

    try {
      if (referralCode) {
        const attribution = await this.referralService.validateReferralCode({ code: referralCode, channel }, actor);
        if (attribution && attribution.valid !== false && (attribution.code_id || attribution.attribution)) {
          const resolved = attribution.attribution || attribution;
          code_id = resolved.code_id || null;
          campaign_id = resolved.campaign_id || null;
          referral_attributed = Boolean(code_id);
        }
      }
    } catch (error) {
      // Attribution lookup is best-effort; never block the marketplace action.
      console.warn('[marketplace-referral] code validation skipped:', error.message);
    }

    const subjectType = inquiryId ? 'marketplace_inquiry' : listingId ? 'marketplace_listing' : null;
    const subjectId = inquiryId || listingId || null;

    try {
      await this.referralService.recordReferralEvent(
        {
          event_type: eventType,
          code_id,
          campaign_id,
          subject_type: subjectType,
          subject_id: subjectId,
          channel,
          source: 'marketplace',
          metadata: cleanEventMetadata({ listing_id: listingId, inquiry_id: inquiryId, campaign_code: campaignCode, ...metadata }),
        },
        {
          actor_user_id: actor.actor_user_id || actor.id || null,
          actor_type: actor.actor_type || (actor.id ? ACTOR_TYPES.USER : ACTOR_TYPES.SYSTEM),
          actor_tenant_id: actor.actor_tenant_id || actor.tenantId || null,
        }
      );
      return { recorded: true, referral_attributed, event_type: eventType };
    } catch (error) {
      console.warn('[marketplace-referral] event emission failed:', error.message);
      return { recorded: false, referral_attributed, reason: 'emit_failed', event_type: eventType };
    }
  }
}

function cleanEventMetadata(obj = {}) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

/** Default shared singleton (service-role client). Tests should construct with an injected referralService. */
export const marketplaceReferralBridge = new MarketplaceReferralBridgeService();
