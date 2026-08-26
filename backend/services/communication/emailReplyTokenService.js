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

/** 16 bytes -> 22 base64url chars, so "conversation+<token>" stays well inside the 64-octet local-part limit. */
const TOKEN_BYTES = 16;
const DEFAULT_TTL_DAYS = 90;
const REPLY_LOCAL_PREFIX = 'conversation+';

/**
 * v1 — random, unrecoverable. v2 — DERIVED, and therefore reproducible.
 *
 * v1 tokens are already in delivered inboxes and stay resolvable until their own expiry. Only
 * generation changed; the inbound resolver looks a token up by hash and never cares which version
 * produced it.
 */
export const REPLY_TOKEN_VERSIONS = Object.freeze({ RANDOM: 1, DERIVED: 2 });
export const CURRENT_REPLY_TOKEN_VERSION = REPLY_TOKEN_VERSIONS.DERIVED;

/** Cryptographic domain separation. The secret must never produce a usable value anywhere else. */
const DERIVATION_DOMAIN = 'carup-email-reply-token:v2';

export const REPLY_TOKEN_SECRET_ENV = 'CARUP_EMAIL_REPLY_TOKEN_SECRET';

/**
 * The canonical form of a tenant id.
 *
 * `message_threads.tenant_id` is nullable and a NULL genuinely means the platform tenant — most
 * marketplace threads are exactly that. `email_reply_tokens.tenant_id` is NOT NULL. Without a
 * canonical form the two disagree by construction: the token stores 'platform', the live thread
 * reads NULL, and `resolve()` rejects its own credential as a tenant violation. That would leave
 * every reply to a platform-tenant conversation unroutable — precisely the failure G5 exists to
 * remove.
 *
 * Canonicalising BOTH sides keeps the invariant's actual meaning — a token may never be routed
 * against a different tenant — while letting NULL and 'platform' be recognised as the one tenant
 * they always were. It is more permissive in that single case and in no other.
 */
export function canonicalTenantId(value) {
  const raw = String(value ?? '').trim();
  return raw.length ? raw : 'platform';
}

export function hashReplyToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

/** v1 generation. Retained because v1 rows must stay explicable, not because it is still used. */
export function generateRawReplyToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * v2 — derive the raw token from the row id, so the trusted server can REPRODUCE it.
 *
 * This is the whole point of v2. Under v1 the raw token was random and stored only as a SHA-256
 * hash, which meant `issue()` could find a live token and still be unable to say what it was — so
 * it minted a new one and revoked the old, and every previously delivered Email in that thread
 * became permanently unroutable the moment a second message was sent. Deriving from the row id
 * makes reuse possible without ever storing anything replayable.
 *
 * `HMAC-SHA256(secret, "carup-email-reply-token:v2:<row id>")`, truncated to 16 bytes. Truncation
 * keeps the address short enough for the 64-octet local part while leaving ~128 bits, and the row
 * id alone is useless without the secret.
 */
export function deriveRawReplyToken(rowId, secret) {
  if (!rowId) throw new Error('deriveRawReplyToken requires a row id');
  if (!secret) throw new Error(`deriveRawReplyToken requires ${REPLY_TOKEN_SECRET_ENV}`);
  return crypto
    .createHmac('sha256', String(secret))
    .update(`${DERIVATION_DOMAIN}:${rowId}`, 'utf8')
    .digest()
    .subarray(0, TOKEN_BYTES)
    .toString('base64url');
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
  constructor({ supabase, now = () => new Date(), env = process.env }) {
    this.supabase = supabase;
    this.now = now;
    // Injected rather than read from `process.env` at the point of use, so a test can drive secret
    // rotation without mutating global state, and so the missing-configuration path is reachable.
    this.env = env || {};
  }

  /**
   * The dedicated derivation secret.
   *
   * Deliberately NOT shared with the webhook secret, the worker secret, the CSRF secret, the auth
   * token secret or a provider API key. Each of those already authorises something else, and a
   * credential that grants two unrelated capabilities cannot be rotated for one without revoking
   * the other.
   */
  derivationSecret() {
    const value = this.env?.[REPLY_TOKEN_SECRET_ENV];
    const secret = value === undefined || value === null ? '' : String(value).trim();
    return secret.length ? secret : null;
  }

  /**
   * Mint OR REUSE the reply token for a (thread, participant) pair.
   *
   * The contract this exists to satisfy: a long-running conversation keeps ONE stable Reply-To
   * address, and sending a new message never invalidates the address in an Email already sitting in
   * someone's inbox. Under v1 the opposite happened — see `deriveRawReplyToken` — and a recipient
   * replying to last week's message became permanently unroutable.
   *
   * Reuse selects the EARLIEST live v2 row for the pair that this application can reproduce. Two
   * properties fall out of that:
   *
   *   - it is deterministic under concurrency. Two workers racing the first issue both insert; the
   *     loser then sees the earlier row, revokes its own (which never left this process and has
   *     never been sent to anyone), and returns the earlier address. Exactly one live current
   *     credential survives, without a new index and without a second table.
   *
   *   - it is safe under SECRET ROTATION. A row minted under a previous secret no longer derives to
   *     a matching hash, so it is skipped for reuse — but it is NOT revoked, because Email carrying
   *     it is already delivered and must keep routing until its own expiry. A new generation is
   *     created alongside it. Rotating the secret costs a new address, never a broken conversation.
   *
   * A still-live v1 token is likewise never revoked. It belongs to Email that was already sent.
   */
  async issue({ threadId, participantId, tenantId = null, bindingId = null, provider = 'resend', ttlDays = DEFAULT_TTL_DAYS }) {
    if (!threadId || !participantId) {
      throw new Error('emailReplyToken.issue requires threadId and participantId');
    }
    // A NULL tenant is the platform tenant, not missing context. See `canonicalTenantId`.
    const tenant = canonicalTenantId(tenantId);
    const secret = this.derivationSecret();
    if (!secret) {
      const error = new Error(`${REPLY_TOKEN_SECRET_ENV} is not configured; conversational Email cannot be given an authenticated Reply-To.`);
      error.code = 'reply_token_secret_missing';
      throw error;
    }

    const now = this.now();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000).toISOString();

    const { data: liveRows, error: lookupError } = await this.supabase
      .from('email_reply_tokens')
      .select('id, token_hash, expires_at, binding_id, created_at')
      .eq('thread_id', threadId)
      .eq('participant_id', participantId)
      .eq('version', CURRENT_REPLY_TOKEN_VERSION)
      .is('revoked_at', null)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (lookupError) throw new Error(`Failed to read reply tokens: ${lookupError.message}`);

    const reusable = this.firstReproducible(liveRows || [], secret);
    if (reusable) {
      // Refresh the window so an active conversation does not expire mid-flight. The ADDRESS does
      // not change — that is the point.
      const patch = { expires_at: expiresAt };
      // A binding may legitimately become known later. Thread and participant authority never move.
      if (bindingId && !reusable.row.binding_id) patch.binding_id = bindingId;
      await this.supabase.from('email_reply_tokens').update(patch).eq('id', reusable.row.id);
      return {
        rawToken: reusable.rawToken,
        address: buildReplyToAddress(reusable.rawToken, this.env),
        reused: true,
        record: { id: reusable.row.id, thread_id: threadId, participant_id: participantId, tenant_id: tenant, expires_at: expiresAt },
      };
    }

    const created = await this.insertDerivedToken({ threadId, participantId, tenantId: tenant, bindingId, provider, expiresAt, secret });

    // Reconcile a concurrent first issue. Anyone who inserted earlier wins; this row has never been
    // handed to a provider, so retiring it strands nobody.
    const { data: afterRows } = await this.supabase
      .from('email_reply_tokens')
      .select('id, token_hash, expires_at, binding_id, created_at')
      .eq('thread_id', threadId)
      .eq('participant_id', participantId)
      .eq('version', CURRENT_REPLY_TOKEN_VERSION)
      .is('revoked_at', null)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    const winner = this.firstReproducible(afterRows || [], secret);
    if (winner && winner.row.id !== created.record.id) {
      await this.supabase.from('email_reply_tokens')
        .update({ revoked_at: nowIso, rotated_from: winner.row.id })
        .eq('id', created.record.id);
      return {
        rawToken: winner.rawToken,
        address: buildReplyToAddress(winner.rawToken, this.env),
        reused: true,
        record: { id: winner.row.id, thread_id: threadId, participant_id: participantId, tenant_id: tenant, expires_at: winner.row.expires_at },
      };
    }

    return created;
  }

  /**
   * The first row whose stored hash matches what this secret derives.
   *
   * A row that does not match was minted under a different secret. It is skipped, never "fixed":
   * sending a derived token whose hash is not the stored one would produce an address the inbound
   * resolver cannot find, which is worse than issuing a new credential.
   */
  firstReproducible(rows, secret) {
    for (const row of rows) {
      const rawToken = deriveRawReplyToken(row.id, secret);
      if (hashReplyToken(rawToken) === row.token_hash) return { row, rawToken };
    }
    return null;
  }

  /**
   * Insert a v2 row whose token derives from its own id.
   *
   * The id is generated here rather than by the database, because the token is a function of the id
   * and the row needs its `token_hash` at insert time.
   */
  async insertDerivedToken({ threadId, participantId, tenantId, bindingId, provider, expiresAt, secret }) {
    const id = crypto.randomUUID();
    const rawToken = deriveRawReplyToken(id, secret);
    const { data, error } = await this.supabase
      .from('email_reply_tokens')
      .insert({
        id,
        token_hash: hashReplyToken(rawToken),
        version: CURRENT_REPLY_TOKEN_VERSION,
        tenant_id: tenantId,
        thread_id: threadId,
        participant_id: participantId,
        binding_id: bindingId,
        provider,
        expires_at: expiresAt,
      })
      .select('id, thread_id, participant_id, tenant_id, expires_at')
      .single();
    if (error) throw new Error(`Failed to issue reply token: ${error.message}`);
    return { rawToken, address: buildReplyToAddress(rawToken, this.env), reused: false, record: data };
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
    // Tenant is never reassigned as a routing shortcut. Compared canonically so a platform-tenant
    // thread (NULL) and its token ('platform') are recognised as the one tenant they always were.
    if (canonicalTenantId(thread.tenant_id) !== canonicalTenantId(token.tenant_id)) {
      return { ok: false, reason: 'tenant_invariant_failed' };
    }

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
