-- +migrate Up
SET lock_timeout = '3s';
-- CARUP-DEALER-ONB-001-LR01-R6 round 2: independent security review of candidate b2da0a74 (FAIL).
--   #1 takedown laundering   — re-prelisting needs a reviewer different from EVERY takedown-class
--                               event since the last public prelisting (WITHHELD included once public);
--                               any non-public decision after a storefront approval needs a new review.
--   #7 COI gaps              — duplicate redirects + grouping reviews check BOTH seeds; buyer-case
--                               findings check the seed; legacy compliance decisions are refused on
--                               activated (seed-linked) profiles; CLOSE_INVESTIGATION needs a reviewer
--                               different from the one who opened it.
--   #2 read-time gate        — public research/storefront/media/inventory reads require
--                               fictional-fixture OR a live Owner (O12) policy at READ time.
--   default privileges       — Supabase's ALTER DEFAULT PRIVILEGES grants ALL to service_role (and
--                               anon/authenticated); strip write/DDL-ish privileges from every dealership
--                               ledger/custody table and view, and EXECUTE from internal helpers.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. #1 Takedown laundering: deterministic (revision-ordered) check of every takedown since the last
--    public prelisting. Revisions are assigned under the seed row lock (FOR UPDATE) by the single
--    publication RPC, so ordering is total and deterministic even inside one transaction.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION dealer_guard_research_reprelisting()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_last_public INTEGER;
BEGIN
  IF NEW.decision <> 'PRELISTED_UNCLAIMED' THEN RETURN NEW; END IF;
  SELECT max(revision) INTO v_last_public
    FROM dealer_research_publication_events
   WHERE seed_dealer_id = NEW.seed_dealer_id AND decision = 'PRELISTED_UNCLAIMED';
  -- Takedown-class events since the last public prelisting: SUPPRESSED / UNDER_DISPUTE / DUPLICATE
  -- always; WITHHELD only when it follows a public state (also how a correction RESOLVED_WITHHELD is
  -- recorded). Never-published WITHHELD is an initial eligibility decision, not a takedown.
  IF EXISTS (
    SELECT 1 FROM dealer_research_publication_events e
     WHERE e.seed_dealer_id = NEW.seed_dealer_id
       AND e.revision > coalesce(v_last_public, 0)
       AND e.reviewer_id = NEW.reviewer_id
       AND (e.decision IN ('SUPPRESSED', 'UNDER_DISPUTE', 'DUPLICATE')
            OR (e.decision = 'WITHHELD' AND v_last_public IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'REPRELISTING_AFTER_TAKEDOWN_REQUIRES_DIFFERENT_REVIEWER';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION dealer_guard_research_reprelisting() FROM PUBLIC, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. #7 Conflict-of-interest gaps
-- ─────────────────────────────────────────────────────────────────────────────
-- TG_ARGV[0] = reviewer column; TG_ARGV[1] = 'seeds' (then TG_ARGV[2..] = every seed column, ALL are
-- checked) or 'feedback_case' (seed resolved via case_id).
CREATE FUNCTION dealer_guard_reviewer_coi_multi_seed()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_row JSONB := to_jsonb(NEW);
  v_reviewer TEXT := v_row->>TG_ARGV[0];
  v_seed TEXT;
  i INTEGER;
BEGIN
  IF v_reviewer IS NULL THEN RETURN NEW; END IF;
  IF TG_ARGV[1] = 'feedback_case' THEN
    SELECT c.seed_dealer_id INTO v_seed FROM dealer_transaction_feedback_cases c
     WHERE c.case_id = (v_row->>'case_id')::uuid;
    IF v_seed IS NOT NULL AND dealer_reviewer_conflict_of_interest(v_reviewer, v_seed, NULL) THEN
      RAISE EXCEPTION 'DEALER_REVIEWER_CONFLICT_OF_INTEREST' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_ARGV[1] = 'seeds' AND TG_NARGS > 2 THEN
    FOR i IN 2..TG_NARGS - 1 LOOP
      v_seed := v_row->>TG_ARGV[i];
      IF v_seed IS NOT NULL AND dealer_reviewer_conflict_of_interest(v_reviewer, v_seed, NULL) THEN
        RAISE EXCEPTION 'DEALER_REVIEWER_CONFLICT_OF_INTEREST' USING ERRCODE = '42501';
      END IF;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'DEALER_REVIEWER_COI_GUARD_MISCONFIGURED';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION dealer_guard_reviewer_coi_multi_seed() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER dealer_r6r2_coi_duplicate_redirect BEFORE INSERT ON dealer_research_duplicate_redirects
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_reviewer_coi_multi_seed(
    'reviewer_user_id', 'seeds', 'duplicate_seed_dealer_id', 'canonical_seed_dealer_id');
CREATE TRIGGER dealer_r6r2_coi_grouping_review BEFORE INSERT ON dealer_research_grouping_review_events
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_reviewer_coi_multi_seed(
    'reviewer_user_id', 'seeds', 'seed_dealer_id', 'related_seed_dealer_id');
CREATE TRIGGER dealer_r6r2_coi_buyer_case_finding BEFORE INSERT ON dealer_transaction_feedback_review_events
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_reviewer_coi_multi_seed('reviewer_user_id', 'feedback_case');

-- Legacy single-reviewer compliance decisions (PATCH /api/admin/dealers/:id/decision ->
-- dealer_record_atomic_compliance_decision) never govern an ACTIVATED dealership: its suspension,
-- investigation, reinstatement and renewal belong to the dual-control C12 lifecycle only.
CREATE FUNCTION dealer_refuse_legacy_decision_on_activated_dealer()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM dealer_approved_seed_links l WHERE l.dealer_profile_id = NEW.dealer_id) THEN
    RAISE EXCEPTION 'ACTIVATED_DEALER_GOVERNED_BY_OPERATING_LIFECYCLE' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION dealer_refuse_legacy_decision_on_activated_dealer() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER dealer_r6r2_no_legacy_decision_on_activated BEFORE INSERT ON dealer_compliance_decisions
  FOR EACH ROW EXECUTE FUNCTION dealer_refuse_legacy_decision_on_activated_dealer();

-- CLOSE_INVESTIGATION is dual control, like REINSTATE: never the reviewer who opened it.
CREATE FUNCTION dealer_guard_investigation_close_dual_control()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_opened_by TEXT;
BEGIN
  IF NEW.action <> 'CLOSE_INVESTIGATION' THEN RETURN NEW; END IF;
  SELECT e.reviewer_user_id INTO v_opened_by
    FROM dealer_operating_lifecycle_events e
   WHERE e.link_id = NEW.link_id AND e.action = 'OPEN_INVESTIGATION'
   ORDER BY e.created_at DESC, e.event_id DESC
   LIMIT 1;
  IF v_opened_by IS NOT NULL AND v_opened_by = NEW.reviewer_user_id THEN
    RAISE EXCEPTION 'CLOSE_INVESTIGATION_REQUIRES_DIFFERENT_REVIEWER' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION dealer_guard_investigation_close_dual_control() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER dealer_r6r2_close_investigation_dual_control BEFORE INSERT ON dealer_operating_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_investigation_close_dual_control();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. #2 Read-time real-publication gate (no existing row is mutated)
-- ─────────────────────────────────────────────────────────────────────────────
-- A research profile is publicly readable only if its seed is a fictional CI fixture, or a live Owner
-- (O12) policy exists whose approver is not the reviewer of the CURRENT publication decision. A real
-- seed prelisted before R6, or under a since-suspended/expired policy, therefore stops being public
-- the moment the policy lapses — everywhere the public reads go through these predicates.
CREATE FUNCTION dealer_research_publicly_eligible(p_seed_dealer_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT dealer_research_seed_is_fictional_fixture(p_seed_dealer_id)
      OR EXISTS (
        SELECT 1
          FROM dealer_research_public_profiles p
          JOIN dealer_research_publication_events e ON e.event_id = p.review_event_id
         WHERE p.seed_dealer_id = p_seed_dealer_id
           AND dealer_real_research_publication_policy_current(e.reviewer_id));
$$;
REVOKE ALL ON FUNCTION dealer_research_publicly_eligible(TEXT) FROM PUBLIC, anon, authenticated;
-- service_role must be able to EXECUTE it: views invoke functions with the querying role's privilege.
GRANT EXECUTE ON FUNCTION dealer_research_publicly_eligible(TEXT) TO service_role;

CREATE VIEW dealer_research_public_profiles_current WITH (security_barrier = true) AS
SELECT p.seed_dealer_id, p.public_slug, p.public_name, p.public_city, p.public_research_category,
       p.source_attribution, p.publication_status, p.review_event_id, p.revision, p.reviewed_at
  FROM dealer_research_public_profiles p
 WHERE p.publication_status = 'PRELISTED_UNCLAIMED'
   AND dealer_research_publicly_eligible(p.seed_dealer_id);
COMMENT ON VIEW dealer_research_public_profiles_current IS
  'The ONLY public read source for research profiles: PRELISTED_UNCLAIMED and (fictional fixture OR live Owner O12 policy) evaluated at read time.';

CREATE OR REPLACE VIEW dealer_full_storefront_current WITH (security_barrier=true) AS
SELECT e.seed_dealer_id, p.public_slug, e.public_name,e.public_city,
  e.approved_branch_snapshot,e.dealer_declared_sections,
  e.publication_reviewed_at,e.event_id AS publication_event_id
FROM (
 SELECT DISTINCT ON(seed_dealer_id) *
 FROM dealer_full_storefront_review_events
 ORDER BY seed_dealer_id,publication_reviewed_at DESC,event_id DESC
) e
JOIN dealer_approved_seed_links l ON l.link_id=e.link_id AND l.operating_status='ACTIVE'
JOIN dealer_research_claim_requests c
 ON c.claim_id=l.claim_id AND c.claim_status='CLAIM_APPROVED'
JOIN dealer_profiles d ON d.id=l.dealer_profile_id
JOIN tenants t ON t.id=l.tenant_id
JOIN dealer_legal_application_reviews legal ON legal.legal_review_id=l.legal_review_id
JOIN dealer_country_legal_policy_authority policy ON
  policy.country_code=legal.country_code AND policy.policy_version=legal.policy_version
JOIN dealer_research_public_profiles p ON p.seed_dealer_id=e.seed_dealer_id
WHERE e.disposition='PUBLISHED_FULL'
  -- Security review #1: an approval older than the latest research takedown never revives by itself.
  -- R6 review #1: ANY non-public research decision (incl. WITHHELD) after the storefront approval
  -- requires a fresh full-storefront review; a status gap never silently revives the storefront.
  AND NOT EXISTS(SELECT 1 FROM dealer_research_publication_events t
    WHERE t.seed_dealer_id=e.seed_dealer_id AND t.decision<>'PRELISTED_UNCLAIMED'
      AND t.recorded_at>=e.publication_reviewed_at)
  AND p.publication_status='PRELISTED_UNCLAIMED'
  -- R6 review #2: read-time real-publication gate (fictional fixture OR live Owner O12 policy).
  AND dealer_research_publicly_eligible(e.seed_dealer_id)
  AND t.type='dealership' AND t.status='active'
  AND d.identity_status='verified' AND d.compliance_review_state='passed'
  AND d.active_state='active' AND d.restriction_state='none'
  AND d.suspension_state='none' AND d.investigation_state='none'
  AND coalesce(d.expiry_date,'epoch'::timestamptz)>now()
  AND legal.legal_expires_at>now()
  AND policy.policy_state='APPROVED'
  AND policy.effective_at<=now() AND policy.expires_at>now()
  AND EXISTS(SELECT 1 FROM tenant_users m WHERE
    m.tenant_id=l.tenant_id AND m.user_id=l.claimant_user_id
    AND m.role IN ('dealer','admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Supabase default privileges: least privilege for the API role on dealership objects
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase runs ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES/FUNCTIONS TO anon, authenticated,
-- service_role, so earlier "GRANT SELECT TO service_role" left service_role with INSERT/UPDATE/DELETE/
-- TRUNCATE/REFERENCES/TRIGGER as well. Every dealership write goes through SECURITY DEFINER RPCs; the
-- backend writes directly only: INSERT dealer_research_claim_requests, INSERT+UPDATE
-- dealer_research_correction_requests (UPDATE granted by 20261103143000), INSERT
-- dealer_claim_private_evidence. SELECT grants are left unchanged.
DO $$
DECLARE
  t TEXT;
  v_tables TEXT[] := ARRAY[
    'dealer_activation_branch_crosswalk',
    'dealer_activation_carryover_events',
    'dealer_approved_seed_links',
    'dealer_canonical_inquiry_progress_events',
    'dealer_claim_appeals',
    'dealer_claim_compliance_review_events',
    'dealer_claim_compliance_submissions',
    'dealer_claim_document_ocr_events',
    'dealer_claim_intake_drafts',
    'dealer_claim_intake_receipts',
    'dealer_claim_private_evidence',
    'dealer_claim_review_events',
    'dealer_country_legal_policy_authority',
    'dealer_full_storefront_review_events',
    'dealer_legal_application_reviews',
    'dealer_listing_authority_events',
    'dealer_operating_lifecycle_events',
    'dealer_operational_declaration_events',
    'dealer_research_claim_requests',
    'dealer_research_correction_requests',
    'dealer_research_correction_review_events',
    'dealer_research_duplicate_redirects',
    'dealer_research_grouping_review_events',
    'dealer_research_public_contact_events',
    'dealer_research_public_profiles',
    'dealer_research_publication_events',
    'dealer_research_publication_policy_authority',
    'dealer_research_seed_records',
    'dealer_reviewer_step_up_guard',
    'dealer_staff_branch_scope_events',
    'dealer_staff_branch_scopes',
    'dealer_staff_invitation_events',
    'dealer_staff_invitation_records',
    'dealer_storefront_media_items',
    'dealer_storefront_media_review_events',
    'dealer_storefront_media_review_tickets',
    'dealer_transaction_feedback_cases',
    'dealer_transaction_feedback_review_events',
    'dealer_vehicle_branch_assignments'];
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %I FROM service_role', t);
  END LOOP;
END;
$$;
GRANT INSERT ON dealer_research_claim_requests TO service_role;
GRANT INSERT, UPDATE ON dealer_research_correction_requests TO service_role;
GRANT INSERT ON dealer_claim_private_evidence TO service_role;

-- Views: SELECT only (a simple security_barrier view is auto-updatable; default ALL would let the API
-- role UPDATE/DELETE base rows through it).
REVOKE ALL ON dealer_research_public_profiles_current FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON dealer_full_storefront_current FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON dealer_public_storefront_media_current FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON dealer_research_public_profiles_current, dealer_full_storefront_current,
  dealer_public_storefront_media_current TO service_role;

-- Internal helpers are never API surface. Trigger functions (any dealer_* returning trigger) and the
-- listed helpers lose EXECUTE for every client role, service_role included. Kept for service_role:
-- the RPCs the backend calls, dealer_tenant_listing_authority_current (RPC + used inside the public
-- media view), dealer_research_publicly_eligible (used inside public views) and
-- dealer_withdraw_lapsed_listing_authority (documented ops/pg_cron sweep, only ever withdraws).
DO $$
DECLARE
  f REGPROCEDURE;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'dealer\_%'
       AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'dealer_carryover_note', 'dealer_carryover_text', 'dealer_assert_staff_owner',
       'dealer_lock_tenant_public_listings', 'dealer_withdraw_tenant_public_listings',
       'dealer_reviewer_conflict_of_interest', 'dealer_research_seed_is_fictional_fixture',
       'dealer_real_research_publication_policy_current')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END;
$$;

-- +migrate Down
SET lock_timeout = '3s';
-- Refuse while custody this Down would orphan exists: duplicate redirects, grouping reviews or buyer-case
-- findings recorded under the R6-round-2 guards, or lifecycle events (their dual-control history).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dealer_research_duplicate_redirects)
     OR EXISTS (SELECT 1 FROM dealer_research_grouping_review_events)
     OR EXISTS (SELECT 1 FROM dealer_transaction_feedback_review_events)
     OR EXISTS (SELECT 1 FROM dealer_operating_lifecycle_events) THEN
    RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_DEALER_R6_ROUND2_CUSTODY';
  END IF;
END;
$$;
-- Privilege tightening (section 4) is deliberately NOT reverted: a rollback must never re-open
-- write access for the API role (same rule as 20261103125000's Down, R6 DBA #6).

CREATE OR REPLACE VIEW dealer_full_storefront_current WITH (security_barrier=true) AS
SELECT e.seed_dealer_id, p.public_slug, e.public_name,e.public_city,
  e.approved_branch_snapshot,e.dealer_declared_sections,
  e.publication_reviewed_at,e.event_id AS publication_event_id
FROM (
 SELECT DISTINCT ON(seed_dealer_id) *
 FROM dealer_full_storefront_review_events
 ORDER BY seed_dealer_id,publication_reviewed_at DESC,event_id DESC
) e
JOIN dealer_approved_seed_links l ON l.link_id=e.link_id AND l.operating_status='ACTIVE'
JOIN dealer_research_claim_requests c
 ON c.claim_id=l.claim_id AND c.claim_status='CLAIM_APPROVED'
JOIN dealer_profiles d ON d.id=l.dealer_profile_id
JOIN tenants t ON t.id=l.tenant_id
JOIN dealer_legal_application_reviews legal ON legal.legal_review_id=l.legal_review_id
JOIN dealer_country_legal_policy_authority policy ON
  policy.country_code=legal.country_code AND policy.policy_version=legal.policy_version
JOIN dealer_research_public_profiles p ON p.seed_dealer_id=e.seed_dealer_id
WHERE e.disposition='PUBLISHED_FULL'
  -- Security review #1: an approval older than the latest research takedown never revives by itself.
  AND NOT EXISTS(SELECT 1 FROM dealer_research_publication_events t
    WHERE t.seed_dealer_id=e.seed_dealer_id AND t.decision IN ('SUPPRESSED','UNDER_DISPUTE','DUPLICATE')
      AND t.recorded_at>=e.publication_reviewed_at)
  AND p.publication_status='PRELISTED_UNCLAIMED'
  AND t.type='dealership' AND t.status='active'
  AND d.identity_status='verified' AND d.compliance_review_state='passed'
  AND d.active_state='active' AND d.restriction_state='none'
  AND d.suspension_state='none' AND d.investigation_state='none'
  AND coalesce(d.expiry_date,'epoch'::timestamptz)>now()
  AND legal.legal_expires_at>now()
  AND policy.policy_state='APPROVED'
  AND policy.effective_at<=now() AND policy.expires_at>now()
  AND EXISTS(SELECT 1 FROM tenant_users m WHERE
    m.tenant_id=l.tenant_id AND m.user_id=l.claimant_user_id
    AND m.role IN ('dealer','admin'));

REVOKE ALL ON dealer_full_storefront_current FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON dealer_full_storefront_current TO service_role;
DROP VIEW IF EXISTS dealer_research_public_profiles_current;
DROP FUNCTION IF EXISTS dealer_research_publicly_eligible(TEXT);

DROP TRIGGER IF EXISTS dealer_r6r2_close_investigation_dual_control ON dealer_operating_lifecycle_events;
DROP FUNCTION IF EXISTS dealer_guard_investigation_close_dual_control();
DROP TRIGGER IF EXISTS dealer_r6r2_no_legacy_decision_on_activated ON dealer_compliance_decisions;
DROP FUNCTION IF EXISTS dealer_refuse_legacy_decision_on_activated_dealer();
DROP TRIGGER IF EXISTS dealer_r6r2_coi_buyer_case_finding ON dealer_transaction_feedback_review_events;
DROP TRIGGER IF EXISTS dealer_r6r2_coi_grouping_review ON dealer_research_grouping_review_events;
DROP TRIGGER IF EXISTS dealer_r6r2_coi_duplicate_redirect ON dealer_research_duplicate_redirects;
DROP FUNCTION IF EXISTS dealer_guard_reviewer_coi_multi_seed();

-- Restore the exact 20261103143000 re-prelisting guard.
CREATE OR REPLACE FUNCTION dealer_guard_research_reprelisting()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_last dealer_research_publication_events%ROWTYPE;
BEGIN
  IF NEW.decision <> 'PRELISTED_UNCLAIMED' THEN RETURN NEW; END IF;
  SELECT * INTO v_last FROM dealer_research_publication_events
   WHERE seed_dealer_id = NEW.seed_dealer_id ORDER BY revision DESC LIMIT 1;
  IF FOUND AND v_last.decision IN ('SUPPRESSED','UNDER_DISPUTE','DUPLICATE')
     AND v_last.reviewer_id = NEW.reviewer_id THEN
    RAISE EXCEPTION 'REPRELISTING_AFTER_TAKEDOWN_REQUIRES_DIFFERENT_REVIEWER';
  END IF;
  RETURN NEW;
END;
$$;
