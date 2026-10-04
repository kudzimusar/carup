/**
 * O2-X3 — CURRENT identity lifecycle over immutable 7C history (PGlite behavioral).
 *
 * The real migrations and the real service functions run against real PostgreSQL. Held here:
 *
 *   · the ledger is append-only IN THE DATABASE (update/delete raise);
 *   · the historical verification session is byte-identical before and after every lifecycle
 *     transition — the current state is layered, never rewritten;
 *   · the transition policy is total and fail-closed by name, verified/recovered are minted
 *     only by the governed approval hook, the subject can never act on their own lifecycle,
 *     an actor needs the capability on a proven session;
 *   · a REVOKED identity does not resurrect from an approval — the hook refuses, the ledger
 *     stays put;
 *   · COMPROMISED revokes every live session in the same governed action, audited without
 *     token material;
 *   · document expiry is an OBSERVATION (OC-5C): an OCR-read expiry is reported, never moves the
 *     state; no expiry → nothing fabricated.
 *
 * Ported by OC-5C from PR #208, with the defects the port fixed proven here too: a restriction is
 * lifted only by evidence submitted after it; a compromise revokes sessions before it is recorded (a
 * failed revocation records nothing and can be retried); the user FK is RESTRICT.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const {
  LIFECYCLE_STATES,
  LIFECYCLE_REASON_CODES,
  isLifecycleTransitionAllowed,
  getCurrentIdentityLifecycle,
  transitionIdentityLifecycle,
  onVerificationApproved,
} = await import('../services/identity/identityLifecycleService.js');

function up(path) {
  const raw = readFileSync(new URL(path, import.meta.url), 'utf8');
  const down = raw.indexOf('-- +migrate Down');
  return (down >= 0 ? raw.slice(0, down) : raw)
    .replace('-- +migrate Up', '')
    .replace(/CREATE EXTENSION IF NOT EXISTS "?pgcrypto"?;/g, '-- [harness] pgcrypto stubbed');
}

async function x3Db() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;

    CREATE TABLE users (id text PRIMARY KEY, role text);
    -- Minimal verification_sessions: exactly the columns the lifecycle derivation reads.
    CREATE TABLE verification_sessions (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id),
      status text NOT NULL,
      document_type text,
      ocr_result jsonb,
      reviewed_at timestamptz,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );

    INSERT INTO users(id,role) VALUES
      ('subject-1','owner'),
      ('subject-2','owner'),
      ('reviewer-1','admin'),
      ('gov-1','government');
  `);
  await db.exec(up('../../database/migrations/20260617120000_user_sessions_auth_contract_align.sql'));
  await db.exec(up('../../database/migrations/20261004170000_o2_x3_identity_lifecycle_events.sql'));
  await db.exec(up('../../database/migrations/20261004170100_o2_x3_user_sessions_authentication_assurance.sql'));
  await db.exec(up('../../database/migrations/20260603233640_governance_foundation_trust_audit_events.sql'));
  return db;
}

/** The transfer-test adapter pattern: supabase-shaped chain over PGlite. */
function adapter(db) {
  return {
    from(table) {
      const state = { filters: [], patch: null, insert: null };
      const chain = {
        select() { return chain; },
        eq(col, val) { state.filters.push([col, val]); return chain; },
        update(patch) { state.patch = patch; return chain; },
        insert(row) { state.insert = row; return chain; },
        async maybeSingle() { const r = await run(); return { data: r.data?.[0] ?? null, error: r.error }; },
        async single() {
          const r = await run();
          if (r.error) return { data: null, error: r.error };
          return r.data?.[0] ? { data: r.data[0], error: null } : { data: null, error: { message: 'Row not found' } };
        },
        then(resolve, reject) { run().then(resolve, reject); },
      };
      async function run() {
        try {
          if (state.insert) {
            const row = state.insert;
            const cols = Object.keys(row);
            const vals = cols.map((c, i) => {
              const v = row[c];
              if (v !== null && typeof v === 'object' && !Array.isArray(v)) return `$${i + 1}::jsonb`;
              return `$${i + 1}`;
            });
            const params = cols.map((c) => {
              const v = row[c];
              return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v;
            });
            const { rows } = await db.query(
              `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${vals.join(',')}) RETURNING *`,
              params,
            );
            return { data: rows, error: null };
          }
          const where = state.filters.length
            ? ` WHERE ${state.filters.map(([c], i) => `"${c}" = $${i + 1}`).join(' AND ')}`
            : '';
          const params = state.filters.map(([, v]) => v);
          if (state.patch) {
            const cols = Object.keys(state.patch);
            const set = cols.map((c, i) => `"${c}" = $${params.length + i + 1}`).join(', ');
            const { rows } = await db.query(`UPDATE ${table} SET ${set}${where} RETURNING *`, [...params, ...cols.map((c) => state.patch[c])]);
            return { data: rows, error: null };
          }
          const { rows } = await db.query(`SELECT * FROM ${table}${where}`, params);
          return { data: rows, error: null };
        } catch (error) {
          return { data: null, error: { message: error.message } };
        }
      }
      return chain;
    },
  };
}

const ADMIN = Object.freeze({ id: 'reviewer-1', platformRole: 'admin', baseRole: 'admin', role: 'admin', authenticationMethod: 'session' });

/** A verification session the subject submitted AFTER the latest lifecycle restriction. */
async function submitSessionAfterRestriction(db, id, userId) {
  await db.query(
    `INSERT INTO verification_sessions (id, user_id, status, document_type, ocr_result, created_at)
     VALUES ($1, $2, 'pending_review', 'national_id', '{}'::jsonb,
             (SELECT max(created_at) FROM identity_lifecycle_events WHERE user_id = $2) + interval '1 second')`,
    [id, userId],
  );
}

async function seedApproved(db, userId, { expiry } = {}) {
  const ocr = expiry === undefined
    ? { first_name: 'Tinashe', last_name: 'Moyo' }
    : { first_name: 'Tinashe', last_name: 'Moyo', additional_fields: { expiry } };
  await db.query(
    `INSERT INTO verification_sessions (id, user_id, status, document_type, ocr_result, reviewed_at)
     VALUES ($1,$2,'verified','national_id',$3::jsonb, now())`,
    [`vs-${userId}`, userId, JSON.stringify(ocr)],
  );
}

test('X3: the ledger is append-only in the database — UPDATE and DELETE raise', async () => {
  const db = await x3Db();
  await db.query(`
    INSERT INTO identity_lifecycle_events
      (user_id, previous_state, next_state, reason_code, trigger_source, actor_kind, actor_user_id, policy_version)
    VALUES ('subject-1','verified','suspended','SECURITY_REVIEW','reviewer_action','user','reviewer-1','identity_lifecycle.v1')
  `);
  await assert.rejects(() => db.query("UPDATE identity_lifecycle_events SET next_state='verified'"), /append-only/);
  await assert.rejects(() => db.query('DELETE FROM identity_lifecycle_events'), /append-only/);
  await db.close();
});

test('X3: derivation — historical approval alone is verified; nothing at all is not_established; an OCR-read expiry is an observation, never a state change', async () => {
  const db = await x3Db();
  const client = adapter(db);

  await seedApproved(db, 'subject-1'); // no expiry in evidence
  const noExpiry = await getCurrentIdentityLifecycle(client, 'subject-1');
  assert.equal(noExpiry.state, LIFECYCLE_STATES.VERIFIED);
  assert.equal(noExpiry.effective_state, LIFECYCLE_STATES.VERIFIED, 'no expiry in the evidence → nothing fabricated');
  assert.equal(noExpiry.capability_bearing, true);
  assert.equal(noExpiry.historically_approved, true);

  const none = await getCurrentIdentityLifecycle(client, 'subject-2');
  assert.equal(none.state, LIFECYCLE_STATES.NOT_ESTABLISHED);
  assert.equal(none.capability_bearing, false);

  await seedApproved(db, 'subject-2', { expiry: '2020-01-01' }); // an OCR-read, past expiry
  const expired = await getCurrentIdentityLifecycle(client, 'subject-2');
  assert.equal(expired.state, LIFECYCLE_STATES.VERIFIED, 'the ledger state is untouched');
  // OC-5C: OCR output that no reviewer confirmed observes; it does not decide.
  assert.equal(expired.effective_state, LIFECYCLE_STATES.VERIFIED);
  assert.equal(expired.derived_reason_code, null);
  assert.equal(expired.capability_bearing, true);
  assert.deepEqual(
    { recorded: expired.document_expiry.recorded, expired: expired.document_expiry.expired, source: expired.document_expiry.source,
      confirmed: expired.document_expiry.reviewer_confirmed, affects: expired.document_expiry.affects_state },
    { recorded: true, expired: true, source: 'ocr_observation', confirmed: false, affects: false },
  );
  assert.equal(LIFECYCLE_REASON_CODES.DOCUMENT_EXPIRED.code, 'DOCUMENT_EXPIRED', 'the vocabulary stays for a reviewer-confirmed expiry');
  const { rows: ledger } = await db.query("SELECT * FROM identity_lifecycle_events WHERE user_id='subject-2'");
  assert.equal(ledger.length, 0, 'the derived overlay writes no ledger rows');
  await db.close();
});

test('X3: a governed transition appends, audits, and leaves the historical 7C row byte-identical', async () => {
  const db = await x3Db();
  const client = adapter(db);
  await seedApproved(db, 'subject-1');
  const { rows: before } = await db.query("SELECT to_jsonb(v) AS row FROM verification_sessions v WHERE user_id='subject-1'");

  const result = await transitionIdentityLifecycle(client, ADMIN, {
    userId: 'subject-1',
    nextState: LIFECYCLE_STATES.REVERIFICATION_REQUIRED,
    reasonCode: 'MATERIAL_IDENTITY_CHANGE',
    note: 'Account holder name changed.',
  });
  assert.ok(result.event.id);

  const current = await getCurrentIdentityLifecycle(client, 'subject-1');
  assert.equal(current.state, LIFECYCLE_STATES.REVERIFICATION_REQUIRED);
  assert.equal(current.who_must_act, 'subject_action');

  const { rows: after } = await db.query("SELECT to_jsonb(v) AS row FROM verification_sessions v WHERE user_id='subject-1'");
  assert.deepEqual(after[0].row, before[0].row, 'historical proof is immutable');

  const { rows: events } = await db.query("SELECT * FROM identity_lifecycle_events WHERE user_id='subject-1'");
  assert.equal(events.length, 1);
  assert.equal(events[0].previous_state, LIFECYCLE_STATES.VERIFIED);
  assert.equal(events[0].actor_user_id, 'reviewer-1');
  assert.equal(events[0].policy_version, 'identity_lifecycle.v1');

  const { rows: audits } = await db.query("SELECT * FROM trust_audit_events WHERE event_type='IDENTITY_LIFECYCLE_TRANSITION'");
  assert.equal(audits.length, 1, 'every transition is audited');
  await db.close();
});

test('X3: refusals, each by name — invalid transition, self-action, missing capability, asserted identity, hand-minted verified', async () => {
  const db = await x3Db();
  const client = adapter(db);
  await seedApproved(db, 'subject-1');

  await assert.rejects(
    () => transitionIdentityLifecycle(client, ADMIN, { userId: 'subject-2', nextState: LIFECYCLE_STATES.SUSPENDED, reasonCode: 'SECURITY_REVIEW' }),
    /IDENTITY_LIFECYCLE_INVALID_TRANSITION: not_established → suspended/,
  );
  await assert.rejects(
    () => transitionIdentityLifecycle(client, { ...ADMIN, id: 'subject-1' }, { userId: 'subject-1', nextState: LIFECYCLE_STATES.SUSPENDED, reasonCode: 'SECURITY_REVIEW' }),
    /IDENTITY_LIFECYCLE_SELF_ACTION/,
  );
  await assert.rejects(
    () => transitionIdentityLifecycle(client, { id: 'subject-2', platformRole: 'owner', authenticationMethod: 'session' }, { userId: 'subject-1', nextState: LIFECYCLE_STATES.SUSPENDED, reasonCode: 'SECURITY_REVIEW' }),
    /operations\.identity\.lifecycle/,
  );
  await assert.rejects(
    () => transitionIdentityLifecycle(client, { ...ADMIN, authenticationMethod: 'x-user-id-fallback' }, { userId: 'subject-1', nextState: LIFECYCLE_STATES.SUSPENDED, reasonCode: 'SECURITY_REVIEW' }),
    /proven session/,
  );
  await assert.rejects(
    () => transitionIdentityLifecycle(client, ADMIN, { userId: 'subject-1', nextState: LIFECYCLE_STATES.VERIFIED, reasonCode: 'VERIFICATION_APPROVED' }),
    /minted only by a governed verification approval/,
  );
  await assert.rejects(
    () => transitionIdentityLifecycle(client, ADMIN, { userId: 'subject-1', nextState: LIFECYCLE_STATES.SUSPENDED, reasonCode: 'NOT_A_REASON' }),
    /Unknown identity lifecycle reason code/,
  );

  const { rows } = await db.query('SELECT count(*)::int AS n FROM identity_lifecycle_events');
  assert.equal(rows[0].n, 0, 'refused transitions append nothing');
  await db.close();
});

test('X3: policy table sanity — revoked accepts ONLY the governed step back into reverification', () => {
  assert.equal(isLifecycleTransitionAllowed('revoked', 'reverification_required'), true);
  for (const next of ['verified', 'recovered', 'suspended', 'compromised', 'disputed']) {
    assert.equal(isLifecycleTransitionAllowed('revoked', next), false, `revoked → ${next} must be refused`);
  }
});

test('X3: approvals mint verified/recovered — and a REVOKED identity does not resurrect', async () => {
  const db = await x3Db();
  const client = adapter(db);
  await seedApproved(db, 'subject-1');

  // reverification_required → verified via the governed approval hook, with evidence filed AFTER it.
  await transitionIdentityLifecycle(client, ADMIN, {
    userId: 'subject-1', nextState: LIFECYCLE_STATES.REVERIFICATION_REQUIRED, reasonCode: 'MATERIAL_IDENTITY_CHANGE',
  });
  await submitSessionAfterRestriction(db, 'vs-new-1', 'subject-1');
  const reverified = await onVerificationApproved(client, {
    userId: 'subject-1', sessionId: 'vs-new-1', reviewerId: 'reviewer-1', reviewerRole: 'admin',
  });
  assert.equal(reverified.state, LIFECYCLE_STATES.VERIFIED);
  assert.equal(reverified.event.reason_code, 'REVERIFICATION_APPROVED');

  // compromised → the approval lands as RECOVERED.
  await transitionIdentityLifecycle(client, ADMIN, {
    userId: 'subject-1', nextState: LIFECYCLE_STATES.COMPROMISED, reasonCode: 'SUSPECTED_ACCOUNT_TAKEOVER',
  });
  await submitSessionAfterRestriction(db, 'vs-new-2', 'subject-1');
  const recovered = await onVerificationApproved(client, {
    userId: 'subject-1', sessionId: 'vs-new-2', reviewerId: 'reviewer-1', reviewerRole: 'admin',
  });
  assert.equal(recovered.state, LIFECYCLE_STATES.RECOVERED);

  // revoked → the approval hook REFUSES; the ledger tail stays 'revoked'.
  await transitionIdentityLifecycle(client, ADMIN, {
    userId: 'subject-1', nextState: LIFECYCLE_STATES.REVOKED, reasonCode: 'GOVERNANCE_REVOCATION',
  });
  await assert.rejects(
    () => onVerificationApproved(client, { userId: 'subject-1', sessionId: 'vs-old', reviewerId: 'reviewer-1' }),
    /IDENTITY_LIFECYCLE_APPROVAL_REFUSED/,
  );
  const current = await getCurrentIdentityLifecycle(client, 'subject-1');
  assert.equal(current.state, LIFECYCLE_STATES.REVOKED, 'an old approval cannot resurrect a revoked identity');
  assert.equal(current.capability_bearing, false);
  await db.close();
});

test('X3: COMPROMISED revokes every live session in the same governed action, audited without token material', async () => {
  const db = await x3Db();
  const client = adapter(db);
  await seedApproved(db, 'subject-1');
  await db.query(`
    INSERT INTO user_sessions (id, user_id, token, is_valid, expires_at, created_at)
    VALUES ('sess-1','subject-1','tok-1',true,'2027-01-01T00:00:00.000Z','2026-09-01T00:00:00.000Z'),
           ('sess-2','subject-1','tok-2',true,'2027-01-01T00:00:00.000Z','2026-09-02T00:00:00.000Z'),
           ('sess-3','reviewer-1','tok-r',true,'2027-01-01T00:00:00.000Z','2026-09-01T00:00:00.000Z')
  `);

  const result = await transitionIdentityLifecycle(client, ADMIN, {
    userId: 'subject-1', nextState: LIFECYCLE_STATES.COMPROMISED, reasonCode: 'SUSPECTED_ACCOUNT_TAKEOVER',
  });
  assert.equal(result.revoked_sessions, 2);

  const { rows: subjectSessions } = await db.query("SELECT is_valid FROM user_sessions WHERE user_id='subject-1'");
  assert.deepEqual(subjectSessions.map((r) => r.is_valid), [false, false], 'no privileged old session survives');
  const { rows: reviewerSessions } = await db.query("SELECT is_valid FROM user_sessions WHERE user_id='reviewer-1'");
  assert.equal(reviewerSessions[0].is_valid, true, 'other accounts are untouched');

  const { rows: audits } = await db.query("SELECT to_jsonb(t) AS row FROM trust_audit_events t WHERE event_type='USER_SESSIONS_REVOKED'");
  assert.equal(audits.length, 1);
  const audit = JSON.stringify(audits[0].row);
  assert.match(audit, /sess-1/);
  assert.doesNotMatch(audit, /tok-1|tok-2/, 'audit never carries token material');
  await db.close();
});

// ── OC-5C: the defects the port fixed ──────────────────────────────────────────────────────────

test('OC-5C: a restriction is lifted only by evidence submitted AFTER it — an older pending session cannot undo a suspension', async () => {
  const db = await x3Db();
  const client = adapter(db);
  await seedApproved(db, 'subject-1');
  // A session the subject filed BEFORE the hold…
  await db.query(`INSERT INTO verification_sessions (id, user_id, status, document_type, ocr_result, created_at)
                   VALUES ('vs-before', 'subject-1', 'pending_review', 'national_id', '{}'::jsonb, now() - interval '1 day')`);
  await transitionIdentityLifecycle(client, ADMIN, { userId: 'subject-1', nextState: LIFECYCLE_STATES.SUSPENDED, reasonCode: 'SECURITY_REVIEW' });
  // …is approved later: the hold must stand.
  await assert.rejects(() => onVerificationApproved(client, { userId: 'subject-1', sessionId: 'vs-before', reviewerId: 'reviewer-1' }),
    /predates the 'suspended' restriction/);
  assert.equal((await getCurrentIdentityLifecycle(client, 'subject-1')).state, LIFECYCLE_STATES.SUSPENDED);
  // Someone else's session can never lift it either.
  await db.query(`INSERT INTO verification_sessions (id, user_id, status, document_type, ocr_result, created_at)
                   VALUES ('vs-other', 'subject-2', 'pending_review', 'national_id', '{}'::jsonb, now() + interval '1 day')`);
  await assert.rejects(() => onVerificationApproved(client, { userId: 'subject-1', sessionId: 'vs-other', reviewerId: 'reviewer-1' }),
    /belongs to someone else/);
  // Evidence filed after the hold lifts it.
  await submitSessionAfterRestriction(db, 'vs-after', 'subject-1');
  const lifted = await onVerificationApproved(client, { userId: 'subject-1', sessionId: 'vs-after', reviewerId: 'reviewer-1' });
  assert.equal(lifted.state, LIFECYCLE_STATES.VERIFIED);
  await db.close();
});

test('OC-5C: a compromise revokes sessions BEFORE it is recorded — a failed revocation records nothing, and the retry succeeds', async () => {
  const db = await x3Db();
  const client = adapter(db);
  await seedApproved(db, 'subject-1');
  await db.query(`INSERT INTO user_sessions (id, user_id, token, is_valid, expires_at, created_at)
                   VALUES ('sess-a','subject-1','tok-a',true,'2027-01-01T00:00:00.000Z','2026-09-01T00:00:00.000Z')`);
  // Revocation cannot write: the session table refuses updates for this attempt.
  await db.exec(`CREATE FUNCTION oc5c_refuse() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'session store unavailable'; END $f$;
                 CREATE TRIGGER oc5c_refuse BEFORE UPDATE ON user_sessions FOR EACH ROW EXECUTE FUNCTION oc5c_refuse();`);
  await assert.rejects(() => transitionIdentityLifecycle(client, ADMIN, {
    userId: 'subject-1', nextState: LIFECYCLE_STATES.COMPROMISED, reasonCode: 'SUSPECTED_ACCOUNT_TAKEOVER',
  }), /session store unavailable/);
  const { rows: none } = await db.query("SELECT count(*)::int AS n FROM identity_lifecycle_events WHERE user_id='subject-1'");
  assert.equal(none[0].n, 0, 'nothing recorded while sessions could not be revoked');
  await db.exec('DROP TRIGGER oc5c_refuse ON user_sessions');
  const retried = await transitionIdentityLifecycle(client, ADMIN, {
    userId: 'subject-1', nextState: LIFECYCLE_STATES.COMPROMISED, reasonCode: 'SUSPECTED_ACCOUNT_TAKEOVER',
  });
  assert.equal(retried.revoked_sessions, 1, 'the retry is not refused by the transition table');
  await db.close();
});

test('OC-5C migrations: append-only ledger whose user cannot be deleted (RESTRICT), no client grants; the assurance columns are additive; both re-run and roll back', async () => {
  const db = await x3Db();
  await db.query(`INSERT INTO identity_lifecycle_events (user_id, previous_state, next_state, reason_code, trigger_source, actor_kind, actor_user_id, policy_version)
                   VALUES ('subject-1','verified','suspended','SECURITY_REVIEW','reviewer_action','user','reviewer-1','identity_lifecycle.v1')`);
  await assert.rejects(() => db.query("DELETE FROM users WHERE id = 'subject-1'"), (e) => e.code === '23503', 'identity history is not erased by deleting the user');
  const { rows: grants } = await db.query(`SELECT has_table_privilege('anon', 'identity_lifecycle_events', 'SELECT') AS anon,
      has_table_privilege('authenticated', 'identity_lifecycle_events', 'INSERT') AS authed,
      (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'identity_lifecycle_events') AS forced`);
  assert.deepEqual({ ...grants[0] }, { anon: false, authed: false, forced: true });
  const { rows: cols } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'user_sessions'
      AND column_name IN ('auth_method', 'step_up_at', 'step_up_method') ORDER BY 1`);
  assert.deepEqual(cols.map((c) => c.column_name), ['auth_method', 'step_up_at', 'step_up_method']);
  for (const file of ['20261004170000_o2_x3_identity_lifecycle_events.sql', '20261004170100_o2_x3_user_sessions_authentication_assurance.sql']) {
    await db.exec(up(`../../database/migrations/${file}`)); // idempotent re-run
  }
  const sessionsDown = readFileSync(new URL('../../database/migrations/20261004170100_o2_x3_user_sessions_authentication_assurance.sql', import.meta.url), 'utf8').split('-- +migrate Down')[1];
  await db.exec(sessionsDown);
  const { rows: gone } = await db.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'user_sessions' AND column_name = 'step_up_at'`);
  assert.equal(gone[0].n, 0);
  await db.close();
});

