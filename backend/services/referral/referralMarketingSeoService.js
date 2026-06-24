import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { ACTOR_TYPES, REFERRAL_CHANNELS } from '../../constants/referral/referralConstants.js';
import { REFERRAL_TABLES } from './referralEngineRepository.js';
import { ReferralEngineService, normalizeReferralCode, slugify } from './referralEngineService.js';

export const MARKETING_EVENT_TYPES = Object.freeze({
  KIT_CREATED: 'ai_marketing.kit_created',
  ASSET_DRAFTED: 'ai_marketing.asset_drafted',
  STATUS_CHANGED: 'ai_marketing.status_changed',
  ANALYTICS_SUGGESTION_CREATED: 'ai_marketing.analytics_suggestion_created',
});

export const MARKETING_ASSET_TYPES = Object.freeze({
  CORRIDOR_LANDING_PAGE: 'corridor_landing_page',
  LOCAL_CITY_PAGE: 'local_city_page',
  VEHICLE_IMPORT_PAGE: 'vehicle_import_page',
  PARTS_REQUEST_PAGE: 'parts_request_page',
  CONTAINER_CAMPAIGN_PAGE: 'container_campaign_page',
  AMBASSADOR_SHARE_KIT: 'ambassador_share_kit',
  PROOF_STORY: 'proof_story',
  FAQ_PAGE: 'faq_page',
  WHATSAPP_MESSAGE: 'whatsapp_message',
  TELEGRAM_POST: 'telegram_post',
  FACEBOOK_CAPTION: 'facebook_caption',
  INSTAGRAM_CAPTION: 'instagram_caption',
});

export const MARKETING_ASSET_STATUSES = Object.freeze({
  DRAFT: 'draft',
  REVIEW: 'review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
});

const OPERATOR_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'dealer', 'seller', 'agent', 'manager', 'operator', 'route_agent', 'marketing_manager']);
const ADMIN_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'marketing_manager']);
const PAGE_TYPES = new Set([
  MARKETING_ASSET_TYPES.CORRIDOR_LANDING_PAGE,
  MARKETING_ASSET_TYPES.LOCAL_CITY_PAGE,
  MARKETING_ASSET_TYPES.VEHICLE_IMPORT_PAGE,
  MARKETING_ASSET_TYPES.PARTS_REQUEST_PAGE,
  MARKETING_ASSET_TYPES.CONTAINER_CAMPAIGN_PAGE,
  MARKETING_ASSET_TYPES.FAQ_PAGE,
]);
const CHANNEL_TYPES = new Set([
  MARKETING_ASSET_TYPES.WHATSAPP_MESSAGE,
  MARKETING_ASSET_TYPES.TELEGRAM_POST,
  MARKETING_ASSET_TYPES.FACEBOOK_CAPTION,
  MARKETING_ASSET_TYPES.INSTAGRAM_CAPTION,
]);
const DEFAULT_OBJECTS = Object.freeze([
  MARKETING_ASSET_TYPES.CORRIDOR_LANDING_PAGE,
  MARKETING_ASSET_TYPES.CONTAINER_CAMPAIGN_PAGE,
  MARKETING_ASSET_TYPES.AMBASSADOR_SHARE_KIT,
  MARKETING_ASSET_TYPES.PROOF_STORY,
  MARKETING_ASSET_TYPES.FAQ_PAGE,
  MARKETING_ASSET_TYPES.WHATSAPP_MESSAGE,
  MARKETING_ASSET_TYPES.TELEGRAM_POST,
  MARKETING_ASSET_TYPES.FACEBOOK_CAPTION,
  MARKETING_ASSET_TYPES.INSTAGRAM_CAPTION,
]);
const DISCLOSURE = 'Disclosure: a CarUp promoter or referrer may receive a benefit if this referral leads to a verified purchase, booking, or approved transaction.';

function enumValues(value) { return Object.values(value); }
function cleanObject(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)); }
function actorRole(actor = {}) { return String(actor.actor_role || actor.role || '').trim().toLowerCase(); }
function actorIsOperator(actor = {}) { return OPERATOR_ROLES.has(actorRole(actor)); }
function actorIsAdmin(actor = {}) { return ADMIN_ROLES.has(actorRole(actor)); }
function normalizeAssetType(value) { const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); if (!enumValues(MARKETING_ASSET_TYPES).includes(normalized)) throw new ValidationError('asset_type is invalid.', { value, allowed: enumValues(MARKETING_ASSET_TYPES) }); return normalized; }
function normalizeStatus(value) { const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); if (!enumValues(MARKETING_ASSET_STATUSES).includes(normalized)) throw new ValidationError('status is invalid.', { value, allowed: enumValues(MARKETING_ASSET_STATUSES) }); return normalized; }
function trimTo(value, limit) { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trim()}…` : text; }
function safeArray(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function channelForAssetType(assetType) { if (assetType.includes('whatsapp')) return 'whatsapp'; if (assetType.includes('telegram')) return 'telegram'; if (assetType.includes('facebook')) return 'facebook'; if (assetType.includes('instagram')) return 'instagram'; return REFERRAL_CHANNELS.WEB; }

function actorCanPublish(actor = {}) {
  return actorIsAdmin(actor) || actor.gateway_trusted === true;
}

function baseUrl(input = {}) {
  return String(input.base_url || process.env.CARUP_PUBLIC_URL || 'https://carup.app').replace(/\/+$/, '');
}

function makeUtm(input = {}, assetType, context = {}) {
  const source = input.utm_source || channelForAssetType(assetType) || 'carup';
  const medium = input.utm_medium || (CHANNEL_TYPES.has(assetType) ? 'social' : 'seo');
  const campaign = input.utm_campaign || context.slug || context.route_key || context.campaign_id || 'referral-campaign';
  const content = input.utm_content || assetType;
  return { utm_source: source, utm_medium: medium, utm_campaign: slugify(campaign), utm_content: slugify(content) };
}

function appendQuery(url, params = {}) {
  const query = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''))).toString();
  return query ? `${url}${url.includes('?') ? '&' : '?'}${query}` : url;
}

function inferCampaignName(context = {}, input = {}) {
  return input.campaign_name || context.name || context.metadata?.campaign_name || context.route_key || 'CarUp referral campaign';
}

function inferRoute(context = {}, input = {}) {
  return {
    route_origin: input.route_origin || context.route_origin || context.metadata?.route_origin || context.metadata?.origin || 'Japan',
    route_destination: input.route_destination || context.route_destination || context.metadata?.route_destination || context.metadata?.destination || 'Zimbabwe',
    route_key: input.route_key || context.metadata?.route_key || context.route_key || slugify([input.route_origin || context.route_origin || 'Japan', input.route_destination || context.route_destination || 'Zimbabwe', input.flow_type || context.category || context.campaign_type || 'referral'].join('-')),
  };
}

function inferKeywords(assetType, context = {}, input = {}) {
  const route = inferRoute(context, input);
  return unique([
    'CarUp',
    'referral',
    route.route_origin,
    route.route_destination,
    input.city,
    context.category,
    context.campaign_type,
    assetType.replace(/_/g, ' '),
    'vehicle import',
    'parts import',
    'container space',
  ].map((value) => String(value || '').trim()).filter((value) => value.length > 1));
}

function cleanSlugParts(parts) {
  return parts.map((part) => slugify(part)).filter(Boolean).join('/');
}

function assetPath(assetType, context = {}, input = {}) {
  const route = inferRoute(context, input);
  const city = input.city || context.metadata?.city || null;
  if (assetType === MARKETING_ASSET_TYPES.LOCAL_CITY_PAGE) return `/referrals/local/${cleanSlugParts([city || route.route_destination, context.category || 'marketplace'])}`;
  if (assetType === MARKETING_ASSET_TYPES.VEHICLE_IMPORT_PAGE) return `/referrals/import/vehicles/${cleanSlugParts([route.route_origin, route.route_destination])}`;
  if (assetType === MARKETING_ASSET_TYPES.PARTS_REQUEST_PAGE) return `/referrals/import/parts/${cleanSlugParts([route.route_origin, route.route_destination])}`;
  if (assetType === MARKETING_ASSET_TYPES.CONTAINER_CAMPAIGN_PAGE) return `/referrals/import/container-space/${cleanSlugParts([route.route_origin, route.route_destination, route.route_key])}`;
  if (assetType === MARKETING_ASSET_TYPES.FAQ_PAGE) return `/referrals/faq/${cleanSlugParts([route.route_key || context.slug || 'campaign'])}`;
  if (assetType === MARKETING_ASSET_TYPES.PROOF_STORY) return `/referrals/proof/${cleanSlugParts([route.route_key || context.slug || 'campaign'])}`;
  return `/referrals/campaigns/${cleanSlugParts([context.slug || route.route_key || context.id || 'campaign'])}`;
}

function buildSeoPayload(assetType, context = {}, input = {}) {
  const name = inferCampaignName(context, input);
  const route = inferRoute(context, input);
  const url = `${baseUrl(input)}${assetPath(assetType, context, input)}`;
  const utm = makeUtm(input, assetType, { ...context, ...route });
  const trackedUrl = appendQuery(url, utm);
  const keywords = inferKeywords(assetType, context, input);
  const title = trimTo(input.title || `${name}: ${route.route_origin} to ${route.route_destination}`, 60);
  const description = trimTo(input.description || `Use CarUp to discover verified referral offers, import support, parts requests, and container-space updates for ${route.route_origin} to ${route.route_destination}.`, 158);
  return {
    title,
    slug: slugify(assetPath(assetType, context, input)),
    clean_url: url,
    canonical_url: url,
    tracked_url: trackedUrl,
    meta_title: title,
    meta_description: description,
    keywords,
    canonical_tag: `<link rel="canonical" href="${url}" />`,
    structured_metadata: {
      '@context': 'https://schema.org',
      '@type': PAGE_TYPES.has(assetType) ? 'WebPage' : 'CreativeWork',
      name: title,
      description,
      url,
      inLanguage: input.language || 'en',
    },
    internal_links: unique([
      '/referrals',
      '/referrals/import',
      '/referrals/local',
      route.route_key ? `/referrals/routes/${route.route_key}` : null,
      context.id ? `/referrals/campaigns/${context.id}` : null,
    ]),
    utm,
    attribution: {
      campaign_id: context.id || input.campaign_id || null,
      code_id: input.code_id || context.code_id || null,
      referral_code: input.referral_code || context.referral_code || null,
      route_key: route.route_key,
    },
  };
}

function buildBody(assetType, context = {}, input = {}) {
  const name = inferCampaignName(context, input);
  const route = inferRoute(context, input);
  const keywords = inferKeywords(assetType, context, input).slice(0, 8);
  if (assetType === MARKETING_ASSET_TYPES.FAQ_PAGE) {
    return {
      questions: [
        { question: `How does ${name} work?`, answer: 'CarUp records referral attribution, explains the next step, and keeps the campaign event trail available for review.' },
        { question: 'Can a referral reward be paid immediately?', answer: 'No. Benefits remain pending until a verified commercial milestone is reached and reviewed.' },
        { question: 'How is attribution preserved?', answer: 'Links, QR codes, channel messages, and UTM parameters carry the campaign, route, channel, and referral-code context.' },
        { question: 'Who reviews sensitive actions?', answer: 'Operators review publication, wallet, and restricted campaign actions before they become final.' },
      ],
      disclosure: DISCLOSURE,
    };
  }
  if (assetType === MARKETING_ASSET_TYPES.PROOF_STORY) {
    return {
      headline: `${route.route_origin} to ${route.route_destination}: proof story draft`,
      summary: 'Draft a verified delivery or booking story only after a real operator-confirmed milestone exists.',
      sections: ['Customer need', 'Referral source', 'Verification step', 'Delivery or booking outcome', 'What CarUp checked'],
      evidence_required: ['operator confirmation', 'transaction reference', 'delivery or booking proof', 'permission to publish'],
      disclosure: DISCLOSURE,
    };
  }
  if (assetType === MARKETING_ASSET_TYPES.AMBASSADOR_SHARE_KIT) {
    return {
      headline: `Share ${name} safely`,
      elevator_pitch: `Help someone discover CarUp support for ${route.route_origin} to ${route.route_destination}.`,
      do: ['Share only approved links', 'Use the tracked campaign URL', 'Disclose possible promoter benefit'],
      do_not: ['Promise guaranteed discounts', 'Approve payments manually', 'Hide referral benefit disclosure'],
      disclosure: DISCLOSURE,
    };
  }
  if (CHANNEL_TYPES.has(assetType)) {
    const callToAction = input.call_to_action || 'Open the CarUp referral link and request support.';
    return {
      message: `${name}: CarUp can help with ${route.route_origin} to ${route.route_destination} referrals, import support, parts requests, and container-space updates. ${callToAction}\n\n${DISCLOSURE}`,
      short_message: `${name}: request verified CarUp support for ${route.route_origin} to ${route.route_destination}. ${DISCLOSURE}`,
      hashtags: ['#CarUp', '#Zimbabwe', '#VehicleImport', '#ContainerSpace'].filter(Boolean),
      disclosure: DISCLOSURE,
    };
  }
  return {
    hero: `${name}`,
    intro: `CarUp helps users enter verified referral, import, parts, and local marketplace workflows for ${route.route_origin} to ${route.route_destination}.`,
    sections: [
      { heading: 'What this campaign does', body: `This page explains ${name}, preserves campaign attribution, and guides users to the right CarUp workflow.` },
      { heading: 'How attribution is tracked', body: 'Referral codes, social links, QR scans, and UTM parameters are stored before lead, quote, booking, or wallet events.' },
      { heading: 'What happens next', body: 'Users can request support, join a route, ask for parts, book container space, or wait for operator review.' },
    ],
    keywords,
    disclosure: DISCLOSURE,
  };
}

function buildAssetPayload(assetType, context = {}, input = {}) {
  const seo = buildSeoPayload(assetType, context, input);
  return {
    asset_type: assetType,
    status: MARKETING_ASSET_STATUSES.DRAFT,
    language: input.language || 'en',
    locale_variants: safeArray(input.locale_variants),
    seo,
    body: buildBody(assetType, context, input),
    disclosure: DISCLOSURE,
    review: {
      requires_human_review: true,
      publish_mode: 'review_required',
      allowed_next_statuses: [MARKETING_ASSET_STATUSES.REVIEW, MARKETING_ASSET_STATUSES.APPROVED, MARKETING_ASSET_STATUSES.REJECTED],
    },
    analytics: {
      tracked_url: seo.tracked_url,
      utm: seo.utm,
      suggested_metrics: ['views', 'clicks', 'lead_starts', 'coupon_applications', 'verified_milestones'],
    },
  };
}

function transitionAllowed(current, next, actor = {}) {
  if (current === next) return true;
  const graph = {
    draft: ['review', 'approved', 'rejected', 'archived'],
    review: ['approved', 'rejected', 'draft', 'archived'],
    approved: ['scheduled', 'published', 'rejected', 'archived'],
    scheduled: ['published', 'approved', 'archived'],
    published: ['archived'],
    rejected: ['draft', 'archived'],
    archived: [],
  };
  if (!graph[current]?.includes(next)) return false;
  if ([MARKETING_ASSET_STATUSES.APPROVED, MARKETING_ASSET_STATUSES.SCHEDULED, MARKETING_ASSET_STATUSES.PUBLISHED].includes(next)) return actorCanPublish(actor);
  return true;
}

export class ReferralMarketingSeoService {
  constructor({ referralService, client, now = () => new Date() } = {}) {
    this.referralService = referralService || new ReferralEngineService({ client, now });
    this.now = now;
  }

  getRuleCatalog() {
    return {
      asset_types: enumValues(MARKETING_ASSET_TYPES),
      statuses: enumValues(MARKETING_ASSET_STATUSES),
      default_objects: DEFAULT_OBJECTS,
      required_seo: ['clean_url', 'canonical_url', 'canonical_tag', 'structured_metadata', 'internal_links', 'utm'],
      required_disclosure: DISCLOSURE,
      workflow: ['draft', 'review', 'approved', 'scheduled', 'published'],
      safety: {
        publication: 'stored_before_publication',
        approval: 'operator_or_admin_required',
        attribution: 'campaign_code_route_and_utm_required',
        benefit_disclosure: 'always_included',
      },
    };
  }

  async resolveCampaignContext(input = {}) {
    if (input.campaign_id) {
      const campaign = await this.referralService.repository.findOne(REFERRAL_TABLES.campaigns, { id: input.campaign_id });
      if (!campaign) throw new NotFoundError('Referral campaign not found.', { campaign_id: input.campaign_id });
      return campaign;
    }
    const codeValue = normalizeReferralCode(input.referral_code || input.code || '');
    if (codeValue) {
      const code = await this.referralService.repository.findOne(REFERRAL_TABLES.codes, { code: codeValue });
      if (!code) throw new NotFoundError('Referral code not found.', { code: codeValue });
      const campaign = code.campaign_id ? await this.referralService.repository.findOne(REFERRAL_TABLES.campaigns, { id: code.campaign_id }) : null;
      return { ...(campaign || {}), id: code.campaign_id || null, code_id: code.id, referral_code: code.code, owner_user_id: code.owner_user_id, metadata: { ...cleanObject(campaign?.metadata), ...cleanObject(code.metadata) } };
    }
    return {
      id: null,
      name: input.campaign_name || input.route_key || 'CarUp referral campaign',
      slug: slugify(input.slug || input.campaign_name || input.route_key || 'carup-referral-campaign'),
      campaign_type: input.campaign_type || null,
      category: input.flow_type || input.category || null,
      route_origin: input.route_origin || input.origin || null,
      route_destination: input.route_destination || input.destination || 'Zimbabwe',
      metadata: cleanObject(input.metadata),
    };
  }

  async draftAsset(input = {}, actor = {}) {
    if (!actorIsOperator(actor)) throw new ForbiddenError('Drafting referral marketing assets requires operator context.');
    const assetType = normalizeAssetType(input.asset_type);
    const context = await this.resolveCampaignContext(input);
    const payload = buildAssetPayload(assetType, context, input);
    const event = await this.referralService.recordReferralEvent({
      event_type: MARKETING_EVENT_TYPES.ASSET_DRAFTED,
      campaign_id: context.id || input.campaign_id || null,
      code_id: input.code_id || context.code_id || null,
      subject_type: 'ai_marketing_asset',
      subject_id: input.subject_id || `${assetType}:${payload.seo.slug}`,
      channel: channelForAssetType(assetType),
      session_id: input.session_id || actor.session_id || null,
      metadata: {
        ...payload,
        kit_id: input.kit_id || null,
        source: input.source || 'phase6_ai_marketing',
        campaign_context: {
          campaign_id: context.id || null,
          campaign_name: inferCampaignName(context, input),
          campaign_type: context.campaign_type || null,
          route: inferRoute(context, input),
        },
        created_by_ai_role: 'Campaign',
        created_by_actor: actor.actor_user_id || null,
        created_at: this.now().toISOString(),
      },
    }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
    return { id: event.id, ...payload, event };
  }

  async createCampaignKit(input = {}, actor = {}) {
    if (!actorIsOperator(actor)) throw new ForbiddenError('Creating AI marketing campaign kits requires operator context.');
    const context = await this.resolveCampaignContext(input);
    const objects = unique(safeArray(input.objects).length ? safeArray(input.objects) : DEFAULT_OBJECTS).map(normalizeAssetType);
    const kitEvent = await this.referralService.recordReferralEvent({
      event_type: MARKETING_EVENT_TYPES.KIT_CREATED,
      campaign_id: context.id || input.campaign_id || null,
      code_id: input.code_id || context.code_id || null,
      subject_type: 'ai_marketing_campaign_kit',
      subject_id: input.kit_reference || context.id || context.slug || input.route_key || `kit-${this.now().getTime()}`,
      channel: REFERRAL_CHANNELS.WEB,
      session_id: input.session_id || actor.session_id || null,
      metadata: {
        campaign_name: inferCampaignName(context, input),
        objects,
        route: inferRoute(context, input),
        disclosure: DISCLOSURE,
        required_review: true,
        created_by_ai_role: 'Campaign',
        created_at: this.now().toISOString(),
      },
    }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
    const assets = [];
    for (const assetType of objects) {
      assets.push(await this.draftAsset({ ...input, asset_type: assetType, kit_id: kitEvent.id }, actor));
    }
    return { success: true, kit: { id: kitEvent.id, ...kitEvent.metadata }, assets };
  }

  async draftSeoPage(input = {}, actor = {}) {
    const preferred = input.asset_type || MARKETING_ASSET_TYPES.CORRIDOR_LANDING_PAGE;
    const assetType = normalizeAssetType(preferred);
    if (!PAGE_TYPES.has(assetType)) throw new ValidationError('asset_type must be an SEO page type.', { asset_type: assetType });
    return { success: true, asset: await this.draftAsset({ ...input, asset_type: assetType }, actor) };
  }

  async draftChannelMessages(input = {}, actor = {}) {
    const types = unique(safeArray(input.channels).length ? safeArray(input.channels).map((channel) => `${String(channel).toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${channel === 'telegram' ? 'post' : channel === 'whatsapp' ? 'message' : 'caption'}`) : [MARKETING_ASSET_TYPES.WHATSAPP_MESSAGE, MARKETING_ASSET_TYPES.TELEGRAM_POST, MARKETING_ASSET_TYPES.FACEBOOK_CAPTION, MARKETING_ASSET_TYPES.INSTAGRAM_CAPTION]).map(normalizeAssetType);
    const assets = [];
    for (const assetType of types) {
      if (!CHANNEL_TYPES.has(assetType)) throw new ValidationError('channels can only create social/message assets.', { asset_type: assetType });
      assets.push(await this.draftAsset({ ...input, asset_type: assetType }, actor));
    }
    return { success: true, assets };
  }

  async draftProofStory(input = {}, actor = {}) {
    return { success: true, asset: await this.draftAsset({ ...input, asset_type: MARKETING_ASSET_TYPES.PROOF_STORY }, actor) };
  }

  async draftFaq(input = {}, actor = {}) {
    return { success: true, asset: await this.draftAsset({ ...input, asset_type: MARKETING_ASSET_TYPES.FAQ_PAGE }, actor) };
  }

  async getAsset(assetId) {
    const event = await this.referralService.repository.findOne(REFERRAL_TABLES.events, { id: assetId });
    if (!event || event.event_type !== MARKETING_EVENT_TYPES.ASSET_DRAFTED) throw new NotFoundError('Marketing asset not found.', { asset_id: assetId });
    return event;
  }

  async listAssets(filters = {}) {
    const baseFilters = { campaign_id: filters.campaign_id || undefined, code_id: filters.code_id || undefined };
    const events = await this.referralService.repository.list(REFERRAL_TABLES.events, baseFilters, { orderBy: 'created_at', ascending: false, limit: Number(filters.limit || 200) });
    return events.filter((event) => event.event_type === MARKETING_EVENT_TYPES.ASSET_DRAFTED)
      .filter((event) => !filters.status || cleanObject(event.metadata).status === filters.status)
      .filter((event) => !filters.asset_type || cleanObject(event.metadata).asset_type === filters.asset_type);
  }

  async transitionAssetStatus(assetId, input = {}, actor = {}) {
    if (!actorIsOperator(actor)) throw new ForbiddenError('Changing marketing asset status requires operator context.');
    const nextStatus = normalizeStatus(input.status);
    const assetEvent = await this.getAsset(assetId);
    const metadata = cleanObject(assetEvent.metadata);
    const currentStatus = normalizeStatus(metadata.status || MARKETING_ASSET_STATUSES.DRAFT);
    if (!transitionAllowed(currentStatus, nextStatus, actor)) throw new ForbiddenError('Marketing asset status transition is not allowed.', { current_status: currentStatus, next_status: nextStatus });
    if (nextStatus === MARKETING_ASSET_STATUSES.SCHEDULED && !input.scheduled_at) throw new ValidationError('scheduled_at is required when scheduling marketing assets.');
    if (nextStatus === MARKETING_ASSET_STATUSES.REJECTED && !String(input.reason || '').trim()) throw new ValidationError('reason is required when rejecting a marketing asset.');
    if (nextStatus === MARKETING_ASSET_STATUSES.PUBLISHED && !metadata.seo?.tracked_url && !input.public_url) throw new ValidationError('Published assets must preserve attribution through a tracked URL.');
    const updatedMetadata = {
      ...metadata,
      ...cleanObject(input.patch),
      status: nextStatus,
      status_reason: input.reason || null,
      scheduled_at: input.scheduled_at || metadata.scheduled_at || null,
      public_url: input.public_url || metadata.public_url || metadata.seo?.tracked_url || null,
      reviewed_by: actor.actor_user_id || null,
      reviewed_at: this.now().toISOString(),
    };
    const updated = await this.referralService.repository.updateById(REFERRAL_TABLES.events, assetId, { metadata: updatedMetadata });
    const statusEvent = await this.referralService.recordReferralEvent({
      event_type: MARKETING_EVENT_TYPES.STATUS_CHANGED,
      campaign_id: assetEvent.campaign_id || null,
      code_id: assetEvent.code_id || null,
      subject_type: 'ai_marketing_asset',
      subject_id: assetId,
      channel: assetEvent.channel || REFERRAL_CHANNELS.WEB,
      session_id: input.session_id || actor.session_id || null,
      metadata: {
        asset_id: assetId,
        asset_type: updatedMetadata.asset_type,
        from_status: currentStatus,
        to_status: nextStatus,
        reason: input.reason || null,
        public_url: updatedMetadata.public_url,
        scheduled_at: updatedMetadata.scheduled_at,
        attribution: updatedMetadata.seo?.attribution || null,
      },
    }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
    return { success: true, asset: updated, status_event: statusEvent };
  }

  async createAnalyticsSuggestion(input = {}, actor = {}) {
    if (!actorIsOperator(actor)) throw new ForbiddenError('Creating marketing analytics suggestions requires operator context.');
    const metrics = cleanObject(input.metrics);
    const suggestions = [];
    if (Number(metrics.views || 0) > 0 && Number(metrics.clicks || 0) / Number(metrics.views || 1) < 0.02) suggestions.push('Refresh channel headline and call-to-action because click-through is low.');
    if (Number(metrics.clicks || 0) > 0 && Number(metrics.lead_starts || 0) / Number(metrics.clicks || 1) < 0.1) suggestions.push('Improve landing page proof, FAQ clarity, and trust explanation because lead-start conversion is low.');
    if (Number(metrics.verified_milestones || 0) === 0 && Number(metrics.lead_starts || 0) > 0) suggestions.push('Ask operator to review lead quality and route/capacity friction before increasing promotion.');
    if (!suggestions.length) suggestions.push('Keep campaign active and monitor attribution, channel performance, and verified milestone quality.');
    const event = await this.referralService.recordReferralEvent({
      event_type: MARKETING_EVENT_TYPES.ANALYTICS_SUGGESTION_CREATED,
      campaign_id: input.campaign_id || null,
      code_id: input.code_id || null,
      subject_type: 'ai_marketing_analytics',
      subject_id: input.asset_id || input.campaign_id || `analytics-${this.now().getTime()}`,
      channel: input.channel || REFERRAL_CHANNELS.WEB,
      session_id: input.session_id || actor.session_id || null,
      metadata: {
        metrics,
        suggestions,
        next_actions: ['review_assets', 'check_attribution', 'compare_channel_copy', 'inspect_verified_milestones'],
        created_by_ai_role: 'Analytics',
        created_at: this.now().toISOString(),
      },
    }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
    return { success: true, suggestion: { id: event.id, ...event.metadata }, event };
  }
}

export default ReferralMarketingSeoService;
