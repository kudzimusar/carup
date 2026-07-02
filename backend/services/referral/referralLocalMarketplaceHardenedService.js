import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { REFERRAL_CHANNELS } from '../../constants/referral/referralConstants.js';
import { REFERRAL_TABLES } from './referralEngineRepository.js';
import { normalizeReferralCode, slugify } from './referralEngineService.js';
import {
  LOCAL_MARKETPLACE_EVENT_TYPES,
  ReferralLocalMarketplaceService,
} from './referralLocalMarketplaceService.js';

const REWARDABLE_MILESTONES = new Set([
  'order_paid',
  'purchase_confirmed',
  'service_booked',
  'quote_accepted',
  'listing_paid',
  'inspection_paid',
]);

function cleanObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function positiveAmount(value) {
  if (value === undefined || value === null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError('Reward amount must be a positive number.', { value });
  }
  return Number(amount.toFixed(2));
}

function timestampSeed(now) {
  const value = now instanceof Date ? now.getTime() : Date.now();
  return Number.isFinite(value) ? value : Date.now();
}

export class ReferralLocalMarketplaceHardenedService extends ReferralLocalMarketplaceService {
  buildCollisionResistantSlug(input = {}, actor = {}) {
    this.localBundleSlugCounter = (this.localBundleSlugCounter || 0) + 1;
    const flow = input.flow_type || 'general_marketplace';
    const participant = input.participant_type || flow;
    const owner = input.owner_user_id || actor.actor_user_id || 'owner';
    const name = input.campaign_name || `Local ${String(flow).replace(/_/g, ' ')} referral`;
    const seed = `${name}-${participant}-${owner}-${timestampSeed(this.now())}-${this.localBundleSlugCounter}`;
    return slugify(seed);
  }

  async createReferralBundle(input = {}, actor = {}) {
    const hardenedInput = { ...input };
    if (!hardenedInput.campaign_id && !hardenedInput.slug) {
      hardenedInput.slug = this.buildCollisionResistantSlug(hardenedInput, actor);
    }
    return super.createReferralBundle(hardenedInput, actor);
  }

  async getLeadEventForQualification(leadEventId) {
    if (!leadEventId) throw new ValidationError('lead_event_id is required.');
    const leadEvent = await this.referralService.repository.findOne(REFERRAL_TABLES.events, { id: leadEventId });
    if (!leadEvent || leadEvent.event_type !== LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED) {
      throw new NotFoundError('Local marketplace lead event not found.', { lead_event_id: leadEventId });
    }
    return leadEvent;
  }

  async getAttributionOwner(leadEvent, input = {}) {
    const metadata = cleanObject(leadEvent.metadata);
    if (metadata.attribution?.owner_user_id) return metadata.attribution.owner_user_id;
    if (leadEvent.code_id) {
      const code = await this.referralService.repository.findOne(REFERRAL_TABLES.codes, { id: leadEvent.code_id });
      if (code?.owner_user_id) return code.owner_user_id;
    }
    // Lead-first so the preflight self-referral/duplicate guards resolve the same
    // owner that the base service credits.
    const referralCode = normalizeReferralCode(metadata.referral_code || input.referral_code || '');
    if (referralCode) {
      const code = await this.referralService.repository.findOne(REFERRAL_TABLES.codes, { code: referralCode });
      if (code?.owner_user_id) return code.owner_user_id;
    }
    return null;
  }

  async assertNoDuplicateRewardEligibility(leadEventId, milestone) {
    const existing = await this.referralService.repository.list(REFERRAL_TABLES.events, {
      event_type: LOCAL_MARKETPLACE_EVENT_TYPES.REWARD_ELIGIBILITY_CREATED,
      subject_type: 'local_marketplace_lead',
      subject_id: leadEventId,
    });
    const duplicate = existing.find((event) => cleanObject(event.metadata).milestone === milestone);
    if (duplicate) {
      throw new ValidationError('Reward eligibility already exists for this local marketplace lead milestone.', {
        lead_event_id: leadEventId,
        milestone,
        existing_event_id: duplicate.id,
      });
    }
  }

  async preflightQualification(input = {}) {
    const milestone = String(input.milestone || '').trim().toLowerCase();
    if (!milestone) throw new ValidationError('milestone is required.');
    const leadEvent = await this.getLeadEventForQualification(input.lead_event_id);
    if (!REWARDABLE_MILESTONES.has(milestone)) return { leadEvent, milestone, rewardable: false };

    const metadata = cleanObject(leadEvent.metadata);
    const attributionOwner = await this.getAttributionOwner(leadEvent, input);
    if (attributionOwner) {
      const referredUserId = input.referred_user_id || metadata.contact?.user_id || null;
      if (referredUserId && referredUserId === attributionOwner) {
        throw new ForbiddenError('Self-referrals cannot create local marketplace reward eligibility.');
      }
      positiveAmount(input.reward_amount);
      await this.assertNoDuplicateRewardEligibility(input.lead_event_id, milestone);
    }
    return { leadEvent, milestone, rewardable: Boolean(attributionOwner) };
  }

  async qualifyLead(input = {}, actor = {}) {
    await this.preflightQualification(input, actor);
    return super.qualifyLead(input, actor);
  }

  async prepareLocalShareKit(input = {}, actor = {}) {
    return super.prepareLocalShareKit({ channel: actor.surface || REFERRAL_CHANNELS.WEB, ...input }, actor);
  }
}

export default ReferralLocalMarketplaceHardenedService;
