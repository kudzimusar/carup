import { ForbiddenError, ValidationError } from '../../utils/errors.js';
import { ACTOR_TYPES, REFERRAL_CAMPAIGN_STATUSES, REFERRAL_CAMPAIGN_TYPES, REFERRAL_CHANNELS } from '../../constants/referral/referralConstants.js';
import { ReferralEngineService, buildReferralShareAssets, normalizeReferralCode, sanitizeCallerShareOptions, slugify } from './referralEngineService.js';

export const AGENT_GATEWAY_EVENT_TYPES = Object.freeze({
  TOOL_EXECUTED: 'agent.tool_executed',
  TOOL_FAILED: 'agent.tool_failed',
  TRIAGE_COMPLETED: 'agent.triage_completed',
  SUPPORT_HANDOFF_OPENED: 'agent.support_handoff_opened',
});

export const AGENT_TOOL_NAMES = Object.freeze({
  TRIAGE: 'triage',
  VALIDATE_REFERRAL_CODE: 'validate_referral_code',
  DRAFT_CAMPAIGN: 'draft_campaign',
  GENERATE_SHARE_KIT: 'generate_share_kit',
  EXPLAIN_WALLET: 'explain_wallet',
  SUPPORT_HANDOFF: 'support_handoff',
  CHECK_CAMPAIGN_STATUS: 'check_campaign_status',
  DRAFT_SOCIAL_COPY: 'draft_social_copy',
});

const PUBLIC_SAFE_TOOLS = new Set([AGENT_TOOL_NAMES.TRIAGE, AGENT_TOOL_NAMES.VALIDATE_REFERRAL_CODE, AGENT_TOOL_NAMES.CHECK_CAMPAIGN_STATUS, AGENT_TOOL_NAMES.DRAFT_SOCIAL_COPY]);
const WRITE_TOOLS = new Set([AGENT_TOOL_NAMES.DRAFT_CAMPAIGN, AGENT_TOOL_NAMES.GENERATE_SHARE_KIT, AGENT_TOOL_NAMES.SUPPORT_HANDOFF]);
const OPERATOR_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'dealer', 'seller', 'agent', 'manager']);
const ADMIN_ROLES = new Set(['admin', 'platform_admin', 'super_admin']);
const TOOL_ALIASES = Object.freeze({ validate: AGENT_TOOL_NAMES.VALIDATE_REFERRAL_CODE, validate_code: AGENT_TOOL_NAMES.VALIDATE_REFERRAL_CODE, referral_validate: AGENT_TOOL_NAMES.VALIDATE_REFERRAL_CODE, campaign_status: AGENT_TOOL_NAMES.CHECK_CAMPAIGN_STATUS, share_kit: AGENT_TOOL_NAMES.GENERATE_SHARE_KIT, social_copy: AGENT_TOOL_NAMES.DRAFT_SOCIAL_COPY, wallet_status: AGENT_TOOL_NAMES.EXPLAIN_WALLET, handoff: AGENT_TOOL_NAMES.SUPPORT_HANDOFF, support: AGENT_TOOL_NAMES.SUPPORT_HANDOFF });

function normalizeToolName(tool) { const normalized = String(tool || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); return TOOL_ALIASES[normalized] || normalized; }
function normalizeRole(role) { return String(role || '').trim().toLowerCase(); }
function isAdmin(actor = {}) { return ADMIN_ROLES.has(normalizeRole(actor.actor_role || actor.role)); }
function isOperator(actor = {}) { return OPERATOR_ROLES.has(normalizeRole(actor.actor_role || actor.role)); }
function isTrustedActor(actor = {}) { return Boolean(actor.gateway_trusted || actor.actor_user_id || actor.user_id || isAdmin(actor)); }
function cleanObject(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)); }

function detectCampaignType(text = '') {
  const value = String(text).toLowerCase();
  if (value.includes('container') || value.includes('space') || value.includes('shipment')) return REFERRAL_CAMPAIGN_TYPES.CONTAINER_SPACE;
  if (value.includes('vehicle') || value.includes('car import') || value.includes('auction')) return REFERRAL_CAMPAIGN_TYPES.IMPORT_VEHICLE;
  if (value.includes('part') || value.includes('spare') || value.includes('engine') || value.includes('tyre')) return REFERRAL_CAMPAIGN_TYPES.IMPORT_PARTS;
  if (value.includes('group') || value.includes('community') || value.includes('whatsapp')) return REFERRAL_CAMPAIGN_TYPES.COMMUNITY_GROUP;
  return REFERRAL_CAMPAIGN_TYPES.LOCAL_MARKETPLACE;
}

function inferIntent(message = '') {
  const text = String(message || '').toLowerCase();
  if (/\b(code|referral|coupon|discount)\b/.test(text)) return 'referral_validation';
  if (/\b(wallet|reward|balance|paid|payout|credit)\b/.test(text)) return 'wallet_explanation';
  if (/\b(campaign|container|import|vehicle|parts|supplier|share)\b/.test(text)) return 'campaign_or_share';
  if (/\b(help|support|human|agent|problem|complaint|stuck)\b/.test(text)) return 'support_handoff';
  return 'general_triage';
}

function suggestedToolsForIntent(intent) {
  if (intent === 'referral_validation') return [AGENT_TOOL_NAMES.VALIDATE_REFERRAL_CODE, AGENT_TOOL_NAMES.SUPPORT_HANDOFF];
  if (intent === 'wallet_explanation') return [AGENT_TOOL_NAMES.EXPLAIN_WALLET, AGENT_TOOL_NAMES.SUPPORT_HANDOFF];
  if (intent === 'campaign_or_share') return [AGENT_TOOL_NAMES.CHECK_CAMPAIGN_STATUS, AGENT_TOOL_NAMES.GENERATE_SHARE_KIT, AGENT_TOOL_NAMES.DRAFT_CAMPAIGN];
  if (intent === 'support_handoff') return [AGENT_TOOL_NAMES.SUPPORT_HANDOFF];
  return [AGENT_TOOL_NAMES.TRIAGE, AGENT_TOOL_NAMES.VALIDATE_REFERRAL_CODE];
}

function summarizeWallet(wallet, transactions = []) {
  const pending = Number(wallet.pending_balance || 0);
  const approved = Number(wallet.approved_balance || 0);
  const payable = Number(wallet.payable_balance || 0);
  const paid = Number(wallet.paid_or_applied_balance || 0);
  const latest = transactions.slice(0, 5).map((tx) => ({ id: tx.id, status: tx.status, amount: Number(tx.amount || 0), currency: tx.currency || wallet.currency, reason: tx.reason || null, created_at: tx.created_at || null }));
  return {
    balances: { pending, approved, payable, paid_or_applied: paid, currency: wallet.currency || 'USD' },
    plain_language: [
      pending > 0 ? `${pending} ${wallet.currency || 'USD'} is still pending review or milestone completion.` : null,
      approved > 0 ? `${approved} ${wallet.currency || 'USD'} has been approved but is not yet payable.` : null,
      payable > 0 ? `${payable} ${wallet.currency || 'USD'} is payable or usable as service credit.` : null,
      paid > 0 ? `${paid} ${wallet.currency || 'USD'} has already been paid or applied.` : null,
    ].filter(Boolean).join(' ') || 'There is no referral reward balance yet.',
    latest_transactions: latest,
    safety_note: 'This tool only explains wallet state. It cannot approve, mature, pay, or apply balances.',
  };
}

function buildCampaignDraft(input = {}) {
  const sourceText = [input.name, input.message, input.route_origin, input.route_destination, input.category].filter(Boolean).join(' ');
  const campaignType = input.campaign_type || detectCampaignType(sourceText);
  const name = input.name || `${input.route_origin || 'CarUp'} ${input.route_destination ? `to ${input.route_destination}` : 'referral'} campaign`;
  const priorityScope = input.priority_scope || (campaignType === REFERRAL_CAMPAIGN_TYPES.LOCAL_MARKETPLACE ? 'LOCAL' : 'IMPORT');
  return { tenant_id: input.tenant_id, name, slug: input.slug || slugify(name), campaign_type: campaignType, priority_scope: priorityScope, status: REFERRAL_CAMPAIGN_STATUSES.DRAFT, starts_at: input.starts_at || null, ends_at: input.ends_at || null, route_origin: input.route_origin || null, route_destination: input.route_destination || null, category: input.category || null, channel_strategy: cleanObject(input.channel_strategy || { primary: input.channel || REFERRAL_CHANNELS.WEB, recommended_tools: [AGENT_TOOL_NAMES.GENERATE_SHARE_KIT, AGENT_TOOL_NAMES.DRAFT_SOCIAL_COPY] }), metadata: cleanObject({ ...input.metadata, drafted_by: 'agent_gateway', requires_human_review: true, source_message: input.message || null }) };
}

function buildSocialCopy(input = {}, validation = null) {
  const code = normalizeReferralCode(input.code || validation?.code?.code || '');
  const route = [input.route_origin, input.route_destination].filter(Boolean).join(' to ');
  const campaignLabel = input.campaign_name || route || input.category || 'CarUp';
  const copyBase = code ? `Use my CarUp code ${code} for ${campaignLabel}.` : `Join me on CarUp for ${campaignLabel}.`;
  return { whatsapp: `${copyBase} Ask for verified local buying, selling, parts, imports, or container-space support.`, telegram: `${copyBase} CarUp keeps referral attribution and support history in one place.`, short_post: `${copyBase} CarUp helps connect buyers, sellers, suppliers, importers, and agents with a traceable referral path.`, compliance_note: 'Draft copy only. Human review is required before paid promotion, reward promises, or regulated claims.' };
}

export class ReferralAgentGatewayService {
  constructor({ referralService, client, now = () => new Date(), shareOptions = {} } = {}) { this.referralService = referralService || new ReferralEngineService({ client, now, shareOptions }); this.now = now; this.shareOptions = shareOptions; }

  getToolCatalog(actor = {}) { return Object.values(AGENT_TOOL_NAMES).map((name) => ({ name, permission: this.describePermission(name, actor), writes: WRITE_TOOLS.has(name), available: this.isToolVisible(name, actor) })); }
  describePermission(tool, actor = {}) { const name = normalizeToolName(tool); if (PUBLIC_SAFE_TOOLS.has(name)) return 'public_safe'; if (name === AGENT_TOOL_NAMES.EXPLAIN_WALLET) return 'self_or_admin_read'; if (name === AGENT_TOOL_NAMES.DRAFT_CAMPAIGN) return 'dry_run_public_persist_operator'; if (name === AGENT_TOOL_NAMES.GENERATE_SHARE_KIT) return 'dry_run_public_persist_operator'; if (name === AGENT_TOOL_NAMES.SUPPORT_HANDOFF) return isTrustedActor(actor) ? 'trusted_handoff' : 'trusted_actor_required'; return 'restricted'; }
  isToolVisible(tool, actor = {}) { const name = normalizeToolName(tool); if (PUBLIC_SAFE_TOOLS.has(name)) return true; if (name === AGENT_TOOL_NAMES.DRAFT_CAMPAIGN || name === AGENT_TOOL_NAMES.GENERATE_SHARE_KIT) return true; if (name === AGENT_TOOL_NAMES.EXPLAIN_WALLET || name === AGENT_TOOL_NAMES.SUPPORT_HANDOFF) return isTrustedActor(actor); return false; }

  assertToolAllowed(tool, input = {}, actor = {}) {
    const name = normalizeToolName(tool);
    if (!Object.values(AGENT_TOOL_NAMES).includes(name)) throw new ValidationError('Unknown agent gateway tool.', { tool });
    if (PUBLIC_SAFE_TOOLS.has(name)) return name;
    if (name === AGENT_TOOL_NAMES.EXPLAIN_WALLET) {
      const requestedUserId = input.user_id || input.userId || actor.actor_user_id;
      if (!requestedUserId) throw new ValidationError('user_id is required for wallet explanation.');
      if (requestedUserId === actor.actor_user_id || isAdmin(actor)) return name;
      throw new ForbiddenError('Agent gateway cannot explain another user wallet without admin context.');
    }
    if (name === AGENT_TOOL_NAMES.SUPPORT_HANDOFF) { if (isTrustedActor(actor)) return name; throw new ForbiddenError('Support handoff requires a trusted gateway actor or user context.'); }
    if (name === AGENT_TOOL_NAMES.DRAFT_CAMPAIGN || name === AGENT_TOOL_NAMES.GENERATE_SHARE_KIT) { if (input.persist === true && !isOperator(actor)) throw new ForbiddenError('Persisting agent-generated campaign or share assets requires operator context.'); return name; }
    throw new ForbiddenError('Agent gateway tool is not allowed.');
  }

  async auditTool(tool, input = {}, actor = {}, result = {}, success = true) {
    const safeInput = { ...cleanObject(input) };
    delete safeInput.secret;
    return this.referralService.recordReferralEvent({ event_type: success ? AGENT_GATEWAY_EVENT_TYPES.TOOL_EXECUTED : AGENT_GATEWAY_EVENT_TYPES.TOOL_FAILED, campaign_id: result?.campaign?.id || result?.campaign_id || null, code_id: result?.code?.id || result?.code_id || null, coupon_id: result?.coupon?.id || null, wallet_transaction_id: result?.wallet_transaction_id || null, subject_type: 'agent_gateway_tool', subject_id: tool, channel: input.channel || actor.surface || REFERRAL_CHANNELS.WEB, session_id: input.session_id || actor.session_id || null, metadata: { tool, success, input: safeInput, result_summary: result?.summary || result?.intent || result?.plain_language || null, surface: actor.surface || input.surface || null } }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
  }

  async executeTool({ tool, input = {}, context = {} } = {}, actor = {}) {
    const mergedInput = { ...cleanObject(context), ...cleanObject(input) };
    const normalizedTool = this.assertToolAllowed(tool, mergedInput, actor);
    try {
      let result;
      if (normalizedTool === AGENT_TOOL_NAMES.TRIAGE) result = await this.triage(mergedInput, actor);
      if (normalizedTool === AGENT_TOOL_NAMES.VALIDATE_REFERRAL_CODE) result = await this.validateReferralCode(mergedInput, actor);
      if (normalizedTool === AGENT_TOOL_NAMES.DRAFT_CAMPAIGN) result = await this.draftCampaign(mergedInput, actor);
      if (normalizedTool === AGENT_TOOL_NAMES.GENERATE_SHARE_KIT) result = await this.generateShareKit(mergedInput, actor);
      if (normalizedTool === AGENT_TOOL_NAMES.EXPLAIN_WALLET) result = await this.explainWallet(mergedInput, actor);
      if (normalizedTool === AGENT_TOOL_NAMES.SUPPORT_HANDOFF) result = await this.openSupportHandoff(mergedInput, actor);
      if (normalizedTool === AGENT_TOOL_NAMES.CHECK_CAMPAIGN_STATUS) result = await this.checkCampaignStatus(mergedInput, actor);
      if (normalizedTool === AGENT_TOOL_NAMES.DRAFT_SOCIAL_COPY) result = await this.draftSocialCopy(mergedInput, actor);
      const auditEvent = await this.auditTool(normalizedTool, mergedInput, actor, result, true);
      return { success: true, tool: normalizedTool, permission: this.describePermission(normalizedTool, actor), writes: WRITE_TOOLS.has(normalizedTool), audit_event_id: auditEvent?.id || null, result };
    } catch (error) { await this.auditTool(normalizedTool, mergedInput, actor, { summary: error.message }, false).catch(() => null); throw error; }
  }

  async triage(input = {}, actor = {}) {
    const intent = inferIntent(input.message || input.text || input.query);
    const result = { intent, confidence: intent === 'general_triage' ? 0.52 : 0.82, suggested_tools: suggestedToolsForIntent(intent), required_fields: intent === 'referral_validation' ? ['code'] : intent === 'wallet_explanation' ? ['user_id'] : [], channel: input.channel || actor.surface || REFERRAL_CHANNELS.WEB, safe_response: 'I can help with referral codes, campaign status, share kits, wallet explanations, or handoff to CarUp support.' };
    await this.referralService.recordReferralEvent({ event_type: AGENT_GATEWAY_EVENT_TYPES.TRIAGE_COMPLETED, channel: result.channel, session_id: input.session_id || actor.session_id || null, metadata: result }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
    return result;
  }

  async validateReferralCode(input = {}, actor = {}) {
    const result = await this.referralService.validateReferralCode({ code: input.code, channel: input.channel || actor.surface || REFERRAL_CHANNELS.WEB, source: input.source || 'agent_gateway', session_id: input.session_id || actor.session_id || null, subject_type: input.subject_type || 'agent_gateway_session', subject_id: input.subject_id || input.session_id || actor.session_id || null, metadata: cleanObject({ ...input.metadata, surface: actor.surface || input.surface || null }) }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
    return { ...result, next_actions: result.valid ? [AGENT_TOOL_NAMES.GENERATE_SHARE_KIT, AGENT_TOOL_NAMES.CHECK_CAMPAIGN_STATUS] : [AGENT_TOOL_NAMES.SUPPORT_HANDOFF] };
  }

  async draftCampaign(input = {}, actor = {}) {
    const draft = buildCampaignDraft({ ...input, tenant_id: input.tenant_id || actor.actor_tenant_id });
    if (input.persist !== true) return { persisted: false, draft, requires_human_review: true };
    const campaign = await this.referralService.createCampaign(draft, { ...actor, actor_type: ACTOR_TYPES.AGENT });
    return { persisted: true, campaign, requires_human_review: true };
  }

  async generateShareKit(input = {}, actor = {}) {
    if (!input.code) throw new ValidationError('code is required for share-kit generation.');
    const validation = await this.referralService.validateReferralCode({ code: input.code, channel: input.channel || actor.surface || REFERRAL_CHANNELS.WEB, source: 'agent_gateway_share_kit', session_id: input.session_id || actor.session_id || null }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
    if (!validation.valid) return { persisted: false, valid: false, validation };
    const callerShareOptions = sanitizeCallerShareOptions(input.options);
    if (input.persist === true) { const shareAsset = await this.referralService.createShareAssets({ code: validation.code.code, channel: input.channel || actor.surface || REFERRAL_CHANNELS.WEB, asset_type: input.asset_type || 'agent_share_kit', options: callerShareOptions }, { ...actor, actor_type: ACTOR_TYPES.AGENT }); return { persisted: true, valid: true, shareAsset, validation }; }
    return { persisted: false, valid: true, share_kit: buildReferralShareAssets(validation.code, null, { ...callerShareOptions, ...this.shareOptions }), validation };
  }

  async explainWallet(input = {}, actor = {}) {
    const userId = input.user_id || input.userId || actor.actor_user_id;
    if (!userId) throw new ValidationError('user_id is required for wallet explanation.');
    if (userId !== actor.actor_user_id && !isAdmin(actor)) throw new ForbiddenError('Agent gateway cannot explain another user wallet without admin context.');
    const { wallet, transactions } = await this.referralService.getWallet(userId);
    return summarizeWallet(wallet, transactions);
  }

  async openSupportHandoff(input = {}, actor = {}) {
    const issueType = input.issue_type || inferIntent(input.message || input.summary || 'support');
    const event = await this.referralService.recordReferralEvent({ event_type: AGENT_GATEWAY_EVENT_TYPES.SUPPORT_HANDOFF_OPENED, code_id: input.code_id || null, campaign_id: input.campaign_id || null, subject_type: input.subject_type || 'support_handoff', subject_id: input.subject_id || input.user_id || actor.actor_user_id || input.session_id || null, channel: input.channel || actor.surface || REFERRAL_CHANNELS.WEB, session_id: input.session_id || actor.session_id || null, metadata: { issue_type: issueType, summary: input.summary || input.message || 'Agent gateway support handoff requested.', priority: input.priority || 'normal', contact: cleanObject(input.contact), transcript_excerpt: input.transcript_excerpt || null, requires_human_review: true } }, { ...actor, actor_type: ACTOR_TYPES.AGENT });
    return { handoff_opened: true, handoff_event_id: event.id, status: 'queued_for_human_review', issue_type: issueType, summary: input.summary || input.message || null };
  }

  async checkCampaignStatus(input = {}) {
    const campaigns = await this.referralService.listCampaigns({ tenant_id: input.tenant_id || undefined, status: input.status || undefined, campaign_type: input.campaign_type || undefined, priority_scope: input.priority_scope || undefined });
    return { count: campaigns.length, campaigns: campaigns.map((campaign) => ({ id: campaign.id, name: campaign.name, slug: campaign.slug, campaign_type: campaign.campaign_type, priority_scope: campaign.priority_scope, status: campaign.status, route_origin: campaign.route_origin || null, route_destination: campaign.route_destination || null, starts_at: campaign.starts_at || null, ends_at: campaign.ends_at || null })) };
  }

  async draftSocialCopy(input = {}, actor = {}) { let validation = null; if (input.code) validation = await this.validateReferralCode(input, actor); return buildSocialCopy(input, validation); }
}
