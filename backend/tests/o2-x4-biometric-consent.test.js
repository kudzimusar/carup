/**
 * O2-X4 — explicit biometric consent (PGlite behavioral) + the no-biometric-store law.
 *
 * Held here:
 *   · the consent ledger is append-only IN THE DATABASE, seq-ordered, RLS'd;
 *   · a grant is affirmative (consent:true), purpose-scoped, versioned (policy + exact
 *     consent-text version), audited; Terms/Privacy acceptance is never inferred;
 *   · withdrawal is a NEW row — it flips the current state and erases nothing;
 *   · the provider gate (requireActiveBiometricConsent) fails closed by name without an
 *     active grant covering the purpose;
 *   · consent is SELF-ONLY — a request body cannot aim it at another user;
 *   · and the repository-wide data-minimisation law: no biometric template/embedding store
 *     and no fingerprint fields/endpoints exist anywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const {
  getBiometricConsentStateForUser,
  grantBiometricConsent,
  withdrawBiometricConsent,
  requireActiveBiometricConsent,
} = await import('../services/identity/biometrics/biometricConsentService.js');
const { BIOMETRIC_CONSENT_TEXT_VERSION } = await import('../services/identity/biometrics/biometricProvider.js');

function up(path) {
  const raw = readFileSync(new URL(path, import.meta.url), 'utf8');
  const down = raw.indexOf('-- +migrate Down');
  return (down >= 0 ? raw.slice(0, down) : raw)
    .replace('-- +migrate Up', '')
    .replace(/CREATE EXTENSION IF NOT EXISTS "?pgcrypto"?;/g, '-- [harness] pgcrypto stubbed');
}

async function x4Db() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
    CREATE TABLE users (id text PRIMARY KEY, role text);
    INSERT INTO users(id,role) VALUES ('subject-1','owner'), ('subject-2','owner');
  `);
  await db.exec(up('../../database/migrations/20260903210000_identity_biometric_consents.sql'));
  await db.exec(up('../../database/migrations/20260603233640_governance_foundation_trust_audit_events.sql'));
  return db;
}

function adapter(db) {
  return {
    from(table) {
      const state = { filters: [], insert: null, patch: null };
      const chain = {
        select() { return chain; },
        eq(col, val) { state.filters.push([col, val]); return chain; },
        insert(row) { state.insert = row; return chain; },
        update(patch) { state.patch = patch; return chain; },
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
            // The audit ledger's *_ids array columns are text[]; every other array/object here
            // is jsonb (purposes, risk_flags, previous/new_value…).
            const isTextArray = (c) => c.endsWith('_ids');
            const vals = cols.map((c, i) => {
              const v = row[c];
              if (Array.isArray(v)) return isTextArray(c) ? `$${i + 1}::text[]` : `$${i + 1}::jsonb`;
              if (v !== null && typeof v === 'object') return `$${i + 1}::jsonb`;
              return `$${i + 1}`;
            });
            const params = cols.map((c) => {
              const v = row[c];
              if (Array.isArray(v)) return isTextArray(c) ? v : JSON.stringify(v);
              return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
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

const SUBJECT = Object.freeze({ id: 'subject-1', role: 'owner' });
const GRANT = Object.freeze({
  consent: true,
  consent_text_version: BIOMETRIC_CONSENT_TEXT_VERSION,
  purposes: ['face_document_match', 'liveness'],
});

test('X4: the consent ledger is append-only in the database', async () => {
  const db = await x4Db();
  await db.query(`
    INSERT INTO identity_biometric_consents (user_id, status, purposes, policy_version, consent_text_version, source, actor_kind, actor_user_id)
    VALUES ('subject-1','granted','["liveness"]'::jsonb,'v','t','test','user','subject-1')
  `);
  await assert.rejects(() => db.query("UPDATE identity_biometric_consents SET status='withdrawn'"), /append-only/);
  await assert.rejects(() => db.query('DELETE FROM identity_biometric_consents'), /append-only/);
  await db.close();
});

test('X4: grant is affirmative, purpose-scoped and versioned — nothing is inferred', async () => {
  const db = await x4Db();
  const client = adapter(db);

  await assert.rejects(
    () => grantBiometricConsent(client, SUBJECT, { ...GRANT, consent: undefined }),
    /explicitly/,
    'no pre-checked box, no inference from submit',
  );
  await assert.rejects(
    () => grantBiometricConsent(client, SUBJECT, { ...GRANT, consent_text_version: 'terms_of_service_v3' }),
    /current consent text/,
    'general Terms acceptance is not biometric consent',
  );
  await assert.rejects(
    () => grantBiometricConsent(client, SUBJECT, { ...GRANT, purposes: ['face_document_match', 'marketing'] }),
    /purposes/,
  );

  const granted = await grantBiometricConsent(client, SUBJECT, GRANT);
  assert.equal(granted.status, 'granted');
  assert.equal(granted.policy_version, 'biometric_consent.v1');
  assert.equal(granted.consent_text_version, BIOMETRIC_CONSENT_TEXT_VERSION);

  const state = await getBiometricConsentStateForUser(client, 'subject-1');
  assert.equal(state.active, true);

  const { rows: audits } = await db.query("SELECT * FROM trust_audit_events WHERE event_type='BIOMETRIC_CONSENT_GRANTED'");
  assert.equal(audits.length, 1, 'the grant is audited');
  await db.close();
});

test('X4: consent is SELF-ONLY — a body-supplied user id changes nothing about whose consent it is', async () => {
  const db = await x4Db();
  const client = adapter(db);
  const granted = await grantBiometricConsent(client, SUBJECT, { ...GRANT, user_id: 'subject-2', userId: 'subject-2' });
  assert.equal(granted.user_id, 'subject-1', 'the subject is the authenticated caller, never a payload field');
  const other = await getBiometricConsentStateForUser(client, 'subject-2');
  assert.equal(other.active, false);
  await db.close();
});

test('X4: withdrawal is a new row — it stops new processing and erases nothing', async () => {
  const db = await x4Db();
  const client = adapter(db);
  const granted = await grantBiometricConsent(client, SUBJECT, GRANT);
  await requireActiveBiometricConsent(client, 'subject-1'); // passes while granted

  const withdrawal = await withdrawBiometricConsent(client, SUBJECT, { reason: 'changed my mind' });
  assert.equal(withdrawal.status, 'withdrawn');
  assert.equal(withdrawal.supersedes_id, granted.id);

  await assert.rejects(
    () => requireActiveBiometricConsent(client, 'subject-1'),
    /BIOMETRIC_CONSENT_REQUIRED/,
    'withdrawn consent prevents NEW biometric processing',
  );

  const { rows } = await db.query("SELECT status FROM identity_biometric_consents WHERE user_id='subject-1' ORDER BY seq");
  assert.deepEqual(rows.map((r) => r.status), ['granted', 'withdrawn'], 'history is intact — nothing was erased');

  const { rows: audits } = await db.query("SELECT event_type FROM trust_audit_events ORDER BY created_at");
  assert.ok(audits.some((a) => a.event_type === 'BIOMETRIC_CONSENT_WITHDRAWN'));
  await db.close();
});

test('X4: the gate refuses a consent that does not cover the requested purpose', async () => {
  const db = await x4Db();
  const client = adapter(db);
  await grantBiometricConsent(client, SUBJECT, { ...GRANT, purposes: ['liveness'] });
  await assert.rejects(
    () => requireActiveBiometricConsent(client, 'subject-1', ['face_document_match']),
    /does not cover 'face_document_match'/,
  );
  await db.close();
});

// ---------------------------------------------------------------------------------------
// Data-minimisation law: no biometric template store, no fingerprints — anywhere.
// ---------------------------------------------------------------------------------------

test('X4: no biometric fingerprint store and no template/embedding store is introduced anywhere', () => {
  // Pre-existing NON-biometric uses of the word (device-telemetry column from 002, workspace
  // idempotency hashes, trust-presentation change fingerprints) are legacy naming, not
  // biometrics. The law pinned here is about INTRODUCTIONS: no expansion-era migration and no
  // identity-domain code may touch fingerprints at all, and nothing anywhere may build a
  // biometric fingerprint/template/embedding construct.
  const biometricFingerprint = /fingerprint[^\n]{0,40}(enroll|capture|template|biometric|scan)|biometric[^\n]{0,40}fingerprint|fingerprint_template/i;
  const templateStore = /face_embedding|facial_embedding|biometric_template|face_vector|face_encoding/i;

  const migrationsDir = new URL('../../database/migrations/', import.meta.url);
  for (const file of readdirSync(migrationsDir)) {
    const sql = readFileSync(new URL(file, migrationsDir), 'utf8');
    if (file >= '20260829') {
      // The blanket expansion-era rule was written when O2 owned every migration in this era.
      // Service Network now has some too, and `presentation_fingerprint` is the trust-presentation
      // change hash used as an event dedupe key — exactly the non-biometric use this test's own
      // comment above already excuses. Strip that construct before the blanket check so the rule
      // keeps meaning "no NEW biometric fingerprint storage" rather than "no occurrence of a
      // nine-letter word". The two targeted patterns below still apply to every file unchanged, so
      // the law itself is not weakened — only its collision with another domain's vocabulary.
      // Strip SQL comments and the trust-presentation dedupe identifiers only. Nothing here is
      // storage: `v_fingerprint` is a PL/pgSQL local holding `payload->>'presentation_fingerprint'`,
      // the trust-presentation change hash used to build a dedupe key.
      const withoutDedupeHash = sql
        .replace(/--[^\n]*/g, '')
        .replace(/presentation_fingerprint/g, '')
        .replace(/v_fingerprint/g, '');
      assert.doesNotMatch(withoutDedupeHash, /fingerprint/i, `${file} (expansion era) must not define fingerprint storage`);
    }
    assert.doesNotMatch(sql, biometricFingerprint, `${file} must not define biometric fingerprint storage`);
    assert.doesNotMatch(sql, templateStore, `${file} must not define a biometric template/embedding store`);
  }

  const files = [];
  const walk = (url) => {
    for (const entry of readdirSync(url, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.js')) files.push(child);
    }
  };
  walk(new URL('../services/', import.meta.url));
  walk(new URL('../routes/', import.meta.url));
  files.push(new URL('../server.js', import.meta.url));

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (file.pathname.includes('/services/identity/') || /identity[^/]*Routes/.test(file.pathname)) {
      assert.doesNotMatch(src, /fingerprint/i, `${file.pathname} (identity domain) must not touch fingerprints`);
    }
    assert.doesNotMatch(src, biometricFingerprint, `${file.pathname} must not implement biometric fingerprints`);
    assert.doesNotMatch(src, templateStore, `${file.pathname} must not persist biometric templates`);
  }
});
