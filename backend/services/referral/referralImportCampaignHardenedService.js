import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { REFERRAL_TABLES } from './referralEngineRepository.js';
import { normalizeReferralCode, slugify } from './referralEngineService.js';
import {
  IMPORT_CAMPAIGN_EVENT_TYPES,
  ReferralImportCampaignService,
} from './referralImportCampaignService.js';

const REWARDABLE_IMPORT_MILESTONES = new Set([
  'deposit_paid',
  'booking_confirmed',
  'container_space_paid',
  'auction_won',
  'vehicle_purchased',
  'parts_order_paid',
  'shipment_booked',
]);

function cleanObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function nonNegativeNumber(value, label) {
  if (value === undefined || value === null || value === '') return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new ValidationError(`${label} must be a non-negative number.`, { value });
  return Number(number.toFixed(2));
}

function positiveRewardAmount(value) {
  if (value === undefined || value === null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError('Reward amount must be a positive number.', { value });
  return Number(amount.toFixed(2));
}

function timestampSeed(now) {
  const value = now instanceof Date ? now.getTime() : Date.now();
  return Number.isFinite(value) ? value : Date.now();
}

export class ReferralImportCampaignHardenedService extends ReferralImportCampaignService {
  buildCollisionResistantSlug(input = {}, actor = {}) {
    this.importBundleSlugCounter = (this.importBundleSlugCounter || 0) + 1;
    const flow = input.flow_type || 'container_space';
    const owner = input.owner_user_id || actor.actor_user_id || 'owner';
    const route = input.route_key || [input.route_origin || input.origin, input.route_destination || input.destination].filter(Boolean).join('-') || 'route';
    const campaign = input.campaign_name || `Import ${String(flow).replace(/_/g, ' ')} campaign`;
    return slugify(`${campaign}-${flow}-${owner}-${route}-${timestampSeed(this.now())}-${this.importBundleSlugCounter}`);
  }

  preflightCapacity(input = {}) {
    const total = nonNegativeNumber(input.total_capacity_units ?? input.total_cbm ?? input.total_slots, 'total_capacity_units');
    const booked = nonNegativeNumber(input.booked_capacity_units ?? input.booked_cbm ?? input.booked_slots, 'booked_capacity_units');
    if (total > 0 && booked > total) throw new ValidationError('booked capacity cannot exceed total capacity.', { booked, total });
    return { total, booked };
  }

  async createRoutePage(input = {}, actor = {}) {
    this.preflightCapacity(input);
    return super.createRoutePage(input, actor);
  }

  async updateCapacity(input = {}, actor = {}) {
    this.preflightCapacity(input);
    return super.updateCapacity(input, actor);
  }

  async createReferralBundle(input = {}, actor = {}) {
    const hardenedInput = { ...input };
    if (!hardenedInput.slug) hardenedInput.slug = this.buildCollisionResistantSlug(hardenedInput, actor);
    return super.createReferralBundle(hardenedInput, actor);
  }

  async preflightRequestedCapacity(input = {}, actor = {}) {
    const requested = nonNegativeNumber(input.requested_capacity_units ?? input.requested_cbm ?? input.requested_slots, 'requested_capacity_units');
    if (requested <= 0) return { requested, checked: false };
    const intent = this.classifyImportIntent(input, actor);
    let routeStatus = null;
    try {
      routeStatus = await this.getRouteStatus(intent.route_key);
    } catch {
      return { requested, checked: false };
    }
    const availableRaw = routeStatus?.capacity?.available_capacity_units;
    if (availableRaw === undefined || availableRaw === null) return { requested, checked: false, route_key: intent.route_key };
    const available = nonNegativeNumber(availableRaw, 'available_capacity_units');
    if (requested > available) {
      throw new ValidationError('requested capacity exceeds available route capacity.', {
        route_key: intent.route_key,
        requested,
        available,
        capacity_status: routeStatus?.capacity?.capacity_status || null,
      });
    }
    return { requested, available, checked: true, route_key: intent.route_key };
  }

  async createLead(input = {}, actor = {}) {
    await this.preflightRequestedCapacity(input, actor);
    return super.createLead(input, actor);
  }

  async getLeadEventForQualification(leadEventId) {
    if (!leadEventId) throw new ValidationError('lead_event_id is required.');
    const leadEvent = await this.referralService.repository.findOne(REFERRAL_TABLES.events, { id: leadEventId });
    if (!leadEvent || leadEvent.event_type !== IMPORT_CAMPAIGN_EVENT_TYPES.IMPORT_LEAD_CREATED) {
      throw new NotFoundError('Import campaign lead event not found.', { lead_event_id: leadEventId });
    }
    return leadEvent;
  }

  async getAttributionOwnerForLead(leadEvent, input = {}) {
    const metadata = cleanObject(leadEvent.metadata);
    if (metadata.attribution?.owner_user_id) return metadata.attribution.owner_user_id;
    if (leadEvent.code_id) {
      const code = await this.referralService.repository.findOne(REFERRAL_TABLES.codes, { id: leadEvent.code_id });
      if (code?.owner_user_id) return code.owner_user_id;
    }
    const referralCode = normalizeReferralCode(input.referral_code || metadata.referral_code || '');
    if (referralCode) {
      const code = await this.referralService.repository.findOne(REFERRAL_TABLES.codes, { code: referralCode });
      if (code?.owner_user_id) return code.owner_user_id;
    }
    return null;
  }

  async assertNoDuplicateRewardEligibility(leadEventId, milestone) {
    const existing = await this.referralService.repository.list(REFERRAL_TABLES.events, {
      event_type: IMPORT_CAMPAIGN_EVENT_TYPES.REWARD_ELIGIBILITY_CREATED,
      subject_type: 'import_campaign_lead',
      subject_id: leadEventId,
    });
    const duplicate = existing.find((event) => cleanObject(event.metadata).milestone === milestone);
    if (duplicate) {
      throw new ValidationError('Import reward eligibility already exists for this lead milestone.', {
        lead_event_id: leadEventId,
        milestone,
        existing_event_id: duplicate.id,
      });
    }
  }

  async preflightMilestoneQualification(input = {}) {
    const milestone = String(input.milestone || '').trim().toLowerCase();
    if (!milestone) throw new ValidationError('milestone is required.');
    const leadEvent = await this.getLeadEventForQualification(input.lead_event_id);
    if (!REWARDABLE_IMPORT_MILESTONES.has(milestone)) return { leadEvent, milestone, rewardable: false };

    const metadata = cleanObject(leadEvent.metadata);
    const attributionOwner = await this.getAttributionOwnerForLead(leadEvent, input);
    if (attributionOwner) {
      const referredUserId = input.referred_user_id || metadata.contact?.user_id || null;
      if (referredUserId && referredUserId === attributionOwner) throw new ForbiddenError('Self-referrals cannot create import campaign reward eligibility.');
      positiveRewardAmount(input.reward_amount);
      await this.assertNoDuplicateRewardEligibility(input.lead_event_id, milestone);
    }
    return { leadEvent, milestone, rewardable: Boolean(attributionOwner) };
  }

  async qualifyMilestone(input = {}, actor = {}) {
    await this.preflightMilestoneQualification(input);
    return super.qualifyMilestone(input, actor);
  }
}

export default ReferralImportCampaignHardenedService;
