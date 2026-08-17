import crypto from 'node:crypto';

import { resolveCanonicalWebOrigin } from '../../config/canonicalWebOrigin.js';

/**
 * E5/E7 — the governed CarUp unsubscribe action for marketing Email.
 *
 * CarUp is the canonical consent authority. An unsubscribe resolves here and mutates CarUp's own
 * consent and suppression state; the provider is never asked to own the decision, and the recipient
 * is never managed directly inside Brevo.
 *
 * The handle is opaque and stored only as a SHA-256 hash, so a database disclosure cannot forge an
 * unsubscribe for an arbitrary address. Unlike the auth action tokens, it is deliberately MULTI-USE
 * and idempotent: an unsubscribe link lives in a mailbox indefinitely, and RFC 8058 one-click POST
 * may be replayed by the mail client or a security scanner.
 */

const DEFAULT_TTL_DAYS = 730;

export function hashUnsubscribeToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

export function generateRawUnsubscribeToken() {
  // base64url of 16 random bytes — URL-safe, no padding, and short enough to survive line wrapping
  // in a plain-text Email body without being broken across lines.
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * Build the public unsubscribe URL for a raw handle.
 *
 * Deliberately routed through the canonical web origin resolver rather than an ad-hoc env var, so an
 * unsubscribe link can never point at a dead or attacker-supplied host.
 */
export function buildUnsubscribeUrl(rawToken, env = process.env) {
  const base = (env.COMMUNICATION_WEBHOOK_BASE_URL || resolveCanonicalWebOrigin(env) || '').replace(/\/+$/, '');
  return `${base}/api/communications/unsubscribe?token=${encodeURIComponent(rawToken)}`;
}

/**
 * The mailto: fallback required alongside the https URI by RFC 8058-capable clients.
 */
export function buildUnsubscribeMailto(rawToken, env = process.env) {
  const domain = env.RESEND_INBOUND_DOMAIN || 'mail.carup.dev';
  return `unsubscribe+${rawToken}@${domain}`;
}

export class MarketingUnsubscribeService {
  constructor({ supabase, env = process.env, now = () => new Date() }) {
    this.supabase = supabase;
    this.env = env;
    this.now = now;
  }

  /**
   * Mint an unsubscribe handle for a recipient address.
   *
   * A fresh handle is minted per marketing send and earlier handles are deliberately NOT revoked.
   * Storage is hash-only, so a previously issued raw token is unrecoverable and cannot be re-embedded
   * in a new message; revoking on reissue would therefore silently break the unsubscribe link in
   * every Email already sitting in the recipient's mailbox. Several live handles per address is the
   * correct trade — they all resolve to the same address and scope, and unsubscribing is idempotent.
   */
  async issue({ address, tenantId = 'platform', channel = 'email', userId = null, identityId = null, scope = 'marketing', campaignId = null, ttlDays = DEFAULT_TTL_DAYS }) {
    const normalizedAddress = String(address || '').trim().toLowerCase();
    if (!normalizedAddress) throw new Error('marketingUnsubscribe.issue requires a recipient address');

    const nowDate = this.now();
    const rawToken = generateRawUnsubscribeToken();
    const expiresAt = new Date(nowDate.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.supabase
      .from('marketing_unsubscribe_tokens')
      .insert({
        token_hash: hashUnsubscribeToken(rawToken),
        tenant_id: tenantId,
        channel,
        address: normalizedAddress,
        user_id: userId,
        identity_id: identityId,
        scope,
        campaign_id: campaignId,
        expires_at: expiresAt,
      })
      .select('id, address, tenant_id, channel, scope, user_id, identity_id')
      .single();
    if (error) throw new Error(`Failed to issue unsubscribe token: ${error.message}`);

    return {
      rawToken,
      record: data,
      url: buildUnsubscribeUrl(rawToken, this.env),
      mailto: buildUnsubscribeMailto(rawToken, this.env),
    };
  }

  async resolve(rawToken) {
    if (!rawToken) return { ok: false, reason: 'no_token' };
    const { data: token, error } = await this.supabase
      .from('marketing_unsubscribe_tokens')
      .select('id, tenant_id, channel, address, user_id, identity_id, scope, campaign_id, expires_at, revoked_at, use_count')
      .eq('token_hash', hashUnsubscribeToken(rawToken))
      .maybeSingle();

    if (error) return { ok: false, reason: `lookup_failed:${error.message}` };
    if (!token) return { ok: false, reason: 'unknown_token' };
    if (token.revoked_at) return { ok: false, reason: 'revoked_token' };
    if (token.expires_at && new Date(token.expires_at) <= this.now()) return { ok: false, reason: 'expired_token' };
    return { ok: true, token };
  }

  /**
   * Apply the unsubscribe across CarUp's canonical consent state.
   *
   * Idempotent: replaying the same handle re-asserts the same suppression rather than failing, which
   * RFC 8058 one-click requires.
   */
  async unsubscribe(rawToken, { source = 'carup_one_click', evidence = {} } = {}) {
    const resolved = await this.resolve(rawToken);
    if (!resolved.ok) return resolved;

    const { token } = resolved;
    const nowIso = this.now().toISOString();

    // 1. Canonical suppression state — consulted by the send-time gate before any marketing send.
    const { error: suppressionError } = await this.supabase
      .from('communication_suppressions')
      .upsert({
        tenant_id: token.tenant_id,
        channel: token.channel,
        address: token.address,
        user_id: token.user_id,
        scope: token.scope,
        reason: 'unsubscribe',
        source,
        provider: null,
        evidence: { ...evidence, unsubscribe_token_id: token.id, campaign_id: token.campaign_id },
        suppressed_at: nowIso,
        released_at: null,
      }, { onConflict: 'tenant_id,channel,address,scope' });
    if (suppressionError) throw new Error(`Failed to record suppression: ${suppressionError.message}`);

    // 2. Recorded preference, when the recipient is a known CarUp user. Marketing only — an
    //    unsubscribe from marketing must never disable transactional or security Email.
    if (token.user_id && token.scope === 'marketing') {
      await this.supabase
        .from('communication_preferences')
        .update({ marketing_enabled: false, withdrawn_at: nowIso, updated_at: nowIso })
        .eq('user_id', token.user_id)
        .eq('tenant_id', token.tenant_id);
    }

    // 3. Channel identity consent, so eligibility computed from identity consent agrees.
    if (token.identity_id) {
      await this.supabase
        .from('channel_identities')
        .update({ consent_status: 'opted_out' })
        .eq('id', token.identity_id);
    } else {
      await this.supabase
        .from('channel_identities')
        .update({ consent_status: 'opted_out' })
        .eq('tenant_id', token.tenant_id)
        .eq('channel', token.channel)
        .eq('normalized_address', token.address);
    }

    await this.supabase
      .from('marketing_unsubscribe_tokens')
      .update({ use_count: Number(token.use_count || 0) + 1, last_used_at: nowIso })
      .eq('id', token.id);

    return { ok: true, address: token.address, scope: token.scope, tenantId: token.tenant_id };
  }
}

export function createMarketingUnsubscribeService(deps) {
  return new MarketingUnsubscribeService(deps);
}
