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
import { ReferralLocalMarketplaceService, LOCAL_MARKETPLACE_EVENT_TYPES } from '../referral/referralLocalMarketplaceService.js';
import { REFERRAL_TABLES } from '../referral/referralEngineRepository.js';
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
  constructor({ client = supabase, referralService = null, localMarketplaceService = null } = {}) {
    this.referralService = referralService || new ReferralEngineService({ client });
    // Reuse the canonical local-marketplace lead service so a bridged lead is byte-for-byte
    // identical to an admin-console-created lead (same LEAD_CREATED event the qualify flow consumes).
    this.localMarketplaceService =
      localMarketplaceService || new ReferralLocalMarketplaceService({ referralService: this.referralService });
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

  /**
   * Bridge a marketplace inquiry that carries a referral code into the canonical, qualifiable
   * local-marketplace referral lead (the LEAD_CREATED event the admin qualify → reward flow consumes).
   *
   * Guarantees:
   * - The invitee's real marketplace submission — not an admin substitute — creates the lead.
   * - campaign_id / code_id / owner are derived SERVER-SIDE from the validated referral code; any
   *   caller-supplied owner/beneficiary/campaign fields on the inquiry are ignored (never passed on).
   * - Idempotent per inquiry: one inquiry → at most one qualifiable lead (keyed on the inquiry id as the
   *   lead's subject_id + source_inquiry_id). Retries return the existing lead.
   * - No wallet transaction / reward is created here — only a pending, qualifiable lead.
   * - An invalid/expired/missing code yields NO attributed lead (the plain marketplace inquiry still stands).
   * Best-effort: never throws; a failure here must not break the marketplace inquiry.
   *
   * @param {object} args
   * @param {object} args.inquiry the persisted inquiry row ({ id, listing_id, message, referral_code, source_channel, buyer_id })
   * @param {object} [args.actor] authenticated buyer actor context ({ actor_user_id | id })
   * @returns {Promise<{bridged:boolean, reason?:string, lead_event_id?:string, idempotent?:boolean, owner_user_id?:string}>}
   */
  async bridgeInquiryToReferralLead({ inquiry = {}, actor = {} } = {}) {
    const inquiryId = inquiry.id || null;
    const referralCode = inquiry.referral_code || null;
    if (!referralCode) return { bridged: false, reason: 'no_referral_code' };
    if (!inquiryId) return { bridged: false, reason: 'missing_inquiry_id' };

    const channel = String(inquiry.source_channel || 'web').toLowerCase();
    const leadActor = {
      actor_user_id: actor.actor_user_id || actor.id || inquiry.buyer_id || null,
      actor_type: (actor.actor_user_id || actor.id || inquiry.buyer_id) ? ACTOR_TYPES.USER : ACTOR_TYPES.SYSTEM,
      actor_tenant_id: actor.actor_tenant_id || actor.tenantId || null,
      surface: channel,
    };

    // Reject non-usable codes up front so an invalid/expired code never produces an attributed lead.
    // `record: false` — this is only a pre-check; createLead performs the single authoritative
    // validation+event, so one inquiry yields exactly one code_validated event (not two).
    const validation = await this.referralService.validateReferralCode({ code: referralCode, channel, record: false }, leadActor);
    if (!validation || validation.valid === false) {
      return { bridged: false, reason: 'invalid_code' };
    }
    const ownerUserId = validation.attribution?.owner_user_id || null;

    // Fast idempotency path: one inquiry → at most one qualifiable lead (subject_id === inquiry id).
    const findExisting = () => this.referralService.repository.findOne(REFERRAL_TABLES.events, {
      event_type: LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED,
      subject_type: 'local_marketplace_lead',
      subject_id: inquiryId,
    });
    const existing = await findExisting();
    if (existing) {
      return { bridged: true, idempotent: true, lead_event_id: existing.id, owner_user_id: ownerUserId };
    }

    try {
      // Create the canonical lead. Only the referral code + inquiry context are forwarded — never a
      // caller-chosen owner/beneficiary. createLead derives owner/campaign from the validated code.
      const result = await this.localMarketplaceService.createLead(
        {
          referral_code: referralCode,
          listing_id: inquiry.listing_id || null,
          message: inquiry.message || null,
          channel,
          lead_reference: inquiryId,
          source_inquiry_id: inquiryId,
          session_id: inquiryId,
        },
        leadActor
      );
      return {
        bridged: true,
        idempotent: false,
        lead_event_id: result.event_id,
        owner_user_id: result.attribution?.owner_user_id || ownerUserId,
      };
    } catch (error) {
      // Atomic idempotency: under concurrent execution two callers can pass the findExisting() check
      // and both attempt an insert; the partial unique index on (source_inquiry_id) for lead events
      // makes the DB reject the loser with a unique violation. Treat that as idempotent success and
      // return the winner's lead — exactly one lead survives.
      if (isUniqueViolation(error)) {
        const raced = await findExisting();
        if (raced) return { bridged: true, idempotent: true, lead_event_id: raced.id, owner_user_id: ownerUserId };
      }
      // Any other failure is surfaced to the caller so the durable retry path (the
      // marketplace.inquiry.created outbox listener) re-attempts — a valid attributed inquiry must not
      // be silently left without its lead.
      throw error;
    }
  }
}

/** True for a Postgres unique-constraint violation (23505) or an equivalent duplicate-key error. */
function isUniqueViolation(error) {
  if (!error) return false;
  const code = error.code || error?.cause?.code || error?.details?.code;
  if (code === '23505') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('duplicate key') || msg.includes('unique constraint') || msg.includes('unique_violation');
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
