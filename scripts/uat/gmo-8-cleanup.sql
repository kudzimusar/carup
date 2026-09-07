-- GMO-8 run-scoped fixture cleanup.
--
-- WHY THIS IS PARAMETERISED AND NOT A SWEEP
--
-- Two certification runs shared this lane and this staging database at the same time. A cleanup
-- written as `DELETE FROM public.users WHERE email LIKE 'gmo8.owner.%'` would have deleted the
-- other run's LIVE accounts mid-journey — its applications, its tenant, its membership — and the
-- other run would have reported a product failure that was really this cleanup.
--
-- So a run may delete only what carries ITS run id. The harness prints that id at startup and
-- writes it to report.json as `run_id`; every account it creates embeds it:
--
--     gmo8.owner.<run_id>@carup-uat.invalid
--     gmo8.mech.<run_id>@carup-uat.invalid
--     gmo8.cust.<run_id>@carup-uat.invalid
--
-- USAGE: replace :run_id with the run id. Never widen the pattern. Never drop the suffix.
-- The synthetic Operations reviewer is NOT matched by these patterns and must survive.
--
-- Storage objects are deliberately NOT addressed here: `storage.protect_delete()` refuses direct
-- deletion and weakening it to tidy test files is the worse trade. See
-- docs/garage-mechanic-onboarding/evidence/GMO_8_STORAGE_CLEANUP_DEBT.md.

BEGIN;

CREATE TEMP TABLE gmo8_run_users ON COMMIT DROP AS
SELECT id
FROM public.users
WHERE email IN (
  'gmo8.owner.' || :'run_id' || '@carup-uat.invalid',
  'gmo8.mech.'  || :'run_id' || '@carup-uat.invalid',
  'gmo8.cust.'  || :'run_id' || '@carup-uat.invalid'
);

-- Refuse to run against nothing: an empty match usually means a mistyped run id, and continuing
-- would report a successful cleanup that removed exactly zero of the rows it was asked to remove.
DO $$
BEGIN
  IF (SELECT count(*) FROM gmo8_run_users) = 0 THEN
    RAISE EXCEPTION 'No accounts match this run id — refusing to run a cleanup that owns nothing.';
  END IF;
END $$;

CREATE TEMP TABLE gmo8_run_tenants ON COMMIT DROP AS
SELECT DISTINCT a.activated_tenant_id AS id
FROM public.garage_applications a
WHERE a.applicant_user_id IN (SELECT id FROM gmo8_run_users)
  AND a.activated_tenant_id IS NOT NULL;

-- Service Network state produced by this run's garage, most dependent first.
DELETE FROM public.service_records        WHERE tenant_id IN (SELECT id FROM gmo8_run_tenants);
DELETE FROM public.work_order_assignments WHERE tenant_id IN (SELECT id FROM gmo8_run_tenants);
DELETE FROM public.service_work_orders    WHERE tenant_id IN (SELECT id FROM gmo8_run_tenants);
DELETE FROM public.service_cases          WHERE garage_tenant_id IN (SELECT id FROM gmo8_run_tenants);
DELETE FROM public.garage_public_profiles WHERE tenant_id IN (SELECT id FROM gmo8_run_tenants);
DELETE FROM public.garage_branches        WHERE tenant_id IN (SELECT id FROM gmo8_run_tenants);

-- Onboarding authority. tenant_users is named explicitly: it is the consequential membership table,
-- and it is scoped by THIS RUN'S tenant, never by role or by email pattern.
DELETE FROM public.garage_invitations WHERE tenant_id IN (SELECT id FROM gmo8_run_tenants);
DELETE FROM public.tenant_users       WHERE tenant_id IN (SELECT id FROM gmo8_run_tenants)
                                          OR user_id IN (SELECT id FROM gmo8_run_users);
DELETE FROM public.garage_application_decisions WHERE application_id IN
  (SELECT id FROM public.garage_applications WHERE applicant_user_id IN (SELECT id FROM gmo8_run_users));
DELETE FROM public.garage_application_documents WHERE application_id IN
  (SELECT id FROM public.garage_applications WHERE applicant_user_id IN (SELECT id FROM gmo8_run_users));
DELETE FROM public.garage_applications WHERE applicant_user_id IN (SELECT id FROM gmo8_run_users);
DELETE FROM public.tenants              WHERE id IN (SELECT id FROM gmo8_run_tenants);

-- Vehicles this run's customer created, and the identity/session trail.
DELETE FROM public.vehicle_ownership_history WHERE vin IN
  (SELECT vin FROM public.vehicles WHERE owner_id IN (SELECT id FROM gmo8_run_users));
DELETE FROM public.vehicles             WHERE owner_id IN (SELECT id FROM gmo8_run_users);

-- Identity evidence, in FK order. Once extraction actually ran against a live provider it began
-- producing `ocr_documents` rows (and their per-type children) that this cleanup did not know
-- about — the first live run failed on ocr_documents_user_id_fkey. `verification_sessions`
-- REFERENCES `ocr_documents`, so the session rows must go first or the delete is refused.
DELETE FROM public.verification_assessments    WHERE session_id IN
  (SELECT id FROM public.verification_sessions WHERE user_id IN (SELECT id FROM gmo8_run_users));
DELETE FROM public.verification_ocr_provenance WHERE session_id IN
  (SELECT id FROM public.verification_sessions WHERE user_id IN (SELECT id FROM gmo8_run_users));
DELETE FROM public.verification_sessions WHERE user_id IN (SELECT id FROM gmo8_run_users);
DELETE FROM public.ocr_national_ids       WHERE ocr_document_id IN
  (SELECT id FROM public.ocr_documents WHERE user_id IN (SELECT id FROM gmo8_run_users));
DELETE FROM public.ocr_registration_books WHERE ocr_document_id IN
  (SELECT id FROM public.ocr_documents WHERE user_id IN (SELECT id FROM gmo8_run_users));
DELETE FROM public.ocr_documents          WHERE user_id IN (SELECT id FROM gmo8_run_users);
DELETE FROM public.notification_queue    WHERE recipient_id IN (SELECT id FROM gmo8_run_users);
DELETE FROM public.user_sessions         WHERE user_id IN (SELECT id FROM gmo8_run_users);
DELETE FROM public.users                 WHERE id IN (SELECT id FROM gmo8_run_users);

COMMIT;
