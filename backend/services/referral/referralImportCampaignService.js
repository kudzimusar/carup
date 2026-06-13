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

export const IMPORT_CAMPAIGN_EVENT_TYPES = Object.freeze({
  ROUTE_PAGE_CREATED: 'import_campaign.route_page_created',
  CAPACITY_UPDATED: 'import_campaign.capacity_updated',
  REFERRAL_BUNDLE_CREATED: 'import_campaign.referral_bundle_created',
  IMPORT_LEAD_CREATED: 'import_campaign.lead_created',
  MILESTONE_QUALIFIED: 'import_campaign.milestone_qualified',
  REWARD_ELIGIBILITY_CREATED: 'import_campaign.reward_eligibility_created',
  SHARE_KIT_PREPARED: 'import_campaign.share_kit_prepared',
});

export const IMPORT_FLOW_TYPES = Object.freeze({
  VEHICLE_IMPORT: 'vehicle_import',
  PARTS_IMPORT: 'parts_import',
  CONTAINER_SPACE: 'container_space',
});

export const IMPORT_PARTICIPANT_TYPES = Object.freeze({
  IMPORT_BUYER: 'import_buyer',
  EXPORT_SELLER: 'export_seller',
  PARTS_SUPPLIER: 'parts_supplier',
  SPACE_BOOKER: 'space_booker',
  ROUTE_AGENT: 'route_agent',
  GENERAL_REFERRER: 'general_referrer',
});

export const IMPORT_CAPACITY_STATUSES = Object.freeze({
  PLANNED: 'planned',
  OPEN: 'open',
  LIMITED: 'limited',
  FULL: 'full',
  CLOSED: 'closed',
});

const REWARDABLE_IMPORT_MILESTONES = new Set([
  'deposit_paid',
  'booking_confirmed',
  'container_space_paid',
  'auction_won',
  'vehicle_purchased',
  'parts_order_paid',
  'shipment_booked',
]);

const OPERATOR_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'dealer', 'seller', 'agent', 'manager', 'operator', 'route_agent']);

const DEFAULT_IMPORT_REWARD_RULES = Object.freeze({
  vehicle_import: { amount: 25, currency: 'USD', reason: 'Vehicle import referral milestone reached' },
  parts_import: { amount: 5, currency: 'USD', reason: 'Parts import referral milestone reached' },
  container_space: { amount: 10, currency: 'USD', reason: 'Container-space referral milestone reached' },
});

function enumValues(value) { return Object.values(value); }
function cleanObject(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)); }
function actorIsOperator(actor = {}) { return OPERATOR_ROLES.has(String(actor.actor_role || actor.role || '').trim().toLowerCase()); }
function normalizeEnum(value, allowed, fallback, label) { const normalized = String(value || fallback || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); if (!allowed.includes(normalized)) throw new ValidationError(`${label} is invalid.`, { value, allowed }); return normalized; }
function positiveNumber(value, label, fallback = null) { const source = value ?? fallback; if (source === null || source === undefined || source === '') return null; const number = Number(source); if (!Number.isFinite(number) || number < 0) throw new ValidationError(`${label} must be a non-negative number.`, { value }); return Number(number.toFixed(2)); }
function positiveReward(value, fallback) { const amount = Number(value ?? fallback); if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError('Reward amount must be a positive number.', { value }); return Number(amount.toFixed(2)); }
function timestampSeed(now) { const value = now instanceof Date ? now.getTime() : Date.now(); return Number.isFinite(value) ? value : Date.now(); }
function channelToReferralChannel(channel) { try { const normalized = normalizeChannel(channel); if (normalized === 'web_chat') return REFERRAL_CHANNELS.WEB; if (normalized === 'mobile_chat') return REFERRAL_CHANNELS.MOBILE; return normalized; } catch { return channel || REFERRAL_CHANNELS.WEB; } }
function routeKeyFor(input = {}) { return slugify(input.route_key || [input.route_origin || input.origin, input.route_destination || input.destination, input.flow_type || input.import_type || 'import'].filter(Boolean).join('-')); }

function campaignTypeForFlow(flowType) {
  if (flowType === IMPORT_FLOW_TYPES.VEHICLE_IMPORT) return REFERRAL_CAMPAIGN_TYPES.IMPORT_VEHICLE;
  if (flowType === IMPORT_FLOW_TYPES.PARTS_IMPORT) return REFERRAL_CAMPAIGN_TYPES.IMPORT_PARTS;
  if (flowType === IMPORT_FLOW_TYPES.CONTAINER_SPACE) return REFERRAL_CAMPAIGN_TYPES.CONTAINER_SPACE;
  return REFERRAL_CAMPAIGN_TYPES.CONTAINER_SPACE;
}

function participantForFlow(flowType, explicitParticipant) {
  if (explicitParticipant) return explicitParticipant;
  if (flowType === IMPORT_FLOW_TYPES.CONTAINER_SPACE) return IMPORT_PARTICIPANT_TYPES.SPACE_BOOKER;
  if (flowType === IMPORT_FLOW_TYPES.PARTS_IMPORT) return IMPORT_PARTICIPANT_TYPES.PARTS_SUPPLIER;
  return IMPORT_PARTICIPANT_TYPES.IMPORT_BUYER;
}

// Importers name makes/models ("import a Toyota Aqua from Japan") far more often
// than the generic word "vehicle", so the vehicle-import heuristic recognises
// common makes and JDM models too.
const IMPORT_VEHICLE_MAKE_MODEL_RE = /\b(vehicle|car|auction|truck|bus|van|toyota|honda|nissan|mazda|mitsubishi|mercedes|benz|bmw|audi|volkswagen|vw|ford|isuzu|subaru|suzuki|hyundai|kia|lexus|land\s?rover|range\s?rover|jeep|chevrolet|renault|peugeot|datsun|aqua|vitz|fit|corolla|hilux|fortuner|prado|harrier|allion|premio|wish|noah|voxy|fielder|axio|demio|axela|x-?trail|qashqai|juke|ranger|everest)\b/;

function detectImportFlow(input = {}) {
  const text = [input.message, input.text, input.query, input.category, input.part_name].filter(Boolean).join(' ').toLowerCase();
  if (/\b(container|space|shipment|cbm|route|consolidation)\b/.test(text)) return IMPORT_FLOW_TYPES.CONTAINER_SPACE;
  if (/\b(part|spare|engine|gearbox|tyre|battery|bumper|headlight)\b/.test(text)) return IMPORT_FLOW_TYPES.PARTS_IMPORT;
  if (IMPORT_VEHICLE_MAKE_MODEL_RE.test(text)) return IMPORT_FLOW_TYPES.VEHICLE_IMPORT;
  return input.flow_type || IMPORT_FLOW_TYPES.CONTAINER_SPACE;
}

function buildImportNextSteps(flowType, capacityStatus) {
  const common = ['capture_contact_consent', 'attach_import_referral_attribution', 'route_to_import_operator'];
  if (capacityStatus === IMPORT_CAPACITY_STATUSES.FULL || capacityStatus === IMPORT_CAPACITY_STATUSES.CLOSED) return [...common, 'offer_waitlist_or_next_route'];
  if (flowType === IMPORT_FLOW_TYPES.VEHICLE_IMPORT) return [...common, 'collect_vehicle_specs', 'estimate_import_budget', 'offer_deposit_or_inspection_path'];
  if (flowType === IMPORT_FLOW_TYPES.PARTS_IMPORT) return [...common, 'collect_part_request', 'match_supplier_stock', 'quote_shipping_or_container_space'];
  return [...common, 'estimate_cbm_or_units', 'reserve_container_space', 'confirm_route_cutoff_date'];
}

function deriveCapacityStatus(input = {}) {
  const explicit = input.capacity_status || input.status;
  if (explicit) return normalizeEnum(explicit, enumValues(IMPORT_CAPACITY_STATUSES), IMPORT_CAPACITY_STATUSES.OPEN, 'capacity_status');
  const total = Number(input.total_capacity_units ?? input.total_cbm ?? input.total_slots ?? 0);
  const booked = Number(input.booked_capacity_units ?? input.booked_cbm ?? input.booked_slots ?? 0);
  if (total > 0 && booked >= total) return IMPORT_CAPACITY_STATUSES.FULL;
  if (total > 0 && booked / total >= 0.8) return IMPORT_CAPACITY_STATUSES.LIMITED;
  return IMPORT_CAPACITY_STATUSES.OPEN;
}

export class ReferralImportCampaignService {
  constructor({ referralService, channelGateway, client, now = () => new Date() } = {}) {
    this.referralService = referralService || new ReferralEngineService({ client, now });
    this.channelGateway = channelGateway || new ReferralChannelGatewayService({ referralService: this.referralService, now });
    this.now = now;
  }

  getRuleCatalog() {
    return {
      flow_types: enumValues(IMPORT_FLOW_TYPES),
      participant_types: enumValues(IMPORT_PARTICIPANT_TYPES),
      capacity_statuses: enumValues(IMPORT_CAPACITY_STATUSES),
      rewardable_milestones: Array.from(REWARDABLE_IMPORT_MILESTONES),
      default_reward_rules: DEFAULT_IMPORT_REWARD_RULES,
      safety: {
        priority_scope: 'IMPORT',
        route_capacity_source: 'referral_events',
        financial_state: 'pending_only_until_operator_review',
        duplicate_reward_policy: 'blocked_per_lead_and_milestone',
        self_referral: 'blocked',
      },
    };
  }

  classifyImportIntent(input = {}, actor = {}) {
    const flowType = normalizeEnum(input.flow_type || detectImportFlow(input), enumValues(IMPORT_FLOW_TYPES), IMPORT_FLOW_TYPES.CONTAINER_SPACE, 'flow_type');
    const participantType = normalizeEnum(participantForFlow(flowType, input.participant_type), enumValues(IMPORT_PARTICIPANT_TYPES), IMPORT_PARTICIPANT_TYPES.GENERAL_REFERRER, 'participant_type');
    const routeKey = routeKeyFor({ ...input, flow_type: flowType });
    const capacityStatus = deriveCapacityStatus(input);
    return {
      flow_type: flowType,
      participant_type: participantType,
      route_key: routeKey,
      route_origin: input.route_origin || input.origin || null,
      route_destination: input.route_destination || input.destination || 'Zimbabwe',
      capacity_status: capacityStatus,
      confidence: input.flow_type ? 0.92 : 0.78,
      next_steps: buildImportNextSteps(flowType, capacityStatus),
      actor_surface: actor.surface || input.channel || REFERRAL_CHANNELS.WEB,
    };
  }

  async createRoutePage(input = {}, actor = {}) {
    if (!actorIsOperator(actor)) throw new ForbiddenError('Creating import route pages requires operator context.');
    const intent = this.classifyImportIntent(input, actor);
    const event = await this.referralService.recordReferralEvent({
      event_type: IMPORT_CAMPAIGN_EVENT_TYPES.ROUTE_PAGE_CREATED,
      subject_type: 'import_route',
      subject_id: intent.route_key,
      channel: channelToReferralChannel(input.channel || actor.surface || REFERRAL_CHANNELS.WEB),
      session_id: input.session_id || actor.session_id || null,
      metadata: {
        ...intent,
        title: input.title || `${intent.route_origin || 'Import'} to ${intent.route_destination} ${intent.flow_type.replace(/_/g, ' ')}`,
        route_page_slug: input.route_page_slug || intent.route_key,
        seo_summary: input.seo_summary || null,
        cutoff_date: input.cutoff_date || null,
        departure_date: input.departure_date || null,
        arrival_eta: input.arrival_eta || null,
        total_capacity_units: positiveNumber(input.total_capacity_units ?? input.total_cbm ?? input.total_slots, 'total_capacity_units', 0),
        booked_capacity_units: positiveNumber(input.booked_capacity_units ?? input.booked_cbm ?? input.booked_slots, 'booked_capacity_units', 0),
        unit_label: input.unit_label || (intent.flow_type === IMPORT_FLOW_TYPES.CONTAINER_SPACE ? 'CBM' : 'slots'),
        requires_human_review: true,
      },
    }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
    return { success: true, route: { id: event.id, ...event.metadata }, event_id: event.id };
  }

  async updateCapacity(input = {}, actor = {}) {
    if (!actorIsOperator(actor)) throw new ForbiddenError('Updating import capacity requires operator context.');
    const routeKey = routeKeyFor(input);
    const capacityStatus = deriveCapacityStatus(input);
    const total = positiveNumber(input.total_capacity_units ?? input.total_cbm ?? input.total_slots, 'total_capacity_units', 0);
    const booked = positiveNumber(input.booked_capacity_units ?? input.booked_cbm ?? input.booked_slots, 'booked_capacity_units', 0);
    if (total > 0 && booked > total) throw new ValidationError('booked capacity cannot exceed total capacity.', { booked, total });
    const event = await this.referralService.recordReferralEvent({
      event_type: IMPORT_CAMPAIGN_EVENT_TYPES.CAPACITY_UPDATED,
      subject_type: 'import_route',
      subject_id: routeKey,
      channel: channelToReferralChannel(input.channel || actor.surface || REFERRAL_CHANNELS.WEB),
      session_id: input.session_id || actor.session_id || null,
      metadata: {
        route_key: routeKey,
        route_origin: input.route_origin || input.origin || null,
        route_destination: input.route_destination || input.destination || 'Zimbabwe',
        flow_type: normalizeEnum(input.flow_type || detectImportFlow(input), enumValues(IMPORT_FLOW_TYPES), IMPORT_FLOW_TYPES.CONTAINER_SPACE, 'flow_type'),
        capacity_status: capacityStatus,
        total_capacity_units: total,
        booked_capacity_units: booked,
        available_capacity_units: total > 0 ? Math.max(total - booked, 0) : null,
        unit_label: input.unit_label || 'units',
        cutoff_date: input.cutoff_date || null,
        updated_by: actor.actor_user_id || null,
      },
    }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
    return { success: true, route_key: routeKey, capacity: event.metadata, event_id: event.id };
  }

  async getRouteStatus(routeKey) {
    const key = routeKeyFor({ route_key: routeKey });
    const events = await this.referralService.repository.list(REFERRAL_TABLES.events, { subject_type: 'import_route', subject_id: key });
    const routeEvent = [...events].reverse().find((event) => event.event_type === IMPORT_CAMPAIGN_EVENT_TYPES.ROUTE_PAGE_CREATED) || null;
    const capacityEvent = [...events].reverse().find((event) => event.event_type === IMPORT_CAMPAIGN_EVENT_TYPES.CAPACITY_UPDATED) || null;
    if (!routeEvent && !capacityEvent) throw new NotFoundError('Import route status not found.', { route_key: key });
    const route = cleanObject(routeEvent?.metadata);
    const capacity = cleanObject(capacityEvent?.metadata || routeEvent?.metadata);
    return { success: true, route_key: key, route, capacity, history_count: events.length };
  }

  async createReferralBundle(input = {}, actor = {}) {
    if (!actorIsOperator(actor)) throw new ForbiddenError('Creating import referral bundles requires operator context.');
    const intent = this.classifyImportIntent(input, actor);
    const ownerUserId = input.owner_user_id || actor.actor_user_id;
    if (!ownerUserId) throw new ValidationError('owner_user_id is required for import referral bundle creation.');
    const campaignName = input.campaign_name || `${intent.route_origin || 'Import'} to ${intent.route_destination} ${intent.flow_type.replace(/_/g, ' ')} campaign`;
    const slugSeed = `${campaignName}-${intent.participant_type}-${ownerUserId}-${timestampSeed(this.now())}-${input.route_key || intent.route_key}`;
    const campaign = await this.referralService.createCampaign({
      tenant_id: input.tenant_id || actor.actor_tenant_id,
      name: campaignName,
      slug: input.slug || slugify(slugSeed),
      campaign_type: campaignTypeForFlow(intent.flow_type),
      priority_scope: 'IMPORT',
      status: input.status || REFERRAL_CAMPAIGN_STATUSES.ACTIVE,
      route_origin: intent.route_origin,
      route_destination: intent.route_destination,
      category: intent.flow_type,
      channel_strategy: { primary: input.channel || REFERRAL_CHANNELS.WEB, import_campaign: true, route_key: intent.route_key },
      metadata: { ...intent, import_campaign: true, route_key: intent.route_key, ...cleanObject(input.metadata) },
    }, actor);
    const code = await this.referralService.createReferralCode({
      tenant_id: input.tenant_id || actor.actor_tenant_id,
      campaign_id: campaign.id,
      owner_user_id: ownerUserId,
      code: input.code,
      prefix: input.prefix || `IMPORT-${intent.flow_type}`,
      code_type: input.code_type || REFERRAL_CODE_TYPES.MEMBER,
      channel: input.channel || REFERRAL_CHANNELS.WEB,
      location_scope: input.location_scope || [intent.route_origin, intent.route_destination].filter(Boolean),
      role_scope: input.role_scope || [intent.participant_type],
      metadata: { ...intent, import_campaign: true, route_key: intent.route_key, ...cleanObject(input.metadata) },
    }, actor);
    let coupon = null;
    if (input.create_coupon) {
      coupon = await this.referralService.createCoupon({
        tenant_id: input.tenant_id || actor.actor_tenant_id,
        campaign_id: campaign.id,
        code: input.coupon_code,
        benefit_type: input.coupon_benefit_type || 'import_discount',
        discount_type: input.discount_type || COUPON_DISCOUNT_TYPES.FIXED,
        discount_value: input.discount_value ?? 5,
        max_discount_amount: input.max_discount_amount ?? null,
        minimum_order_amount: input.minimum_order_amount ?? null,
        currency: input.currency || 'USD',
        max_redemptions: input.max_redemptions ?? null,
        metadata: { ...intent, import_campaign: true, route_key: intent.route_key },
      }, actor);
    }
    const shareAsset = await this.referralService.createShareAssets({ code: code.code, channel: input.channel || REFERRAL_CHANNELS.WEB }, actor);
    const event = await this.referralService.recordReferralEvent({
      event_type: IMPORT_CAMPAIGN_EVENT_TYPES.REFERRAL_BUNDLE_CREATED,
      code_id: code.id,
      campaign_id: campaign.id,
      coupon_id: coupon?.id || null,
      subject_type: 'import_referral_bundle',
      subject_id: ownerUserId,
      channel: channelToReferralChannel(input.channel || actor.surface || REFERRAL_CHANNELS.WEB),
      metadata: { ...intent, owner_user_id: ownerUserId, coupon_created: Boolean(coupon) },
    }, actor);
    return { success: true, campaign, code, coupon, shareAsset, route_key: intent.route_key, event_id: event.id };
  }

  async createLead(input = {}, actor = {}) {
    const intent = this.classifyImportIntent(input, actor);
    let routeStatus = null;
    try { routeStatus = await this.getRouteStatus(intent.route_key); } catch { routeStatus = null; }
    const effectiveCapacityStatus = routeStatus?.capacity?.capacity_status || intent.capacity_status;
    if ([IMPORT_CAPACITY_STATUSES.FULL, IMPORT_CAPACITY_STATUSES.CLOSED].includes(effectiveCapacityStatus) && input.allow_waitlist !== true) {
      throw new ValidationError('Import route is not accepting new active leads. Use waitlist mode or choose another route.', { route_key: intent.route_key, capacity_status: effectiveCapacityStatus });
    }

    const referralCode = normalizeReferralCode(input.referral_code || input.code || '');
    let validation = null;
    if (referralCode) {
      validation = await this.referralService.validateReferralCode({
        code: referralCode,
        channel: channelToReferralChannel(input.channel || actor.surface || REFERRAL_CHANNELS.WEB),
        source: 'import_campaign',
        session_id: input.session_id || actor.session_id || null,
        subject_type: 'import_campaign_lead',
        subject_id: input.lead_reference || input.session_id || actor.session_id || null,
        metadata: { ...intent, capacity_status: effectiveCapacityStatus },
      }, { ...actor, actor_type: actor.actor_type || ACTOR_TYPES.USER });
    }
    let coupon = null;
    if (input.coupon_code) coupon = await this.referralService.applyCoupon({ code: input.coupon_code, order_amount: input.estimated_order_amount || input.order_amount || 0 }, actor);
    const event = await this.referralService.recordReferralEvent({
      event_type: IMPORT_CAMPAIGN_EVENT_TYPES.IMPORT_LEAD_CREATED,
      code_id: validation?.valid ? validation.code.id : null,
      campaign_id: validation?.valid ? validation.code.campaign_id : null,
      subject_type: 'import_campaign_lead',
      subject_id: input.lead_reference || input.session_id || actor.session_id || null,
      channel: channelToReferralChannel(input.channel || actor.surface || REFERRAL_CHANNELS.WEB),
      session_id: input.session_id || actor.session_id || null,
      metadata: {
        ...intent,
        capacity_status: effectiveCapacityStatus,
        lead_reference: input.lead_reference || null,
        vehicle: cleanObject(input.vehicle),
        part_request: cleanObject(input.part_request),
        container_space: cleanObject(input.container_space),
        requested_capacity_units: positiveNumber(input.requested_capacity_units ?? input.requested_cbm ?? input.requested_slots, 'requested_capacity_units', 0),
        estimated_order_amount: positiveNumber(input.estimated_order_amount || input.order_amount, 'estimated_order_amount', 0),
        contact: cleanObject(input.contact),
        consent: cleanObject(input.consent),
        attribution: validation?.valid ? validation.attribution : null,
        referral_code: validation?.valid ? validation.code.code : referralCode,
        coupon: coupon ? { applied: coupon.applied, discount_amount: coupon.discount_amount || 0, reason: coupon.reason || null } : null,
        waitlisted: [IMPORT_CAPACITY_STATUSES.FULL, IMPORT_CAPACITY_STATUSES.CLOSED].includes(effectiveCapacityStatus),
        next_steps: buildImportNextSteps(intent.flow_type, effectiveCapacityStatus),
      },
    }, actor);
    return { success: true, lead: { id: event.id, flow_type: intent.flow_type, route_key: intent.route_key, capacity_status: effectiveCapacityStatus, waitlisted: event.metadata.waitlisted }, attribution: validation?.valid ? validation.attribution : null, validation, coupon, next_steps: event.metadata.next_steps, event_id: event.id };
  }

  async getAttributionOwner(leadEvent, input = {}) {
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
    const existing = await this.referralService.repository.list(REFERRAL_TABLES.events, { event_type: IMPORT_CAMPAIGN_EVENT_TYPES.REWARD_ELIGIBILITY_CREATED, subject_type: 'import_campaign_lead', subject_id: leadEventId });
    const duplicate = existing.find((event) => cleanObject(event.metadata).milestone === milestone);
    if (duplicate) throw new ValidationError('Import reward eligibility already exists for this lead milestone.', { lead_event_id: leadEventId, milestone, existing_event_id: duplicate.id });
  }

  async qualifyMilestone(input = {}, actor = {}) {
    if (!actorIsOperator(actor)) throw new ForbiddenError('Qualifying import campaign milestones requires operator context.');
    if (!input.lead_event_id) throw new ValidationError('lead_event_id is required.');
    const milestone = String(input.milestone || '').trim().toLowerCase();
    if (!milestone) throw new ValidationError('milestone is required.');
    const leadEvent = await this.referralService.repository.findOne(REFERRAL_TABLES.events, { id: input.lead_event_id });
    if (!leadEvent || leadEvent.event_type !== IMPORT_CAMPAIGN_EVENT_TYPES.IMPORT_LEAD_CREATED) throw new NotFoundError('Import campaign lead event not found.', { lead_event_id: input.lead_event_id });
    const metadata = cleanObject(leadEvent.metadata);
    const flowType = normalizeEnum(input.flow_type || metadata.flow_type || IMPORT_FLOW_TYPES.CONTAINER_SPACE, enumValues(IMPORT_FLOW_TYPES), IMPORT_FLOW_TYPES.CONTAINER_SPACE, 'flow_type');
    const attributionOwner = await this.getAttributionOwner(leadEvent, input);
    const rewardable = REWARDABLE_IMPORT_MILESTONES.has(milestone) && attributionOwner;
    if (rewardable) {
      const referredUserId = input.referred_user_id || metadata.contact?.user_id || null;
      if (referredUserId && referredUserId === attributionOwner) throw new ForbiddenError('Self-referrals cannot create import campaign reward eligibility.');
      await this.assertNoDuplicateRewardEligibility(input.lead_event_id, milestone);
    }
    const qualifiedEvent = await this.referralService.recordReferralEvent({
      event_type: IMPORT_CAMPAIGN_EVENT_TYPES.MILESTONE_QUALIFIED,
      code_id: leadEvent.code_id || null,
      campaign_id: leadEvent.campaign_id || null,
      subject_type: 'import_campaign_lead',
      subject_id: input.lead_event_id,
      channel: leadEvent.channel || REFERRAL_CHANNELS.WEB,
      session_id: leadEvent.session_id || null,
      metadata: { milestone, flow_type: flowType, route_key: metadata.route_key || null, result_reference: input.result_reference || null, order_amount: input.order_amount || null, lead_event_id: input.lead_event_id },
    }, actor);
    let reward = null;
    if (rewardable) {
      const rule = DEFAULT_IMPORT_REWARD_RULES[flowType] || DEFAULT_IMPORT_REWARD_RULES.container_space;
      const amount = positiveReward(input.reward_amount, rule.amount);
      reward = await this.referralService.createWalletTransaction({
        user_id: attributionOwner,
        campaign_id: leadEvent.campaign_id || null,
        code_id: leadEvent.code_id || null,
        source_event_id: qualifiedEvent.id,
        source_event_type: `import_campaign.${milestone}`,
        transaction_type: 'import_campaign_referral_credit',
        status: WALLET_TRANSACTION_STATUSES.PENDING,
        amount,
        currency: input.currency || rule.currency,
        reason: input.reward_reason || rule.reason,
        metadata: { flow_type: flowType, milestone, lead_event_id: input.lead_event_id, route_key: metadata.route_key || null, result_reference: input.result_reference || null },
      }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
      await this.referralService.recordReferralEvent({
        event_type: IMPORT_CAMPAIGN_EVENT_TYPES.REWARD_ELIGIBILITY_CREATED,
        code_id: leadEvent.code_id || null,
        campaign_id: leadEvent.campaign_id || null,
        wallet_transaction_id: reward.id,
        subject_type: 'import_campaign_lead',
        subject_id: input.lead_event_id,
        channel: leadEvent.channel || REFERRAL_CHANNELS.WEB,
        session_id: leadEvent.session_id || null,
        metadata: { milestone, flow_type: flowType, amount, currency: input.currency || rule.currency, status: WALLET_TRANSACTION_STATUSES.PENDING, route_key: metadata.route_key || null },
      }, actor);
    }
    return { success: true, lead_event_id: input.lead_event_id, qualified_event_id: qualifiedEvent.id, milestone, reward_created: Boolean(reward), reward };
  }

  async prepareShareKit(input = {}, actor = {}) {
    const channel = input.channel || actor.surface || REFERRAL_CHANNELS.WEB;
    const response = await this.channelGateway.prepareShareKit(channel, input, actor);
    const event = await this.referralService.recordReferralEvent({
      event_type: IMPORT_CAMPAIGN_EVENT_TYPES.SHARE_KIT_PREPARED,
      code_id: response.share_kit?.code_id || null,
      campaign_id: response.share_kit?.campaign_id || null,
      subject_type: 'import_campaign_share_kit',
      subject_id: input.route_key || input.code || null,
      channel: channelToReferralChannel(channel),
      session_id: actor.session_id || null,
      metadata: { route_key: input.route_key || null, flow_type: input.flow_type || null, channel: response.channel, message: response.copy?.message || null, link: response.copy?.link || null },
    }, actor);
    return { ...response, import_campaign: true, share_event_id: event.id, route_key: input.route_key || null, flow_type: input.flow_type || null };
  }
}

export default ReferralImportCampaignService;
