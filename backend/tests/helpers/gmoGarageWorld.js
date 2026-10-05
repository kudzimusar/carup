/**
 * OC-5E — a real PostgreSQL (PGlite) world for garage onboarding (GMO-3..7), built ONLY from the
 * repository's own migrations:
 *
 *   createEvidenceHistoryDatabase()   users, tenants / tenant_users (002), user_sessions, trust_audit_events,
 *                                     ocr_documents (and the ledger chain they ride on)
 *   20261004160000                    OC-5A tenant-role catalogue (the roles a membership may carry)
 *   20260605042424                    verification_sessions (the identity lifecycle reads approvals from it)
 *   20261004170000 / 170100           O2-X3 identity lifecycle + session authentication assurance (step-up)
 *   20260918090000 / 100000 / 110000  OCR C3: garage applications, evidence, RLS
 *   GMO_MIGRATIONS                    the OC-5E migrations under test
 *
 * Identity approval in this world is a `verification_sessions` row with status 'verified' — test data
 * in a disposable database, exactly as the X3 suites seed it; never evidence about a real person.
 */
import { createEvidenceHistoryDatabase, supabaseOver, migrationUpSql } from './pgliteLedgerHarness.js';

export const GMO_PREREQUISITES = Object.freeze([
  '20261004160000_oc5a_tenant_users_role_catalogue.sql',
  '20260605042424_verification_sessions_phase7b.sql',
  '20261004170000_o2_x3_identity_lifecycle_events.sql',
  '20261004170100_o2_x3_user_sessions_authentication_assurance.sql',
  '20260918090000_ocr_c3_garage_applications.sql',
  '20260918100000_ocr_c3_garage_application_evidence.sql',
  '20260918110000_ocr_c3_garage_onboarding_rls.sql',
]);

/** The OC-5E migrations, in file (and phase) order. */
export const GMO_MIGRATIONS = Object.freeze([
  '20261004190000_gmo3_garage_application_decision.sql',
  '20261004190100_gmo4_garage_business_activation.sql',
]);

export async function createGmoDatabase({ gmo = GMO_MIGRATIONS } = {}) {
  const db = await createEvidenceHistoryDatabase();
  for (const file of [...GMO_PREREQUISITES, ...gmo]) {
    try {
      await db.exec(migrationUpSql(file));
    } catch (error) {
      throw new Error(`gmo world: ${file} did not apply: ${error.message}`);
    }
  }
  return db;
}

/** Point the shared supabase singleton (from AND rpc) at this database. Returns { client, restore }. */
export function installOver(supabase, db) {
  const client = supabaseOver(db);
  const saved = { from: supabase.from, rpc: supabase.rpc };
  supabase.from = (table) => client.from(table);
  supabase.rpc = (name, args) => client.rpc(name, args);
  return { client, restore: () => { supabase.from = saved.from; supabase.rpc = saved.rpc; } };
}

/** A person whose identity a governed review approved (the lifecycle derives it from this row). */
export async function seedApprovedIdentity(db, userId) {
  await db.query(
    `INSERT INTO verification_sessions (user_id, status, document_type, ocr_result, reviewed_at)
     VALUES ($1, 'verified', 'national_id', '{}'::jsonb, now())`,
    [userId],
  );
}

/** A submitted application with one live piece of evidence — what a reviewer receives. */
export async function seedSubmittedApplication(db, applicantUserId, { tradingName = 'Mbare Motors', status = 'submitted', evidence = true } = {}) {
  const { rows: [app] } = await db.query(
    `INSERT INTO garage_applications (applicant_user_id, status, trading_name, location_city, submitted_at, attestation_accepted_at)
     VALUES ($1, $2, $3, 'Harare', CASE WHEN $2 = 'draft' THEN NULL ELSE now() END, now()) RETURNING *`,
    [applicantUserId, status, tradingName],
  );
  if (evidence) {
    await db.query(
      `INSERT INTO garage_application_documents (application_id, evidence_type, file_ref, mime_type, size_bytes, uploaded_by_user_id)
       VALUES ($1, 'signage_photo', $2, 'image/jpeg', 2048, $3)`,
      [app.id, `garage-evidence/${app.id}/sign.jpg`, applicantUserId],
    );
  }
  return app;
}

export default { GMO_PREREQUISITES, GMO_MIGRATIONS, createGmoDatabase, installOver, seedApprovedIdentity, seedSubmittedApplication };
