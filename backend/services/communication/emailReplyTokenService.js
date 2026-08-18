import crypto from 'crypto';

/**
 * E2/E4 — opaque authenticated Reply-To routing tokens.
 *
 * Outbound conversational Email carries:
 *     Reply-To: conversation+<token>@mail.carup.dev
 *
 * The token is an opaque random handle. Nothing about the conversation is derivable from the
 * address — no raw thread ID is ever exposed — and only a SHA-256 hash is persisted, so a
 * database read cannot be replayed as a routing credential.
 *
 * Unlike an auth action token this is NOT single-use: a correspondent may reply many times to the
 * same thread. It is instead expiring, revocable, rotatable, and, crucially, resolution
 * revalidates the LIVE thread/participant/binding invariants every time rather than trusting what
 * the token asserted when it was minted.
 */

/** 16 random bytes -> 22 base64url chars, so "conversation+<token>" stays well inside the 64-octet local-part limit. */
const TOKEN_BYTES = 16;
const DEFAULT_TTL_DAYS = 90;
const REPLY_LOCAL_PREFIX = 'conversation+';
const CURRENT_VERSION = 1;

export function hashReplyToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

export function generateRawReplyToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/** `conversation+<token>@mail.carup.dev` */
export function buildReplyToAddress(rawToken, env = process.env) {
  const domain = env.RESEND_INBOUND_DOMAIN || 'mail.carup.dev';
  return `${REPLY_LOCAL_PREFIX}${rawToken}@${domain}`;
}

/**
 * Extract the raw token from a recipient address.
 * Returns null for any address that is not a conversation reply address.
 */
export function parseReplyToAddress(address) {
  // The token is base64url and CASE-SENSITIVE, so the address must not be lower-cased before
  // extraction — doing so silently corrupts every token containing an uppercase character and
  // makes the hash lookup miss. Only the fixed `conversation+` prefix is matched loosely.
  const raw = String(address || '').trim();
  const match = raw.match(/(?:^|[<\s,;])conversation\+([A-Za-z0-9_-]{16,64})@/i);
  return match ? match[1] : null;
}

/** Pull every candidate reply token out of a To/Cc/delivered-to header set. */
export function extractReplyTokens(addresses = []) {
  const list = Array.isArray(addresses) ? addresses : [addresses];
  const tokens = new Set();
  for (const entry of list) {
    // A header line may hold several addresses; scan the whole string.
    const text = String(entry || '');
    const re = /conversation\+([A-Za-z0-9_-]{16,64})@/gi;
    let m;
    while ((m = re.exec(text)) !== null) tokens.add(m[1]);
  }
  return [...tokens];
}

export class EmailReplyTokenService {
  constructor({ supabase, now = () => new Date() }) {
    this.supabase = supabase;
    this.now = now;
  }

  /**
   * Mint a reply token for a (thread, participant) pair.
   *
   * Reuses a live token for the same pair when one exists, so a long-running thread keeps a
   * stable Reply-To address instead of accumulating a new credential per outbound message.
   */
  async issue({ threadId, participantId, tenantId, bindingId = null, provider = 'resend', ttlDays = DEFAULT_TTL_DAYS }) {
    if (!threadId || !participantId || !tenantId) {
      throw new Error('emailReplyToken.issue requires threadId, participantId and tenantId');
    }

    const nowIso = this.now().toISOString();
    const { data: existing } = await this.supabase
      .from('email_reply_tokens')
      .select('id, token_hash, expires_at')
      .eq('thread_id', threadId)
      .eq('participant_id', participantId)
      .is('revoked_at', null)
      .gt('expires_at', nowIso)
      .maybeSingle();

    // A live token exists but its raw form is unrecoverable by design (hash-only storage), so a
    // fresh handle is minted and the old one superseded rather than guessed at.
    const rawToken = generateRawReplyToken();
    const expiresAt = new Date(this.now().getTime() + ttlDays * 86_400_000).toISOString();

    const { data, error } = await this.supabase
      .from('email_reply_tokens')
      .insert({
        token_hash: hashReplyToken(rawToken),
        version: CURRENT_VERSION,
        tenant_id: tenantId,
        thread_id: threadId,
        participant_id: participantId,
        binding_id: bindingId,
        provider,
        expires_at: expiresAt,
        rotated_from: existing?.id || null,
      })
      .select('id, thread_id, participant_id, tenant_id, expires_at')
      .single();

    if (error) throw new Error(`Failed to issue reply token: ${error.message}`);
    if (existing?.id) {
      await this.supabase.from('email_reply_tokens').update({ revoked_at: nowIso }).eq('id', existing.id);
    }
    return { rawToken, address: buildReplyToAddress(rawToken), record: data };
  }

  /**
   * Resolve a raw token to its routing context.
   *
   * Fails closed on every ambiguity: unknown, expired, revoked, or a token whose thread/participant
   * no longer satisfies the live invariants. The caller must treat any non-ok result as "do not
   * route" — never as "fall back to a guess".
   */
  async resolve(rawToken) {
    if (!rawToken) return { ok: false, reason: 'no_token' };
    const nowIso = this.now().toISOString();

    const { data: token, error } = await this.supabase
      .from('email_reply_tokens')
      .select('id, thread_id, participant_id, binding_id, tenant_id, expires_at, revoked_at, use_count')
      .eq('token_hash', hashReplyToken(rawToken))
      .maybeSingle();

    if (error) return { ok: false, reason: `lookup_failed:${error.message}` };
    if (!token) return { ok: false, reason: 'unknown_token' };
    if (token.revoked_at) return { ok: false, reason: 'revoked_token' };
    if (new Date(token.expires_at) <= new Date(nowIso)) return { ok: false, reason: 'expired_token' };

    // Revalidate LIVE state — the token asserted these once; they must still hold now.
    const { data: participant } = await this.supabase
      .from('message_participants')
      .select('id, thread_id, left_at, user_id')
      .eq('id', token.participant_id)
      .maybeSingle();
    if (!participant) return { ok: false, reason: 'participant_missing' };
    if (participant.thread_id !== token.thread_id) return { ok: false, reason: 'participant_thread_mismatch' };
    if (participant.left_at) return { ok: false, reason: 'participant_inactive' };

    const { data: thread } = await this.supabase
      .from('message_threads')
      .select('id, tenant_id')
      .eq('id', token.thread_id)
      .maybeSingle();
    if (!thread) return { ok: false, reason: 'thread_missing' };
    // Tenant is never reassigned as a routing shortcut.
    if (thread.tenant_id !== token.tenant_id) return { ok: false, reason: 'tenant_invariant_failed' };

    if (token.binding_id) {
      const { data: binding } = await this.supabase
        .from('conversation_channel_bindings')
        .select('id, can_receive, expires_at')
        .eq('id', token.binding_id)
        .maybeSingle();
      if (binding) {
        if (binding.can_receive === false) return { ok: false, reason: 'binding_cannot_receive' };
        if (binding.expires_at && new Date(binding.expires_at) <= new Date(nowIso)) {
          return { ok: false, reason: 'binding_expired' };
        }
      }
    }

    return {
      ok: true,
      threadId: token.thread_id,
      participantId: token.participant_id,
      tenantId: token.tenant_id,
      bindingId: token.binding_id,
      tokenId: token.id,
    };
  }

  /** Record usage. Best-effort telemetry — never blocks routing. */
  async recordUse(tokenId) {
    if (!tokenId) return;
    try {
      const { data } = await this.supabase
        .from('email_reply_tokens')
        .select('use_count')
        .eq('id', tokenId)
        .maybeSingle();
      await this.supabase
        .from('email_reply_tokens')
        .update({ last_used_at: this.now().toISOString(), use_count: (data?.use_count || 0) + 1 })
        .eq('id', tokenId);
    } catch {
      /* telemetry only */
    }
  }

  async revokeForThread(threadId) {
    await this.supabase
      .from('email_reply_tokens')
      .update({ revoked_at: this.now().toISOString() })
      .eq('thread_id', threadId)
      .is('revoked_at', null);
  }
}

export function createEmailReplyTokenService(deps) {
  return new EmailReplyTokenService(deps);
}
