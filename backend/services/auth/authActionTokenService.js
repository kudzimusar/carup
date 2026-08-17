import crypto from 'crypto';

/**
 * SA1C — secure auth action tokens for CarUp's own auth (password reset, email verification).
 *
 * CarUp authenticates against public.users / public.user_sessions; this service deliberately
 * issues NO session and creates no second user authority. It only proves "the holder of this
 * one-time secret is the owner of this mailbox, for this purpose".
 *
 * Security properties:
 *   - the raw token is generated with crypto.randomBytes and returned exactly once, to be placed
 *     in the outbound link; only its SHA-256 hash is persisted;
 *   - consumption is a single conditional UPDATE ... RETURNING, so it is atomic and replay-safe
 *     even under concurrent requests — the second caller matches zero rows;
 *   - tokens are purpose-bound and user-bound, so a reset token cannot satisfy a verification
 *     check (or vice versa);
 *   - lookup is by hash, so a leaked database read cannot be replayed as a bearer token.
 */

export const AUTH_TOKEN_PURPOSES = Object.freeze({
  PASSWORD_RESET: 'password_reset',
  EMAIL_VERIFICATION: 'email_verification',
  EMAIL_CHANGE: 'email_change',
  REAUTHENTICATION: 'reauthentication',
});

/** Short expiries: long enough to use from a mail client, short enough to limit exposure. */
export const AUTH_TOKEN_TTL_MINUTES = Object.freeze({
  password_reset: 60,
  email_verification: 60 * 24,
  email_change: 60,
  reauthentication: 10,
});

const TOKEN_BYTES = 32; // 256 bits of entropy -> 43-char base64url string

/** SHA-256 hex digest. The only form of a token that is ever persisted. */
export function hashAuthToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

/** Cryptographically secure, URL-safe raw token. Never logged, never stored. */
export function generateRawAuthToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Constant-time comparison of two token hashes.
 *
 * Redemption looks tokens up by hash (an indexed equality match), so this is belt-and-braces for
 * any caller that compares hashes directly rather than querying.
 */
export function timingSafeHashEquals(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export class AuthActionTokenService {
  constructor({ supabase, now = () => new Date() }) {
    this.supabase = supabase;
    this.now = now;
  }

  /**
   * Issue a token for a user+purpose.
   *
   * Any older live token for the same user+purpose is revoked first, so requesting a second
   * reset invalidates the first link rather than leaving several valid secrets in flight.
   *
   * @returns {{ rawToken: string, record: object }} rawToken is returned ONCE and must go only
   *          into the outbound message.
   */
  async issue({ userId, purpose, ttlMinutes, requestedIp = null, userAgent = null, metadata = {}, createdBy = null, source = 'api' }) {
    if (!userId) throw new Error('authActionToken.issue requires userId');
    if (!Object.values(AUTH_TOKEN_PURPOSES).includes(purpose)) {
      throw new Error(`authActionToken.issue: unsupported purpose '${purpose}'`);
    }

    await this.revokeLiveTokens({ userId, purpose });

    const rawToken = generateRawAuthToken();
    const minutes = ttlMinutes || AUTH_TOKEN_TTL_MINUTES[purpose] || 60;
    const expiresAt = new Date(this.now().getTime() + minutes * 60_000).toISOString();

    const { data, error } = await this.supabase
      .from('auth_action_tokens')
      .insert({
        user_id: userId,
        purpose,
        token_hash: hashAuthToken(rawToken),
        expires_at: expiresAt,
        requested_ip: requestedIp,
        user_agent: userAgent,
        metadata,
        created_by: createdBy,
        source,
      })
      .select('id, user_id, purpose, expires_at, created_at')
      .single();

    if (error) throw new Error(`Failed to issue auth action token: ${error.message}`);
    return { rawToken, record: data };
  }

  /**
   * Atomically consume a token.
   *
   * The conditional UPDATE is the whole security control: used_at/revoked_at/expiry are all
   * enforced in the same statement that marks the token used, so there is no read-then-write
   * window for a replay or a race to slip through.
   *
   * @returns {{ ok: true, token: object } | { ok: false, reason: string }} — reasons are for
   *          server-side audit only and must not be echoed to the caller verbatim.
   */
  async consume({ rawToken, purpose }) {
    if (!rawToken || typeof rawToken !== 'string') return { ok: false, reason: 'malformed_token' };
    if (!Object.values(AUTH_TOKEN_PURPOSES).includes(purpose)) return { ok: false, reason: 'unsupported_purpose' };

    const tokenHash = hashAuthToken(rawToken);
    const nowIso = this.now().toISOString();

    const { data, error } = await this.supabase
      .from('auth_action_tokens')
      .update({ used_at: nowIso })
      .eq('token_hash', tokenHash)
      .eq('purpose', purpose)
      .is('used_at', null)
      .is('revoked_at', null)
      .gt('expires_at', nowIso)
      .select('id, user_id, purpose, metadata, expires_at, created_at')
      .maybeSingle();

    if (error) return { ok: false, reason: `consume_failed:${error.message}` };
    if (!data) {
      // Distinguish "never existed" from "already used/expired/revoked" for audit only.
      const { data: existing } = await this.supabase
        .from('auth_action_tokens')
        .select('id, used_at, revoked_at, expires_at, purpose')
        .eq('token_hash', tokenHash)
        .maybeSingle();
      if (!existing) return { ok: false, reason: 'unknown_token' };
      if (existing.purpose !== purpose) return { ok: false, reason: 'wrong_purpose' };
      if (existing.revoked_at) return { ok: false, reason: 'revoked' };
      if (existing.used_at) return { ok: false, reason: 'already_used' };
      return { ok: false, reason: 'expired' };
    }

    return { ok: true, token: data };
  }

  /** Revoke every live token for a user+purpose (used when superseding or after a reset). */
  async revokeLiveTokens({ userId, purpose = null }) {
    const nowIso = this.now().toISOString();
    let query = this.supabase
      .from('auth_action_tokens')
      .update({ revoked_at: nowIso })
      .eq('user_id', userId)
      .is('used_at', null)
      .is('revoked_at', null);
    if (purpose) query = query.eq('purpose', purpose);
    const { error } = await query;
    if (error) throw new Error(`Failed to revoke auth action tokens: ${error.message}`);
  }
}

export function createAuthActionTokenService(deps) {
  return new AuthActionTokenService(deps);
}
