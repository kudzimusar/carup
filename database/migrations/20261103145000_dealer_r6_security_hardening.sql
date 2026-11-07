-- +migrate Up
SET LOCAL lock_timeout = '3s';
-- CARUP-DEALER-ONB-001-LR01-R6 work package C: security hardening from the R5 advisory review
-- (docs/dealership/R5_STAGING_ACTIVATION_PACKAGE_AND_OWNER_DECISIONS.md §7).
--   #2  Real research publication stays FAIL-CLOSED (Owner decision O12 undecided): a non-fictional
--       researched record cannot be pre-listed or have its contacts displayed unless a live,
--       Owner-approved publication-policy row exists. No API-reachable code path can create one.
--   #5  Per-reviewer (per user id) password step-up lockout, shared across instances in PostgreSQL.
--   #7  Reviewer conflict of interest: a reviewer holding their own claim on the seed, or a member of
--       the dealer tenant under review, can never record a claim / preliminary / legal / activation /
--       storefront / media / lifecycle / research decision for that dealer.
--   #8c Media review ticket RPCs: search_path pinned with pg_temp, server clock only (the app-supplied
--       p_now is ignored), bounded expiry, superseding of stale tickets and a per-reviewer cap on
--       outstanding unconsumed tickets.
-- Every new table: RLS on, no end-user policy, REVOKE from PUBLIC/anon/authenticated (and service_role
-- where the API must not write); every function SECURITY DEFINER, search_path=public,pg_temp,
-- EXECUTE granted to service_role only.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. #7 Reviewer conflict of interest (data layer)
-- ─────────────────────────────────────────────────────────────────────────────
-- Conflicted when the reviewer
--   (a) has their own claim (any status) on the seed, or
--   (b) is the claimant of, or any tenant_users member of, the tenant bound to the seed, or
--   (c) is a tenant_users member of the explicit tenant on the decision row (e.g. media, activation).
CREATE FUNCTION dealer_reviewer_conflict_of_interest(
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
REVOKE ALL ON FUNCTION dealer_reviewer_conflict_of_interest(TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_reviewer_conflict_of_interest(TEXT, TEXT, UUID) TO service_role;

-- Generic BEFORE INSERT guard. TG_ARGV[0] = reviewer column, TG_ARGV[1] = how the seed is resolved
-- ('seed' = seed_dealer_id column, 'claim' = via claim_id, 'submission' = via submission_id).
-- Enforced on the decision ledgers themselves, so every current and future RPC that writes a decision
-- is covered, not only the ones that remember to call a helper.
CREATE FUNCTION dealer_guard_reviewer_conflict_of_interest()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_row JSONB := to_jsonb(NEW);
  v_reviewer TEXT := v_row->>TG_ARGV[0];
  v_seed TEXT;
  v_tenant UUID := nullif(v_row->>'tenant_id', '')::uuid;
BEGIN
  IF TG_ARGV[1] = 'seed' THEN
    v_seed := v_row->>'seed_dealer_id';
  ELSIF TG_ARGV[1] = 'claim' THEN
    SELECT c.seed_dealer_id INTO v_seed FROM dealer_research_claim_requests c
     WHERE c.claim_id = (v_row->>'claim_id')::uuid;
  ELSIF TG_ARGV[1] = 'submission' THEN
    SELECT c.seed_dealer_id INTO v_seed
      FROM dealer_claim_compliance_submissions s
      JOIN dealer_research_claim_requests c ON c.claim_id = s.claim_id
     WHERE s.submission_id = (v_row->>'submission_id')::uuid;
  ELSE
    RAISE EXCEPTION 'DEALER_REVIEWER_COI_GUARD_MISCONFIGURED';
  END IF;
  IF v_reviewer IS NULL OR v_seed IS NULL THEN
    RETURN NEW; -- NOT NULL / FK constraints refuse the row on their own
  END IF;
  IF dealer_reviewer_conflict_of_interest(v_reviewer, v_seed, v_tenant) THEN
    RAISE EXCEPTION 'DEALER_REVIEWER_CONFLICT_OF_INTEREST' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION dealer_guard_reviewer_conflict_of_interest() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER dealer_r6_coi_claim_review BEFORE INSERT ON dealer_claim_review_events
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_reviewer_conflict_of_interest('reviewer_user_id', 'claim');
CREATE TRIGGER dealer_r6_coi_preliminary_review BEFORE INSERT ON dealer_claim_compliance_review_events
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_reviewer_conflict_of_interest('reviewer_user_id', 'submission');
CREATE TRIGGER dealer_r6_coi_legal_review BEFORE INSERT ON dealer_legal_application_reviews
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_reviewer_conflict_of_interest('reviewer_user_id', 'submission');
CREATE TRIGGER dealer_r6_coi_activation BEFORE INSERT ON dealer_approved_seed_links
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_reviewer_conflict_of_interest('activated_by', 'seed');
CREATE TRIGGER dealer_r6_coi_full_storefront BEFORE INSERT ON dealer_full_storefront_review_events
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_reviewer_conflict_of_interest('reviewer_user_id', 'seed');
CREATE TRIGGER dealer_r6_coi_media_review BEFORE INSERT ON dealer_storefront_media_review_events
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_reviewer_conflict_of_interest('reviewer_user_id', 'seed');
CREATE TRIGGER dealer_r6_coi_media_ticket BEFORE INSERT ON dealer_storefront_media_review_tickets
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_reviewer_conflict_of_interest('reviewer_id', 'seed');
CREATE TRIGGER dealer_r6_coi_lifecycle BEFORE INSERT ON dealer_operating_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_reviewer_conflict_of_interest('reviewer_user_id', 'seed');
CREATE TRIGGER dealer_r6_coi_research_publication BEFORE INSERT ON dealer_research_publication_events
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_reviewer_conflict_of_interest('reviewer_id', 'seed');
CREATE TRIGGER dealer_r6_coi_research_contact BEFORE INSERT ON dealer_research_public_contact_events
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_reviewer_conflict_of_interest('reviewer_user_id', 'seed');
CREATE TRIGGER dealer_r6_coi_research_correction BEFORE INSERT ON dealer_research_correction_review_events
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_reviewer_conflict_of_interest('reviewer_user_id', 'seed');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. #2 Real research publication: fail closed without an Owner-approved policy (O12)
-- ─────────────────────────────────────────────────────────────────────────────
-- The publication policy is written ONLY by the database owner/operator outside the Dealer API
-- (no SECURITY DEFINER function writes it; service_role may only SELECT; a trigger refuses API roles).
-- No row is created here: real publication stays closed until the Owner decides O12.
CREATE TABLE dealer_research_publication_policy_authority (
  policy_version TEXT PRIMARY KEY CHECK (policy_version ~ '^[A-Z0-9_]{6,80}$'),
  country_code TEXT NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  policy_state TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (policy_state IN ('DRAFT', 'APPROVED', 'SUSPENDED', 'WITHDRAWN')),
  owner_decision_reference TEXT NOT NULL CHECK (owner_decision_reference ~ '^O[0-9]{1,3}$'),
  approval_evidence_sha256 TEXT CHECK (approval_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  effective_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (policy_state <> 'APPROVED' OR (
    approval_evidence_sha256 IS NOT NULL AND approved_by IS NOT NULL
    AND effective_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at > effective_at))
);
COMMENT ON TABLE dealer_research_publication_policy_authority IS
  'Owner decision O12 gate for publishing REAL (non-fictional) researched dealer records. Written only by the database owner outside the Dealer API; no migration or API path creates an APPROVED row. The approver can never also be the publishing reviewer.';
ALTER TABLE dealer_research_publication_policy_authority ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_research_publication_policy_authority FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON dealer_research_publication_policy_authority TO service_role;

CREATE FUNCTION dealer_refuse_api_publication_policy_write()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('service_role', 'anon', 'authenticated')
     OR session_user IN ('service_role', 'anon', 'authenticated', 'authenticator') THEN
    RAISE EXCEPTION 'PUBLICATION_POLICY_NOT_WRITABLE_FROM_API' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION dealer_refuse_api_publication_policy_write() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER dealer_r6_publication_policy_operator_only
  BEFORE INSERT OR UPDATE OR DELETE ON dealer_research_publication_policy_authority
  FOR EACH ROW EXECUTE FUNCTION dealer_refuse_api_publication_policy_write();

-- A seed is a FICTIONAL CI fixture only when its own private, API-immutable source snapshot
-- (service_role has no UPDATE on dealer_research_seed_records and no API route inserts seeds)
-- declares itself fictional in the very name that would be published AND carries no real-looking
-- contact channel. A real business therefore cannot be published under its real name, phone,
-- e-mail, website, address or key principal through the fictional path; the Owner-original workbook
-- is excluded by checksum outright.
CREATE FUNCTION dealer_research_seed_is_fictional_fixture(p_seed_dealer_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT coalesce((
    SELECT s.source_workbook_sha256 <> 'a9a6ac6f68bed5266c6870958520105fc1c69f75dd80f7020839e8d5fdd4b137'
       AND coalesce(s.source_snapshot->>'Dealer / Company Name', '') ~ '^SYNTHETIC FICTIONAL [A-Za-z0-9 ]{1,120}$'
       AND coalesce(nullif(btrim(s.source_snapshot->>'Email'), ''), 'none@example.invalid')
             ~* '^[^@[:space:]]+@([a-z0-9-]+\.)*invalid$'
       AND coalesce(nullif(btrim(s.source_snapshot->>'Website / Source URL'), ''), 'https://example.invalid')
             ~* '^https?://([a-z0-9-]+\.)*invalid([/?#][^[:space:]]*)?$'
       AND length(regexp_replace(coalesce(s.source_snapshot->>'Phone / WhatsApp', ''), '[^0-9]', '', 'g')) < 5
       AND (nullif(btrim(coalesce(s.source_snapshot->>'Physical Address', '')), '') IS NULL
            OR s.source_snapshot->>'Physical Address' ~* 'not a real address')
       AND (nullif(btrim(coalesce(s.source_snapshot->>'Ownership / Parent Company / Key Principal', '')), '') IS NULL
            OR s.source_snapshot->>'Ownership / Parent Company / Key Principal' ~* 'fictional')
      FROM dealer_research_seed_records s
     WHERE s.seed_dealer_id = p_seed_dealer_id), false);
$$;
REVOKE ALL ON FUNCTION dealer_research_seed_is_fictional_fixture(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_research_seed_is_fictional_fixture(TEXT) TO service_role;

CREATE FUNCTION dealer_real_research_publication_policy_current(p_reviewer_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM dealer_research_publication_policy_authority p
     WHERE p.country_code = 'ZW'
       AND p.policy_state = 'APPROVED'
       AND p.effective_at <= clock_timestamp()
       AND p.expires_at > clock_timestamp()
       AND p.approved_by IS DISTINCT FROM p_reviewer_id);
$$;
REVOKE ALL ON FUNCTION dealer_real_research_publication_policy_current(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_real_research_publication_policy_current(TEXT) TO service_role;

-- Gates the two ledgers that make research data public: PRELISTED_UNCLAIMED publication events and
-- DISPLAY_REVIEWED_FIELDS contact events. Takedowns (WITHHELD/SUPPRESSED/DUPLICATE/UNDER_DISPUTE,
-- contact RETRACTED) are never blocked.
CREATE FUNCTION dealer_guard_real_research_publication()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_row JSONB := to_jsonb(NEW);
  v_publishing BOOLEAN;
  v_reviewer TEXT;
BEGIN
  IF TG_TABLE_NAME = 'dealer_research_publication_events' THEN
    v_publishing := v_row->>'decision' = 'PRELISTED_UNCLAIMED';
    v_reviewer := v_row->>'reviewer_id';
  ELSE
    v_publishing := v_row->>'public_contact_state' = 'DISPLAY_REVIEWED_FIELDS';
    v_reviewer := v_row->>'reviewer_user_id';
  END IF;
  IF NOT coalesce(v_publishing, false)
     OR dealer_research_seed_is_fictional_fixture(v_row->>'seed_dealer_id')
     OR dealer_real_research_publication_policy_current(v_reviewer) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'REAL_RESEARCH_PUBLICATION_REQUIRES_OWNER_POLICY' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION dealer_guard_real_research_publication() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER dealer_r6_real_publication_gate BEFORE INSERT ON dealer_research_publication_events
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_real_research_publication();
CREATE TRIGGER dealer_r6_real_contact_gate BEFORE INSERT ON dealer_research_public_contact_events
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_real_research_publication();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. #5 Per-reviewer password step-up lockout (shared across backend instances)
-- ─────────────────────────────────────────────────────────────────────────────
-- Policy: at most 5 step-up attempts that do not succeed per reviewer per 15-minute window; the
-- 5th failure (or a 6th attempt while 5 are reserved) locks the reviewer's step-up for 15 minutes.
-- Each attempt is RESERVED before the password is verified, so parallel guesses cannot exceed 5.
-- A successful step-up resets the window, so legitimate reviewers are never locked out by successes.
-- This is in addition to (never instead of) the per-IP sensitive route buckets.
CREATE TABLE dealer_reviewer_step_up_guard (
  reviewer_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempts_in_window INTEGER NOT NULL DEFAULT 0 CHECK (attempts_in_window BETWEEN 0 AND 5),
  locked_until TIMESTAMPTZ,
  lockout_count INTEGER NOT NULL DEFAULT 0 CHECK (lockout_count >= 0),
  last_failure_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE dealer_reviewer_step_up_guard IS
  'Per-reviewer password step-up counter: 5 unsuccessful attempts per 15 minutes, then a 15-minute lockout; success resets. Written only through dealer_begin/complete_reviewer_step_up.';
ALTER TABLE dealer_reviewer_step_up_guard ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_reviewer_step_up_guard FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION dealer_begin_reviewer_step_up(p_reviewer_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  c_max CONSTANT INTEGER := 5;
  c_window CONSTANT INTERVAL := interval '15 minutes';
  c_lock CONSTANT INTERVAL := interval '15 minutes';
  v_now TIMESTAMPTZ := clock_timestamp();
  g dealer_reviewer_step_up_guard%ROWTYPE;
BEGIN
  IF p_reviewer_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = p_reviewer_id) THEN
    RAISE EXCEPTION 'REVIEWER_STEP_UP_SUBJECT_REQUIRED';
  END IF;
  INSERT INTO dealer_reviewer_step_up_guard (reviewer_user_id, window_started_at)
    VALUES (p_reviewer_id, v_now) ON CONFLICT (reviewer_user_id) DO NOTHING;
  SELECT * INTO g FROM dealer_reviewer_step_up_guard WHERE reviewer_user_id = p_reviewer_id FOR UPDATE;

  IF g.locked_until IS NOT NULL AND g.locked_until > v_now THEN
    RETURN jsonb_build_object('allowed', false, 'locked_until', g.locked_until,
      'retry_after_seconds', ceil(extract(epoch FROM (g.locked_until - v_now)))::int);
  END IF;
  IF g.locked_until IS NOT NULL OR g.window_started_at <= v_now - c_window THEN
    g.attempts_in_window := 0;
    g.window_started_at := v_now;
  END IF;
  IF g.attempts_in_window >= c_max THEN
    UPDATE dealer_reviewer_step_up_guard
       SET locked_until = v_now + c_lock, lockout_count = lockout_count + 1,
           attempts_in_window = c_max, window_started_at = g.window_started_at, updated_at = v_now
     WHERE reviewer_user_id = p_reviewer_id;
    RETURN jsonb_build_object('allowed', false, 'locked_until', v_now + c_lock,
      'retry_after_seconds', extract(epoch FROM c_lock)::int);
  END IF;
  UPDATE dealer_reviewer_step_up_guard
     SET attempts_in_window = g.attempts_in_window + 1, window_started_at = g.window_started_at,
         locked_until = NULL, updated_at = v_now
   WHERE reviewer_user_id = p_reviewer_id;
  RETURN jsonb_build_object('allowed', true, 'attempt', g.attempts_in_window + 1,
    'max_attempts', c_max, 'window_seconds', extract(epoch FROM c_window)::int);
END;
$$;
REVOKE ALL ON FUNCTION dealer_begin_reviewer_step_up(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_begin_reviewer_step_up(TEXT) TO service_role;

CREATE FUNCTION dealer_complete_reviewer_step_up(p_reviewer_id TEXT, p_succeeded BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  c_max CONSTANT INTEGER := 5;
  c_lock CONSTANT INTERVAL := interval '15 minutes';
  v_now TIMESTAMPTZ := clock_timestamp();
  g dealer_reviewer_step_up_guard%ROWTYPE;
BEGIN
  SELECT * INTO g FROM dealer_reviewer_step_up_guard WHERE reviewer_user_id = p_reviewer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REVIEWER_STEP_UP_NOT_STARTED';
  END IF;
  IF p_succeeded IS TRUE THEN
    UPDATE dealer_reviewer_step_up_guard
       SET attempts_in_window = 0, window_started_at = v_now, locked_until = NULL, updated_at = v_now
     WHERE reviewer_user_id = p_reviewer_id;
    RETURN jsonb_build_object('locked', false, 'attempts_in_window', 0);
  END IF;
  IF g.attempts_in_window >= c_max AND (g.locked_until IS NULL OR g.locked_until <= v_now) THEN
    UPDATE dealer_reviewer_step_up_guard
       SET locked_until = v_now + c_lock, lockout_count = lockout_count + 1,
           last_failure_at = v_now, updated_at = v_now
     WHERE reviewer_user_id = p_reviewer_id;
    RETURN jsonb_build_object('locked', true, 'locked_until', v_now + c_lock,
      'attempts_in_window', g.attempts_in_window);
  END IF;
  UPDATE dealer_reviewer_step_up_guard SET last_failure_at = v_now, updated_at = v_now
   WHERE reviewer_user_id = p_reviewer_id;
  RETURN jsonb_build_object('locked', g.locked_until IS NOT NULL AND g.locked_until > v_now,
    'attempts_in_window', g.attempts_in_window);
END;
$$;
REVOKE ALL ON FUNCTION dealer_complete_reviewer_step_up(TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_complete_reviewer_step_up(TEXT, BOOLEAN) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. #8c Hardened single-use media review ticket custody (same signatures as 20261103143000)
-- ─────────────────────────────────────────────────────────────────────────────
-- * search_path = public, pg_temp.
-- * Server clock only (clock_timestamp()); p_expires_at is bounded to <= 10 minutes from the server
--   clock, and the consume RPC IGNORES its p_now argument (kept only for signature compatibility).
-- * A new grant for the same (reviewer, media item, operation) supersedes the reviewer's earlier
--   unconsumed one, so reloading the queue never accumulates live tickets.
-- * At most 96 outstanding (unconsumed, unexpired) tickets per reviewer (= 2 operations x a 24-item
--   queue page x 2 pages) and at most 480 grants per reviewer per 10 minutes; serialized per reviewer
--   with a transaction-scoped advisory lock so concurrent queue loads cannot overshoot.
CREATE OR REPLACE FUNCTION dealer_issue_storefront_media_review_ticket(
  p_ticket_jti TEXT,
  p_token_sha256 TEXT,
  p_reviewer_id TEXT,
  p_seed_dealer_id TEXT,
  p_target_row_id UUID,
  p_operation TEXT,
  p_expires_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_max_ttl CONSTANT INTERVAL := interval '10 minutes';
  c_max_outstanding CONSTANT INTEGER := 96;
  c_max_recent_grants CONSTANT INTEGER := 480;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_expires TIMESTAMPTZ;
  v_reviewer RECORD;
  v_media RECORD;
  v_link RECORD;
  v_outstanding INTEGER;
  v_recent INTEGER;
BEGIN
  IF p_ticket_jti IS NULL OR p_ticket_jti !~ '^[0-9a-f]{32}$'
     OR p_token_sha256 IS NULL OR p_token_sha256 !~ '^[0-9a-f]{64}$'
     OR p_operation IS NULL OR p_operation NOT IN ('STOREFRONT_MEDIA_PREVIEW', 'STOREFRONT_MEDIA_DECISION')
     OR p_expires_at IS NULL OR p_expires_at <= v_now THEN
    RAISE EXCEPTION 'INVALID_MEDIA_REVIEW_TICKET_GRANT';
  END IF;
  v_expires := LEAST(p_expires_at, v_now + c_max_ttl);

  SELECT id, role, is_verified INTO v_reviewer
    FROM users
   WHERE id = p_reviewer_id;
  IF NOT FOUND
     OR COALESCE(v_reviewer.is_verified, false) IS NOT TRUE
     OR COALESCE(v_reviewer.role, '') NOT IN ('admin', 'reviewer', 'platform_admin', 'super_admin') THEN
    RAISE EXCEPTION 'INDEPENDENT_MEDIA_REVIEWER_REQUIRED';
  END IF;

  SELECT * INTO v_media
    FROM dealer_storefront_media_items
   WHERE media_id = p_target_row_id
     AND seed_dealer_id = p_seed_dealer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STOREFRONT_MEDIA_NOT_FOUND';
  END IF;

  SELECT * INTO v_link
    FROM dealer_approved_seed_links
   WHERE link_id = v_media.link_id;

  IF p_reviewer_id = v_media.uploaded_by
     OR p_reviewer_id = v_link.claimant_user_id
     OR EXISTS (
       SELECT 1 FROM tenant_users tu
        WHERE tu.tenant_id = v_media.tenant_id
          AND tu.user_id = p_reviewer_id
     ) THEN
    RAISE EXCEPTION 'INDEPENDENT_MEDIA_REVIEWER_REQUIRED';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('dealer_media_review_ticket:' || p_reviewer_id, 0));

  DELETE FROM dealer_storefront_media_review_tickets
   WHERE expires_at < v_now - interval '1 hour'
      OR (consumed_at IS NOT NULL AND consumed_at < v_now - interval '1 hour');

  -- Supersede: the newest grant for (reviewer, item, operation) is the only live one.
  UPDATE dealer_storefront_media_review_tickets
     SET consumed_at = v_now
   WHERE reviewer_id = p_reviewer_id
     AND target_row_id = v_media.media_id
     AND operation = p_operation
     AND consumed_at IS NULL;

  SELECT count(*) FILTER (WHERE consumed_at IS NULL AND expires_at >= v_now),
         count(*) FILTER (WHERE issued_at > v_now - interval '10 minutes')
    INTO v_outstanding, v_recent
    FROM dealer_storefront_media_review_tickets
   WHERE reviewer_id = p_reviewer_id;
  IF v_outstanding >= c_max_outstanding OR v_recent >= c_max_recent_grants THEN
    RAISE EXCEPTION 'MEDIA_REVIEW_TICKET_OUTSTANDING_LIMIT';
  END IF;

  INSERT INTO dealer_storefront_media_review_tickets (
    ticket_jti,
    token_sha256,
    reviewer_id,
    seed_dealer_id,
    tenant_id,
    target_row_id,
    content_sha256,
    operation,
    issued_at,
    expires_at
  ) VALUES (
    p_ticket_jti,
    p_token_sha256,
    p_reviewer_id,
    p_seed_dealer_id,
    v_media.tenant_id,
    v_media.media_id,
    v_media.content_sha256,
    p_operation,
    v_now,
    v_expires
  );

  RETURN jsonb_build_object(
    'ticket_jti', p_ticket_jti,
    'seed_dealer_id', p_seed_dealer_id,
    'operation', p_operation,
    'expires_at', v_expires
  );
END;
$$;

REVOKE ALL ON FUNCTION dealer_issue_storefront_media_review_ticket(TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_issue_storefront_media_review_ticket(TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ)
  TO service_role;

CREATE OR REPLACE FUNCTION dealer_consume_storefront_media_review_ticket(
  p_ticket_jti TEXT,
  p_token_sha256 TEXT,
  p_reviewer_id TEXT,
  p_seed_dealer_id TEXT,
  p_expected_operation TEXT,
  p_now TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- p_now is deliberately ignored: expiry is judged on the database clock only.
  v_eval_now TIMESTAMPTZ := clock_timestamp();
  v_ticket RECORD;
  v_reviewer RECORD;
  v_media RECORD;
BEGIN
  IF p_ticket_jti IS NULL OR p_ticket_jti !~ '^[0-9a-f]{32}$'
     OR p_token_sha256 IS NULL OR p_token_sha256 !~ '^[0-9a-f]{64}$'
     OR p_reviewer_id IS NULL
     OR p_seed_dealer_id IS NULL
     OR p_expected_operation IS NULL
     OR p_expected_operation NOT IN ('STOREFRONT_MEDIA_PREVIEW', 'STOREFRONT_MEDIA_DECISION') THEN
    RAISE EXCEPTION 'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID';
  END IF;

  -- Atomic row-level lock and single-use transition across all backend instances
  UPDATE dealer_storefront_media_review_tickets
     SET consumed_at = v_eval_now
   WHERE ticket_jti = p_ticket_jti
     AND token_sha256 = p_token_sha256
     AND reviewer_id = p_reviewer_id
     AND seed_dealer_id = p_seed_dealer_id
     AND operation = p_expected_operation
     AND consumed_at IS NULL
     AND expires_at >= v_eval_now
  RETURNING ticket_jti, reviewer_id, seed_dealer_id, tenant_id, target_row_id, content_sha256, operation, expires_at, consumed_at
    INTO v_ticket;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID';
  END IF;

  SELECT id, role, is_verified INTO v_reviewer
    FROM users
   WHERE id = p_reviewer_id;
  IF NOT FOUND
     OR COALESCE(v_reviewer.is_verified, false) IS NOT TRUE
     OR COALESCE(v_reviewer.role, '') NOT IN ('admin', 'reviewer', 'platform_admin', 'super_admin') THEN
    RAISE EXCEPTION 'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID';
  END IF;

  SELECT m.media_id, m.uploaded_by, m.tenant_id INTO v_media
    FROM dealer_storefront_media_items m
   WHERE m.media_id = v_ticket.target_row_id
     AND m.seed_dealer_id = v_ticket.seed_dealer_id;
  -- Conflict of interest is re-checked at use time (membership or a claim may postdate the grant).
  IF NOT FOUND OR v_media.uploaded_by = p_reviewer_id
     OR EXISTS (SELECT 1 FROM tenant_users tu
                 WHERE tu.tenant_id = v_media.tenant_id AND tu.user_id = p_reviewer_id)
     OR EXISTS (SELECT 1 FROM dealer_research_claim_requests c
                 WHERE c.seed_dealer_id = v_ticket.seed_dealer_id AND c.claimant_user_id = p_reviewer_id) THEN
    RAISE EXCEPTION 'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID';
  END IF;

  RETURN jsonb_build_object(
    'ticket_jti', v_ticket.ticket_jti,
    'reviewer_id', v_ticket.reviewer_id,
    'seed_dealer_id', v_ticket.seed_dealer_id,
    'tenant_id', v_ticket.tenant_id,
    'target_row_id', v_ticket.target_row_id,
    'content_sha256', v_ticket.content_sha256,
    'operation', v_ticket.operation,
    'expires_at', v_ticket.expires_at,
    'consumed_at', v_ticket.consumed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION dealer_consume_storefront_media_review_ticket(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_consume_storefront_media_review_ticket(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;

-- +migrate Down
SET LOCAL lock_timeout = '3s';
-- Refuse while security custody this Down would destroy exists: an Owner publication-policy record
-- or any reviewer step-up counter/lockout row. An operator must consciously archive and clear them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dealer_research_publication_policy_authority)
     OR EXISTS (SELECT 1 FROM dealer_reviewer_step_up_guard) THEN
    RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_DEALER_R6_SECURITY_CUSTODY';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS dealer_r6_real_contact_gate ON dealer_research_public_contact_events;
DROP TRIGGER IF EXISTS dealer_r6_real_publication_gate ON dealer_research_publication_events;
DROP FUNCTION IF EXISTS dealer_guard_real_research_publication();
DROP FUNCTION IF EXISTS dealer_real_research_publication_policy_current(TEXT);
DROP FUNCTION IF EXISTS dealer_research_seed_is_fictional_fixture(TEXT);
DROP TRIGGER IF EXISTS dealer_r6_publication_policy_operator_only ON dealer_research_publication_policy_authority;
DROP FUNCTION IF EXISTS dealer_refuse_api_publication_policy_write();
DROP TABLE IF EXISTS dealer_research_publication_policy_authority;

DROP FUNCTION IF EXISTS dealer_complete_reviewer_step_up(TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS dealer_begin_reviewer_step_up(TEXT);
DROP TABLE IF EXISTS dealer_reviewer_step_up_guard;

DROP TRIGGER IF EXISTS dealer_r6_coi_research_correction ON dealer_research_correction_review_events;
DROP TRIGGER IF EXISTS dealer_r6_coi_research_contact ON dealer_research_public_contact_events;
DROP TRIGGER IF EXISTS dealer_r6_coi_research_publication ON dealer_research_publication_events;
DROP TRIGGER IF EXISTS dealer_r6_coi_lifecycle ON dealer_operating_lifecycle_events;
DROP TRIGGER IF EXISTS dealer_r6_coi_media_ticket ON dealer_storefront_media_review_tickets;
DROP TRIGGER IF EXISTS dealer_r6_coi_media_review ON dealer_storefront_media_review_events;
DROP TRIGGER IF EXISTS dealer_r6_coi_full_storefront ON dealer_full_storefront_review_events;
DROP TRIGGER IF EXISTS dealer_r6_coi_activation ON dealer_approved_seed_links;
DROP TRIGGER IF EXISTS dealer_r6_coi_legal_review ON dealer_legal_application_reviews;
DROP TRIGGER IF EXISTS dealer_r6_coi_preliminary_review ON dealer_claim_compliance_review_events;
DROP TRIGGER IF EXISTS dealer_r6_coi_claim_review ON dealer_claim_review_events;
DROP FUNCTION IF EXISTS dealer_guard_reviewer_conflict_of_interest();
DROP FUNCTION IF EXISTS dealer_reviewer_conflict_of_interest(TEXT, TEXT, UUID);

-- Restore the exact 20261103143000 ticket RPC definitions (a rollback must restore prior behaviour).
CREATE OR REPLACE FUNCTION dealer_issue_storefront_media_review_ticket(
  p_ticket_jti TEXT,
  p_token_sha256 TEXT,
  p_reviewer_id TEXT,
  p_seed_dealer_id TEXT,
  p_target_row_id UUID,
  p_operation TEXT,
  p_expires_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reviewer RECORD;
  v_media RECORD;
  v_link RECORD;
BEGIN
  IF p_ticket_jti IS NULL OR p_ticket_jti !~ '^[0-9a-f]{32}$'
     OR p_token_sha256 IS NULL OR p_token_sha256 !~ '^[0-9a-f]{64}$'
     OR p_operation IS NULL OR p_operation NOT IN ('STOREFRONT_MEDIA_PREVIEW', 'STOREFRONT_MEDIA_DECISION')
     OR p_expires_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_MEDIA_REVIEW_TICKET_GRANT';
  END IF;

  SELECT id, role, is_verified INTO v_reviewer
    FROM users
   WHERE id = p_reviewer_id;
  IF NOT FOUND
     OR COALESCE(v_reviewer.is_verified, false) IS NOT TRUE
     OR COALESCE(v_reviewer.role, '') NOT IN ('admin', 'reviewer', 'platform_admin', 'super_admin') THEN
    RAISE EXCEPTION 'INDEPENDENT_MEDIA_REVIEWER_REQUIRED';
  END IF;

  SELECT * INTO v_media
    FROM dealer_storefront_media_items
   WHERE media_id = p_target_row_id
     AND seed_dealer_id = p_seed_dealer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STOREFRONT_MEDIA_NOT_FOUND';
  END IF;

  SELECT * INTO v_link
    FROM dealer_approved_seed_links
   WHERE link_id = v_media.link_id;

  IF p_reviewer_id = v_media.uploaded_by
     OR p_reviewer_id = v_link.claimant_user_id
     OR EXISTS (
       SELECT 1 FROM tenant_users tu
        WHERE tu.tenant_id = v_media.tenant_id
          AND tu.user_id = p_reviewer_id
     ) THEN
    RAISE EXCEPTION 'INDEPENDENT_MEDIA_REVIEWER_REQUIRED';
  END IF;

  DELETE FROM dealer_storefront_media_review_tickets
   WHERE expires_at < now() - interval '1 hour'
      OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '1 hour');

  INSERT INTO dealer_storefront_media_review_tickets (
    ticket_jti,
    token_sha256,
    reviewer_id,
    seed_dealer_id,
    tenant_id,
    target_row_id,
    content_sha256,
    operation,
    issued_at,
    expires_at
  ) VALUES (
    p_ticket_jti,
    p_token_sha256,
    p_reviewer_id,
    p_seed_dealer_id,
    v_media.tenant_id,
    v_media.media_id,
    v_media.content_sha256,
    p_operation,
    LEAST(now(), p_expires_at - interval '1 second'),
    p_expires_at
  );

  RETURN jsonb_build_object(
    'ticket_jti', p_ticket_jti,
    'seed_dealer_id', p_seed_dealer_id,
    'operation', p_operation,
    'expires_at', p_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION dealer_issue_storefront_media_review_ticket(TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_issue_storefront_media_review_ticket(TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ)
  TO service_role;

CREATE OR REPLACE FUNCTION dealer_consume_storefront_media_review_ticket(
  p_ticket_jti TEXT,
  p_token_sha256 TEXT,
  p_reviewer_id TEXT,
  p_seed_dealer_id TEXT,
  p_expected_operation TEXT,
  p_now TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eval_now TIMESTAMPTZ := COALESCE(p_now, now());
  v_ticket RECORD;
  v_reviewer RECORD;
  v_media RECORD;
BEGIN
  IF p_ticket_jti IS NULL OR p_ticket_jti !~ '^[0-9a-f]{32}$'
     OR p_token_sha256 IS NULL OR p_token_sha256 !~ '^[0-9a-f]{64}$'
     OR p_reviewer_id IS NULL
     OR p_seed_dealer_id IS NULL
     OR p_expected_operation IS NULL
     OR p_expected_operation NOT IN ('STOREFRONT_MEDIA_PREVIEW', 'STOREFRONT_MEDIA_DECISION') THEN
    RAISE EXCEPTION 'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID';
  END IF;

  -- Atomic row-level lock and single-use transition across all backend instances
  UPDATE dealer_storefront_media_review_tickets
     SET consumed_at = v_eval_now
   WHERE ticket_jti = p_ticket_jti
     AND token_sha256 = p_token_sha256
     AND reviewer_id = p_reviewer_id
     AND seed_dealer_id = p_seed_dealer_id
     AND operation = p_expected_operation
     AND consumed_at IS NULL
     AND expires_at >= v_eval_now
  RETURNING ticket_jti, reviewer_id, seed_dealer_id, tenant_id, target_row_id, content_sha256, operation, expires_at, consumed_at
    INTO v_ticket;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID';
  END IF;

  SELECT id, role, is_verified INTO v_reviewer
    FROM users
   WHERE id = p_reviewer_id;
  IF NOT FOUND
     OR COALESCE(v_reviewer.is_verified, false) IS NOT TRUE
     OR COALESCE(v_reviewer.role, '') NOT IN ('admin', 'reviewer', 'platform_admin', 'super_admin') THEN
    RAISE EXCEPTION 'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID';
  END IF;

  SELECT media_id, uploaded_by INTO v_media
    FROM dealer_storefront_media_items
   WHERE media_id = v_ticket.target_row_id
     AND seed_dealer_id = v_ticket.seed_dealer_id;
  IF NOT FOUND OR v_media.uploaded_by = p_reviewer_id THEN
    RAISE EXCEPTION 'STOREFRONT_MEDIA_REVIEW_TICKET_INVALID';
  END IF;

  RETURN jsonb_build_object(
    'ticket_jti', v_ticket.ticket_jti,
    'reviewer_id', v_ticket.reviewer_id,
    'seed_dealer_id', v_ticket.seed_dealer_id,
    'tenant_id', v_ticket.tenant_id,
    'target_row_id', v_ticket.target_row_id,
    'content_sha256', v_ticket.content_sha256,
    'operation', v_ticket.operation,
    'expires_at', v_ticket.expires_at,
    'consumed_at', v_ticket.consumed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION dealer_consume_storefront_media_review_ticket(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_consume_storefront_media_review_ticket(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;
