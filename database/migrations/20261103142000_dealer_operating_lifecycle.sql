-- +migrate Up
-- CARUP-DEALER-ONB-001-LR01-R4 P0-3 (C12): governed dealership operating lifecycle.
-- Plan v1.1 C12: "Renew, amend, suspend, reinstate, investigate, expire and withdraw public claims;
-- immediate revocation". Claim revocation (dealer_suspend_revoked_seed_claim), storefront retraction,
-- time expiry and listing withdrawal already exist. This adds the missing reviewer decisions:
--   SUSPEND             ACTIVE → SUSPENDED (tenant + profile suspended; public stock withdrawn)
--   OPEN_INVESTIGATION  investigation flag on an ACTIVE dealer (authority not current; stock withdrawn)
--   CLOSE_INVESTIGATION clears the flag; nothing is silently republished
--   REINSTATE           SUSPENDED → ACTIVE, only by a DIFFERENT reviewer than the one who suspended,
--                       only for a still-approved claim with current legal + country policy
--   RENEW               moves the link onto a NEWER independent legal review of the same claim with a
--                       later expiry (the legal review itself is the existing legal-approval function)
--   WITHDRAW            permanent: ACTIVE/SUSPENDED → WITHDRAWN (no reinstatement path)
-- Every decision needs a verified independent reviewer (never the claimant or a tenant member), a
-- 40–3000 character reason, and lands in an append-only event. Amendments remain versioned
-- operational declarations (20261103134000). No payment, verification badge or listing is granted.

CREATE TABLE dealer_operating_lifecycle_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID NOT NULL REFERENCES dealer_approved_seed_links(link_id) ON DELETE RESTRICT,
  seed_dealer_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('SUSPEND','OPEN_INVESTIGATION','CLOSE_INVESTIGATION',
    'REINSTATE','RENEW','WITHDRAW')),
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 40 AND 3000),
  previous_operating_status TEXT NOT NULL,
  next_operating_status TEXT NOT NULL,
  previous_legal_review_id UUID NOT NULL,
  next_legal_review_id UUID NOT NULL,
  public_listings_withdrawn INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX dealer_operating_lifecycle_events_link ON dealer_operating_lifecycle_events(link_id, created_at);
CREATE TRIGGER dealer_operating_lifecycle_events_no_update BEFORE UPDATE ON dealer_operating_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_operating_lifecycle_events_no_delete BEFORE DELETE ON dealer_operating_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
ALTER TABLE dealer_operating_lifecycle_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_operating_lifecycle_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON dealer_operating_lifecycle_events TO service_role;

CREATE FUNCTION dealer_record_operating_lifecycle_decision(
  p_seed_dealer_id TEXT, p_reviewer_id TEXT, p_action TEXT, p_reason TEXT,
  p_new_legal_review_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_link dealer_approved_seed_links%ROWTYPE;
  v_reviewer users%ROWTYPE;
  v_claim dealer_research_claim_requests%ROWTYPE;
  v_profile dealer_profiles%ROWTYPE;
  v_current dealer_legal_application_reviews%ROWTYPE;
  v_new dealer_legal_application_reviews%ROWTYPE;
  v_new_submission dealer_claim_compliance_submissions%ROWTYPE;
  v_policy dealer_country_legal_policy_authority%ROWTYPE;
  v_next_status TEXT; v_next_legal UUID; v_last_suspender TEXT; v_withdrawn INTEGER := 0;
  v_published_before INTEGER := 0;
  v_event UUID;
BEGIN
  IF p_action NOT IN ('SUSPEND','OPEN_INVESTIGATION','CLOSE_INVESTIGATION','REINSTATE','RENEW','WITHDRAW') THEN
    RAISE EXCEPTION 'INVALID_OPERATING_LIFECYCLE_ACTION';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 40 AND 3000 THEN
    RAISE EXCEPTION 'OPERATING_LIFECYCLE_REASON_REQUIRED';
  END IF;
  SELECT * INTO v_link FROM dealer_approved_seed_links WHERE seed_dealer_id = p_seed_dealer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'APPROVED_DEALER_LINK_REQUIRED'; END IF;
  SELECT * INTO v_reviewer FROM users WHERE id = p_reviewer_id;
  IF NOT FOUND OR v_reviewer.is_verified IS DISTINCT FROM true
     OR v_reviewer.role NOT IN ('admin','reviewer','platform_admin','super_admin')
     OR v_reviewer.id = v_link.claimant_user_id
     OR EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = v_link.tenant_id AND tu.user_id = p_reviewer_id) THEN
    RAISE EXCEPTION 'INDEPENDENT_LIFECYCLE_REVIEWER_REQUIRED';
  END IF;
  SELECT * INTO v_claim FROM dealer_research_claim_requests WHERE claim_id = v_link.claim_id;
  SELECT * INTO v_profile FROM dealer_profiles WHERE id = v_link.dealer_profile_id FOR UPDATE;
  SELECT * INTO v_current FROM dealer_legal_application_reviews WHERE legal_review_id = v_link.legal_review_id;
  v_next_status := v_link.operating_status;
  v_next_legal := v_link.legal_review_id;
  SELECT count(*)::int INTO v_published_before FROM vehicles
   WHERE tenant_id::text = v_link.tenant_id::text AND publication_status = 'published';

  IF p_action = 'SUSPEND' THEN
    IF v_link.operating_status <> 'ACTIVE' THEN RAISE EXCEPTION 'ONLY_ACTIVE_DEALER_CAN_BE_SUSPENDED'; END IF;
    v_next_status := 'SUSPENDED';
    UPDATE dealer_profiles SET active_state = 'inactive', suspension_state = 'suspended', updated_at = now()
     WHERE id = v_link.dealer_profile_id;
    UPDATE tenants SET status = 'suspended', updated_at = now() WHERE id = v_link.tenant_id;
  ELSIF p_action = 'OPEN_INVESTIGATION' THEN
    IF v_link.operating_status <> 'ACTIVE' OR v_profile.investigation_state <> 'none' THEN
      RAISE EXCEPTION 'INVESTIGATION_REQUIRES_ACTIVE_UNFLAGGED_DEALER';
    END IF;
    UPDATE dealer_profiles SET investigation_state = 'open', updated_at = now() WHERE id = v_link.dealer_profile_id;
  ELSIF p_action = 'CLOSE_INVESTIGATION' THEN
    IF v_profile.investigation_state <> 'open' THEN RAISE EXCEPTION 'NO_OPEN_INVESTIGATION'; END IF;
    UPDATE dealer_profiles SET investigation_state = 'none', updated_at = now() WHERE id = v_link.dealer_profile_id;
  ELSIF p_action = 'REINSTATE' THEN
    IF v_link.operating_status <> 'SUSPENDED' THEN RAISE EXCEPTION 'ONLY_SUSPENDED_DEALER_CAN_BE_REINSTATED'; END IF;
    IF v_claim.claim_status <> 'CLAIM_APPROVED' THEN RAISE EXCEPTION 'REVOKED_CLAIM_REQUIRES_NEW_CLAIM'; END IF;
    SELECT reviewer_user_id INTO v_last_suspender FROM dealer_operating_lifecycle_events
     WHERE link_id = v_link.link_id AND action = 'SUSPEND' ORDER BY created_at DESC, event_id DESC LIMIT 1;
    IF v_last_suspender IS NOT NULL AND v_last_suspender = p_reviewer_id THEN
      RAISE EXCEPTION 'REINSTATEMENT_REQUIRES_DIFFERENT_REVIEWER';
    END IF;
    SELECT * INTO v_policy FROM dealer_country_legal_policy_authority
     WHERE country_code = v_current.country_code AND policy_version = v_current.policy_version;
    IF v_policy.policy_state IS DISTINCT FROM 'APPROVED' OR v_policy.effective_at > clock_timestamp()
       OR v_policy.expires_at <= clock_timestamp() OR v_current.legal_expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'REINSTATEMENT_REQUIRES_CURRENT_LEGAL_AND_POLICY';
    END IF;
    v_next_status := 'ACTIVE';
    UPDATE dealer_profiles SET active_state = 'active', suspension_state = 'none', updated_at = now()
     WHERE id = v_link.dealer_profile_id;
    UPDATE tenants SET status = 'active', updated_at = now() WHERE id = v_link.tenant_id;
  ELSIF p_action = 'RENEW' THEN
    IF v_link.operating_status = 'WITHDRAWN' THEN RAISE EXCEPTION 'WITHDRAWN_DEALER_CANNOT_RENEW'; END IF;
    IF p_new_legal_review_id IS NULL OR p_new_legal_review_id = v_link.legal_review_id THEN
      RAISE EXCEPTION 'NEWER_INDEPENDENT_LEGAL_REVIEW_REQUIRED';
    END IF;
    SELECT * INTO v_new FROM dealer_legal_application_reviews WHERE legal_review_id = p_new_legal_review_id;
    SELECT * INTO v_new_submission FROM dealer_claim_compliance_submissions WHERE submission_id = v_new.submission_id;
    IF v_new.legal_review_id IS NULL OR v_new_submission.claim_id IS DISTINCT FROM v_link.claim_id
       OR v_new.claimant_user_id <> v_link.claimant_user_id
       OR v_new.created_at <= v_current.created_at
       OR v_new.legal_expires_at <= v_current.legal_expires_at
       OR v_new.legal_expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'NEWER_INDEPENDENT_LEGAL_REVIEW_REQUIRED';
    END IF;
    SELECT * INTO v_policy FROM dealer_country_legal_policy_authority
     WHERE country_code = v_new.country_code AND policy_version = v_new.policy_version;
    IF v_policy.policy_state IS DISTINCT FROM 'APPROVED' OR v_policy.effective_at > clock_timestamp()
       OR v_policy.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'RENEWAL_REQUIRES_CURRENT_COUNTRY_POLICY';
    END IF;
    v_next_legal := v_new.legal_review_id;
    UPDATE dealer_approved_seed_links SET legal_review_id = v_new.legal_review_id,
      submission_id = v_new.submission_id WHERE link_id = v_link.link_id;
    UPDATE dealer_profiles SET expiry_date = v_new.legal_expires_at, updated_at = now()
     WHERE id = v_link.dealer_profile_id;
  ELSIF p_action = 'WITHDRAW' THEN
    IF v_link.operating_status NOT IN ('ACTIVE','SUSPENDED') THEN RAISE EXCEPTION 'DEALER_ALREADY_WITHDRAWN'; END IF;
    v_next_status := 'WITHDRAWN';
    UPDATE dealer_profiles SET active_state = 'inactive', suspension_state = 'suspended', updated_at = now()
     WHERE id = v_link.dealer_profile_id;
    UPDATE tenants SET status = 'withdrawn', updated_at = now() WHERE id = v_link.tenant_id;
  END IF;

  IF v_next_status IS DISTINCT FROM v_link.operating_status THEN
    UPDATE dealer_approved_seed_links SET operating_status = v_next_status WHERE link_id = v_link.link_id;
  END IF;
  -- Belt and braces: whatever changed, a dealer whose authority is no longer current has no public stock.
  IF NOT dealer_tenant_listing_authority_current(v_link.tenant_id) THEN
    PERFORM dealer_withdraw_tenant_public_listings(v_link.tenant_id, 'LIFECYCLE_' || p_action, p_reviewer_id);
  END IF;
  -- Truthful count whichever trigger or call withdrew them inside this transaction.
  SELECT v_published_before - count(*)::int INTO v_withdrawn FROM vehicles
   WHERE tenant_id::text = v_link.tenant_id::text AND publication_status = 'published';
  INSERT INTO dealer_operating_lifecycle_events(link_id, seed_dealer_id, action, reviewer_user_id, reason,
    previous_operating_status, next_operating_status, previous_legal_review_id, next_legal_review_id,
    public_listings_withdrawn)
  VALUES (v_link.link_id, v_link.seed_dealer_id, p_action, p_reviewer_id, btrim(p_reason),
    v_link.operating_status, v_next_status, v_link.legal_review_id, v_next_legal, v_withdrawn)
  RETURNING event_id INTO v_event;
  RETURN jsonb_build_object('event_id', v_event, 'seed_dealer_id', v_link.seed_dealer_id, 'action', p_action,
    'previous_operating_status', v_link.operating_status, 'operating_status', v_next_status,
    'legal_review_id', v_next_legal, 'operating_authority_current', dealer_tenant_listing_authority_current(v_link.tenant_id),
    'public_listings_withdrawn', v_withdrawn, 'listings_republished', false,
    'public_storefront_republished', false, 'payment_entitlement_changed', false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_record_operating_lifecycle_decision(TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_record_operating_lifecycle_decision(TEXT, TEXT, TEXT, TEXT, UUID) TO service_role;

-- +migrate Down
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dealer_operating_lifecycle_events) THEN
    RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_DEALER_LIFECYCLE_CUSTODY';
  END IF;
END;
$$;
DROP FUNCTION IF EXISTS dealer_record_operating_lifecycle_decision(TEXT, TEXT, TEXT, TEXT, UUID);
DROP TABLE IF EXISTS dealer_operating_lifecycle_events;
