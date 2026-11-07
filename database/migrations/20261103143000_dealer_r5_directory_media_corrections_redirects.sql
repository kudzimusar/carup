-- +migrate Up
-- R6 DBA #7: never queue indefinitely behind long transactions on canonical tables (fail with
-- 55P03 after 3 s instead; re-run the migration). Session-scoped, exactly as 20261103141000.
SET lock_timeout = '3s';
-- CARUP-DEALER-ONB-001-LR01-R5 (T22, T42, S08, S09):
-- 1. T42: Independent reviewer disposition ledger and atomic publication withdrawal for public
--    correction/takedown requests (no unreviewed complaint can auto-suppress; no unauthorized
--    removal is allowed; approved suppression/dispute/withholding atomically updates public state).
-- 2. S09: Governed duplicate research seed reconciliation and canonical URL redirect ledger
--    (preserves source/claim/legal custody, blocks hostile takeover of claimed/activated records,
--    and prevents redirect chains/cycles).
-- 3. T22: Tenant-scoped dealership facility/showroom media gallery with ClamAV-verified private
--    storage custody, mandatory accessibility alt text, explicit no-OEM/logo rights constraint,
--    independent reviewer approval/retraction, and automatic withdrawal on dealer suspension.

DO $$
BEGIN
  IF to_regclass('public.dealer_research_correction_requests') IS NULL
     OR to_regclass('public.dealer_research_grouping_review_events') IS NULL
     OR to_regclass('public.dealer_full_storefront_current') IS NULL
     OR to_regprocedure('public.dealer_tenant_listing_authority_current(uuid)') IS NULL THEN
    RAISE EXCEPTION 'DEALER_R5_PREREQUISITE_LINEAGE_MISSING';
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. T42: Source correction & takedown reviewer disposition custody
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE dealer_research_correction_requests
  DROP CONSTRAINT IF EXISTS dealer_research_correction_requests_status_check;

ALTER TABLE dealer_research_correction_requests
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS resolution_event_id UUID;

ALTER TABLE dealer_research_correction_requests
  ADD CONSTRAINT dealer_research_correction_requests_status_check
  CHECK (status IN (
    'PENDING_HUMAN_REVIEW',
    'RESOLVED_SUPPRESSED',
    'RESOLVED_WITHHELD',
    'RESOLVED_UNDER_DISPUTE',
    'REJECTED_NO_CHANGE'
  ));

CREATE TABLE IF NOT EXISTS dealer_research_correction_review_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE REFERENCES dealer_research_correction_requests(request_id) ON DELETE RESTRICT,
  seed_dealer_id TEXT NOT NULL REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN (
    'RESOLVED_SUPPRESSED',
    'RESOLVED_WITHHELD',
    'RESOLVED_UNDER_DISPUTE',
    'REJECTED_NO_CHANGE'
  )),
  publication_event_id UUID REFERENCES dealer_research_publication_events(event_id) ON DELETE RESTRICT,
  resulting_publication_status TEXT NOT NULL CHECK (resulting_publication_status IN (
    'PRELISTED_UNCLAIMED',
    'WITHHELD',
    'SUPPRESSED',
    'DUPLICATE',
    'UNDER_DISPUTE'
  )),
  rationale TEXT NOT NULL CHECK (length(btrim(rationale)) BETWEEN 60 AND 3000),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_research_correction_reviews_seed
  ON dealer_research_correction_review_events(seed_dealer_id, reviewed_at DESC);

ALTER TABLE dealer_research_correction_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_research_correction_review_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON dealer_research_correction_review_events TO service_role;
GRANT UPDATE ON dealer_research_correction_requests TO service_role;

DROP TRIGGER IF EXISTS dealer_research_correction_review_events_no_update ON dealer_research_correction_review_events;
CREATE TRIGGER dealer_research_correction_review_events_no_update
  BEFORE UPDATE ON dealer_research_correction_review_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

DROP TRIGGER IF EXISTS dealer_research_correction_review_events_no_delete ON dealer_research_correction_review_events;
CREATE TRIGGER dealer_research_correction_review_events_no_delete
  BEFORE DELETE ON dealer_research_correction_review_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

CREATE OR REPLACE FUNCTION dealer_review_research_correction_request(
  p_request_id UUID,
  p_reviewer_id TEXT,
  p_decision TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reviewer users%ROWTYPE;
  v_req dealer_research_correction_requests%ROWTYPE;
  v_pub_decision TEXT;
  v_pub_result JSONB;
  v_profile dealer_research_public_profiles%ROWTYPE;
  v_pub_event_id UUID := NULL;
  v_pub_status TEXT;
  v_event_id UUID;
BEGIN
  IF p_decision NOT IN (
    'RESOLVED_SUPPRESSED',
    'RESOLVED_WITHHELD',
    'RESOLVED_UNDER_DISPUTE',
    'REJECTED_NO_CHANGE'
  ) THEN
    RAISE EXCEPTION 'INVALID_CORRECTION_REVIEW_DECISION';
  END IF;

  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 60 AND 3000 THEN
    RAISE EXCEPTION 'CORRECTION_REVIEW_REASON_REQUIRED';
  END IF;

  SELECT * INTO v_reviewer FROM users WHERE id = p_reviewer_id;
  IF NOT FOUND
     OR v_reviewer.role NOT IN ('admin', 'reviewer', 'platform_admin', 'super_admin')
     OR v_reviewer.is_verified IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'INDEPENDENT_CORRECTION_REVIEWER_REQUIRED';
  END IF;

  SELECT * INTO v_req
    FROM dealer_research_correction_requests
   WHERE request_id = p_request_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CORRECTION_REQUEST_NOT_FOUND';
  END IF;

  IF v_req.status <> 'PENDING_HUMAN_REVIEW' THEN
    RAISE EXCEPTION 'CORRECTION_REQUEST_ALREADY_RESOLVED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM dealer_research_claim_requests c
     WHERE c.seed_dealer_id = v_req.seed_dealer_id
       AND c.claimant_user_id = p_reviewer_id
  ) OR EXISTS (
    SELECT 1 FROM dealer_approved_seed_links l
     WHERE l.seed_dealer_id = v_req.seed_dealer_id
       AND l.claimant_user_id = p_reviewer_id
  ) THEN
    RAISE EXCEPTION 'INDEPENDENT_CORRECTION_REVIEWER_REQUIRED';
  END IF;

  IF p_decision IN ('RESOLVED_SUPPRESSED', 'RESOLVED_WITHHELD', 'RESOLVED_UNDER_DISPUTE') THEN
    v_pub_decision := CASE p_decision
      WHEN 'RESOLVED_SUPPRESSED' THEN 'SUPPRESSED'
      WHEN 'RESOLVED_WITHHELD' THEN 'WITHHELD'
      ELSE 'UNDER_DISPUTE'
    END;
    v_pub_result := dealer_record_research_publication_review(
      v_req.seed_dealer_id,
      p_reviewer_id,
      v_pub_decision,
      btrim(p_reason)
    );
    SELECT * INTO v_profile
      FROM dealer_research_public_profiles
     WHERE seed_dealer_id = v_req.seed_dealer_id;
    v_pub_event_id := v_profile.review_event_id;
    v_pub_status := v_profile.publication_status;
  ELSE
    SELECT * INTO v_profile
      FROM dealer_research_public_profiles
     WHERE seed_dealer_id = v_req.seed_dealer_id;
    v_pub_status := coalesce(v_profile.publication_status, 'WITHHELD');
  END IF;

  INSERT INTO dealer_research_correction_review_events (
    request_id,
    seed_dealer_id,
    reviewer_user_id,
    decision,
    publication_event_id,
    resulting_publication_status,
    rationale
  ) VALUES (
    v_req.request_id,
    v_req.seed_dealer_id,
    p_reviewer_id,
    p_decision,
    v_pub_event_id,
    v_pub_status,
    btrim(p_reason)
  ) RETURNING event_id INTO v_event_id;

  UPDATE dealer_research_correction_requests
     SET status = p_decision,
         reviewed_at = now(),
         reviewed_by = p_reviewer_id,
         resolution_event_id = v_event_id
   WHERE request_id = v_req.request_id;

  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'request_id', v_req.request_id,
    'seed_dealer_id', v_req.seed_dealer_id,
    'decision', p_decision,
    'resulting_publication_status', v_pub_status,
    'publication_event_id', v_pub_event_id,
    'public_profile_withdrawn', v_pub_status <> 'PRELISTED_UNCLAIMED',
    'legal_or_claim_ownership_granted', false
  );
END;
$$;

REVOKE ALL ON FUNCTION dealer_review_research_correction_request(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_review_research_correction_request(UUID, TEXT, TEXT, TEXT)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. S09: Governed duplicate research reconciliation & canonical URL redirects
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dealer_research_duplicate_redirects (
  redirect_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duplicate_seed_dealer_id TEXT NOT NULL UNIQUE REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
  canonical_seed_dealer_id TEXT NOT NULL REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
  canonical_slug TEXT NOT NULL CHECK (canonical_slug = lower(canonical_seed_dealer_id)),
  grouping_event_id UUID NOT NULL REFERENCES dealer_research_grouping_review_events(event_id) ON DELETE RESTRICT,
  publication_event_id UUID NOT NULL REFERENCES dealer_research_publication_events(event_id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rationale TEXT NOT NULL CHECK (length(btrim(rationale)) BETWEEN 60 AND 3000),
  source_custody_preserved BOOLEAN NOT NULL DEFAULT true CHECK (source_custody_preserved = true),
  legal_entity_merged BOOLEAN NOT NULL DEFAULT false CHECK (legal_entity_merged = false),
  reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (duplicate_seed_dealer_id <> canonical_seed_dealer_id)
);

CREATE INDEX IF NOT EXISTS idx_dealer_research_duplicate_redirects_canonical
  ON dealer_research_duplicate_redirects(canonical_seed_dealer_id);

ALTER TABLE dealer_research_duplicate_redirects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_research_duplicate_redirects FROM PUBLIC, anon, authenticated;
GRANT SELECT ON dealer_research_duplicate_redirects TO service_role;

DROP TRIGGER IF EXISTS dealer_research_duplicate_redirects_no_update ON dealer_research_duplicate_redirects;
CREATE TRIGGER dealer_research_duplicate_redirects_no_update
  BEFORE UPDATE ON dealer_research_duplicate_redirects
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

DROP TRIGGER IF EXISTS dealer_research_duplicate_redirects_no_delete ON dealer_research_duplicate_redirects;
CREATE TRIGGER dealer_research_duplicate_redirects_no_delete
  BEFORE DELETE ON dealer_research_duplicate_redirects
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

CREATE OR REPLACE FUNCTION dealer_reconcile_duplicate_research_seed(
  p_duplicate_seed_id TEXT,
  p_canonical_seed_id TEXT,
  p_reviewer_id TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reviewer users%ROWTYPE;
  v_canonical_profile dealer_research_public_profiles%ROWTYPE;
  v_dup_profile dealer_research_public_profiles%ROWTYPE;
  v_grouping JSONB;
  v_pub JSONB;
  v_redirect_id UUID;
BEGIN
  IF p_duplicate_seed_id IS NULL OR p_canonical_seed_id IS NULL
     OR btrim(p_duplicate_seed_id) = '' OR btrim(p_canonical_seed_id) = '' THEN
    RAISE EXCEPTION 'UNKNOWN_RESEARCH_SEED';
  END IF;

  IF p_duplicate_seed_id = p_canonical_seed_id THEN
    RAISE EXCEPTION 'SELF_DUPLICATE_REDIRECT_REFUSED';
  END IF;

  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 60 AND 3000 THEN
    RAISE EXCEPTION 'DUPLICATE_RECONCILIATION_REASON_REQUIRED';
  END IF;

  SELECT * INTO v_reviewer FROM users WHERE id = p_reviewer_id;
  IF NOT FOUND
     OR v_reviewer.role NOT IN ('admin', 'reviewer', 'platform_admin', 'super_admin')
     OR v_reviewer.is_verified IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'INDEPENDENT_DUPLICATE_REVIEWER_REQUIRED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM dealer_research_seed_records WHERE seed_dealer_id = p_duplicate_seed_id)
     OR NOT EXISTS (SELECT 1 FROM dealer_research_seed_records WHERE seed_dealer_id = p_canonical_seed_id) THEN
    RAISE EXCEPTION 'UNKNOWN_RESEARCH_SEED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM dealer_research_claim_requests c
     WHERE c.seed_dealer_id IN (p_duplicate_seed_id, p_canonical_seed_id)
       AND c.claimant_user_id = p_reviewer_id
  ) THEN
    RAISE EXCEPTION 'INDEPENDENT_DUPLICATE_REVIEWER_REQUIRED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM dealer_research_duplicate_redirects
     WHERE duplicate_seed_dealer_id = p_duplicate_seed_id
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_REDIRECT_ALREADY_RECORDED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM dealer_research_duplicate_redirects
     WHERE duplicate_seed_dealer_id = p_canonical_seed_id
        OR canonical_seed_dealer_id = p_duplicate_seed_id
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_REDIRECT_CHAIN_REFUSED';
  END IF;

  -- Prevent hostile takeover or loss of claim/legal custody: a seed with an active or historical
  -- claim or approved legal link cannot be folded into another seed via research duplicate redirect.
  IF EXISTS (
    SELECT 1 FROM dealer_research_claim_requests WHERE seed_dealer_id = p_duplicate_seed_id
  ) OR EXISTS (
    SELECT 1 FROM dealer_approved_seed_links WHERE seed_dealer_id = p_duplicate_seed_id
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_HAS_CLAIM_OR_LEGAL_CUSTODY_REFUSED';
  END IF;

  SELECT * INTO v_canonical_profile
    FROM dealer_research_public_profiles
   WHERE seed_dealer_id = p_canonical_seed_id
   FOR UPDATE;
  IF NOT FOUND OR v_canonical_profile.publication_status <> 'PRELISTED_UNCLAIMED' THEN
    RAISE EXCEPTION 'CANONICAL_TARGET_MUST_BE_PUBLISHED';
  END IF;

  v_grouping := dealer_record_research_grouping_review(
    p_duplicate_seed_id,
    p_canonical_seed_id,
    p_reviewer_id,
    'POTENTIAL_DUPLICATE',
    btrim(p_reason)
  );

  v_pub := dealer_record_research_publication_review(
    p_duplicate_seed_id,
    p_reviewer_id,
    'DUPLICATE',
    btrim(p_reason)
  );

  SELECT * INTO v_dup_profile
    FROM dealer_research_public_profiles
   WHERE seed_dealer_id = p_duplicate_seed_id;

  INSERT INTO dealer_research_duplicate_redirects (
    duplicate_seed_dealer_id,
    canonical_seed_dealer_id,
    canonical_slug,
    grouping_event_id,
    publication_event_id,
    reviewer_user_id,
    rationale,
    source_custody_preserved,
    legal_entity_merged
  ) VALUES (
    p_duplicate_seed_id,
    p_canonical_seed_id,
    v_canonical_profile.public_slug,
    (v_grouping->>'event_id')::uuid,
    v_dup_profile.review_event_id,
    p_reviewer_id,
    btrim(p_reason),
    true,
    false
  ) RETURNING redirect_id INTO v_redirect_id;

  RETURN jsonb_build_object(
    'redirect_id', v_redirect_id,
    'duplicate_seed_dealer_id', p_duplicate_seed_id,
    'canonical_seed_dealer_id', p_canonical_seed_id,
    'canonical_slug', v_canonical_profile.public_slug,
    'canonical_path', '/dealers/' || v_canonical_profile.public_slug,
    'grouping_event_id', (v_grouping->>'event_id')::uuid,
    'publication_event_id', v_dup_profile.review_event_id,
    'source_custody_preserved', true,
    'legal_entity_merged', false
  );
END;
$$;

REVOKE ALL ON FUNCTION dealer_reconcile_duplicate_research_seed(TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_reconcile_duplicate_research_seed(TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. T22: Tenant-scoped dealership media gallery & independent rights review
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dealer_storefront_media_items (
  media_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_dealer_id TEXT NOT NULL REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
  link_id UUID NOT NULL REFERENCES dealer_approved_seed_links(link_id) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  dealer_profile_id UUID NOT NULL REFERENCES dealer_profiles(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES dealer_branches(id) ON DELETE RESTRICT,
  uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_bucket TEXT NOT NULL DEFAULT 'ocr-documents' CHECK (storage_bucket = 'ocr-documents'),
  storage_path TEXT NOT NULL UNIQUE CHECK (storage_path LIKE 'dealership-media/%'),
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png')),
  file_bytes INTEGER NOT NULL CHECK (file_bytes BETWEEN 32 AND 4194304),
  scan_state TEXT NOT NULL CHECK (scan_state = 'CLEAN_CLAMAV_AT_UPLOAD'),
  media_category TEXT NOT NULL CHECK (media_category IN (
    'SHOWROOM_EXTERIOR',
    'SHOWROOM_INTERIOR',
    'BRANCH_FACILITY',
    'SERVICE_BAY'
  )),
  caption TEXT NOT NULL CHECK (
    length(btrim(caption)) BETWEEN 5 AND 240
    AND caption !~ '<\s*[/!a-zA-Z]'
  ),
  alt_text TEXT NOT NULL CHECK (
    length(btrim(alt_text)) BETWEEN 5 AND 240
    AND alt_text !~ '<\s*[/!a-zA-Z]'
  ),
  rights_attestation TEXT NOT NULL CHECK (
    rights_attestation = 'DEALER_OWNED_PHOTOGRAPH_NO_OEM_OR_THIRD_PARTY_LOGO'
  ),
  oem_or_brand_logo_claimed BOOLEAN NOT NULL DEFAULT false CHECK (oem_or_brand_logo_claimed = false),
  logo_rights_approved BOOLEAN NOT NULL DEFAULT false CHECK (logo_rights_approved = false),
  review_status TEXT NOT NULL DEFAULT 'PENDING_INDEPENDENT_REVIEW' CHECK (review_status IN (
    'PENDING_INDEPENDENT_REVIEW',
    'APPROVED_PUBLIC_DISPLAY',
    'REJECTED',
    'RETRACTED'
  )),
  latest_review_event_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, content_sha256)
);

CREATE INDEX IF NOT EXISTS idx_dealer_storefront_media_seed
  ON dealer_storefront_media_items(seed_dealer_id, review_status, created_at DESC);

CREATE TABLE IF NOT EXISTS dealer_storefront_media_review_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id UUID NOT NULL REFERENCES dealer_storefront_media_items(media_id) ON DELETE RESTRICT,
  seed_dealer_id TEXT NOT NULL REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED_PUBLIC_DISPLAY', 'REJECTED', 'RETRACTED')),
  rationale TEXT NOT NULL CHECK (length(btrim(rationale)) BETWEEN 40 AND 3000),
  logo_rights_approved BOOLEAN NOT NULL DEFAULT false CHECK (logo_rights_approved = false),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_storefront_media_reviews_media
  ON dealer_storefront_media_review_events(media_id, reviewed_at DESC);

ALTER TABLE dealer_storefront_media_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_storefront_media_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_storefront_media_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON dealer_storefront_media_review_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON dealer_storefront_media_items, dealer_storefront_media_review_events TO service_role;

DROP TRIGGER IF EXISTS dealer_storefront_media_review_events_no_update ON dealer_storefront_media_review_events;
CREATE TRIGGER dealer_storefront_media_review_events_no_update
  BEFORE UPDATE ON dealer_storefront_media_review_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

DROP TRIGGER IF EXISTS dealer_storefront_media_review_events_no_delete ON dealer_storefront_media_review_events;
CREATE TRIGGER dealer_storefront_media_review_events_no_delete
  BEFORE DELETE ON dealer_storefront_media_review_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

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
    seed_dealer_id,
    link_id,
    tenant_id,
    dealer_profile_id,
    branch_id,
    uploaded_by,
    storage_bucket,
    storage_path,
    content_sha256,
    mime_type,
    file_bytes,
    scan_state,
    media_category,
    caption,
    alt_text,
    rights_attestation,
    oem_or_brand_logo_claimed,
    logo_rights_approved,
    review_status
  ) VALUES (
    v_link.seed_dealer_id,
    v_link.link_id,
    v_link.tenant_id,
    v_link.dealer_profile_id,
    p_branch_id,
    p_actor_id,
    'ocr-documents',
    p_storage_path,
    p_content_sha256,
    p_mime_type,
    p_file_bytes,
    'CLEAN_CLAMAV_AT_UPLOAD',
    p_media_category,
    btrim(p_caption),
    btrim(p_alt_text),
    p_rights_attestation,
    false,
    false,
    'PENDING_INDEPENDENT_REVIEW'
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

REVOKE ALL ON FUNCTION dealer_record_storefront_media_upload(TEXT, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_record_storefront_media_upload(TEXT, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, BOOLEAN)
  TO service_role;

CREATE OR REPLACE FUNCTION dealer_review_storefront_media_item(
  p_media_id UUID,
  p_reviewer_id TEXT,
  p_decision TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reviewer users%ROWTYPE;
  v_media dealer_storefront_media_items%ROWTYPE;
  v_link dealer_approved_seed_links%ROWTYPE;
  v_event_id UUID;
BEGIN
  IF p_decision NOT IN ('APPROVED_PUBLIC_DISPLAY', 'REJECTED', 'RETRACTED')
     OR length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 40 AND 3000 THEN
    RAISE EXCEPTION 'INVALID_STOREFRONT_MEDIA_REVIEW';
  END IF;

  SELECT * INTO v_reviewer FROM users WHERE id = p_reviewer_id;
  IF NOT FOUND
     OR v_reviewer.role NOT IN ('admin', 'reviewer', 'platform_admin', 'super_admin')
     OR v_reviewer.is_verified IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'INDEPENDENT_MEDIA_REVIEWER_REQUIRED';
  END IF;

  SELECT * INTO v_media
    FROM dealer_storefront_media_items
   WHERE media_id = p_media_id
   FOR UPDATE;
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

  IF p_decision = 'APPROVED_PUBLIC_DISPLAY'
     AND NOT dealer_tenant_listing_authority_current(v_media.tenant_id) THEN
    RAISE EXCEPTION 'DEALER_MEDIA_PUBLICATION_REQUIRES_ACTIVE_AUTHORITY';
  END IF;

  INSERT INTO dealer_storefront_media_review_events (
    media_id,
    seed_dealer_id,
    tenant_id,
    reviewer_user_id,
    decision,
    rationale,
    logo_rights_approved
  ) VALUES (
    v_media.media_id,
    v_media.seed_dealer_id,
    v_media.tenant_id,
    p_reviewer_id,
    p_decision,
    btrim(p_reason),
    false
  ) RETURNING event_id INTO v_event_id;

  UPDATE dealer_storefront_media_items
     SET review_status = p_decision,
         latest_review_event_id = v_event_id,
         updated_at = now()
   WHERE media_id = v_media.media_id;

  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'media_id', v_media.media_id,
    'seed_dealer_id', v_media.seed_dealer_id,
    'decision', p_decision,
    'public_display_approved', p_decision = 'APPROVED_PUBLIC_DISPLAY',
    'logo_rights_approved', false
  );
END;
$$;

REVOKE ALL ON FUNCTION dealer_review_storefront_media_item(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_review_storefront_media_item(UUID, TEXT, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE VIEW dealer_public_storefront_media_current WITH (security_barrier = true) AS
SELECT
  m.media_id,
  m.seed_dealer_id,
  m.branch_id,
  -- Security review #4: the REVIEWED branch name from the approved storefront snapshot, never the
  -- live (owner/staff-editable) dealer_branches.name.
  (SELECT snap->>'name' FROM jsonb_array_elements(f.approved_branch_snapshot) snap
    WHERE snap->>'branch_id' = m.branch_id::text LIMIT 1) AS branch_name,
  m.storage_bucket,
  m.storage_path,
  m.content_sha256,
  m.mime_type,
  m.media_category,
  m.caption,
  m.alt_text,
  m.rights_attestation,
  m.logo_rights_approved,
  m.updated_at AS approved_at
FROM dealer_storefront_media_items m
JOIN dealer_full_storefront_current f
  ON f.seed_dealer_id = m.seed_dealer_id
JOIN dealer_approved_seed_links l
  ON l.link_id = m.link_id AND l.operating_status = 'ACTIVE'
WHERE m.review_status = 'APPROVED_PUBLIC_DISPLAY'
  AND m.logo_rights_approved = false
  AND m.oem_or_brand_logo_claimed = false
  AND dealer_tenant_listing_authority_current(m.tenant_id) = true;

REVOKE ALL ON dealer_public_storefront_media_current FROM PUBLIC, anon, authenticated;
GRANT SELECT ON dealer_public_storefront_media_current TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Shared Multi-Instance & Process-Restart-Safe Single-Use Media Review Tickets
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dealer_storefront_media_review_tickets (
  ticket_jti TEXT PRIMARY KEY CHECK (ticket_jti ~ '^[0-9a-f]{32}$'),
  token_sha256 TEXT NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seed_dealer_id TEXT NOT NULL REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  target_row_id UUID NOT NULL REFERENCES dealer_storefront_media_items(media_id) ON DELETE CASCADE,
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  operation TEXT NOT NULL CHECK (operation IN ('STOREFRONT_MEDIA_PREVIEW', 'STOREFRONT_MEDIA_DECISION')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_dealer_media_tickets_lookup
  ON dealer_storefront_media_review_tickets(reviewer_id, seed_dealer_id, operation, expires_at);

ALTER TABLE dealer_storefront_media_review_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_storefront_media_review_tickets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON dealer_storefront_media_review_tickets TO service_role;

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

-- Security review #1: a takedown (SUPPRESSED / UNDER_DISPUTE / DUPLICATE) can only be reversed by a
-- DIFFERENT reviewer than the one who recorded it, and a full storefront approved before the most recent
-- takedown never comes back on its own (dealer_full_storefront_current re-checks recency, 20261103135000).
CREATE FUNCTION dealer_guard_research_reprelisting()
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
CREATE TRIGGER dealer_guard_research_reprelisting
  BEFORE INSERT ON dealer_research_publication_events
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_research_reprelisting();

-- +migrate Down
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dealer_research_correction_review_events)
     OR EXISTS (SELECT 1 FROM dealer_research_duplicate_redirects)
     OR EXISTS (SELECT 1 FROM dealer_storefront_media_items)
     OR EXISTS (SELECT 1 FROM dealer_storefront_media_review_events) THEN
    RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_DEALER_R5_CUSTODY';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS dealer_consume_storefront_media_review_ticket(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS dealer_issue_storefront_media_review_ticket(TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ);
DROP TABLE IF EXISTS dealer_storefront_media_review_tickets;
DROP VIEW IF EXISTS dealer_public_storefront_media_current;
DROP FUNCTION IF EXISTS dealer_review_storefront_media_item(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS dealer_record_storefront_media_upload(TEXT, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, BOOLEAN);
DROP TABLE IF EXISTS dealer_storefront_media_review_events;
DROP TABLE IF EXISTS dealer_storefront_media_items;
DROP FUNCTION IF EXISTS dealer_reconcile_duplicate_research_seed(TEXT, TEXT, TEXT, TEXT);
DROP TABLE IF EXISTS dealer_research_duplicate_redirects;
DROP FUNCTION IF EXISTS dealer_review_research_correction_request(UUID, TEXT, TEXT, TEXT);
DROP TABLE IF EXISTS dealer_research_correction_review_events;
DROP TRIGGER IF EXISTS dealer_guard_research_reprelisting ON dealer_research_publication_events;
DROP FUNCTION IF EXISTS dealer_guard_research_reprelisting();
