import { createHash } from 'node:crypto';

/**
 * The O2-X4 fingerprint guard (PAY-05-R1; Moderator directive on issue #255).
 *
 * "Fingerprint" appears in a few SQL files with meanings that have nothing to do with biometrics. A word-level exclusion cannot tell
 * those from a prohibited column of the same name, and neither can a rule about single lines: the independent O2 reviews moved reviewed
 * lines to build a real column, and hid SQL behind a line that only looks like a comment. So nothing here parses SQL, and no spelling,
 * comment or name is exempt. A file that names a fingerprint anywhere is allowed only if it is on this closed list, byte for byte.
 *
 * Adding or changing an entry is a deliberate review: read every mention, and say what it means. This guards biometric storage.
 * It does not describe biometric architecture, which it leaves alone.
 */
export const REVIEWED_FINGERPRINT_FILES = Object.freeze({
  'database/migrations/002_multi_tenant_and_auth_schema.sql': Object.freeze({ sha256: '6de3590a9a97396f4975ccad2abf2f907752fe77c82075e2745ae75351710dc4', meaning: 'A trusted device identifier, not a body measurement.' }),
  'database/migrations/20260817090000_issue164_phase0_flagged_table_containment.sql': Object.freeze({ sha256: 'b30adeeda3add2d5886fb362e57acda761b3bd7d1e0d1ec9fbdb106010b9de4b', meaning: 'Comments naming that device identifier.' }),
  'database/migrations/20260826120000_email_1_0_hardening.sql': Object.freeze({ sha256: 'bf8c1cbfbec807cc2839720416521e584964457c1264bfd9ae9fa20d4ff680e0', meaning: "Trust's presentation hash, used to announce a change once, and work_fingerprint, a concurrency token computed in SQL over trust columns." }),
  'database/migrations/20260828120000_intelligence_recommendations.sql': Object.freeze({ sha256: 'a6c8dc2acc029b8bf0ed75c4fa40d6e8774d36904380b99598a2dbb174c5ce13', meaning: 'A hash of the evidence behind a recommendation.' }),
  'database/migrations/20261004180600_service_network_o4_event_dedupe.sql': Object.freeze({ sha256: '1a63283d48d0dc972cee4a54ab02e4b9c794d9e0aba35fd92407a321f650e962', meaning: "Reads Trust's presentation hash to deduplicate events." }),
  'database/migrations/20261024140000_garage_communications_events_and_template.sql': Object.freeze({ sha256: '13110aa284a62e281e2f4e20e4069738e501c58030e359a8a93d4a18f2430847', meaning: "Reads Trust's presentation hash to deduplicate events." }),
  'database/migrations/20261102110000_carup_pay04_garage_provider_payments.sql': Object.freeze({ sha256: '95b9ae12bd7c5da17bfdcc72807c607b29b9ca2e16689857885c655a132b2848', meaning: 'One comment: a function body certified by comparison.' }),
  'database/migrations/20261103100000_carup_pay05_zimbabwe_paynow_collections.sql': Object.freeze({ sha256: '75b16ae8097e6ddfc1a0b113b1ad8b68ba5336952b63f62137c45836576389a4', meaning: 'The approved node below: a 16-hex digest of a Paynow key.' }),
  'database/migrations/20261104100000_carup_pay05_r1_financial_integrity.sql': Object.freeze({ sha256: '580219a965dad4b0a565281ac25a5b6d27ccd03eac8a6459cbfa2212e8b7f806', meaning: 'Writes, compares and audits that digest, and declares nothing.' }),
});

/** The one approved schema node: the reviewed files hold exactly this declaration of a fingerprint for a Paynow key, on this table, once. */
export const APPROVED_KEY_DIGEST = Object.freeze({
  file: 'database/migrations/20261103100000_carup_pay05_zimbabwe_paynow_collections.sql',
  table: 'public.pay05_merchant_integrations',
  declaration: "credential_fingerprint text NOT NULL CHECK (credential_fingerprint ~ '^[0-9a-f]{16}$')",
});
/** What the two files touching that column say about it, so that a re-pin of either cannot quietly add to it. */
export const KEY_DIGEST_REVIEWED_LINES = Object.freeze({
  [APPROVED_KEY_DIGEST.file]: Object.freeze([
    `${APPROVED_KEY_DIGEST.declaration},`,
    'OR NEW.credential_fingerprint IS DISTINCT FROM OLD.credential_fingerprint',
    "'credential_fingerprint', p_row.credential_fingerprint, 'status', p_row.status, 'registered_by', p_row.registered_by,",
    'credential_tag, credential_key_version, credential_fingerprint, status, registered_by, registered_role)',
    "v_item->>'tag', (v_item->>'key_version')::smallint, v_item->>'fingerprint', 'pending_verification', trim(p_actor_id),",
    "'methods', to_jsonb(v_int.methods), 'credential_fingerprint', v_int.credential_fingerprint));",
    "OR coalesce(p_evidence->'credential_probes'->v_int.id::text->>'credential_fingerprint', '') <> v_int.credential_fingerprint THEN",
  ]),
  'database/migrations/20261104100000_carup_pay05_r1_financial_integrity.sql': Object.freeze([
    'OR NEW.credential_fingerprint IS DISTINCT FROM OLD.credential_fingerprint',
    "OR coalesce(v_item->'probe'->>'credential_fingerprint', '') <> coalesce(v_item->>'fingerprint', '')",
    'credential_tag, credential_key_version, credential_fingerprint, status, registered_by, registered_role, test_auth_email)',
    "v_item->>'tag', (v_item->>'key_version')::smallint, v_item->>'fingerprint', 'pending_verification', trim(p_actor_id),",
    "'methods', to_jsonb(v_int.methods), 'credential_fingerprint', v_int.credential_fingerprint));",
    "OR coalesce(p_evidence->'credential_probes'->v_int.id::text->>'credential_fingerprint', '') <> v_int.credential_fingerprint THEN",
  ]),
});

/** The two biometric patterns, run on every SQL file whether or not it is reviewed. */
export const BIOMETRIC_FINGERPRINT = /fingerprint[^\n]{0,40}(enroll|capture|template|biometric|scan)|biometric[^\n]{0,40}fingerprint|fingerprint_template/i;
export const BIOMETRIC_TEMPLATE_STORE = /face_embedding|facial_embedding|biometric_template|face_vector|face_encoding/i;

const normalize = (line) => line.replace(/\s+/g, ' ').trim();

/** Every line naming a fingerprint, whatever surrounds it, whitespace-normalized. */
export const fingerprintMentions = (sql) => String(sql).split('\n').filter((line) => /fingerprint/i.test(line)).map(normalize);

// A Unicode-escaped name reads as the column to PostgreSQL and as nothing here, and no file under database/ needs one.
const unicodeEscapes = (sql) => String(sql).split('\n').filter((line) => /\bu&["']/i.test(line)).map(normalize);

const WHAT_TO_DO = 'if this is not biometric, list the file in REVIEWED_FINGERPRINT_FILES in backend/tests/helpers/o2FingerprintGuard.mjs, with its meaning, after O2 review';

/** Why this file breaks the rule, or an empty list. `repoPath` is its path from the repository root; `contents` is a string or Buffer. */
export function fingerprintViolations(contents, repoPath) {
  const reviewed = Object.hasOwn(REVIEWED_FINGERPRINT_FILES, repoPath) ? REVIEWED_FINGERPRINT_FILES[repoPath] : null;
  if (reviewed && createHash('sha256').update(contents).digest('hex') === reviewed.sha256) return [];
  const violations = reviewed ? ['this reviewed file changed: after O2 review, update its sha256 in backend/tests/helpers/o2FingerprintGuard.mjs, and KEY_DIGEST_REVIEWED_LINES if it touches the Paynow key digest'] : [];
  for (const line of fingerprintMentions(contents)) violations.push(`a mention of fingerprint outside the reviewed files: ${line.slice(0, 160)} (${WHAT_TO_DO})`);
  for (const line of unicodeEscapes(contents)) violations.push(`a U& name or string, which this guard cannot read and is not needed under database/: write it plainly: ${line.slice(0, 160)}`);
  return violations;
}
