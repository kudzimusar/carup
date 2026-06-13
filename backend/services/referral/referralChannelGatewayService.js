import { ValidationError } from '../../utils/errors.js';
import { ACTOR_TYPES, REFERRAL_CHANNELS } from '../../constants/referral/referralConstants.js';
import { ReferralAgentGatewayService, AGENT_TOOL_NAMES } from './referralAgentGatewayServiceSafe.js';
import { normalizeReferralCode } from './referralEngineService.js';

export const CHANNEL_GATEWAY_EVENT_TYPES = Object.freeze({
  INBOUND_RECEIVED: 'channel.inbound_received',
  ATTRIBUTION_ATTACHED: 'channel.attribution_attached',
  SHARE_KIT_PREPARED: 'channel.share_kit_prepared',
});

export const SUPPORTED_CHANNELS = Object.freeze({
  WHATSAPP: 'whatsapp',
  TELEGRAM: 'telegram',
  WEB_CHAT: 'web_chat',
  MOBILE_CHAT: 'mobile_chat',
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
});

const CHANNEL_ALIASES = Object.freeze({
  wa: SUPPORTED_CHANNELS.WHATSAPP,
  whatsapp: SUPPORTED_CHANNELS.WHATSAPP,
  telegram: SUPPORTED_CHANNELS.TELEGRAM,
  tg: SUPPORTED_CHANNELS.TELEGRAM,
  web: SUPPORTED_CHANNELS.WEB_CHAT,
  webchat: SUPPORTED_CHANNELS.WEB_CHAT,
  web_chat: SUPPORTED_CHANNELS.WEB_CHAT,
  mobile: SUPPORTED_CHANNELS.MOBILE_CHAT,
  mobilechat: SUPPORTED_CHANNELS.MOBILE_CHAT,
  mobile_chat: SUPPORTED_CHANNELS.MOBILE_CHAT,
  facebook: SUPPORTED_CHANNELS.FACEBOOK,
  fb: SUPPORTED_CHANNELS.FACEBOOK,
  instagram: SUPPORTED_CHANNELS.INSTAGRAM,
  ig: SUPPORTED_CHANNELS.INSTAGRAM,
});

function cleanObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export function normalizeChannel(channel) {
  const key = String(channel || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const normalized = CHANNEL_ALIASES[key];
  if (!normalized) throw new ValidationError('Unsupported referral channel.', { channel, supported: Object.values(SUPPORTED_CHANNELS) });
  return normalized;
}

function directCodeCandidate(value) {
  const direct = normalizeReferralCode(value);
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+){1,8}$/.test(direct)) return null;
  if (direct.length > 80) return null;
  return direct;
}

function extractFromNaturalText(raw) {
  if (!raw) return null;
  const value = String(raw);
  const startMatch = value.match(/(?:^|\s)\/start\s+([A-Za-z0-9][A-Za-z0-9-_]{2,80})/i);
  if (startMatch) return normalizeReferralCode(startMatch[1]);
  const pathMatch = value.match(/\/r\/([A-Za-z0-9][A-Za-z0-9-_]{2,80})/i);
  if (pathMatch) return normalizeReferralCode(pathMatch[1]);
  const labelMatch = value.match(/(?:code|coupon|referral)[:#\s-]+([A-Za-z0-9][A-Za-z0-9-_]{2,80})/i);
  if (labelMatch) return normalizeReferralCode(labelMatch[1]);
  return null;
}

export function extractReferralCode(input = {}) {
  const explicitCandidates = [input.referral_code, input.code, input.start_payload, input.deep_link].filter(Boolean).map(String);
  for (const raw of explicitCandidates) {
    const fromText = extractFromNaturalText(raw);
    if (fromText) return fromText;
    const direct = directCodeCandidate(raw);
    if (direct) return direct;
  }

  const naturalTextCandidates = [input.text, input.message, input.caption, input.query, input.url].filter(Boolean).map(String);
  for (const raw of naturalTextCandidates) {
    const fromText = extractFromNaturalText(raw);
    if (fromText) return fromText;
  }
  return null;
}

function buildActor(channel, input = {}, actor = {}) {
  return {
    ...actor,
    actor_type: ACTOR_TYPES.AGENT,
    actor_user_id: actor.actor_user_id || input.user_id || input.sender_user_id || null,
    actor_role: actor.actor_role || input.actor_role || 'agent',
    actor_tenant_id: actor.actor_tenant_id || input.tenant_id || 'platform',
    gateway_trusted: Boolean(actor.gateway_trusted),
    surface: channel,
    session_id: input.session_id || input.conversation_id || input.thread_id || actor.session_id || null,
  };
}

function channelToReferralChannel(channel) {
  if (channel === SUPPORTED_CHANNELS.WEB_CHAT) return REFERRAL_CHANNELS.WEB;
  if (channel === SUPPORTED_CHANNELS.MOBILE_CHAT) return REFERRAL_CHANNELS.MOBILE;
  return channel;
}

function buildInboundSummary(channel, input = {}, triage, validation) {
  const valid = validation?.valid === true;
  const failed = validation && validation.valid === false;
  const base = triage?.safe_response || 'CarUp received your message.';
  if (valid) return `${base} Your referral code is valid and attribution has been attached.`;
  if (failed) return `${base} I could not validate that referral code. I can hand this to CarUp support if needed.`;
  if (channel === SUPPORTED_CHANNELS.WHATSAPP || channel === SUPPORTED_CHANNELS.TELEGRAM) return `${base} Share your CarUp code or request and I will route it.`;
  return base;
}

function buildChannelCopy(channel, shareKit = {}, socialCopy = {}) {
  const code = shareKit.code || shareKit.barcode_payload || '';
  const url = shareKit.short_referral_url || shareKit.social_campaign_url || '';
  const text = socialCopy.whatsapp || socialCopy.short_post || `Use my CarUp code ${code}.`;
  if (channel === SUPPORTED_CHANNELS.WHATSAPP) return { message: `${text} ${url}`.trim(), link: shareKit.whatsapp_share_url || url };
  if (channel === SUPPORTED_CHANNELS.TELEGRAM) return { message: `${socialCopy.telegram || text} ${url}`.trim(), link: shareKit.telegram_start_url || url };
  if (channel === SUPPORTED_CHANNELS.WEB_CHAT || channel === SUPPORTED_CHANNELS.MOBILE_CHAT) return { message: `${text} ${url}`.trim(), link: url };
  return { message: `${socialCopy.short_post || text} ${url}`.trim(), link: shareKit.social_campaign_url || url };
}

export class ReferralChannelGatewayService {
  constructor({ agentGateway, referralService, now = () => new Date() } = {}) {
    this.agentGateway = agentGateway || new ReferralAgentGatewayService({ referralService, now });
    this.referralService = referralService || this.agentGateway.referralService;
    this.now = now;
  }

  async recordChannelEvent(channel, input = {}, actor = {}, validation = null) {
    return this.referralService.recordReferralEvent({
      event_type: validation ? CHANNEL_GATEWAY_EVENT_TYPES.ATTRIBUTION_ATTACHED : CHANNEL_GATEWAY_EVENT_TYPES.INBOUND_RECEIVED,
      code_id: validation?.code?.id || null,
      campaign_id: validation?.code?.campaign_id || null,
      subject_type: 'channel_session',
      subject_id: input.conversation_id || input.thread_id || input.session_id || input.sender_id || null,
      channel: channelToReferralChannel(channel),
      source: input.source || channel,
      session_id: input.session_id || input.conversation_id || input.thread_id || null,
      metadata: {
        normalized_channel: channel,
        sender_id: input.sender_id || null,
        message_id: input.message_id || null,
        consent: cleanObject(input.consent),
        referral_code: validation?.code?.code || null,
        raw_referral_code: input.referral_code || input.code || null,
        payload: cleanObject(input.payload),
      },
    }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
  }

  async processInbound(channelName, input = {}, actor = {}) {
    const channel = normalizeChannel(channelName);
    const gatewayActor = buildActor(channel, input, actor);
    const text = input.text || input.message || input.caption || input.query || '';
    const extractedCode = extractReferralCode({ ...input, text });
    const inboundEvent = await this.recordChannelEvent(channel, input, gatewayActor);
    const triage = await this.agentGateway.executeTool({ tool: AGENT_TOOL_NAMES.TRIAGE, input: { message: text, channel: channelToReferralChannel(channel), session_id: gatewayActor.session_id, surface: channel } }, gatewayActor);
    let validation = null;
    if (extractedCode) {
      const validationResponse = await this.agentGateway.executeTool({ tool: AGENT_TOOL_NAMES.VALIDATE_REFERRAL_CODE, input: { code: extractedCode, channel: channelToReferralChannel(channel), session_id: gatewayActor.session_id, subject_id: gatewayActor.session_id, metadata: { source_channel: channel } } }, gatewayActor);
      validation = validationResponse.result;
      await this.recordChannelEvent(channel, input, gatewayActor, validation);
    }
    return {
      success: true,
      channel,
      inbound_event_id: inboundEvent.id,
      extracted_referral_code: extractedCode,
      attribution: validation?.attribution || null,
      triage: triage.result,
      validation,
      reply: buildInboundSummary(channel, input, triage.result, validation),
      next_tools: validation?.next_actions || triage.result.suggested_tools,
      metadata: {
        conversation_id: gatewayActor.session_id,
        sender_id: input.sender_id || null,
        consent: cleanObject(input.consent),
      },
    };
  }

  async prepareShareKit(channelName, input = {}, actor = {}) {
    const channel = normalizeChannel(channelName || input.channel);
    const gatewayActor = buildActor(channel, input, actor);
    const shareResponse = await this.agentGateway.executeTool({ tool: AGENT_TOOL_NAMES.GENERATE_SHARE_KIT, input: { code: input.code, channel: channelToReferralChannel(channel), persist: Boolean(input.persist), options: cleanObject(input.options) } }, gatewayActor);
    const socialCopy = await this.agentGateway.executeTool({ tool: AGENT_TOOL_NAMES.DRAFT_SOCIAL_COPY, input: { code: input.code, channel: channelToReferralChannel(channel), route_origin: input.route_origin, route_destination: input.route_destination, campaign_name: input.campaign_name, category: input.category } }, gatewayActor);
    const kit = shareResponse.result.share_kit || shareResponse.result.shareAsset?.payload || {};
    const channelCopy = buildChannelCopy(channel, kit, socialCopy.result);
    const event = await this.referralService.recordReferralEvent({
      event_type: CHANNEL_GATEWAY_EVENT_TYPES.SHARE_KIT_PREPARED,
      code_id: shareResponse.result.validation?.code?.id || shareResponse.result.shareAsset?.code_id || null,
      campaign_id: shareResponse.result.validation?.code?.campaign_id || shareResponse.result.shareAsset?.campaign_id || null,
      subject_type: 'channel_share_kit',
      subject_id: channel,
      channel: channelToReferralChannel(channel),
      session_id: gatewayActor.session_id,
      metadata: { channel, persisted: Boolean(input.persist), message: channelCopy.message, link: channelCopy.link },
    }, gatewayActor);
    return {
      success: true,
      channel,
      share_event_id: event.id,
      persisted: Boolean(shareResponse.result.persisted),
      share_kit: kit,
      copy: channelCopy,
      social_copy: socialCopy.result,
    };
  }
}
