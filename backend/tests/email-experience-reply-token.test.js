import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  CURRENT_REPLY_TOKEN_VERSION,
  EmailReplyTokenService,
  REPLY_TOKEN_SECRET_ENV,
  REPLY_TOKEN_VERSIONS,
  buildReplyToAddress,
  canonicalTenantId,
  deriveRawReplyToken,
  generateRawReplyToken,
  hashReplyToken,
  parseReplyToAddress,
} from '../services/communication/emailReplyTokenService.js';

/**
 * G5 — the authenticated conversation Reply-To credential.
 *
 * THE DEFECT THIS CLOSES. `issue()` documented itself as reusing a live token, and could not:
 * only a SHA-256 hash was stored, so a live row's raw value was unrecoverable by construction. So
 * it minted a NEW token and REVOKED the old one. Wired as-is, sending a second message in a thread
 * would have permanently unrouted every reply to the first — the customer clicks reply on last
 * week's Email and their answer vanishes.
 *
 * v2 fixes it without weakening anything at rest: the raw token is DERIVED from the row id via
 * HMAC with a dedicated secret, so the trusted server can reproduce it while the database still
 * holds only a hash. A database read on its own is still not a replayable credential.
 */

const SECRET = 'g5-test-derivation-secret-not-a-real-one';
const OTHER_SECRET = 'g5-rotated-derivation-secret';
const ENV = { [REPLY_TOKEN_SECRET_ENV]: SECRET };

/** A writable in-memory stand-in for the PostgREST surface the service uses. */
function memorySupabase(tables = {}) {
  const store = { email_reply_tokens: [], message_participants: [], message_threads: [], conversation_channel_bindings: [], ...tables };
  const clone = (row) => JSON.parse(JSON.stringify(row));

  function builder(table) {
    const rows = store[table] || (store[table] = []);
    const filters = [];
    const orders = [];
    let mode = 'select';
    let payload = null;

    const run = () => {
      let matched = rows.filter((row) => filters.every((f) => f(row)));
      for (const { column, ascending } of [...orders].reverse()) {
        matched = matched.slice().sort((a, b) => {
          const av = a[column]; const bv = b[column];
          if (av === bv) return 0;
          return (av > bv ? 1 : -1) * (ascending ? 1 : -1);
        });
      }
      if (mode === 'update') {
        matched.forEach((row) => Object.assign(row, payload));
      }
      return matched.map(clone);
    };

    const api = {
      select: () => api,
      eq: (c, v) => { filters.push((r) => r[c] === v); return api; },
      is: (c) => { filters.push((r) => r[c] === null || r[c] === undefined); return api; },
      gt: (c, v) => { filters.push((r) => new Date(r[c]) > new Date(v)); return api; },
      in: (c, vs) => { filters.push((r) => vs.includes(r[c])); return api; },
      order: (column, opts = {}) => { orders.push({ column, ascending: opts.ascending !== false }); return api; },
      insert: (row) => {
        mode = 'insert';
        const created = { revoked_at: null, use_count: 0, last_used_at: null, binding_id: null, rotated_from: null, created_at: new Date().toISOString(), ...row };
        if (rows.some((r) => r.token_hash === created.token_hash)) {
          return { select: () => ({ single: async () => ({ data: null, error: { message: 'duplicate token_hash' } }) }) };
        }
        rows.push(created);
        return { select: () => ({ single: async () => ({ data: clone(created), error: null }) }) };
      },
      update: (patch) => { mode = 'update'; payload = patch; return api; },
      maybeSingle: async () => ({ data: run()[0] || null, error: null }),
      single: async () => ({ data: run()[0] || null, error: null }),
      then: (res, rej) => Promise.resolve({ data: run(), error: null }).then(res, rej),
    };
    return api;
  }

  return { store, from: (table) => builder(table) };
}

function serviceFor(db, { env = ENV, now = () => new Date() } = {}) {
  return new EmailReplyTokenService({ supabase: db, env, now });
}

const PAIR = { threadId: 'thread-1', participantId: 'part-1', tenantId: 'platform', bindingId: 'bind-1' };

// ============================================================================
// T1–T4. FORMAT AND AT-REST STORAGE
// ============================================================================

test('T1 the address is conversation+<base64url>@mail.carup.dev and the local part fits in 64 octets', async () => {
  const db = memorySupabase();
  const { address, rawToken } = await serviceFor(db).issue(PAIR);

  assert.match(address, /^conversation\+[A-Za-z0-9_-]{22}@mail\.carup\.dev$/);
  const localPart = address.split('@')[0];
  assert.ok(Buffer.byteLength(localPart, 'utf8') <= 64, `local part is ${Buffer.byteLength(localPart)} octets`);
  assert.equal(rawToken.length, 22, '16 bytes of HMAC output, base64url');
});

test('T2 base64url case survives the round trip through the address', async () => {
  const db = memorySupabase();
  const { address, rawToken } = await serviceFor(db).issue(PAIR);
  const parsed = parseReplyToAddress(`CarUp <${address}>`);
  assert.equal(parsed, rawToken, 'lower-casing an address would silently corrupt every mixed-case token');
  assert.equal(hashReplyToken(parsed), hashReplyToken(rawToken));
});

test('T3 the database stores ONLY the hash', async () => {
  const db = memorySupabase();
  const { rawToken } = await serviceFor(db).issue(PAIR);
  const [row] = db.store.email_reply_tokens;

  assert.equal(row.token_hash, hashReplyToken(rawToken));
  assert.equal(row.token_hash.length, 64);
  assert.equal(row.version, CURRENT_REPLY_TOKEN_VERSION);
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes(rawToken), 'the raw token must never be stored');
  assert.ok(!serialized.includes(SECRET), 'nor the derivation secret');
});

test('T4 a database read alone cannot reproduce the credential', () => {
  // The row id is not secret. Without the derivation secret it derives nothing usable, which is why
  // reuse is possible for the trusted server and only for the trusted server.
  const id = crypto.randomUUID();
  const real = deriveRawReplyToken(id, SECRET);
  const guessed = deriveRawReplyToken(id, OTHER_SECRET);
  assert.notEqual(real, guessed);
  assert.notEqual(hashReplyToken(guessed), hashReplyToken(real));
});

// ============================================================================
// T5–T6. STABLE REUSE — the defect this closes
// ============================================================================

test('T5 three issues for the same pair return the SAME address', async () => {
  const db = memorySupabase();
  const service = serviceFor(db);

  const first = await service.issue(PAIR);
  const second = await service.issue(PAIR);
  const third = await service.issue(PAIR);

  assert.equal(second.address, first.address);
  assert.equal(third.address, first.address);
  assert.equal(second.reused, true);
  assert.equal(third.reused, true);
  assert.equal(db.store.email_reply_tokens.length, 1, 'one credential, not one per outbound message');
});

test('T6 a later issue does NOT revoke the credential in an already-delivered Email', async () => {
  // THE DEFECT. The previous implementation revoked the live token on every issue, so replying to
  // an older Email in the same thread became permanently impossible.
  const db = memorySupabase();
  const service = serviceFor(db);

  const emailA = await service.issue(PAIR);
  await service.issue(PAIR); // Email B, same thread and participant

  const rows = db.store.email_reply_tokens;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].revoked_at, null, 'nothing that has been posted to a human may be revoked behind their back');
  assert.equal(hashReplyToken(emailA.rawToken), rows[0].token_hash, "Email A's address is still the live credential");
});

test('T6b reuse refreshes the expiry window without changing the address', async () => {
  const db = memorySupabase();
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const service = serviceFor(db, { now: () => clock });

  const first = await service.issue(PAIR);
  const firstExpiry = db.store.email_reply_tokens[0].expires_at;

  clock = new Date('2026-02-01T00:00:00.000Z');
  const second = await service.issue(PAIR);

  assert.equal(second.address, first.address);
  assert.ok(new Date(db.store.email_reply_tokens[0].expires_at) > new Date(firstExpiry), 'an active conversation does not expire mid-flight');
});

test('T6c a binding learned later is attached without moving thread or participant authority', async () => {
  const db = memorySupabase();
  const service = serviceFor(db);
  await service.issue({ ...PAIR, bindingId: null });
  await service.issue({ ...PAIR, bindingId: 'bind-late' });

  const [row] = db.store.email_reply_tokens;
  assert.equal(row.binding_id, 'bind-late');
  assert.equal(row.thread_id, PAIR.threadId);
  assert.equal(row.participant_id, PAIR.participantId);
});

// ============================================================================
// T7–T9. REVOCATION AND EXPIRY
// ============================================================================

test('T7 a revoked token refuses, and T8 the next issue returns a DIFFERENT address', async () => {
  const db = memorySupabase({
    message_participants: [{ id: 'part-1', thread_id: 'thread-1', left_at: null, user_id: 'u1' }],
    message_threads: [{ id: 'thread-1', tenant_id: 'platform' }],
  });
  const service = serviceFor(db);

  const first = await service.issue(PAIR);
  assert.equal((await service.resolve(first.rawToken)).ok, true);

  await service.revokeForThread('thread-1');
  const afterRevoke = await service.resolve(first.rawToken);
  assert.equal(afterRevoke.ok, false);
  assert.equal(afterRevoke.reason, 'revoked_token');

  const second = await service.issue(PAIR);
  assert.notEqual(second.address, first.address, 'a revoked credential is never silently resurrected');
  assert.equal((await service.resolve(second.rawToken)).ok, true);
  assert.equal((await service.resolve(first.rawToken)).reason, 'revoked_token', 'and the old one stays revoked');
});

test('T9 an expired token refuses and history is not rewritten to make it valid', async () => {
  const db = memorySupabase({
    message_participants: [{ id: 'part-1', thread_id: 'thread-1', left_at: null, user_id: 'u1' }],
    message_threads: [{ id: 'thread-1', tenant_id: 'platform' }],
  });
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const service = serviceFor(db, { now: () => clock });

  const first = await service.issue(PAIR);
  clock = new Date('2026-06-01T00:00:00.000Z'); // past the 90-day window

  const resolved = await service.resolve(first.rawToken);
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, 'expired_token');

  const second = await service.issue(PAIR);
  assert.notEqual(second.address, first.address);
  assert.equal((await service.resolve(first.rawToken)).reason, 'expired_token', 'still expired, not retroactively revived');
});

// ============================================================================
// T10. LEGACY v1
// ============================================================================

test('T10 a live v1 token stays resolvable and is never revoked by a v2 issue', async () => {
  const legacyRaw = generateRawReplyToken();
  const db = memorySupabase({
    email_reply_tokens: [{
      id: 'legacy-1', token_hash: hashReplyToken(legacyRaw), version: REPLY_TOKEN_VERSIONS.RANDOM,
      tenant_id: 'platform', thread_id: 'thread-1', participant_id: 'part-1', binding_id: null,
      expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), revoked_at: null, use_count: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    }],
    message_participants: [{ id: 'part-1', thread_id: 'thread-1', left_at: null, user_id: 'u1' }],
    message_threads: [{ id: 'thread-1', tenant_id: 'platform' }],
  });
  const service = serviceFor(db);

  assert.equal((await service.resolve(legacyRaw)).ok, true, 'precondition: the v1 credential works');

  const v2 = await service.issue(PAIR);
  assert.notEqual(hashReplyToken(v2.rawToken), hashReplyToken(legacyRaw));

  const legacyRow = db.store.email_reply_tokens.find((r) => r.id === 'legacy-1');
  assert.equal(legacyRow.revoked_at, null, 'Email already delivered with a v1 token must keep routing');
  assert.equal((await service.resolve(legacyRaw)).ok, true);
  assert.equal((await service.resolve(v2.rawToken)).ok, true, 'both resolve — the resolver looks up by hash, not by version');
});

// ============================================================================
// T11. SECRET ROTATION
// ============================================================================

test('T11 after secret rotation the old credential still routes and no wrong token is ever sent', async () => {
  const db = memorySupabase({
    message_participants: [{ id: 'part-1', thread_id: 'thread-1', left_at: null, user_id: 'u1' }],
    message_threads: [{ id: 'thread-1', tenant_id: 'platform' }],
  });

  const before = await serviceFor(db, { env: { [REPLY_TOKEN_SECRET_ENV]: SECRET } }).issue(PAIR);
  const rotated = serviceFor(db, { env: { [REPLY_TOKEN_SECRET_ENV]: OTHER_SECRET } });
  const after = await rotated.issue(PAIR);

  // A row it cannot reproduce is skipped for reuse, NEVER sent as a mismatching derived token.
  assert.notEqual(after.address, before.address);
  assert.equal(hashReplyToken(after.rawToken), db.store.email_reply_tokens.find((r) => r.id === after.record.id).token_hash,
    'whatever is sent, its hash is the stored hash — an address the resolver cannot find is worse than a new one');

  // And the pre-rotation credential is NOT revoked: that Email is already in someone's inbox.
  const oldRow = db.store.email_reply_tokens.find((r) => r.id === before.record.id);
  assert.equal(oldRow.revoked_at, null, 'rotating the secret must not unroute delivered Email');
  assert.equal((await rotated.resolve(before.rawToken)).ok, true, 'and it still resolves, because resolution is by hash');
});

test('T11b a missing secret is a distinct, explicit configuration failure', async () => {
  const db = memorySupabase();
  await assert.rejects(
    () => serviceFor(db, { env: {} }).issue(PAIR),
    (error) => {
      assert.equal(error.code, 'reply_token_secret_missing');
      assert.match(error.message, new RegExp(REPLY_TOKEN_SECRET_ENV));
      return true;
    },
  );
  assert.equal(db.store.email_reply_tokens.length, 0, 'and nothing is written');
});

// ============================================================================
// T12. CONCURRENCY
// ============================================================================

test('T12 concurrent first issuance converges on ONE live credential and one address', async () => {
  // What this proves, precisely: within one process, interleaved issues converge on ONE address and
  // ONE live credential.
  //
  // What it does NOT prove, and must not be read as proving: that two SEPARATE workers can never
  // both end up with a live row. Under Postgres READ COMMITTED neither transaction sees the other's
  // uncommitted insert, so the reconcile below cannot see a sibling that has not committed. A
  // genuine cross-process race can therefore leave two live credentials for the pair.
  //
  // That outcome is acceptable and is why no migration was added. Both credentials resolve to the
  // SAME thread and the SAME participant, so neither misroutes and nobody is stranded; reuse then
  // deterministically converges on the earliest. The alternative — a partial unique index on
  // (thread_id, participant_id, version) WHERE revoked_at IS NULL — cannot express liveness at all
  // (an index predicate must be IMMUTABLE and `expires_at > now()` is not), so an expired-but-
  // unrevoked row would occupy the slot and start REFUSING legitimate issues. Trading a harmless
  // duplicate for a dead-lettered conversation is the wrong trade.
  const db = memorySupabase();
  const service = serviceFor(db);

  const [a, b, c] = await Promise.all([service.issue(PAIR), service.issue(PAIR), service.issue(PAIR)]);
  assert.equal(a.address, b.address);
  assert.equal(b.address, c.address);

  // The race really happened: all three read an empty table before any of them inserted.
  assert.equal(db.store.email_reply_tokens.length, 3, 'three concurrent inserts — the reconcile is genuinely exercised');
  const live = db.store.email_reply_tokens.filter((r) => !r.revoked_at);
  assert.equal(live.length, 1, 'exactly one live credential survives reconciliation');
  assert.equal(hashReplyToken(a.rawToken), live[0].token_hash);

  // The retired rows were never sent to anyone, so retiring them stranded nobody.
  const retired = db.store.email_reply_tokens.filter((r) => r.revoked_at);
  assert.equal(retired.length, 2);
  assert.ok(retired.every((r) => r.rotated_from === live[0].id), 'each retirement points at the winner');

  const later = await service.issue(PAIR);
  assert.equal(later.address, a.address, 'and it stays stable afterwards');
});

test('T12b a different participant on the same thread gets a DIFFERENT credential', async () => {
  const db = memorySupabase();
  const service = serviceFor(db);
  const one = await service.issue(PAIR);
  const two = await service.issue({ ...PAIR, participantId: 'part-2' });

  assert.notEqual(one.address, two.address, 'a credential is never silently rebound across participants');
  assert.equal(db.store.email_reply_tokens.length, 2);
});

// ============================================================================
// TENANT CANONICALISATION
// ============================================================================

test('a platform-tenant thread (NULL tenant) can be issued and resolved', async () => {
  // `message_threads.tenant_id` is nullable and NULL genuinely means the platform tenant, while
  // `email_reply_tokens.tenant_id` is NOT NULL. Without a canonical form the token would reject its
  // own credential as a tenant violation and every reply to a platform conversation would be lost.
  assert.equal(canonicalTenantId(null), 'platform');
  assert.equal(canonicalTenantId('  '), 'platform');
  assert.equal(canonicalTenantId('acme'), 'acme');

  const db = memorySupabase({
    message_participants: [{ id: 'part-1', thread_id: 'thread-1', left_at: null, user_id: 'u1' }],
    message_threads: [{ id: 'thread-1', tenant_id: null }],
  });
  const service = serviceFor(db);
  const issued = await service.issue({ threadId: 'thread-1', participantId: 'part-1', tenantId: null });

  assert.equal(db.store.email_reply_tokens[0].tenant_id, 'platform', 'the NOT NULL column gets the canonical value');
  assert.equal((await service.resolve(issued.rawToken)).ok, true);
});

test('a token is still never routed against a DIFFERENT tenant', async () => {
  const db = memorySupabase({
    message_participants: [{ id: 'part-1', thread_id: 'thread-1', left_at: null, user_id: 'u1' }],
    message_threads: [{ id: 'thread-1', tenant_id: 'acme' }],
  });
  const service = serviceFor(db);
  const issued = await service.issue({ threadId: 'thread-1', participantId: 'part-1', tenantId: 'acme' });
  assert.equal((await service.resolve(issued.rawToken)).ok, true);

  db.store.message_threads[0].tenant_id = 'other-tenant';
  const resolved = await service.resolve(issued.rawToken);
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, 'tenant_invariant_failed', 'canonicalising NULL must not loosen anything else');
});

test('the address domain follows the configured inbound domain', () => {
  assert.match(buildReplyToAddress('abc', { RESEND_INBOUND_DOMAIN: 'mail.example.test' }), /@mail\.example\.test$/);
  assert.match(buildReplyToAddress('abc', {}), /@mail\.carup\.dev$/);
});
