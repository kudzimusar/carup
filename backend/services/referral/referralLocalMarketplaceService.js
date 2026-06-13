import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  ACTOR_TYPES,
  COUPON_DISCOUNT_TYPES,
  REFERRAL_CAMPAIGN_STATUSES,
  REFERRAL_CAMPAIGN_TYPES,
  REFERRAL_CHANNELS,
  REFERRAL_CODE_TYPES,
  WALLET_TRANSACTION_STATUSES,
} from '../../constants/referral/referralConstants.js';
import { REFERRAL_TABLES } from './referralEngineRepository.js';
import { ReferralEngineService, normalizeReferralCode, slugify } from './referralEngineService.js';
import { ReferralChannelGatewayService, normalizeChannel } from './referralChannelGatewayService.js';

export const LOCAL_MARKETPLACE_EVENT_TYPES = Object.freeze({
  LEAD_CREATED: 'local_marketplace.lead_created',
  LEAD_QUALIFIED: 'local_marketplace.lead_qualified',
  REFERRAL_BUNDLE_CREATED: 'local_marketplace.referral_bundle_created',
  REWARD_ELIGIBILITY_CREATED: 'local_marketplace.reward_eligibility_created',
  INTENT_CLASSIFIED: 'local_marketplace.intent_classified',
});

export const LOCAL_PARTICIPANT_TYPES = Object.freeze({
  BUYER: 'buyer',
  SELLER: 'seller',
  PARTS_SUPPLIER: 'parts_supplier',
  MECHANIC: 'mechanic',
  OPERATOR: 'operator',
  GENERAL_REFERRER: 'general_referrer',
});

export const LOCAL_FLOW_TYPES = Object.freeze({
  BUY_VEHICLE: 'buy_vehicle',
  SELL_VEHICLE: 'sell_vehicle',
  FIND_PARTS: 'find_parts',
  SUPPLIER_QUOTE: 'supplier_quote',
  MECHANIC_SERVICE: 'mechanic_service',
  INSPECTION_BOOKING: 'inspection_booking',
  SAFEPAY_REQUEST: 'safepay_request',
  GENERAL_MARKETPLACE: 'general_marketplace',
});

const REWARDABLE_MILESTONES = new Set(['order_paid', 'purchase_confirmed', 'service_booked', 'quote_accepted', 'listing_paid', 'inspection_paid']);
const OPERATOR_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'dealer', 'seller', 'agent', 'manager', 'operator']);

const DEFAULT_REWARD_RULES = Object.freeze({
  buy_vehicle: { amount: 5, currency: 'USD', reason: 'Local vehicle buyer referral converted' },
  sell_vehicle: { amount: 3, currency: 'USD', reason: 'Local seller listing referral converted' },
  find_parts: { amount: 2, currency: 'USD', reason: 'Local parts buyer referral converted' },
  supplier_quote: { amount: 2, currency: 'USD', reason: 'Local supplier referral converted' },
  mechanic_service: { amount: 2, currency: 'USD', reason: 'Local mechanic service referral converted' },
  inspection_booking: { amount: 2, currency: 'USD', reason: 'Local inspection referral converted' },
  safepay_request: { amount: 2, currency: 'USD', reason: 'Local SafePay referral converted' },
  general_marketplace: { amount: 1, currency: 'USD', reason: 'Local marketplace referral converted' },
});

function enumValues(value) {
  return Object.values(value);
}

function cleanObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function normalizeEnum(value, allowed, fallback, label) {
  const normalized = String(value || fallback || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!allowed.includes(normalized)) throw new ValidationError(`${label} is invalid.`, { value, allowed });
  return normalized;
}

function actorIsOperator(actor = {}) {
  return OPERATOR_ROLES.has(String(actor.actor_role || actor.role || '').trim().toLowerCase());
}

function channelToReferralChannel(channel) {
  try {
    const normalized = normalizeChannel(channel);
    if (normalized === 'web_chat') return REFERRAL_CHANNELS.WEB;
    if (normalized === 'mobile_chat') return REFERRAL_CHANNELS.MOBILE;
    return normalized;
  } catch {
    return channel || REFERRAL_CHANNELS.WEB;
  }
}

// Buyers and sellers in the Zimbabwe market almost always name a make/model
// (e.g. "Toyota Aqua", "Honda Fit") instead of the generic word "car", so the
// vehicle-intent heuristics must recognise common makes and JDM models too.
export const VEHICLE_MAKE_MODEL_RE = /\b(car|cars|vehicle|vehicles|truck|trucks|bus|van|sedan|hatchback|suv|bakkie|toyota|honda|nissan|mazda|mitsubishi|mercedes|benz|bmw|audi|volkswagen|vw|ford|isuzu|subaru|suzuki|hyundai|kia|lexus|land\s?rover|range\s?rover|jeep|chevrolet|renault|peugeot|datsun|aqua|vitz|fit|corolla|hilux|fortuner|prado|harrier|allion|premio|wish|noah|voxy|fielder|axio|demio|axela|x-?trail|qashqai|juke|ranger|everest)\b/;

function mentionsVehicle(value) {
  return VEHICLE_MAKE_MODEL_RE.test(value);
}

function detectFlowFromText(text = '') {
  const value = String(text || '').toLowerCase();
  // Service/parts/supplier intent must win before generic buy/sell, otherwise a
  // request like "need a mechanic to repair my car" is misread as a car purchase.
  if (/\b(mechanic|repair|repairs|diagnose|garage|servicing|service my)\b/.test(value)) return LOCAL_FLOW_TYPES.MECHANIC_SERVICE;
  if (/\b(part|spare|engine|gearbox|tyre|battery|bumper|headlight)\b/.test(value)) return LOCAL_FLOW_TYPES.FIND_PARTS;
  if (/\b(supplier|quote|stock|bulk|wholesale)\b/.test(value)) return LOCAL_FLOW_TYPES.SUPPLIER_QUOTE;
  if (/\b(inspect|inspection|verify|check vehicle)\b/.test(value)) return LOCAL_FLOW_TYPES.INSPECTION_BOOKING;
  if (/\b(safepay|escrow|secure payment|safe pay)\b/.test(value)) return LOCAL_FLOW_TYPES.SAFEPAY_REQUEST;
  if (/\b(sell|listing|list my|advertise)\b/.test(value) && mentionsVehicle(value)) return LOCAL_FLOW_TYPES.SELL_VEHICLE;
  if (/\b(buy|buying|looking|find|need|want|wanted)\b/.test(value) && mentionsVehicle(value)) return LOCAL_FLOW_TYPES.BUY_VEHICLE;
  return LOCAL_FLOW_TYPES.GENERAL_MARKETPLACE;
}

function participantForFlow(flowType, explicitParticipant) {
  if (explicitParticipant) return explicitParticipant;
  if (flowType === LOCAL_FLOW_TYPES.SELL_VEHICLE) return LOCAL_PARTICIPANT_TYPES.SELLER;
  if (flowType === LOCAL_FLOW_TYPES.SUPPLIER_QUOTE) return LOCAL_PARTICIPANT_TYPES.PARTS_SUPPLIER;
  if (flowType === LOCAL_FLOW_TYPES.MECHANIC_SERVICE) return LOCAL_PARTICIPANT_TYPES.MECHANIC;
  return LOCAL_PARTICIPANT_TYPES.BUYER;
}

function buildNextSteps(flowType, participantType) {
  const common = ['capture_contact_consent', 'attach_referral_attribution', 'route_to_operator_review'];
  if (flowType === LOCAL_FLOW_TYPES.BUY_VEHICLE) return [...common, 'match_buyer_to_verified_listings', 'offer_safepay_or_inspection'];
  if (flowType === LOCAL_FLOW_TYPES.SELL_VEHICLE) return [...common, 'collect_listing_details', 'verify_seller_identity', 'prepare_listing_share_code'];
  if (flowType === LOCAL_FLOW_TYPES.FIND_PARTS) return [...common, 'collect_part_request', 'route_to_parts_supplier', 'quote_available_stock'];
  if (participantType === LOCAL_PARTICIPANT_TYPES.MECHANIC) return [...common, 'collect_service_issue', 'route_to_mechanic', 'confirm_booking'];
  return [...common, 'classify_local_marketplace_need', 'handoff_to_operator'];
}

function buildLeadSummary(input, flowType, participantType, validation) {
  const target = [input.make, input.model, input.part_name, input.service_type].filter(Boolean).join(' ') || input.listing_id || input.vin || input.stock_reference || 'local marketplace request';
  return {
    flow_type: flowType,
    participant_type: participantType,
    target,
    channel: input.channel || REFERRAL_CHANNELS.WEB,
    referral_code: validation?.valid ? validation.code.code : normalizeReferralCode(input.referral_code || input.code || ''),
    attribution: validation?.valid ? validation.attribution : null,
    status: validation?.valid ? 'attributed' : 'created',
  };
}

export class ReferralLocalMarketplaceService {
  constructor({ referralService, channelGateway, client, now = () => new Date() } = {}) {
    this.referralService = referralService || new ReferralEngineService({ client, now });
    this.channelGateway = channelGateway || new ReferralChannelGatewayService({ referralService: this.referralService, now });
    this.now = now;
  }

  getRuleCatalog() {
    return {
      participant_types: enumValues(LOCAL_PARTICIPANT_TYPES),
      flow_types: enumValues(LOCAL_FLOW_TYPES),
      rewardable_milestones: Array.from(REWARDABLE_MILESTONES),
      default_reward_rules: DEFAULT_REWARD_RULES,
      safety: {
        signup_only_rewards: 'not_matured',
        financial_state: 'pending_only_until_operator_review',
        self_referral: 'blocked',
      },
    };
  }

  classifyIntent(input = {}, actor = {}) {
    const message = input.message || input.text || input.query || '';
    const flowType = normalizeEnum(input.flow_type || detectFlowFromText(message), enumValues(LOCAL_FLOW_TYPES), LOCAL_FLOW_TYPES.GENERAL_MARKETPLACE, 'flow_type');
    const participantType = normalizeEnum(participantForFlow(flowType, input.participant_type), enumValues(LOCAL_PARTICIPANT_TYPES), LOCAL_PARTICIPANT_TYPES.BUYER, 'participant_type');
    return {
      flow_type: flowType,
      participant_type: participantType,
      confidence: flowType === LOCAL_FLOW_TYPES.GENERAL_MARKETPLACE ? 0.55 : 0.82,
      next_steps: buildNextSteps(flowType, participantType),
      actor_surface: actor.surface || input.channel || REFERRAL_CHANNELS.WEB,
    };
  }

  async recordIntent(input = {}, actor = {}) {
    const intent = this.classifyIntent(input, actor);
    const event = await this.referralService.recordReferralEvent({
      event_type: LOCAL_MARKETPLACE_EVENT_TYPES.INTENT_CLASSIFIED,
      subject_type: 'local_marketplace_intent',
      subject_id: input.session_id || input.user_id || actor.actor_user_id || null,
      channel: channelToReferralChannel(input.channel || actor.surface || REFERRAL_CHANNELS.WEB),
      session_id: input.session_id || actor.session_id || null,
      metadata: { ...intent, message: input.message || input.text || null, context: cleanObject(input.context) },
    }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
    return { success: true, intent, event_id: event.id };
  }

  async createLead(input = {}, actor = {}) {
    const intent = this.classifyIntent(input, actor);
    const referralCode = normalizeReferralCode(input.referral_code || input.code || '');
    let validation = null;
    if (referralCode) {
      validation = await this.referralService.validateReferralCode({
        code: referralCode,
        channel: channelToReferralChannel(input.channel || actor.surface || REFERRAL_CHANNELS.WEB),
        source: 'local_marketplace',
        session_id: input.session_id || actor.session_id || null,
        subject_type: 'local_marketplace_lead',
        subject_id: input.lead_reference || input.session_id || actor.session_id || null,
        metadata: { flow_type: intent.flow_type, participant_type: intent.participant_type },
      }, { ...actor, actor_type: actor.actor_type || ACTOR_TYPES.USER });
    }

    let coupon = null;
    if (input.coupon_code) {
      coupon = await this.referralService.applyCoupon({ code: input.coupon_code, order_amount: input.estimated_order_amount || input.order_amount || 0 }, actor);
    }

    const summary = buildLeadSummary(input, intent.flow_type, intent.participant_type, validation);
    const leadEvent = await this.referralService.recordReferralEvent({
      event_type: LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED,
      code_id: validation?.valid ? validation.code.id : null,
      campaign_id: validation?.valid ? validation.code.campaign_id : null,
      subject_type: 'local_marketplace_lead',
      subject_id: input.lead_reference || input.session_id || actor.session_id || null,
      channel: channelToReferralChannel(input.channel || actor.surface || REFERRAL_CHANNELS.WEB),
      session_id: input.session_id || actor.session_id || null,
      metadata: {
        ...summary,
        lead_reference: input.lead_reference || null,
        listing_id: input.listing_id || null,
        vin: input.vin || null,
        part_name: input.part_name || null,
        service_type: input.service_type || null,
        location: input.location || 'Zimbabwe',
        contact: cleanObject(input.contact),
        consent: cleanObject(input.consent),
        coupon: coupon ? { applied: coupon.applied, discount_amount: coupon.discount_amount || 0, reason: coupon.reason || null } : null,
        next_steps: intent.next_steps,
      },
    }, actor);

    return {
      success: true,
      lead: {
        id: leadEvent.id,
        status: summary.status,
        flow_type: intent.flow_type,
        participant_type: intent.participant_type,
        target: summary.target,
        location: input.location || 'Zimbabwe',
      },
      attribution: validation?.valid ? validation.attribution : null,
      validation,
      coupon,
      next_steps: intent.next_steps,
      event_id: leadEvent.id,
    };
  }

  async createReferralBundle(input = {}, actor = {}) {
    if (!actorIsOperator(actor)) throw new ForbiddenError('Creating local marketplace referral bundles requires operator context.');
    const flowType = normalizeEnum(input.flow_type || LOCAL_FLOW_TYPES.GENERAL_MARKETPLACE, enumValues(LOCAL_FLOW_TYPES), LOCAL_FLOW_TYPES.GENERAL_MARKETPLACE, 'flow_type');
    const participantType = normalizeEnum(participantForFlow(flowType, input.participant_type), enumValues(LOCAL_PARTICIPANT_TYPES), LOCAL_PARTICIPANT_TYPES.GENERAL_REFERRER, 'participant_type');
    const ownerUserId = input.owner_user_id || actor.actor_user_id;
    if (!ownerUserId) throw new ValidationError('owner_user_id is required for referral bundle creation.');

    let campaign = null;
    if (input.campaign_id) {
      campaign = await this.referralService.repository.findOne(REFERRAL_TABLES.campaigns, { id: input.campaign_id });
      if (!campaign) throw new NotFoundError('Referral campaign not found.', { campaign_id: input.campaign_id });
    } else {
      const campaignName = input.campaign_name || `Local ${flowType.replace(/_/g, ' ')} referral`;
      campaign = await this.referralService.createCampaign({
        tenant_id: input.tenant_id || actor.actor_tenant_id,
        name: campaignName,
        slug: input.slug || slugify(`${campaignName}-${participantType}`),
        campaign_type: REFERRAL_CAMPAIGN_TYPES.LOCAL_MARKETPLACE,
        priority_scope: 'LOCAL',
        status: input.status || REFERRAL_CAMPAIGN_STATUSES.ACTIVE,
        category: flowType,
        channel_strategy: { primary: input.channel || REFERRAL_CHANNELS.WEB, local_marketplace: true },
        metadata: { flow_type: flowType, participant_type: participantType, local_marketplace: true, ...cleanObject(input.metadata) },
      }, actor);
    }

    const code = await this.referralService.createReferralCode({
      tenant_id: input.tenant_id || actor.actor_tenant_id,
      campaign_id: campaign.id,
      owner_user_id: ownerUserId,
      code: input.code,
      prefix: input.prefix || `LOCAL-${participantType}`,
      code_type: input.code_type || REFERRAL_CODE_TYPES.MEMBER,
      channel: input.channel || REFERRAL_CHANNELS.WEB,
      location_scope: input.location_scope || ['Zimbabwe'],
      role_scope: input.role_scope || [participantType],
      metadata: { flow_type: flowType, participant_type: participantType, local_marketplace: true, ...cleanObject(input.metadata) },
    }, actor);

    let coupon = null;
    if (input.create_coupon) {
      coupon = await this.referralService.createCoupon({
        tenant_id: input.tenant_id || actor.actor_tenant_id,
        campaign_id: campaign.id,
        code: input.coupon_code,
        benefit_type: input.coupon_benefit_type || 'buyer_discount',
        discount_type: input.discount_type || COUPON_DISCOUNT_TYPES.FIXED,
        discount_value: input.discount_value ?? 1,
        max_discount_amount: input.max_discount_amount ?? null,
        minimum_order_amount: input.minimum_order_amount ?? null,
        currency: input.currency || 'USD',
        max_redemptions: input.max_redemptions ?? null,
        metadata: { flow_type: flowType, participant_type: participantType, local_marketplace: true },
      }, actor);
    }

    const shareAsset = await this.referralService.createShareAssets({ code: code.code, channel: input.channel || REFERRAL_CHANNELS.WEB }, actor);
    const event = await this.referralService.recordReferralEvent({
      event_type: LOCAL_MARKETPLACE_EVENT_TYPES.REFERRAL_BUNDLE_CREATED,
      code_id: code.id,
      campaign_id: campaign.id,
      coupon_id: coupon?.id || null,
      subject_type: 'local_marketplace_referral_bundle',
      subject_id: ownerUserId,
      channel: channelToReferralChannel(input.channel || actor.surface || REFERRAL_CHANNELS.WEB),
      metadata: { flow_type: flowType, participant_type: participantType, owner_user_id: ownerUserId, coupon_created: Boolean(coupon) },
    }, actor);

    return { success: true, campaign, code, coupon, shareAsset, event_id: event.id };
  }

  async qualifyLead(input = {}, actor = {}) {
    if (!actorIsOperator(actor)) throw new ForbiddenError('Qualifying local marketplace leads requires operator context.');
    if (!input.lead_event_id) throw new ValidationError('lead_event_id is required.');
    const milestone = String(input.milestone || '').trim().toLowerCase();
    if (!milestone) throw new ValidationError('milestone is required.');
    const leadEvent = await this.referralService.repository.findOne(REFERRAL_TABLES.events, { id: input.lead_event_id });
    if (!leadEvent || leadEvent.event_type !== LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_CREATED) throw new NotFoundError('Local marketplace lead event not found.', { lead_event_id: input.lead_event_id });

    const metadata = cleanObject(leadEvent.metadata);
    const flowType = normalizeEnum(input.flow_type || metadata.flow_type || LOCAL_FLOW_TYPES.GENERAL_MARKETPLACE, enumValues(LOCAL_FLOW_TYPES), LOCAL_FLOW_TYPES.GENERAL_MARKETPLACE, 'flow_type');
    const referralCode = normalizeReferralCode(input.referral_code || metadata.referral_code || '');
    let validation = null;
    if (referralCode) validation = await this.referralService.validateReferralCode({ code: referralCode, channel: leadEvent.channel, source: 'local_marketplace_qualification', session_id: leadEvent.session_id, subject_type: 'local_marketplace_lead', subject_id: input.lead_event_id }, { ...actor, actor_type: ACTOR_TYPES.AGENT });

    const qualifiedEvent = await this.referralService.recordReferralEvent({
      event_type: LOCAL_MARKETPLACE_EVENT_TYPES.LEAD_QUALIFIED,
      code_id: validation?.valid ? validation.code.id : leadEvent.code_id,
      campaign_id: validation?.valid ? validation.code.campaign_id : leadEvent.campaign_id,
      subject_type: 'local_marketplace_lead',
      subject_id: input.lead_event_id,
      channel: leadEvent.channel || REFERRAL_CHANNELS.WEB,
      session_id: leadEvent.session_id || null,
      metadata: { milestone, flow_type: flowType, result_reference: input.result_reference || null, order_amount: input.order_amount || null, lead_event_id: input.lead_event_id },
    }, actor);

    let reward = null;
    if (REWARDABLE_MILESTONES.has(milestone) && validation?.valid && validation.attribution?.owner_user_id) {
      const referredUserId = input.referred_user_id || metadata.contact?.user_id || null;
      if (referredUserId && referredUserId === validation.attribution.owner_user_id) {
        throw new ForbiddenError('Self-referrals cannot create local marketplace reward eligibility.');
      }
      const rule = DEFAULT_REWARD_RULES[flowType] || DEFAULT_REWARD_RULES.general_marketplace;
      const amount = Number(input.reward_amount ?? rule.amount);
      reward = await this.referralService.createWalletTransaction({
        user_id: validation.attribution.owner_user_id,
        campaign_id: validation.attribution.campaign_id,
        code_id: validation.attribution.code_id,
        source_event_id: qualifiedEvent.id,
        source_event_type: `local_marketplace.${milestone}`,
        transaction_type: 'local_marketplace_referral_credit',
        status: WALLET_TRANSACTION_STATUSES.PENDING,
        amount,
        currency: input.currency || rule.currency,
        reason: input.reward_reason || rule.reason,
        metadata: { flow_type: flowType, milestone, lead_event_id: input.lead_event_id, result_reference: input.result_reference || null },
      }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
      await this.referralService.recordReferralEvent({
        event_type: LOCAL_MARKETPLACE_EVENT_TYPES.REWARD_ELIGIBILITY_CREATED,
        code_id: validation.attribution.code_id,
        campaign_id: validation.attribution.campaign_id,
        wallet_transaction_id: reward.id,
        subject_type: 'local_marketplace_lead',
        subject_id: input.lead_event_id,
        channel: leadEvent.channel || REFERRAL_CHANNELS.WEB,
        session_id: leadEvent.session_id || null,
        metadata: { milestone, flow_type: flowType, amount, currency: input.currency || rule.currency, status: WALLET_TRANSACTION_STATUSES.PENDING },
      }, actor);
    }

    return { success: true, lead_event_id: input.lead_event_id, qualified_event_id: qualifiedEvent.id, milestone, reward_created: Boolean(reward), reward, validation };
  }

  async prepareLocalShareKit(input = {}, actor = {}) {
    const channel = input.channel || actor.surface || REFERRAL_CHANNELS.WEB;
    const response = await this.channelGateway.prepareShareKit(channel, input, actor);
    return { ...response, local_marketplace: true, flow_type: input.flow_type || null, participant_type: input.participant_type || null };
  }
}
