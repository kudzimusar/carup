-- +migrate Up
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = public, pg_temp;
DO $txnmark$
BEGIN
  -- R6 DBA review 4: the transaction marker is this transaction's own id, so a value preset at
  -- session, role or database level (or through PGOPTIONS) can never satisfy the guard below.
  PERFORM set_config('carup.dealer_migration_txn', txid_current()::text, true);
  -- …and the Down of this same version refuses to run later in this transaction (whole-file apply).
  PERFORM set_config('carup.dealer_migration_up_v20261103147000', txid_current()::text, true);
END
$txnmark$;
DO $txnguard$
BEGIN
  -- R6 DBA review 3 N2 / review 4: SET LOCAL is a silent no-op outside a transaction block, so a
  -- section applied statement by statement in autocommit (plain `psql -f`, an interactive paste)
  -- would lose its bounds and could apply half-way. When the marker set just above is not this
  -- transaction's own, the statements are not sharing one transaction: make the REST OF THIS
  -- SESSION read-only and return WITHOUT raising (a raise would roll the setting back; ending the
  -- session would let an interactive psql reconnect and run the remaining statements). Every later
  -- change in this session then fails with SQLSTATE 25006, so nothing can be applied half-way.
  IF current_setting('carup.dealer_migration_txn', true) IS DISTINCT FROM txid_current()::text THEN
    PERFORM set_config('default_transaction_read_only', 'on', false);
    PERFORM set_config('transaction_read_only', 'on', true);
    RAISE WARNING 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION: this session is now read-only. Apply ONLY through backend/scripts/dealership/applyDealerMigrations.mjs, or psql -1 -v ON_ERROR_STOP=1 on a file containing a single section (Up OR Down).';
    RETURN;
  END IF;
END
$txnguard$;
-- CARUP-DEALER-1.0-VISUAL-UAT-R1 (Owner UAT return, PR #258 comment 6717108659).
--   1. P0 — governed RECONCILIATION of a second, independently approved BRANCH claim of the SAME
--      legal company onto the claimant's EXISTING active dealership (organization, tenant, dealer
--      profile). Never a second organization/tenant/membership, never a public publication, never a
--      merge by e-mail, trade name or shared applicant: the two independent legal reviews must name
--      the same registration number (normalised), country and legal name. A separately registered
--      company is refused with SEPARATE_LEGAL_ORGANIZATION_REQUIRES_GOVERNED_ONBOARDING (multi-company
--      management is out of scope). The 1:1 dealer_approved_seed_links invariant every consumer gate
--      relies on is UNCHANGED: an attached claim lives in its own ledger keyed to the primary link.
--   2. P0 — evidence that is not what it was filed as (a showroom photo stored as a company
--      registration certificate) can be quarantined by the claimant (uploaded in error) or by an
--      independent reviewer; quarantined evidence can never satisfy a claim, application, legal,
--      activation or reconciliation gate.
--   3. P1 — company profile image and cover image are dealer MEDIA (tenant-scoped, ClamAV-scanned,
--      independent T22 public-display review), never legal evidence.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Helpers
-- ─────────────────────────────────────────────────────────────────────────────
-- A registration number compared as letters and digits only (spacing, dashes, slashes and case
-- are presentation). NULL when nothing comparable remains.
CREATE FUNCTION dealer_registration_key(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;
CREATE FUNCTION dealer_legal_name_key(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT nullif(lower(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Evidence quarantine (P0 document classification)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE dealer_claim_evidence_quarantine_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL UNIQUE REFERENCES dealer_claim_private_evidence(evidence_id) ON DELETE RESTRICT,
  claim_id UUID NOT NULL REFERENCES dealer_research_claim_requests(claim_id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('CLAIMANT_WITHDRAWAL', 'INDEPENDENT_REVIEWER')),
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'NOT_THE_DECLARED_DOCUMENT_TYPE', 'UPLOADED_IN_ERROR',
    'UNREADABLE_OR_INCOMPLETE', 'NOT_ISSUED_BY_STATED_AUTHORITY')),
  note TEXT CHECK (note IS NULL OR (length(btrim(note)) BETWEEN 10 AND 1000 AND note !~ '<\s*[/!a-zA-Z]')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (actor_kind <> 'CLAIMANT_WITHDRAWAL' OR reason_code = 'UPLOADED_IN_ERROR')
);
CREATE INDEX dealer_claim_evidence_quarantine_claim ON dealer_claim_evidence_quarantine_events(claim_id);
CREATE TRIGGER dealer_claim_evidence_quarantine_no_update BEFORE UPDATE
  ON dealer_claim_evidence_quarantine_events FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_claim_evidence_quarantine_no_delete BEFORE DELETE
  ON dealer_claim_evidence_quarantine_events FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
ALTER TABLE dealer_claim_evidence_quarantine_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_claim_evidence_quarantine_events FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON dealer_claim_evidence_quarantine_events FROM service_role;
GRANT SELECT ON dealer_claim_evidence_quarantine_events TO service_role;
COMMENT ON TABLE dealer_claim_evidence_quarantine_events IS
  'Append-only, terminal: a quarantined evidence record keeps its original class for audit but can never satisfy a claim, application, legal, activation or reconciliation gate.';

CREATE FUNCTION dealer_claim_evidence_quarantined(p_evidence_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM dealer_claim_evidence_quarantine_events q WHERE q.evidence_id = p_evidence_id)
$$;

-- The claimant may withdraw their OWN evidence uploaded in error while no decision relies on it.
-- An independent reviewer (step-up and conflict-of-interest checked) may quarantine any evidence of a
-- claim they may review; it then stops counting for every later gate.
CREATE FUNCTION dealer_quarantine_claim_evidence(
  p_evidence_id UUID, p_actor_id TEXT, p_actor_kind TEXT, p_reason_code TEXT, p_note TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  e dealer_claim_private_evidence%ROWTYPE;
  c dealer_research_claim_requests%ROWTYPE;
  r users%ROWTYPE;
  v_id UUID;
BEGIN
  IF p_actor_kind NOT IN ('CLAIMANT_WITHDRAWAL', 'INDEPENDENT_REVIEWER')
     OR p_reason_code NOT IN ('NOT_THE_DECLARED_DOCUMENT_TYPE', 'UPLOADED_IN_ERROR',
                              'UNREADABLE_OR_INCOMPLETE', 'NOT_ISSUED_BY_STATED_AUTHORITY')
     OR (p_actor_kind = 'CLAIMANT_WITHDRAWAL' AND p_reason_code <> 'UPLOADED_IN_ERROR')
     OR (p_note IS NOT NULL AND (length(btrim(p_note)) NOT BETWEEN 10 AND 1000 OR p_note ~ '<\s*[/!a-zA-Z]')) THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE_QUARANTINE_REQUEST';
  END IF;
  SELECT * INTO e FROM dealer_claim_private_evidence WHERE evidence_id = p_evidence_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLAIM_EVIDENCE_NOT_FOUND'; END IF;
  SELECT * INTO c FROM dealer_research_claim_requests WHERE claim_id = e.claim_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM dealer_claim_evidence_quarantine_events WHERE evidence_id = e.evidence_id) THEN
    RETURN jsonb_build_object('evidence_id', e.evidence_id, 'quarantined', true, 'idempotent', true);
  END IF;
  IF p_actor_kind = 'CLAIMANT_WITHDRAWAL' THEN
    IF p_actor_id IS DISTINCT FROM c.claimant_user_id OR p_actor_id IS DISTINCT FROM e.uploader_user_id THEN
      RAISE EXCEPTION 'CLAIM_EVIDENCE_NOT_OWNED';
    END IF;
    IF EXISTS (SELECT 1 FROM dealer_claim_review_events WHERE evidence_id = e.evidence_id)
       OR EXISTS (SELECT 1 FROM dealer_legal_application_reviews
                   WHERE e.evidence_id IN (company_registration_evidence_id, signatory_evidence_id)) THEN
      RAISE EXCEPTION 'EVIDENCE_ALREADY_RELIED_ON_BY_A_REVIEW';
    END IF;
  ELSE
    SELECT * INTO r FROM users WHERE id = p_actor_id;
    IF NOT FOUND OR r.is_verified IS DISTINCT FROM true
       OR r.role NOT IN ('admin', 'reviewer', 'platform_admin', 'super_admin')
       OR r.id = c.claimant_user_id OR r.id = e.uploader_user_id THEN
      RAISE EXCEPTION 'INDEPENDENT_REVIEWER_REQUIRED';
    END IF;
    -- Conflicted on the seed, OR a member of any dealership the claimant already operates (their own
    -- staff must not decide what counts as the owner's evidence).
    IF dealer_reviewer_conflict_of_interest(p_actor_id, c.seed_dealer_id, NULL)
       OR EXISTS (SELECT 1 FROM dealer_approved_seed_links l JOIN tenant_users tu ON tu.tenant_id = l.tenant_id
                   WHERE l.claimant_user_id = c.claimant_user_id AND tu.user_id = p_actor_id) THEN
      RAISE EXCEPTION 'DEALER_REVIEWER_CONFLICT_OF_INTEREST' USING ERRCODE = '42501';
    END IF;
  END IF;
  INSERT INTO dealer_claim_evidence_quarantine_events(evidence_id, claim_id, actor_user_id, actor_kind, reason_code, note)
  VALUES (e.evidence_id, e.claim_id, p_actor_id, p_actor_kind, p_reason_code, nullif(btrim(coalesce(p_note, '')), ''))
  RETURNING event_id INTO v_id;
  RETURN jsonb_build_object('evidence_id', e.evidence_id, 'event_id', v_id, 'quarantined', true,
    'idempotent', false, 'original_document_class', e.document_class,
    'can_satisfy_legal_gate', false);
END;
$$;

-- Data-layer gates: every current and future decision path that relies on evidence.
CREATE FUNCTION dealer_guard_decision_evidence_not_quarantined()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v JSONB := to_jsonb(NEW);
BEGIN
  IF TG_TABLE_NAME = 'dealer_claim_review_events' THEN
    IF v->>'verdict' = 'CLAIM_APPROVED' AND v->>'evidence_id' IS NOT NULL
       AND dealer_claim_evidence_quarantined((v->>'evidence_id')::uuid) THEN
      RAISE EXCEPTION 'QUARANTINED_EVIDENCE_CANNOT_SUPPORT_DECISION';
    END IF;
  ELSIF TG_TABLE_NAME = 'dealer_legal_application_reviews' THEN
    IF dealer_claim_evidence_quarantined((v->>'company_registration_evidence_id')::uuid)
       OR dealer_claim_evidence_quarantined((v->>'signatory_evidence_id')::uuid) THEN
      RAISE EXCEPTION 'QUARANTINED_EVIDENCE_CANNOT_SUPPORT_DECISION';
    END IF;
  ELSIF TG_TABLE_NAME IN ('dealer_approved_seed_links', 'dealer_branch_claim_attachments') THEN
    IF EXISTS (SELECT 1 FROM dealer_legal_application_reviews l
                WHERE l.legal_review_id = (v->>'legal_review_id')::uuid
                  AND (dealer_claim_evidence_quarantined(l.company_registration_evidence_id)
                       OR dealer_claim_evidence_quarantined(l.signatory_evidence_id))) THEN
      RAISE EXCEPTION 'LEGAL_EVIDENCE_QUARANTINED';
    END IF;
  ELSIF TG_TABLE_NAME = 'dealer_claim_compliance_submissions' THEN
    IF NOT EXISTS (SELECT 1 FROM dealer_claim_private_evidence e
                    WHERE e.claim_id = (v->>'claim_id')::uuid
                      AND e.uploader_user_id = v->>'claimant_user_id'
                      AND e.scan_state = 'CLEAN_CLAMAV_AT_UPLOAD'
                      AND e.document_class IN ('SIGNATORY_MANDATE', 'DIRECTOR_AUTHORITY', 'COMPANY_REGISTRATION')
                      AND NOT dealer_claim_evidence_quarantined(e.evidence_id)) THEN
      RAISE EXCEPTION 'PRIVATE_ORIGINAL_AUTHORITY_EVIDENCE_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dealer_uat_r1_claim_review_evidence_gate BEFORE INSERT ON dealer_claim_review_events
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_decision_evidence_not_quarantined();
CREATE TRIGGER dealer_uat_r1_legal_review_evidence_gate BEFORE INSERT ON dealer_legal_application_reviews
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_decision_evidence_not_quarantined();
CREATE TRIGGER dealer_uat_r1_activation_evidence_gate BEFORE INSERT ON dealer_approved_seed_links
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_decision_evidence_not_quarantined();
CREATE TRIGGER dealer_uat_r1_submission_evidence_gate BEFORE INSERT ON dealer_claim_compliance_submissions
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_decision_evidence_not_quarantined();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Branch-claim reconciliation (P0 second approved branch claim of the same legal company)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE dealer_branch_claim_attachments (
  attachment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_dealer_id TEXT NOT NULL UNIQUE REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
  claim_id UUID NOT NULL UNIQUE REFERENCES dealer_research_claim_requests(claim_id) ON DELETE RESTRICT,
  submission_id UUID NOT NULL UNIQUE REFERENCES dealer_claim_compliance_submissions(submission_id) ON DELETE RESTRICT,
  legal_review_id UUID NOT NULL UNIQUE REFERENCES dealer_legal_application_reviews(legal_review_id) ON DELETE RESTRICT,
  primary_link_id UUID NOT NULL REFERENCES dealer_approved_seed_links(link_id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  dealer_profile_id UUID NOT NULL REFERENCES dealer_profiles(id) ON DELETE RESTRICT,
  claimant_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  verified_registration_key TEXT NOT NULL CHECK (verified_registration_key ~ '^[A-Z0-9]{2,180}$'),
  attach_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (attach_status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  attached_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attach_reason TEXT NOT NULL CHECK (length(btrim(attach_reason)) BETWEEN 80 AND 3000),
  attached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_changed_at TIMESTAMPTZ,
  CHECK (attached_by <> claimant_user_id)
);
CREATE INDEX dealer_branch_claim_attachments_profile ON dealer_branch_claim_attachments(dealer_profile_id, attach_status);
CREATE INDEX dealer_branch_claim_attachments_link ON dealer_branch_claim_attachments(primary_link_id);
CREATE TABLE dealer_attachment_branch_crosswalk (
  crosswalk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID NOT NULL REFERENCES dealer_branch_claim_attachments(attachment_id) ON DELETE RESTRICT,
  submission_id UUID NOT NULL REFERENCES dealer_claim_compliance_submissions(submission_id) ON DELETE RESTRICT,
  source_row INTEGER NOT NULL CHECK (source_row BETWEEN 1 AND 250),
  branch_ref TEXT NOT NULL CHECK (length(branch_ref) BETWEEN 1 AND 120),
  branch_id UUID NOT NULL UNIQUE REFERENCES dealer_branches(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attachment_id, branch_ref),
  UNIQUE (attachment_id, source_row)
);
CREATE TABLE dealer_attachment_carryover_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID NOT NULL REFERENCES dealer_branch_claim_attachments(attachment_id) ON DELETE RESTRICT,
  submission_id UUID NOT NULL REFERENCES dealer_claim_compliance_submissions(submission_id) ON DELETE RESTRICT,
  dealer_profile_id UUID NOT NULL REFERENCES dealer_profiles(id) ON DELETE RESTRICT,
  source_tab TEXT NOT NULL CHECK (source_tab ~ '^[A-Z][A-Z_]{1,39}$'),
  source_row INTEGER NOT NULL CHECK (source_row BETWEEN 1 AND 250),
  source_field TEXT NOT NULL CHECK (source_field ~ '^[a-z][a-z0-9_]{0,79}$'),
  target TEXT NOT NULL CHECK (length(target) BETWEEN 3 AND 120),
  target_id UUID,
  disposition TEXT NOT NULL CHECK (disposition IN (
    'CARRIED_UNVERIFIED', 'NOT_CARRIED_INVALID', 'NOT_CARRIED_DUPLICATE', 'NOT_CARRIED_CONFLICT',
    'NOT_CARRIED_INCUMBENT_PRESERVED', 'RETAINED_PRIVATE_NOT_CANONICAL')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 240),
  value_sha256 TEXT CHECK (value_sha256 IS NULL OR value_sha256 ~ '^[0-9a-f]{64}$'),
  independently_verified BOOLEAN NOT NULL DEFAULT false CHECK (independently_verified = false),
  publicly_approved BOOLEAN NOT NULL DEFAULT false CHECK (publicly_approved = false),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attachment_id, source_tab, source_row, source_field)
);
CREATE INDEX dealer_attachment_carryover_by_attachment ON dealer_attachment_carryover_events(attachment_id, disposition);
ALTER TABLE dealer_branch_claim_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_attachment_branch_crosswalk ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_attachment_carryover_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_branch_claim_attachments, dealer_attachment_branch_crosswalk,
  dealer_attachment_carryover_events FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON dealer_branch_claim_attachments,
  dealer_attachment_branch_crosswalk, dealer_attachment_carryover_events FROM service_role;
GRANT SELECT ON dealer_branch_claim_attachments, dealer_attachment_branch_crosswalk,
  dealer_attachment_carryover_events TO service_role;
CREATE TRIGGER dealer_attachment_branch_crosswalk_no_update BEFORE UPDATE ON dealer_attachment_branch_crosswalk
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_attachment_branch_crosswalk_no_delete BEFORE DELETE ON dealer_attachment_branch_crosswalk
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_attachment_carryover_no_update BEFORE UPDATE ON dealer_attachment_carryover_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_attachment_carryover_no_delete BEFORE DELETE ON dealer_attachment_carryover_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_branch_claim_attachments_no_delete BEFORE DELETE ON dealer_branch_claim_attachments
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
COMMENT ON TABLE dealer_branch_claim_attachments IS
  'A second independently approved BRANCH claim of the SAME legal company, attached to the claimant''s existing dealership by a separate independent reviewer. No organization, tenant, membership, publication or listing authority is created. The 1:1 dealer_approved_seed_links invariant is unchanged.';

-- Attachment rows are immutable except for the status the revocation path moves (never back to ACTIVE).
CREATE FUNCTION dealer_guard_branch_claim_attachment_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_link dealer_approved_seed_links%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.attach_status <> 'ACTIVE' OR NEW.status_changed_at IS NOT NULL THEN
      RAISE EXCEPTION 'DEALER_ATTACHMENT_MUST_START_ACTIVE';
    END IF;
    IF EXISTS (SELECT 1 FROM dealer_approved_seed_links
                WHERE seed_dealer_id = NEW.seed_dealer_id OR claim_id = NEW.claim_id) THEN
      RAISE EXCEPTION 'CLAIM_ALREADY_ACTIVATED_AS_OWN_DEALERSHIP';
    END IF;
    SELECT * INTO v_link FROM dealer_approved_seed_links WHERE link_id = NEW.primary_link_id;
    IF NOT FOUND OR v_link.operating_status <> 'ACTIVE'
       OR v_link.organization_id IS DISTINCT FROM NEW.organization_id
       OR v_link.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR v_link.dealer_profile_id IS DISTINCT FROM NEW.dealer_profile_id
       OR v_link.claimant_user_id IS DISTINCT FROM NEW.claimant_user_id THEN
      RAISE EXCEPTION 'RECONCILIATION_TARGET_INCONSISTENT';
    END IF;
    -- Conflict of interest on the TARGET dealership as well (the generic guard covers the attached seed).
    IF dealer_reviewer_conflict_of_interest(NEW.attached_by, v_link.seed_dealer_id, NEW.tenant_id) THEN
      RAISE EXCEPTION 'DEALER_REVIEWER_CONFLICT_OF_INTEREST' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: only the status may move, forward only.
  IF (to_jsonb(NEW) - 'attach_status' - 'status_changed_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'attach_status' - 'status_changed_at') THEN
    RAISE EXCEPTION 'DEALER_ATTACHMENT_IMMUTABLE';
  END IF;
  IF NOT ((OLD.attach_status = 'ACTIVE' AND NEW.attach_status IN ('SUSPENDED', 'REVOKED'))
          OR (OLD.attach_status = 'SUSPENDED' AND NEW.attach_status = 'REVOKED')
          OR OLD.attach_status = NEW.attach_status) THEN
    RAISE EXCEPTION 'DEALER_ATTACHMENT_STATUS_TRANSITION_REFUSED';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dealer_branch_claim_attachment_write_guard BEFORE INSERT OR UPDATE ON dealer_branch_claim_attachments
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_branch_claim_attachment_write();
CREATE TRIGGER dealer_uat_r1_coi_reconciliation BEFORE INSERT ON dealer_branch_claim_attachments
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_reviewer_conflict_of_interest('attached_by', 'seed');
CREATE TRIGGER dealer_uat_r1_reconciliation_evidence_gate BEFORE INSERT ON dealer_branch_claim_attachments
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_decision_evidence_not_quarantined();

-- A seed/claim attached to an existing dealership can never ALSO become its own dealership.
CREATE FUNCTION dealer_guard_seed_link_not_attached()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM dealer_branch_claim_attachments
              WHERE seed_dealer_id = NEW.seed_dealer_id OR claim_id = NEW.claim_id) THEN
    RAISE EXCEPTION 'SEED_ALREADY_ATTACHED_TO_EXISTING_DEALERSHIP';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dealer_uat_r1_seed_link_not_attached BEFORE INSERT ON dealer_approved_seed_links
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_seed_link_not_attached();

-- Revoking / rejecting / disputing an ATTACHED branch claim withdraws only that attachment. The existing
-- dealer_suspend_revoked_seed_claim trigger finds no seed link for it, so the company, its other
-- branches, stock and memberships are untouched. Revoking the company's PRIMARY claim still suspends
-- the whole dealership (unchanged), which every attached branch follows at read time.
CREATE FUNCTION dealer_withdraw_attachment_on_claim_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.claim_status NOT IN ('CLAIM_REVOKED', 'CLAIM_DISPUTED', 'CLAIM_REJECTED')
     OR NEW.claim_status = OLD.claim_status THEN
    RETURN NEW;
  END IF;
  UPDATE dealer_branch_claim_attachments
     SET attach_status = CASE WHEN NEW.claim_status = 'CLAIM_DISPUTED' AND attach_status = 'ACTIVE'
                              THEN 'SUSPENDED' ELSE 'REVOKED' END,
         status_changed_at = now()
   WHERE claim_id = NEW.claim_id AND attach_status <> 'REVOKED';
  RETURN NEW;
END;
$$;
CREATE TRIGGER dealer_uat_r1_attachment_claim_revocation AFTER UPDATE OF claim_status ON dealer_research_claim_requests
  FOR EACH ROW EXECUTE FUNCTION dealer_withdraw_attachment_on_claim_change();

-- Conflict of interest now also covers a seed ATTACHED to a dealership: its claimant and every member of
-- the tenant it is attached to are conflicted on it (same signature; the existing EXECUTE grants stay).
CREATE OR REPLACE FUNCTION dealer_reviewer_conflict_of_interest(
  p_reviewer_id TEXT, p_seed_dealer_id TEXT, p_tenant_id UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p_reviewer_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM dealer_research_claim_requests c
             WHERE c.seed_dealer_id = p_seed_dealer_id AND c.claimant_user_id = p_reviewer_id)
    OR EXISTS (SELECT 1 FROM dealer_approved_seed_links l
                WHERE l.seed_dealer_id = p_seed_dealer_id
                  AND (l.claimant_user_id = p_reviewer_id
                       OR EXISTS (SELECT 1 FROM tenant_users tu
                                   WHERE tu.tenant_id = l.tenant_id AND tu.user_id = p_reviewer_id)))
    OR EXISTS (SELECT 1 FROM dealer_branch_claim_attachments a
                WHERE a.seed_dealer_id = p_seed_dealer_id
                  AND (a.claimant_user_id = p_reviewer_id
                       OR EXISTS (SELECT 1 FROM tenant_users tu
                                   WHERE tu.tenant_id = a.tenant_id AND tu.user_id = p_reviewer_id)))
    OR (p_tenant_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = p_tenant_id AND tu.user_id = p_reviewer_id))
  );
$$;

-- Read-only assessment shown to the independent reviewer BEFORE confirming, and re-run under the
-- documented locks by the reconciliation itself. Every check is listed; `blocker` is the first failure.
CREATE FUNCTION dealer_preview_branch_claim_reconciliation(p_legal_review_id UUID, p_reviewer_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  l dealer_legal_application_reviews%ROWTYPE;
  s dealer_claim_compliance_submissions%ROWTYPE;
  c dealer_research_claim_requests%ROWTYPE;
  r users%ROWTYPE;
  p dealer_country_legal_policy_authority%ROWTYPE;
  v_link dealer_approved_seed_links%ROWTYPE;
  pl dealer_legal_application_reviews%ROWTYPE;
  d dealer_profiles%ROWTYPE;
  v_att dealer_branch_claim_attachments%ROWTYPE;
  v_links INTEGER := 0;
  v_checks JSONB := '[]'::jsonb;
  v_blocker TEXT;
  v_business JSONB;
  v_branches JSONB := '[]'::jsonb;
  v_row JSONB; v_ord INTEGER;
  v_declared_sections TEXT[] := '{}';
  v_existing_sections TEXT[] := '{}';
  v_target JSONB;
  v_ok BOOLEAN;
BEGIN
  SELECT * INTO l FROM dealer_legal_application_reviews WHERE legal_review_id = p_legal_review_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'BLOCKED', 'blocker', 'LEGAL_REVIEW_NOT_FOUND', 'checks', '[]'::jsonb);
  END IF;
  SELECT * INTO s FROM dealer_claim_compliance_submissions WHERE submission_id = l.submission_id;
  SELECT * INTO c FROM dealer_research_claim_requests WHERE claim_id = s.claim_id;
  SELECT * INTO r FROM users WHERE id = p_reviewer_id;
  SELECT * INTO v_att FROM dealer_branch_claim_attachments WHERE claim_id = c.claim_id;

  -- Already attached: replay is an idempotent no-op only for the identical decision.
  IF v_att.attachment_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'state', CASE WHEN v_att.attach_status = 'ACTIVE' AND v_att.legal_review_id = l.legal_review_id
                    THEN 'ALREADY_ATTACHED' ELSE 'BLOCKED' END,
      'blocker', CASE WHEN v_att.attach_status = 'ACTIVE' AND v_att.legal_review_id = l.legal_review_id
                      THEN NULL ELSE 'RECONCILIATION_EXISTS_OR_SUSPENDED' END,
      'attachment_id', v_att.attachment_id, 'attach_status', v_att.attach_status,
      'seed_dealer_id', c.seed_dealer_id, 'claim_id', c.claim_id,
      'target', jsonb_build_object('organization_id', v_att.organization_id,
        'tenant_id', v_att.tenant_id, 'dealer_profile_id', v_att.dealer_profile_id),
      'checks', '[]'::jsonb);
  END IF;

  v_business := s.application_snapshot->'tab_rows'->'BUSINESS'->0;
  IF jsonb_typeof(s.application_snapshot->'tab_rows'->'BRANCHES') = 'array' THEN
    FOR v_row, v_ord IN
      SELECT x.value, x.ord::int FROM jsonb_array_elements(s.application_snapshot->'tab_rows'->'BRANCHES')
        WITH ORDINALITY x(value, ord) WHERE x.ord <= 50 ORDER BY x.ord
    LOOP
      CONTINUE WHEN jsonb_typeof(v_row) <> 'object';
      v_branches := v_branches || jsonb_build_object('source_row', v_ord,
        'branch_ref', left(coalesce(v_row->>'branch_ref', ''), 120),
        'name', left(coalesce(v_row->>'branch_name', ''), 200),
        'city', left(coalesce(v_row->>'city', ''), 120),
        'has_gps', coalesce(v_row->>'gps_latitude', '') ~ '^-?[0-9]{1,3}(\.[0-9]{1,8})?$'
                   AND coalesce(v_row->>'gps_longitude', '') ~ '^-?[0-9]{1,3}(\.[0-9]{1,8})?$',
        'has_hours', length(btrim(coalesce(v_row->>'visiting_hours', ''))) > 0);
    END LOOP;
  END IF;
  SELECT coalesce(array_agg(DISTINCT x.section ORDER BY x.section), '{}') INTO v_declared_sections FROM (VALUES
    ('BUSINESS_OVERVIEW', 'BUSINESS', 'business_model'), ('BUSINESS_OVERVIEW', 'BUSINESS', 'business_email'),
    ('BUYER_ASSURANCE', 'BUYER_PROTECTION', 'independent_inspection'), ('BUYER_ASSURANCE', 'BUYER_PROTECTION', 'cancellation_policy'),
    ('BUYER_ASSURANCE', 'FINANCE_PAYMENTS', 'refund_conditions'), ('BUYER_ASSURANCE', 'BUYER_PROTECTION', 'complaint_process'),
    ('FINANCE_TERMS', 'BUYER_PROTECTION', 'deposit_policy'), ('FINANCE_TERMS', 'FINANCE_PAYMENTS', 'payment_methods'),
    ('FINANCE_TERMS', 'FINANCE_PAYMENTS', 'finance_partner'), ('FINANCE_TERMS', 'FINANCE_PAYMENTS', 'currencies'),
    ('SOURCING', 'OPERATIONS_SOURCING', 'sourcing_channels'), ('SOURCING', 'OPERATIONS_SOURCING', 'import_duty_policy'),
    ('WARRANTY_AFTERSALES', 'WORKSHOP_WARRANTY', 'warranty_coverage'), ('WARRANTY_AFTERSALES', 'WORKSHOP_WARRANTY', 'warranty_exclusions'),
    ('WARRANTY_AFTERSALES', 'WORKSHOP_WARRANTY', 'service_facility'), ('WARRANTY_AFTERSALES', 'WORKSHOP_WARRANTY', 'parts_support'),
    ('SERVICE_CAPABILITIES', 'WORKSHOP_WARRANTY', 'workshop_services')) x(section, tab, field)
   WHERE jsonb_typeof(s.application_snapshot->'tab_rows'->x.tab) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.application_snapshot->'tab_rows'->x.tab) e(value)
                  WHERE jsonb_typeof(e.value) = 'object'
                    AND length(btrim(coalesce(e.value->>x.field, ''))) > 0);

  -- The claimant's existing dealership (the only possible target; never matched by name/e-mail/phone).
  SELECT count(*)::int INTO v_links FROM dealer_approved_seed_links WHERE claimant_user_id = c.claimant_user_id;
  SELECT * INTO v_link FROM dealer_approved_seed_links WHERE claimant_user_id = c.claimant_user_id
   ORDER BY activated_at LIMIT 1;
  IF v_link.link_id IS NOT NULL THEN
    SELECT * INTO pl FROM dealer_legal_application_reviews WHERE legal_review_id = v_link.legal_review_id;
    SELECT * INTO d FROM dealer_profiles WHERE id = v_link.dealer_profile_id;
    SELECT coalesce(array_agg(DISTINCT section ORDER BY section), '{}') INTO v_existing_sections
      FROM dealer_operational_declaration_events WHERE dealer_profile_id = v_link.dealer_profile_id;
    v_target := jsonb_build_object(
      'organization_id', v_link.organization_id,
      'organization_name', (SELECT o.name FROM organizations o WHERE o.id = v_link.organization_id),
      'tenant_id', v_link.tenant_id, 'dealer_profile_id', v_link.dealer_profile_id,
      'primary_seed_dealer_id', v_link.seed_dealer_id, 'operating_status', v_link.operating_status,
      'legal_name', d.legal_name, 'trading_name', d.trading_name,
      'registration_number', d.registration_number, 'country_code', d.operating_country,
      'verified_issuer', pl.verified_issuer, 'legal_expires_at', pl.legal_expires_at,
      'existing_branch_count', (SELECT count(*) FROM dealer_branches b WHERE b.dealer_id = v_link.dealer_profile_id),
      'existing_sections', to_jsonb(v_existing_sections),
      'attached_claims', (SELECT count(*) FROM dealer_branch_claim_attachments a
                           WHERE a.primary_link_id = v_link.link_id AND a.attach_status = 'ACTIVE'));
  END IF;

  -- Ordered checks. Each entry: {check, ok}; the first failure is the blocker.
  v_ok := r.id IS NOT NULL AND r.is_verified IS TRUE
          AND r.role IN ('admin', 'reviewer', 'platform_admin', 'super_admin')
          AND r.id <> s.claimant_user_id AND r.id <> l.reviewer_user_id;
  v_checks := v_checks || jsonb_build_object('check', 'SEPARATE_INDEPENDENT_APPROVER', 'ok', coalesce(v_ok, false));
  IF NOT coalesce(v_ok, false) THEN v_blocker := coalesce(v_blocker, 'SEPARATE_RECONCILIATION_APPROVER_REQUIRED'); END IF;

  v_ok := NOT (dealer_reviewer_conflict_of_interest(p_reviewer_id, c.seed_dealer_id, v_link.tenant_id)
               OR (v_link.seed_dealer_id IS NOT NULL
                   AND dealer_reviewer_conflict_of_interest(p_reviewer_id, v_link.seed_dealer_id, NULL)));
  v_checks := v_checks || jsonb_build_object('check', 'NO_REVIEWER_CONFLICT_OF_INTEREST', 'ok', coalesce(v_ok, false));
  IF NOT coalesce(v_ok, false) THEN v_blocker := coalesce(v_blocker, 'DEALER_REVIEWER_CONFLICT_OF_INTEREST'); END IF;

  v_ok := c.claim_status = 'CLAIM_APPROVED' AND c.claimant_user_id = s.claimant_user_id;
  v_checks := v_checks || jsonb_build_object('check', 'CLAIM_STILL_APPROVED', 'ok', coalesce(v_ok, false));
  IF NOT coalesce(v_ok, false) THEN v_blocker := coalesce(v_blocker, 'CLAIM_AUTHORITY_EXPIRED'); END IF;

  SELECT * INTO p FROM dealer_country_legal_policy_authority
   WHERE country_code = l.country_code AND policy_version = l.policy_version;
  v_ok := p.policy_state = 'APPROVED' AND p.effective_at <= now() AND p.expires_at > now()
          AND l.legal_expires_at > now() AND p.approved_by IS DISTINCT FROM p_reviewer_id;
  v_checks := v_checks || jsonb_build_object('check', 'LEGAL_REVIEW_AND_COUNTRY_POLICY_CURRENT', 'ok', coalesce(v_ok, false));
  IF NOT coalesce(v_ok, false) THEN v_blocker := coalesce(v_blocker, 'LIVE_COUNTRY_LEGAL_POLICY_REQUIRED'); END IF;

  v_ok := NOT EXISTS (SELECT 1 FROM dealer_claim_compliance_submissions
                       WHERE claim_id = c.claim_id AND submitted_at > s.submitted_at);
  v_checks := v_checks || jsonb_build_object('check', 'LATEST_APPLICATION_VERSION', 'ok', coalesce(v_ok, false));
  IF NOT coalesce(v_ok, false) THEN v_blocker := coalesce(v_blocker, 'STALE_LEGAL_APPLICATION_CANNOT_RECONCILE'); END IF;

  v_ok := NOT EXISTS (SELECT 1 FROM dealer_research_claim_requests
                       WHERE seed_dealer_id = c.seed_dealer_id AND claim_id <> c.claim_id
                         AND claim_status NOT IN ('CLAIM_REJECTED', 'CLAIM_REVOKED'));
  v_checks := v_checks || jsonb_build_object('check', 'NO_COMPETING_CLAIM_ON_THIS_RESEARCH_RECORD', 'ok', coalesce(v_ok, false));
  IF NOT coalesce(v_ok, false) THEN v_blocker := coalesce(v_blocker, 'COMPETING_LIVE_CLAIM'); END IF;

  v_ok := NOT EXISTS (SELECT 1 FROM dealer_approved_seed_links
                       WHERE seed_dealer_id = c.seed_dealer_id OR claim_id = c.claim_id);
  v_checks := v_checks || jsonb_build_object('check', 'NOT_ALREADY_ITS_OWN_DEALERSHIP', 'ok', coalesce(v_ok, false));
  IF NOT coalesce(v_ok, false) THEN v_blocker := coalesce(v_blocker, 'CLAIM_ALREADY_ACTIVATED_AS_OWN_DEALERSHIP'); END IF;

  v_ok := l.approved_scope = 'BRANCH' AND c.claimed_scope = 'BRANCH';
  v_checks := v_checks || jsonb_build_object('check', 'APPROVED_SCOPE_IS_BRANCH', 'ok', coalesce(v_ok, false));
  IF NOT coalesce(v_ok, false) THEN v_blocker := coalesce(v_blocker, 'PARENT_ORGANIZATION_SCOPE_CANNOT_ATTACH_AS_BRANCH'); END IF;

  v_ok := NOT dealer_claim_evidence_quarantined(l.company_registration_evidence_id)
          AND NOT dealer_claim_evidence_quarantined(l.signatory_evidence_id);
  v_checks := v_checks || jsonb_build_object('check', 'LEGAL_EVIDENCE_NOT_QUARANTINED', 'ok', coalesce(v_ok, false));
  IF NOT coalesce(v_ok, false) THEN v_blocker := coalesce(v_blocker, 'LEGAL_EVIDENCE_QUARANTINED'); END IF;

  v_ok := v_links = 1;
  v_checks := v_checks || jsonb_build_object('check', 'CLAIMANT_HAS_ONE_EXISTING_DEALERSHIP', 'ok', coalesce(v_ok, false));
  IF NOT coalesce(v_ok, false) THEN
    v_blocker := coalesce(v_blocker, CASE WHEN v_links = 0
      THEN 'NO_EXISTING_DEALERSHIP_USE_STANDARD_ACTIVATION' ELSE 'AMBIGUOUS_EXISTING_DEALERSHIPS' END);
  END IF;

  v_ok := v_link.link_id IS NOT NULL AND v_link.operating_status = 'ACTIVE'
          AND dealer_tenant_listing_authority_current(v_link.tenant_id);
  v_checks := v_checks || jsonb_build_object('check', 'EXISTING_DEALERSHIP_ACTIVE_AND_CURRENT', 'ok', coalesce(v_ok, false));
  IF NOT coalesce(v_ok, false) THEN v_blocker := coalesce(v_blocker, 'EXISTING_DEALERSHIP_NOT_ACTIVE'); END IF;

  v_ok := v_link.link_id IS NOT NULL AND l.country_code = pl.country_code
          AND l.country_code = d.operating_country;
  v_checks := v_checks || jsonb_build_object('check', 'SAME_COUNTRY_OF_REGISTRATION', 'ok', coalesce(v_ok, false));
  IF NOT coalesce(v_ok, false) THEN v_blocker := coalesce(v_blocker, 'SEPARATE_LEGAL_ORGANIZATION_REQUIRES_GOVERNED_ONBOARDING'); END IF;

  v_ok := v_link.link_id IS NOT NULL
          AND dealer_registration_key(l.reviewed_registration_number) IS NOT NULL
          AND dealer_registration_key(l.reviewed_registration_number) = dealer_registration_key(pl.reviewed_registration_number)
          AND dealer_registration_key(l.reviewed_registration_number) = dealer_registration_key(d.registration_number);
  v_checks := v_checks || jsonb_build_object('check', 'SAME_INDEPENDENTLY_REVIEWED_REGISTRATION_NUMBER', 'ok', coalesce(v_ok, false));
  IF NOT coalesce(v_ok, false) THEN v_blocker := coalesce(v_blocker, 'SEPARATE_LEGAL_ORGANIZATION_REQUIRES_GOVERNED_ONBOARDING'); END IF;

  v_ok := v_link.link_id IS NOT NULL AND dealer_legal_name_key(v_business->>'legal_name') IS NOT NULL
          AND dealer_legal_name_key(v_business->>'legal_name') = dealer_legal_name_key(d.legal_name);
  v_checks := v_checks || jsonb_build_object('check', 'SAME_REGISTERED_LEGAL_NAME', 'ok', coalesce(v_ok, false));
  IF NOT coalesce(v_ok, false) THEN v_blocker := coalesce(v_blocker, 'LEGAL_IDENTITY_CONFLICT_REQUIRES_INDEPENDENT_REVIEW'); END IF;

  v_ok := v_link.link_id IS NOT NULL AND v_link.claimant_user_id = c.claimant_user_id
          AND EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = v_link.tenant_id
                        AND tu.user_id = c.claimant_user_id AND tu.role IN ('dealer', 'admin'))
          AND d.user_id = c.claimant_user_id;
  v_checks := v_checks || jsonb_build_object('check', 'CLAIMANT_IS_THE_EXISTING_LEGAL_OWNER', 'ok', coalesce(v_ok, false));
  IF NOT coalesce(v_ok, false) THEN v_blocker := coalesce(v_blocker, 'CLAIMANT_NOT_EXISTING_LEGAL_OWNER'); END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_blocker IS NULL THEN 'READY_TO_ATTACH' ELSE 'BLOCKED' END,
    'blocker', v_blocker,
    'checks', v_checks,
    'legal_review_id', l.legal_review_id, 'claim_id', c.claim_id, 'seed_dealer_id', c.seed_dealer_id,
    'submission_id', s.submission_id, 'application_version', s.intake_version,
    'incoming', jsonb_build_object(
      'declared_legal_name', left(coalesce(v_business->>'legal_name', ''), 180),
      'declared_trading_name', left(coalesce(v_business->>'trading_name', ''), 180),
      'reviewed_registration_number', l.reviewed_registration_number,
      'verified_issuer', l.verified_issuer, 'country_code', l.country_code,
      'approved_scope', l.approved_scope, 'legal_expires_at', l.legal_expires_at,
      'branches', v_branches, 'declared_sections', to_jsonb(v_declared_sections)),
    'target', v_target,
    'effects', jsonb_build_object(
      'organization_created', false, 'tenant_created', false, 'membership_changed', false,
      'public_publication', false, 'vehicle_listing_authority_changed', false,
      'branches_to_add', jsonb_array_length(v_branches),
      'sections_to_carry', (SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                              FROM unnest(v_declared_sections) x WHERE NOT x = ANY(v_existing_sections)),
      'sections_preserved', (SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                               FROM unnest(v_declared_sections) x WHERE x = ANY(v_existing_sections))));
END;
$$;

CREATE FUNCTION dealer_attachment_note(
  p_attachment UUID, p_submission UUID, p_profile UUID, p_tab TEXT, p_row INTEGER, p_field TEXT,
  p_target TEXT, p_target_id UUID, p_disposition TEXT, p_reason TEXT, p_raw JSONB
) RETURNS VOID LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO dealer_attachment_carryover_events(attachment_id, submission_id, dealer_profile_id,
    source_tab, source_row, source_field, target, target_id, disposition, reason, value_sha256)
  VALUES (p_attachment, p_submission, p_profile,
    CASE WHEN p_tab ~ '^[A-Z][A-Z_]{1,39}$' THEN p_tab ELSE 'UNRECOGNISED_TAB' END,
    least(greatest(p_row, 1), 250),
    CASE WHEN p_field ~ '^[a-z][a-z0-9_]{0,79}$' THEN p_field ELSE 'unrecognised_field' END,
    p_target, p_target_id, p_disposition, left(p_reason, 240),
    CASE WHEN p_raw IS NULL OR p_raw = 'null'::jsonb THEN NULL
         ELSE encode(sha256(convert_to(p_raw#>>'{}', 'UTF8')), 'hex') END)
  ON CONFLICT (attachment_id, source_tab, source_row, source_field) DO NOTHING;
END;
$$;

-- Carry the approved, frozen application of the ATTACHED claim into the existing dealer profile:
-- every valid branch becomes a NEW private branch (never an update of an incumbent branch, never a
-- name match), dealer-wide declaration sections are carried only where the dealership has none yet
-- (an existing — e.g. version 2 — declaration is preserved), and the identity fields are noted as
-- the incumbent's. Everything else stays private in the frozen submission (one summary note per tab).
CREATE FUNCTION dealer_carry_over_attachment_workbook(p_attachment_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a dealer_branch_claim_attachments%ROWTYPE;
  s dealer_claim_compliance_submissions%ROWTYPE;
  v_tabs JSONB; v_row JSONB; v_ord INTEGER; v_ref TEXT; v_refs TEXT[] := '{}';
  v_name TEXT; v_addr TEXT; v_part TEXT; v_lat TEXT; v_lng TEXT; v_hours TEXT; v_field TEXT;
  v_lat_n NUMERIC; v_lng_n NUMERIC; v_gps_ok BOOLEAN; v_branch UUID; v_added INTEGER := 0;
  v_section TEXT; v_values JSONB; v_notes JSONB; v_event UUID; n JSONB; m RECORD; v_cell RECORD;
  v_chosen INTEGER; v_chosen_text TEXT; v_existing INTEGER; v_carried TEXT[] := '{}'; v_preserved TEXT[] := '{}';
  v_tabname TEXT; v_retained INTEGER;
BEGIN
  SELECT * INTO a FROM dealer_branch_claim_attachments WHERE attachment_id = p_attachment_id;
  SELECT * INTO s FROM dealer_claim_compliance_submissions WHERE submission_id = a.submission_id;
  IF a.attachment_id IS NULL OR jsonb_typeof(s.application_snapshot->'tab_rows') <> 'object' THEN
    RAISE EXCEPTION 'RECONCILIATION_APPLICATION_UNREADABLE';
  END IF;
  v_tabs := s.application_snapshot->'tab_rows';

  -- 1. Identity: the existing dealership's independently reviewed legal identity stays canonical.
  v_row := v_tabs->'BUSINESS'->0;
  IF jsonb_typeof(v_row) = 'object' THEN
    FOREACH v_field IN ARRAY ARRAY['legal_name', 'trading_name', 'registration_number', 'operating_country'] LOOP
      IF dealer_carryover_text(v_row->v_field, 180) IS NOT NULL THEN
        PERFORM dealer_attachment_note(a.attachment_id, s.submission_id, a.dealer_profile_id, 'BUSINESS', 1,
          v_field, 'dealer_profiles.' || v_field, a.dealer_profile_id, 'NOT_CARRIED_INCUMBENT_PRESERVED',
          'The existing dealership''s reviewed company identity is kept; reconciliation confirmed it is the same legal company',
          v_row->v_field);
      END IF;
    END LOOP;
  END IF;

  -- 2. Branches: each valid row → a NEW private canonical branch of the existing profile.
  IF jsonb_typeof(v_tabs->'BRANCHES') = 'array' THEN
    FOR v_row, v_ord IN
      SELECT x.value, x.ord::int FROM jsonb_array_elements(v_tabs->'BRANCHES') WITH ORDINALITY x(value, ord)
       WHERE x.ord <= 250 ORDER BY x.ord
    LOOP
      CONTINUE WHEN jsonb_typeof(v_row) <> 'object';
      v_ref := coalesce(dealer_carryover_text(v_row->'branch_ref', 120), 'ROW-' || v_ord);
      IF v_ref = E'\x01INVALID' THEN v_ref := 'ROW-' || v_ord; END IF;
      v_name := dealer_carryover_text(v_row->'branch_name', 200);
      IF v_ref = ANY(v_refs) THEN
        PERFORM dealer_attachment_note(a.attachment_id, s.submission_id, a.dealer_profile_id, 'BRANCHES', v_ord,
          'branch_name', 'dealer_branches', NULL, 'NOT_CARRIED_DUPLICATE',
          'Duplicate branch reference in the application; the first row was carried', v_row->'branch_name');
        CONTINUE;
      END IF;
      IF v_name IS NULL OR v_name = E'\x01INVALID' OR v_added >= 50 THEN
        PERFORM dealer_attachment_note(a.attachment_id, s.submission_id, a.dealer_profile_id, 'BRANCHES', v_ord,
          'branch_name', 'dealer_branches', NULL, 'NOT_CARRIED_INVALID',
          CASE WHEN v_added >= 50 THEN 'Branch limit of 50 reached' ELSE 'A branch needs a safe, non-empty name' END,
          v_row->'branch_name');
        CONTINUE;
      END IF;
      v_refs := v_refs || v_ref;
      v_addr := NULL;
      FOREACH v_field IN ARRAY ARRAY['physical_address', 'suburb', 'city', 'province'] LOOP
        v_part := dealer_carryover_text(v_row->v_field, 200);
        IF v_part IS NOT NULL AND v_part <> E'\x01INVALID' THEN
          v_addr := CASE WHEN v_addr IS NULL THEN v_part ELSE v_addr || ', ' || v_part END;
        END IF;
      END LOOP;
      v_addr := left(v_addr, 500);
      v_lat := dealer_carryover_text(v_row->'gps_latitude', 20);
      v_lng := dealer_carryover_text(v_row->'gps_longitude', 20);
      v_gps_ok := false; v_lat_n := NULL; v_lng_n := NULL;
      IF v_lat ~ '^-?[0-9]{1,3}(\.[0-9]{1,8})?$' AND v_lng ~ '^-?[0-9]{1,3}(\.[0-9]{1,8})?$' THEN
        v_lat_n := round(v_lat::numeric, 6); v_lng_n := round(v_lng::numeric, 6);
        v_gps_ok := v_lat_n BETWEEN -90 AND 90 AND v_lng_n BETWEEN -180 AND 180;
      END IF;
      IF NOT v_gps_ok THEN v_lat_n := NULL; v_lng_n := NULL; END IF;
      v_hours := dealer_carryover_text(v_row->'visiting_hours', 350);
      IF v_hours = E'\x01INVALID' THEN v_hours := NULL; END IF;
      INSERT INTO dealer_branches(dealer_id, name, address, latitude, longitude, opening_hours_text,
        operating_details_updated_at)
      VALUES (a.dealer_profile_id, v_name, v_addr, v_lat_n, v_lng_n, v_hours,
        CASE WHEN v_gps_ok OR v_hours IS NOT NULL THEN now() END)
      RETURNING id INTO v_branch;
      INSERT INTO dealer_attachment_branch_crosswalk(attachment_id, submission_id, source_row, branch_ref, branch_id)
      VALUES (a.attachment_id, s.submission_id, v_ord, v_ref, v_branch);
      v_added := v_added + 1;
      PERFORM dealer_attachment_note(a.attachment_id, s.submission_id, a.dealer_profile_id, 'BRANCHES', v_ord,
        'branch_name', 'dealer_branches.name', v_branch, 'CARRIED_UNVERIFIED',
        CASE WHEN EXISTS (SELECT 1 FROM dealer_branches b WHERE b.dealer_id = a.dealer_profile_id
                            AND b.id <> v_branch AND lower(btrim(b.name)) = lower(v_name))
             THEN 'Carried as its own branch; an existing branch has the same name and was NOT merged (branches match only by approved claim provenance)'
             ELSE 'Declared branch of the approved claim carried as a private canonical branch' END,
        v_row->'branch_name');
      FOREACH v_field IN ARRAY ARRAY['gps_latitude', 'gps_longitude'] LOOP
        IF dealer_carryover_text(v_row->v_field, 20) IS NOT NULL THEN
          PERFORM dealer_attachment_note(a.attachment_id, s.submission_id, a.dealer_profile_id, 'BRANCHES', v_ord,
            v_field, CASE v_field WHEN 'gps_latitude' THEN 'dealer_branches.latitude' ELSE 'dealer_branches.longitude' END,
            v_branch, CASE WHEN v_gps_ok THEN 'CARRIED_UNVERIFIED' ELSE 'NOT_CARRIED_INVALID' END,
            CASE WHEN v_gps_ok THEN 'Declared coordinate carried privately; never a verified public location'
                 ELSE 'GPS needs both a latitude (-90..90) and a longitude (-180..180)' END, v_row->v_field);
        END IF;
      END LOOP;
      IF dealer_carryover_text(v_row->'visiting_hours', 350) IS NOT NULL THEN
        PERFORM dealer_attachment_note(a.attachment_id, s.submission_id, a.dealer_profile_id, 'BRANCHES', v_ord,
          'visiting_hours', 'dealer_branches.opening_hours_text', v_branch,
          CASE WHEN v_hours IS NOT NULL THEN 'CARRIED_UNVERIFIED' ELSE 'NOT_CARRIED_INVALID' END,
          CASE WHEN v_hours IS NOT NULL THEN 'Declared schedule carried; never an open-now assertion'
               ELSE 'Unsafe or over-long opening hours were not carried' END, v_row->'visiting_hours');
      END IF;
      IF v_addr IS NOT NULL THEN
        PERFORM dealer_attachment_note(a.attachment_id, s.submission_id, a.dealer_profile_id, 'BRANCHES', v_ord,
          'physical_address', 'dealer_branches.address', v_branch, 'CARRIED_UNVERIFIED',
          'Declared location carried; not an independently verified site', to_jsonb(v_addr));
      END IF;
    END LOOP;
  END IF;

  -- 3. Dealer-wide declaration sections: carried as version 1 ONLY where the dealership has none.
  FOR v_section IN SELECT DISTINCT x.section FROM (VALUES
     ('BUSINESS_OVERVIEW'), ('BUYER_ASSURANCE'), ('FINANCE_TERMS'), ('SOURCING'),
     ('WARRANTY_AFTERSALES'), ('SERVICE_CAPABILITIES')) x(section) ORDER BY 1
  LOOP
    v_values := '{}'::jsonb; v_notes := '[]'::jsonb;
    FOR m IN SELECT * FROM (VALUES
      ('BUSINESS_OVERVIEW', 'public_description', 'BUSINESS', 'business_model'),
      ('BUSINESS_OVERVIEW', 'declared_contact_email', 'BUSINESS', 'business_email'),
      ('BUYER_ASSURANCE', 'inspection_rights', 'BUYER_PROTECTION', 'independent_inspection'),
      ('BUYER_ASSURANCE', 'cancellation_policy', 'BUYER_PROTECTION', 'cancellation_policy'),
      ('BUYER_ASSURANCE', 'refund_policy', 'FINANCE_PAYMENTS', 'refund_conditions'),
      ('BUYER_ASSURANCE', 'dispute_resolution', 'BUYER_PROTECTION', 'complaint_process'),
      ('FINANCE_TERMS', 'deposit_terms', 'BUYER_PROTECTION', 'deposit_policy'),
      ('FINANCE_TERMS', 'accepted_payment_methods', 'FINANCE_PAYMENTS', 'payment_methods'),
      ('FINANCE_TERMS', 'finance_partner_disclosure', 'FINANCE_PAYMENTS', 'finance_partner'),
      ('FINANCE_TERMS', 'currency_disclosure', 'FINANCE_PAYMENTS', 'currencies'),
      ('SOURCING', 'sourcing_channels', 'OPERATIONS_SOURCING', 'sourcing_channels'),
      ('SOURCING', 'import_duty_disclosure', 'OPERATIONS_SOURCING', 'import_duty_policy'),
      ('WARRANTY_AFTERSALES', 'warranty_scope', 'WORKSHOP_WARRANTY', 'warranty_coverage'),
      ('WARRANTY_AFTERSALES', 'warranty_exclusions', 'WORKSHOP_WARRANTY', 'warranty_exclusions'),
      ('WARRANTY_AFTERSALES', 'repair_support', 'WORKSHOP_WARRANTY', 'service_facility'),
      ('WARRANTY_AFTERSALES', 'spare_parts_support', 'WORKSHOP_WARRANTY', 'parts_support'),
      ('SERVICE_CAPABILITIES', 'workshop_services', 'WORKSHOP_WARRANTY', 'workshop_services'))
      y(section, decl_key, tab, field) WHERE y.section = v_section
    LOOP
      CONTINUE WHEN jsonb_typeof(v_tabs->m.tab) <> 'array';
      v_chosen := NULL; v_chosen_text := NULL;
      FOR v_cell IN
        SELECT e.ord::int AS ord, e.value->m.field AS raw, dealer_carryover_text(e.value->m.field, 750) AS txt
          FROM jsonb_array_elements(v_tabs->m.tab) WITH ORDINALITY e(value, ord)
         WHERE e.ord <= 250 AND jsonb_typeof(e.value) = 'object'
         ORDER BY (nullif(btrim(coalesce(e.value->>'branch_ref', '')), '') IS NOT NULL), e.ord
      LOOP
        CONTINUE WHEN v_cell.txt IS NULL;
        IF v_cell.txt = E'\x01INVALID' THEN
          v_notes := v_notes || jsonb_build_object('tab', m.tab, 'row', v_cell.ord, 'field', m.field,
            'disposition', 'NOT_CARRIED_INVALID', 'reason', 'Unsafe, non-text or over-long (750) value was not carried', 'raw', v_cell.raw);
        ELSIF v_chosen IS NULL THEN
          v_chosen := v_cell.ord; v_chosen_text := v_cell.txt;
          v_values := v_values || jsonb_build_object(m.decl_key, v_cell.txt);
          v_notes := v_notes || jsonb_build_object('tab', m.tab, 'row', v_cell.ord, 'field', m.field,
            'disposition', 'CARRIED_UNVERIFIED', 'target', 'declaration:' || v_section || '.' || m.decl_key,
            'reason', 'Carried as a private, unverified dealer declaration (version 1)', 'raw', v_cell.raw);
        ELSIF v_cell.txt = v_chosen_text THEN
          v_notes := v_notes || jsonb_build_object('tab', m.tab, 'row', v_cell.ord, 'field', m.field,
            'disposition', 'NOT_CARRIED_DUPLICATE', 'reason', 'Same value as row ' || v_chosen || ', which was considered', 'raw', v_cell.raw);
        ELSE
          v_notes := v_notes || jsonb_build_object('tab', m.tab, 'row', v_cell.ord, 'field', m.field,
            'disposition', 'NOT_CARRIED_CONFLICT',
            'reason', 'Section is dealer-wide; row ' || v_chosen || ' was considered and this differing value was not merged', 'raw', v_cell.raw);
        END IF;
      END LOOP;
    END LOOP;
    CONTINUE WHEN v_values = '{}'::jsonb AND jsonb_array_length(v_notes) = 0;
    v_event := NULL;
    SELECT max(section_version) INTO v_existing FROM dealer_operational_declaration_events
     WHERE dealer_profile_id = a.dealer_profile_id AND section = v_section;
    IF v_values <> '{}'::jsonb AND v_existing IS NULL THEN
      INSERT INTO dealer_operational_declaration_events(dealer_profile_id, tenant_id, actor_user_id,
        section, section_version, declared_values, content_sha256)
      VALUES (a.dealer_profile_id, a.tenant_id, a.claimant_user_id, v_section, 1, v_values,
        encode(sha256(convert_to(v_values::text, 'UTF8')), 'hex'))
      RETURNING event_id INTO v_event;
      v_carried := v_carried || v_section;
    ELSIF v_values <> '{}'::jsonb THEN
      v_preserved := v_preserved || v_section;
    END IF;
    FOR n IN SELECT value FROM jsonb_array_elements(v_notes) LOOP
      PERFORM dealer_attachment_note(a.attachment_id, s.submission_id, a.dealer_profile_id, n->>'tab',
        (n->>'row')::int, n->>'field', coalesce(n->>'target', 'declaration:' || v_section),
        CASE WHEN n->>'disposition' = 'CARRIED_UNVERIFIED' THEN v_event END,
        CASE WHEN n->>'disposition' = 'CARRIED_UNVERIFIED' AND v_event IS NULL
             THEN 'NOT_CARRIED_INCUMBENT_PRESERVED' ELSE n->>'disposition' END,
        CASE WHEN n->>'disposition' = 'CARRIED_UNVERIFIED' AND v_event IS NULL
             THEN 'The dealership''s existing declaration (version ' || v_existing || ') is kept and was not overwritten'
             ELSE n->>'reason' END,
        n->'raw');
    END LOOP;
  END LOOP;

  -- 4. Everything else stays private in the frozen application: one summary note per contract tab.
  FOR v_tabname IN SELECT t.key FROM jsonb_object_keys(v_tabs) t(key)
     WHERE EXISTS (SELECT 1 FROM dealer_intake_contract_fields() f WHERE f.tab = t.key) ORDER BY 1
  LOOP
    CONTINUE WHEN jsonb_typeof(v_tabs->v_tabname) <> 'array';
    SELECT count(*)::int INTO v_retained
      FROM jsonb_array_elements(v_tabs->v_tabname) WITH ORDINALITY e(value, ord)
      CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(e.value) = 'object' THEN e.value ELSE '{}'::jsonb END) c
     WHERE e.ord <= 250 AND dealer_carryover_text(c.value, 750) IS NOT NULL
       AND c.key NOT IN ('claim_reference', 'source_seed_id', 'research_display_name', 'branch_ref', 'brand_claim_ref',
                         'authorization_ref', 'operation_ref', 'policy_ref', 'buyer_policy_ref', 'media_ref');
    IF v_retained > 0 THEN
      PERFORM dealer_attachment_note(a.attachment_id, s.submission_id, a.dealer_profile_id, v_tabname, 1,
        'tab_values_retained', 'frozen_submission', NULL, 'RETAINED_PRIVATE_NOT_CANONICAL',
        v_retained || ' declared value(s) on this tab stay private in the frozen approved application', NULL);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('branches_added', v_added, 'sections_carried', to_jsonb(v_carried),
    'sections_preserved', to_jsonb(v_preserved));
END;
$$;

CREATE FUNCTION dealer_reconcile_approved_branch_claim(
  p_legal_review_id UUID, p_approver_id TEXT, p_reason TEXT, p_expected_organization_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  l dealer_legal_application_reviews%ROWTYPE;
  s dealer_claim_compliance_submissions%ROWTYPE;
  c dealer_research_claim_requests%ROWTYPE;
  v_link dealer_approved_seed_links%ROWTYPE;
  v_att dealer_branch_claim_attachments%ROWTYPE;
  r users%ROWTYPE;
  v_assessment JSONB;
  v_id UUID;
  v_carry JSONB;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 80 AND 3000 THEN
    RAISE EXCEPTION 'RECONCILIATION_REASON_REQUIRED';
  END IF;
  IF p_expected_organization_id IS NULL OR length(p_expected_organization_id) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'RECONCILIATION_TARGET_CONFIRMATION_REQUIRED';
  END IF;
  -- Case rows first (same order as activation), then the target in the documented lock order:
  -- tenants → dealer_profiles → dealer_approved_seed_links (no vehicles are touched).
  SELECT * INTO l FROM dealer_legal_application_reviews WHERE legal_review_id = p_legal_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEGAL_REVIEW_NOT_FOUND'; END IF;
  SELECT * INTO s FROM dealer_claim_compliance_submissions WHERE submission_id = l.submission_id FOR UPDATE;
  SELECT * INTO c FROM dealer_research_claim_requests WHERE claim_id = s.claim_id FOR UPDATE;
  -- The approver is checked BEFORE any replay answer: a claimant, the legal reviewer or a conflicted
  -- reviewer never even receives the idempotent receipt.
  SELECT * INTO r FROM users WHERE id = p_approver_id;
  IF NOT FOUND OR r.is_verified IS DISTINCT FROM true
     OR r.role NOT IN ('admin', 'reviewer', 'platform_admin', 'super_admin')
     OR r.id = s.claimant_user_id OR r.id = l.reviewer_user_id THEN
    RAISE EXCEPTION 'SEPARATE_RECONCILIATION_APPROVER_REQUIRED';
  END IF;
  SELECT * INTO v_att FROM dealer_branch_claim_attachments WHERE claim_id = c.claim_id FOR UPDATE;
  IF FOUND AND dealer_reviewer_conflict_of_interest(p_approver_id, c.seed_dealer_id, v_att.tenant_id) THEN
    RAISE EXCEPTION 'DEALER_REVIEWER_CONFLICT_OF_INTEREST' USING ERRCODE = '42501';
  END IF;
  IF v_att.attachment_id IS NOT NULL THEN
    IF v_att.attach_status = 'ACTIVE' AND v_att.legal_review_id = l.legal_review_id
       AND v_att.organization_id = p_expected_organization_id THEN
      RETURN jsonb_build_object('idempotent', true, 'attachment_id', v_att.attachment_id,
        'seed_dealer_id', v_att.seed_dealer_id, 'organization_id', v_att.organization_id,
        'tenant_id', v_att.tenant_id, 'dealer_profile_id', v_att.dealer_profile_id,
        'organization_created', false, 'tenant_created', false, 'membership_changed', false,
        'public_publication_granted', false, 'vehicle_listing_authority_granted', false,
        'payment_entitlement_granted', false);
    END IF;
    RAISE EXCEPTION 'RECONCILIATION_EXISTS_OR_SUSPENDED';
  END IF;
  SELECT * INTO v_link FROM dealer_approved_seed_links WHERE claimant_user_id = c.claimant_user_id
   ORDER BY activated_at LIMIT 1;
  IF FOUND THEN
    PERFORM 1 FROM tenants WHERE id = v_link.tenant_id FOR NO KEY UPDATE;
    PERFORM 1 FROM dealer_profiles WHERE id = v_link.dealer_profile_id FOR NO KEY UPDATE;
    SELECT * INTO v_link FROM dealer_approved_seed_links WHERE link_id = v_link.link_id FOR UPDATE;
  END IF;
  v_assessment := dealer_preview_branch_claim_reconciliation(p_legal_review_id, p_approver_id);
  IF v_assessment->>'blocker' IS NOT NULL THEN
    RAISE EXCEPTION '%', v_assessment->>'blocker';
  END IF;
  IF v_assessment->>'state' <> 'READY_TO_ATTACH' THEN
    RAISE EXCEPTION 'RECONCILIATION_EXISTS_OR_SUSPENDED';
  END IF;
  IF v_assessment#>>'{target,organization_id}' IS DISTINCT FROM p_expected_organization_id THEN
    RAISE EXCEPTION 'RECONCILIATION_TARGET_CHANGED';
  END IF;
  INSERT INTO dealer_branch_claim_attachments(seed_dealer_id, claim_id, submission_id, legal_review_id,
    primary_link_id, organization_id, tenant_id, dealer_profile_id, claimant_user_id,
    verified_registration_key, attached_by, attach_reason)
  VALUES (c.seed_dealer_id, c.claim_id, s.submission_id, l.legal_review_id, v_link.link_id,
    v_link.organization_id, v_link.tenant_id, v_link.dealer_profile_id, c.claimant_user_id,
    dealer_registration_key(l.reviewed_registration_number), p_approver_id, btrim(p_reason))
  RETURNING attachment_id INTO v_id;
  v_carry := dealer_carry_over_attachment_workbook(v_id);
  RETURN jsonb_build_object('idempotent', false, 'attachment_id', v_id,
    'seed_dealer_id', c.seed_dealer_id, 'organization_id', v_link.organization_id,
    'tenant_id', v_link.tenant_id, 'dealer_profile_id', v_link.dealer_profile_id,
    'primary_seed_dealer_id', v_link.seed_dealer_id, 'carryover', v_carry,
    'organization_created', false, 'tenant_created', false, 'membership_changed', false,
    'public_publication_granted', false, 'vehicle_listing_authority_granted', false,
    'payment_entitlement_granted', false);
END;
$$;

-- Owner read model: the claims attached to this dealership, each with its own status, legal expiry,
-- branches and carried/preserved sections. The service layer enforces the owner workspace.
CREATE FUNCTION dealer_read_branch_attachments(p_profile_id UUID, p_tenant_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'attachment_id', a.attachment_id, 'seed_dealer_id', a.seed_dealer_id, 'claim_id', a.claim_id,
    'legal_review_id', a.legal_review_id, 'application_version', s.intake_version,
    'attach_status', a.attach_status,
    'effective_status', CASE
      WHEN a.attach_status <> 'ACTIVE' THEN a.attach_status
      WHEN pl.operating_status <> 'ACTIVE' THEN 'SUSPENDED_WITH_DEALERSHIP'
      WHEN lr.legal_expires_at <= now() THEN 'LEGAL_REVIEW_EXPIRED'
      ELSE 'ACTIVE' END,
    'legal_expires_at', lr.legal_expires_at, 'attached_at', a.attached_at,
    'status_changed_at', a.status_changed_at,
    'branches', coalesce((SELECT jsonb_agg(jsonb_build_object('branch_id', x.branch_id,
        'branch_ref', x.branch_ref, 'source_row', x.source_row, 'name', b.name,
        'has_gps', b.latitude IS NOT NULL, 'has_hours', b.opening_hours_text IS NOT NULL) ORDER BY x.source_row)
      FROM dealer_attachment_branch_crosswalk x JOIN dealer_branches b ON b.id = x.branch_id
      WHERE x.attachment_id = a.attachment_id), '[]'::jsonb),
    'sections_carried', coalesce((SELECT jsonb_agg(DISTINCT split_part(substr(e.target, 13), '.', 1))
      FROM dealer_attachment_carryover_events e WHERE e.attachment_id = a.attachment_id
       AND e.disposition = 'CARRIED_UNVERIFIED' AND e.target LIKE 'declaration:%'), '[]'::jsonb),
    'sections_preserved', coalesce((SELECT jsonb_agg(DISTINCT split_part(substr(e.target, 13), '.', 1))
      FROM dealer_attachment_carryover_events e WHERE e.attachment_id = a.attachment_id
       AND e.disposition = 'NOT_CARRIED_INCUMBENT_PRESERVED' AND e.target LIKE 'declaration:%'), '[]'::jsonb),
    'counts', (SELECT coalesce(jsonb_object_agg(z.disposition, z.n), '{}'::jsonb) FROM
      (SELECT disposition, count(*)::int AS n FROM dealer_attachment_carryover_events
        WHERE attachment_id = a.attachment_id GROUP BY disposition) z),
    'independently_verified', false, 'publicly_approved', false) ORDER BY a.attached_at), '[]'::jsonb)
  FROM dealer_branch_claim_attachments a
  JOIN dealer_claim_compliance_submissions s ON s.submission_id = a.submission_id
  JOIN dealer_legal_application_reviews lr ON lr.legal_review_id = a.legal_review_id
  JOIN dealer_approved_seed_links pl ON pl.link_id = a.primary_link_id
  WHERE a.dealer_profile_id = p_profile_id AND a.tenant_id = p_tenant_id
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Company profile image + cover image are dealer MEDIA (P1 profile redesign)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_name TEXT;
BEGIN
  SELECT con.conname INTO v_name FROM pg_constraint con
   WHERE con.conrelid = 'dealer_storefront_media_items'::regclass AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) LIKE '%media_category%';
  IF v_name IS NULL THEN RAISE EXCEPTION 'DEALER_MEDIA_CATEGORY_CONSTRAINT_NOT_FOUND'; END IF;
  EXECUTE format('ALTER TABLE dealer_storefront_media_items DROP CONSTRAINT %I', v_name);
END;
$$;
ALTER TABLE dealer_storefront_media_items ADD CONSTRAINT dealer_storefront_media_items_media_category_check
  CHECK (media_category IN ('SHOWROOM_EXTERIOR', 'SHOWROOM_INTERIOR', 'BRANCH_FACILITY', 'SERVICE_BAY',
                            'COMPANY_PROFILE_IMAGE', 'COMPANY_COVER_IMAGE'));

CREATE OR REPLACE FUNCTION dealer_record_storefront_media_upload(
  p_actor_id TEXT,
  p_tenant_id UUID,
  p_branch_id UUID,
  p_storage_path TEXT,
  p_content_sha256 TEXT,
  p_mime_type TEXT,
  p_file_bytes INTEGER,
  p_media_category TEXT,
  p_caption TEXT,
  p_alt_text TEXT,
  p_rights_attestation TEXT,
  p_oem_logo_claimed BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link dealer_approved_seed_links%ROWTYPE;
  v_media_id UUID;
BEGIN
  IF coalesce(p_oem_logo_claimed, false) IS TRUE
     OR p_rights_attestation IS DISTINCT FROM 'DEALER_OWNED_PHOTOGRAPH_NO_OEM_OR_THIRD_PARTY_LOGO' THEN
    RAISE EXCEPTION 'OEM_OR_LOGO_MEDIA_RIGHTS_NOT_PERMITTED';
  END IF;

  SELECT * INTO v_link
    FROM dealer_approved_seed_links
   WHERE tenant_id = p_tenant_id
     AND claimant_user_id = p_actor_id
     AND operating_status = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND OR NOT dealer_tenant_listing_authority_current(p_tenant_id) THEN
    RAISE EXCEPTION 'DEALER_MEDIA_UPLOAD_AUTHORITY_NOT_CURRENT';
  END IF;

  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dealer_branches b
     WHERE b.id = p_branch_id AND b.dealer_id = v_link.dealer_profile_id
  ) THEN
    RAISE EXCEPTION 'BRANCH_NOT_OWNED_BY_APPROVED_DEALER';
  END IF;

  -- UAT-R1: a company profile/cover image is company-level, never tied to a branch.
  IF p_media_category IN ('COMPANY_PROFILE_IMAGE', 'COMPANY_COVER_IMAGE') AND p_branch_id IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_DEALER_MEDIA_METADATA';
  END IF;

  IF p_media_category NOT IN ('SHOWROOM_EXTERIOR', 'SHOWROOM_INTERIOR', 'BRANCH_FACILITY', 'SERVICE_BAY',
                              'COMPANY_PROFILE_IMAGE', 'COMPANY_COVER_IMAGE')
     OR p_mime_type NOT IN ('image/jpeg', 'image/png')
     OR p_file_bytes IS NULL OR p_file_bytes NOT BETWEEN 32 AND 4194304
     OR length(btrim(coalesce(p_caption, ''))) NOT BETWEEN 5 AND 240
     OR length(btrim(coalesce(p_alt_text, ''))) NOT BETWEEN 5 AND 240
     OR p_caption ~ '<\s*[/!a-zA-Z]'
     OR p_alt_text ~ '<\s*[/!a-zA-Z]' THEN
    RAISE EXCEPTION 'INVALID_DEALER_MEDIA_METADATA';
  END IF;

  INSERT INTO dealer_storefront_media_items (
    seed_dealer_id, link_id, tenant_id, dealer_profile_id, branch_id, uploaded_by,
    storage_bucket, storage_path, content_sha256, mime_type, file_bytes, scan_state,
    media_category, caption, alt_text, rights_attestation, oem_or_brand_logo_claimed,
    logo_rights_approved, review_status
  ) VALUES (
    v_link.seed_dealer_id, v_link.link_id, v_link.tenant_id, v_link.dealer_profile_id, p_branch_id, p_actor_id,
    'ocr-documents', p_storage_path, p_content_sha256, p_mime_type, p_file_bytes, 'CLEAN_CLAMAV_AT_UPLOAD',
    p_media_category, btrim(p_caption), btrim(p_alt_text), p_rights_attestation, false,
    false, 'PENDING_INDEPENDENT_REVIEW'
  ) RETURNING media_id INTO v_media_id;

  RETURN jsonb_build_object(
    'media_id', v_media_id,
    'seed_dealer_id', v_link.seed_dealer_id,
    'tenant_id', v_link.tenant_id,
    'branch_id', p_branch_id,
    'media_category', p_media_category,
    'review_status', 'PENDING_INDEPENDENT_REVIEW',
    'logo_rights_approved', false,
    'public_display_approved', false
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Least privilege (same discipline as R6 round 2 §4): RPCs for the backend; helpers and trigger
--    functions are never API surface.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION dealer_registration_key(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION dealer_legal_name_key(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION dealer_claim_evidence_quarantined(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION dealer_attachment_note(UUID, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, UUID, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION dealer_carry_over_attachment_workbook(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION dealer_guard_decision_evidence_not_quarantined() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION dealer_guard_branch_claim_attachment_write() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION dealer_guard_seed_link_not_attached() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION dealer_withdraw_attachment_on_claim_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION dealer_quarantine_claim_evidence(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_quarantine_claim_evidence(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION dealer_preview_branch_claim_reconciliation(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_preview_branch_claim_reconciliation(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION dealer_reconcile_approved_branch_claim(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_reconcile_approved_branch_claim(UUID, TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION dealer_read_branch_attachments(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_read_branch_attachments(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION dealer_record_storefront_media_upload(TEXT, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_record_storefront_media_upload(TEXT, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, BOOLEAN)
  TO service_role;

-- +migrate Down
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = public, pg_temp;
DO $txnmark$
BEGIN
  -- R6 DBA review 4: the transaction marker is this transaction's own id, so a value preset at
  -- session, role or database level (or through PGOPTIONS) can never satisfy the guard below.
  PERFORM set_config('carup.dealer_migration_txn', txid_current()::text, true);
END
$txnmark$;
DO $txnguard$
BEGIN
  -- R6 DBA review 3 N2 / review 4: SET LOCAL is a silent no-op outside a transaction block, so a
  -- section applied statement by statement in autocommit (plain `psql -f`, an interactive paste)
  -- would lose its bounds and could apply half-way. When the marker set just above is not this
  -- transaction's own, the statements are not sharing one transaction: make the REST OF THIS
  -- SESSION read-only and return WITHOUT raising (a raise would roll the setting back; ending the
  -- session would let an interactive psql reconnect and run the remaining statements). Every later
  -- change in this session then fails with SQLSTATE 25006, so nothing can be applied half-way.
  IF current_setting('carup.dealer_migration_txn', true) IS DISTINCT FROM txid_current()::text THEN
    PERFORM set_config('default_transaction_read_only', 'on', false);
    PERFORM set_config('transaction_read_only', 'on', true);
    RAISE WARNING 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION: this session is now read-only. Apply ONLY through backend/scripts/dealership/applyDealerMigrations.mjs, or psql -1 -v ON_ERROR_STOP=1 on a file containing a single section (Up OR Down).';
    RETURN;
  END IF;
  -- R6 DBA review 4 R1: this version's Up ran earlier in THIS transaction — a whole file (Up then
  -- Down) was applied as one transaction, which would silently undo itself. Refuse loudly; the
  -- whole transaction rolls back.
  IF current_setting('carup.dealer_migration_up_v20261103147000', true) = txid_current()::text THEN
    RAISE EXCEPTION 'DEALER_MIGRATION_WHOLE_FILE_APPLY_REFUSED: the Up and the Down of 20261103147000 ran in one transaction'
      USING HINT = 'Apply ONLY through backend/scripts/dealership/applyDealerMigrations.mjs, or psql -1 -v ON_ERROR_STOP=1 on a file containing a single section.';
  END IF;
END
$txnguard$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dealer_branch_claim_attachments)
     OR EXISTS (SELECT 1 FROM dealer_claim_evidence_quarantine_events)
     OR EXISTS (SELECT 1 FROM dealer_storefront_media_items
                 WHERE media_category IN ('COMPANY_PROFILE_IMAGE', 'COMPANY_COVER_IMAGE')) THEN
    RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_DEALER_UAT_R1_CUSTODY';
  END IF;
END;
$$;
DROP TRIGGER IF EXISTS dealer_uat_r1_attachment_claim_revocation ON dealer_research_claim_requests;
DROP TRIGGER IF EXISTS dealer_uat_r1_seed_link_not_attached ON dealer_approved_seed_links;
DROP TRIGGER IF EXISTS dealer_uat_r1_activation_evidence_gate ON dealer_approved_seed_links;
DROP TRIGGER IF EXISTS dealer_uat_r1_claim_review_evidence_gate ON dealer_claim_review_events;
DROP TRIGGER IF EXISTS dealer_uat_r1_legal_review_evidence_gate ON dealer_legal_application_reviews;
DROP TRIGGER IF EXISTS dealer_uat_r1_submission_evidence_gate ON dealer_claim_compliance_submissions;
DROP FUNCTION IF EXISTS dealer_read_branch_attachments(UUID, UUID);
DROP FUNCTION IF EXISTS dealer_reconcile_approved_branch_claim(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS dealer_carry_over_attachment_workbook(UUID);
DROP FUNCTION IF EXISTS dealer_attachment_note(UUID, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, UUID, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS dealer_preview_branch_claim_reconciliation(UUID, TEXT);
-- Restore the pre-UAT-R1 conflict-of-interest rule (identical to 20261103145000) BEFORE the table it
-- now reads is dropped.
CREATE OR REPLACE FUNCTION dealer_reviewer_conflict_of_interest(
  p_reviewer_id TEXT, p_seed_dealer_id TEXT, p_tenant_id UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p_reviewer_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM dealer_research_claim_requests c
             WHERE c.seed_dealer_id = p_seed_dealer_id AND c.claimant_user_id = p_reviewer_id)
    OR EXISTS (SELECT 1 FROM dealer_approved_seed_links l
                WHERE l.seed_dealer_id = p_seed_dealer_id
                  AND (l.claimant_user_id = p_reviewer_id
                       OR EXISTS (SELECT 1 FROM tenant_users tu
                                   WHERE tu.tenant_id = l.tenant_id AND tu.user_id = p_reviewer_id)))
    OR (p_tenant_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = p_tenant_id AND tu.user_id = p_reviewer_id))
  );
$$;
DROP TABLE IF EXISTS dealer_attachment_carryover_events;
DROP TABLE IF EXISTS dealer_attachment_branch_crosswalk;
DROP TABLE IF EXISTS dealer_branch_claim_attachments;
DROP FUNCTION IF EXISTS dealer_guard_branch_claim_attachment_write();
DROP FUNCTION IF EXISTS dealer_guard_seed_link_not_attached();
DROP FUNCTION IF EXISTS dealer_withdraw_attachment_on_claim_change();
DROP FUNCTION IF EXISTS dealer_guard_decision_evidence_not_quarantined();
DROP FUNCTION IF EXISTS dealer_quarantine_claim_evidence(UUID, TEXT, TEXT, TEXT, TEXT);
DROP TABLE IF EXISTS dealer_claim_evidence_quarantine_events;
DROP FUNCTION IF EXISTS dealer_claim_evidence_quarantined(UUID);
DROP FUNCTION IF EXISTS dealer_legal_name_key(TEXT);
DROP FUNCTION IF EXISTS dealer_registration_key(TEXT);
ALTER TABLE dealer_storefront_media_items DROP CONSTRAINT IF EXISTS dealer_storefront_media_items_media_category_check;
ALTER TABLE dealer_storefront_media_items ADD CONSTRAINT dealer_storefront_media_items_media_category_check
  CHECK (media_category IN ('SHOWROOM_EXTERIOR', 'SHOWROOM_INTERIOR', 'BRANCH_FACILITY', 'SERVICE_BAY'));
CREATE OR REPLACE FUNCTION dealer_record_storefront_media_upload(
  p_actor_id TEXT,
  p_tenant_id UUID,
  p_branch_id UUID,
  p_storage_path TEXT,
  p_content_sha256 TEXT,
  p_mime_type TEXT,
  p_file_bytes INTEGER,
  p_media_category TEXT,
  p_caption TEXT,
  p_alt_text TEXT,
  p_rights_attestation TEXT,
  p_oem_logo_claimed BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link dealer_approved_seed_links%ROWTYPE;
  v_media_id UUID;
BEGIN
  IF coalesce(p_oem_logo_claimed, false) IS TRUE
     OR p_rights_attestation IS DISTINCT FROM 'DEALER_OWNED_PHOTOGRAPH_NO_OEM_OR_THIRD_PARTY_LOGO' THEN
    RAISE EXCEPTION 'OEM_OR_LOGO_MEDIA_RIGHTS_NOT_PERMITTED';
  END IF;

  SELECT * INTO v_link
    FROM dealer_approved_seed_links
   WHERE tenant_id = p_tenant_id
     AND claimant_user_id = p_actor_id
     AND operating_status = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND OR NOT dealer_tenant_listing_authority_current(p_tenant_id) THEN
    RAISE EXCEPTION 'DEALER_MEDIA_UPLOAD_AUTHORITY_NOT_CURRENT';
  END IF;

  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dealer_branches b
     WHERE b.id = p_branch_id AND b.dealer_id = v_link.dealer_profile_id
  ) THEN
    RAISE EXCEPTION 'BRANCH_NOT_OWNED_BY_APPROVED_DEALER';
  END IF;

  IF p_media_category NOT IN ('SHOWROOM_EXTERIOR', 'SHOWROOM_INTERIOR', 'BRANCH_FACILITY', 'SERVICE_BAY')
     OR p_mime_type NOT IN ('image/jpeg', 'image/png')
     OR p_file_bytes IS NULL OR p_file_bytes NOT BETWEEN 32 AND 4194304
     OR length(btrim(coalesce(p_caption, ''))) NOT BETWEEN 5 AND 240
     OR length(btrim(coalesce(p_alt_text, ''))) NOT BETWEEN 5 AND 240
     OR p_caption ~ '<\s*[/!a-zA-Z]'
     OR p_alt_text ~ '<\s*[/!a-zA-Z]' THEN
    RAISE EXCEPTION 'INVALID_DEALER_MEDIA_METADATA';
  END IF;

  INSERT INTO dealer_storefront_media_items (
    seed_dealer_id, link_id, tenant_id, dealer_profile_id, branch_id, uploaded_by,
    storage_bucket, storage_path, content_sha256, mime_type, file_bytes, scan_state,
    media_category, caption, alt_text, rights_attestation, oem_or_brand_logo_claimed,
    logo_rights_approved, review_status
  ) VALUES (
    v_link.seed_dealer_id, v_link.link_id, v_link.tenant_id, v_link.dealer_profile_id, p_branch_id, p_actor_id,
    'ocr-documents', p_storage_path, p_content_sha256, p_mime_type, p_file_bytes, 'CLEAN_CLAMAV_AT_UPLOAD',
    p_media_category, btrim(p_caption), btrim(p_alt_text), p_rights_attestation, false,
    false, 'PENDING_INDEPENDENT_REVIEW'
  ) RETURNING media_id INTO v_media_id;

  RETURN jsonb_build_object(
    'media_id', v_media_id,
    'seed_dealer_id', v_link.seed_dealer_id,
    'tenant_id', v_link.tenant_id,
    'branch_id', p_branch_id,
    'media_category', p_media_category,
    'review_status', 'PENDING_INDEPENDENT_REVIEW',
    'logo_rights_approved', false,
    'public_display_approved', false
  );
END;
$$;
