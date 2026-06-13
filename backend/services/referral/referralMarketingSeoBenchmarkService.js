import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { REFERRAL_TABLES } from './referralEngineRepository.js';
import { normalizeReferralCode } from './referralEngineService.js';
import {
  MARKETING_ASSET_STATUSES,
  MARKETING_ASSET_TYPES,
  ReferralMarketingSeoService,
} from './referralMarketingSeoService.js';

const PUBLISHER_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'marketing_manager']);
const CHANNEL_ASSET_MAP = Object.freeze({
  whatsapp: MARKETING_ASSET_TYPES.WHATSAPP_MESSAGE,
  telegram: MARKETING_ASSET_TYPES.TELEGRAM_POST,
  facebook: MARKETING_ASSET_TYPES.FACEBOOK_CAPTION,
  instagram: MARKETING_ASSET_TYPES.INSTAGRAM_CAPTION,
});
const PUBLICATION_STATUSES = new Set([
  MARKETING_ASSET_STATUSES.APPROVED,
  MARKETING_ASSET_STATUSES.SCHEDULED,
  MARKETING_ASSET_STATUSES.PUBLISHED,
]);

function cleanObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function roleOf(actor = {}) {
  return String(actor.actor_role || actor.role || '').trim().toLowerCase();
}

function canPublishMarketing(actor = {}) {
  return PUBLISHER_ROLES.has(roleOf(actor));
}

function normalizeChannelName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeMetric(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new ValidationError(`${label} must be a non-negative number.`, { value });
  return number;
}

function assertValidBaseUrl(input = {}) {
  if (!input.base_url) return;
  let parsed;
  try {
    parsed = new URL(String(input.base_url));
  } catch {
    throw new ValidationError('base_url must be a valid http or https URL.', { base_url: input.base_url });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ValidationError('base_url must use http or https.', { base_url: input.base_url });
  }
}

function assertPatchSafe(patch = {}) {
  if (!patch || typeof patch !== 'object') return;
  if (patch.status) throw new ValidationError('status cannot be changed through patch; use the status field.');
  if (patch.seo) throw new ValidationError('seo cannot be replaced through patch; attribution metadata must remain immutable.');
  if (patch.disclosure === '' || patch.disclosure === null) throw new ValidationError('disclosure cannot be removed.');
}

function preserveAttribution(currentMetadata = {}, updated = {}) {
  const currentSeo = cleanObject(currentMetadata.seo);
  const updatedSeo = cleanObject(updated.seo);
  const currentAttribution = cleanObject(currentSeo.attribution);
  const updatedAttribution = cleanObject(updatedSeo.attribution);
  if (Object.keys(currentAttribution).length && JSON.stringify(currentAttribution) !== JSON.stringify(updatedAttribution)) {
    throw new ValidationError('Published assets must preserve immutable attribution metadata.');
  }
  if (currentSeo.tracked_url && !updatedSeo.tracked_url) {
    throw new ValidationError('Published assets must preserve the tracked URL.');
  }
}

export class ReferralMarketingSeoBenchmarkService extends ReferralMarketingSeoService {
  async resolveCampaignContext(input = {}) {
    const context = await super.resolveCampaignContext(input);
    const codeValue = normalizeReferralCode(input.referral_code || input.code || '');
    if (!codeValue) return context;
    const code = await this.referralService.repository.findOne(REFERRAL_TABLES.codes, { code: codeValue });
    if (!code) throw new NotFoundError('Referral code not found.', { code: codeValue });
    if (context.id && code.campaign_id && context.id !== code.campaign_id) {
      throw new ValidationError('referral_code does not belong to the requested campaign.', { campaign_id: context.id, code_campaign_id: code.campaign_id });
    }
    return {
      ...context,
      code_id: code.id,
      referral_code: code.code,
      owner_user_id: code.owner_user_id,
      metadata: { ...cleanObject(context.metadata), ...cleanObject(code.metadata) },
    };
  }

  async draftAsset(input = {}, actor = {}) {
    assertValidBaseUrl(input);
    return super.draftAsset(input, actor);
  }

  async createCampaignKit(input = {}, actor = {}) {
    assertValidBaseUrl(input);
    return super.createCampaignKit(input, actor);
  }

  async draftChannelMessages(input = {}, actor = {}) {
    const channels = Array.isArray(input.channels) && input.channels.length ? input.channels : ['whatsapp', 'telegram', 'facebook', 'instagram'];
    const assetTypes = [...new Set(channels.map((channel) => {
      const normalized = normalizeChannelName(channel);
      const assetType = CHANNEL_ASSET_MAP[normalized];
      if (!assetType) throw new ValidationError('Unsupported marketing channel.', { channel, allowed: Object.keys(CHANNEL_ASSET_MAP) });
      return assetType;
    }))];
    const assets = [];
    for (const assetType of assetTypes) {
      assets.push(await this.draftAsset({ ...input, asset_type: assetType }, actor));
    }
    return { success: true, assets };
  }

  async transitionAssetStatus(assetId, input = {}, actor = {}) {
    const requestedStatus = String(input.status || '').trim().toLowerCase();
    if (PUBLICATION_STATUSES.has(requestedStatus) && !canPublishMarketing(actor)) {
      throw new ForbiddenError('Approving, scheduling, or publishing marketing assets requires marketing publisher context.');
    }
    assertPatchSafe(input.patch);
    const before = await this.getAsset(assetId);
    const response = await super.transitionAssetStatus(assetId, input, actor);
    preserveAttribution(cleanObject(before.metadata), cleanObject(response.asset?.metadata));
    return response;
  }

  async createAnalyticsSuggestion(input = {}, actor = {}) {
    const metrics = cleanObject(input.metrics);
    for (const key of ['views', 'clicks', 'lead_starts', 'coupon_applications', 'verified_milestones']) {
      if (metrics[key] !== undefined) normalizeMetric(metrics[key], key);
    }
    return super.createAnalyticsSuggestion(input, actor);
  }
}

export default ReferralMarketingSeoBenchmarkService;
