-- +migrate Up
-- DBA review #7: never queue indefinitely behind long transactions on canonical tables.
SET LOCAL lock_timeout = '3s';
SET LOCAL carup.dealer_migration_txn = 'on';
DO $txnguard$
BEGIN
  -- R6 DBA review 3 N2: SET LOCAL is a silent no-op outside a transaction block, so a migration
  -- run statement by statement in autocommit (plain `psql -f`) would lose its lock_timeout and
  -- could apply half-way. Refuse, and end the session so the client cannot run the remaining
  -- statements. Apply with backend/scripts/dealership/applyDealerMigrations.mjs or
  -- `psql -1 -v ON_ERROR_STOP=1` (one transaction per migration section).
  IF current_setting('carup.dealer_migration_txn', true) IS DISTINCT FROM 'on' THEN
    RAISE WARNING 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION: use the dealership migration runner or psql -1 -v ON_ERROR_STOP=1';
    BEGIN
      PERFORM pg_terminate_backend(pg_backend_pid());
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE EXCEPTION 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION';
  END IF;
END
$txnguard$;
-- CARUP-DEALER-ONB-001-LR01-R4 P0-2 (C17 / C12 / C15): canonical dealer VIN listing authority.
--
-- The dealership domain NEVER publishes a vehicle and never invents a seller decision. Publication
-- stays the canonical Seller/Marketplace action (POST /api/vehicles/:vin/publish, gated by the
-- deterministic completeness evaluator: identity, Seller Authority, registration readiness,
-- reconciliation, risk). This migration only:
--  (a) lets the ACTIVE approved legal owner of a dealership-programme tenant prepare one of its own
--      private tenant VIN drafts as a canonical seller listing candidate — owner as the governed
--      current seller, an owned branch, and every stated fact stamped `dealer_declared`;
--  (b) refuses, at the data layer, a seller relationship or publication for a dealership-programme
--      VIN unless that tenant's approved operating authority is current RIGHT NOW;
--  (c) withdraws a dealership-programme tenant's public listings the moment its operating link,
--      tenant or dealer profile loses authority, and gives operations a sweep for time lapses;
--  (d) refuses new inquiries routed to a dealership-programme tenant whose authority is not current;
--  (e) refuses verification of a dealership-programme VIN's evidence by the uploader or by anyone
--      holding membership in that dealership (no self-certification).
-- Tenants WITHOUT a dealer_approved_seed_links row (every legacy tenant) are untouched by every
-- trigger below: each one returns before doing anything else.

CREATE TABLE dealer_listing_authority_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  vin TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'LISTING_CANDIDATE_PREPARED','PUBLIC_LISTINGS_WITHDRAWN','LAPSE_SWEEP_TENANT_SKIPPED')),
  reason_code TEXT NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  affected_listings INTEGER NOT NULL DEFAULT 0 CHECK (affected_listings >= 0),
  actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX dealer_listing_authority_events_tenant ON dealer_listing_authority_events(tenant_id, created_at);
CREATE TRIGGER dealer_listing_authority_events_no_update BEFORE UPDATE ON dealer_listing_authority_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_listing_authority_events_no_delete BEFORE DELETE ON dealer_listing_authority_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
ALTER TABLE dealer_listing_authority_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_listing_authority_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON dealer_listing_authority_events TO service_role;

-- Lawful branch inventory attribution: one current branch per prepared dealership VIN, and the
-- branch must belong to the same approved dealer profile (enforced by the preparation function).
CREATE TABLE dealer_vehicle_branch_assignments (
  vin TEXT PRIMARY KEY REFERENCES vehicles(vin) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES dealer_branches(id) ON DELETE RESTRICT,
  assigned_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX dealer_vehicle_branch_assignments_tenant ON dealer_vehicle_branch_assignments(tenant_id);
ALTER TABLE dealer_vehicle_branch_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_vehicle_branch_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON dealer_vehicle_branch_assignments TO service_role;

-- The SQL twin of readMyOperationalDealerAuthority (dealerLegalActivationService.js). Every
-- condition is evaluated against clock_timestamp(), not now(): now() is the transaction start, so
-- a long transaction could otherwise act on authority that has already lapsed.
CREATE FUNCTION dealer_tenant_listing_authority_current(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM dealer_approved_seed_links l
      JOIN dealer_research_claim_requests c ON c.claim_id = l.claim_id
      JOIN tenants t ON t.id = l.tenant_id
      JOIN tenant_users tu ON tu.tenant_id = l.tenant_id AND tu.user_id = l.claimant_user_id
      JOIN dealer_profiles d ON d.id = l.dealer_profile_id AND d.user_id = l.claimant_user_id
      JOIN dealer_legal_application_reviews r ON r.legal_review_id = l.legal_review_id
      JOIN dealer_country_legal_policy_authority p
        ON p.country_code = r.country_code AND p.policy_version = r.policy_version
     WHERE l.tenant_id = p_tenant_id
       AND l.operating_status = 'ACTIVE'
       AND c.claim_status = 'CLAIM_APPROVED' AND c.claimant_user_id = l.claimant_user_id
       AND t.type = 'dealership' AND t.status = 'active'
       AND tu.role IN ('dealer', 'admin')
       AND d.identity_status = 'verified' AND d.compliance_review_state = 'passed'
       AND d.active_state = 'active' AND d.restriction_state = 'none'
       AND d.suspension_state = 'none' AND d.investigation_state = 'none'
       AND d.expiry_date > clock_timestamp()
       AND p.policy_state = 'APPROVED'
       AND p.effective_at <= clock_timestamp() AND p.expires_at > clock_timestamp()
       AND r.legal_expires_at > clock_timestamp()
  )
$$;
REVOKE ALL ON FUNCTION dealer_tenant_listing_authority_current(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_tenant_listing_authority_current(UUID) TO service_role;

-- R6 DBA #4 (+ review 2 #3/#4): ONE lock order for every dealership write that touches programme
-- stock and its operating link (docs/dealership/R6_DBA_OPERATIONS_AND_LOCK_ORDER.md):
--   tenants row → dealer_profiles row → ALL the tenant's VINs (any publication status, ascending
--   VIN; several tenants: ascending (tenant_id, vin)), FOR NO KEY UPDATE → dealer_approved_seed_links.
-- The canonical vehicle write guard below can only ever take "vehicle, then link" (a BEFORE ROW
-- trigger fires after its own row is locked), so every suspension/withdrawal path takes the
-- tenant's VINs BEFORE the link. ALL VINs, not only published ones: a dealer transaction that
-- publishes a draft VIN holds that draft row and the link FOR SHARE, so a published-only pre-lock
-- would skip it, take the link's turn and deadlock on the dealer's next (ascending) VIN.
-- FOR NO KEY UPDATE is the mode the withdrawal UPDATE itself takes, so FK KEY SHARE checks
-- (e.g. a branch assignment referencing the VIN) are never blocked by the pre-lock.
CREATE FUNCTION dealer_lock_tenant_programme_vins(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM vehicles WHERE tenant_id = p_tenant_id ORDER BY vin FOR NO KEY UPDATE;
END;
$$;
REVOKE ALL ON FUNCTION dealer_lock_tenant_programme_vins(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_lock_tenant_programme_vins(UUID) TO service_role;

-- Withdraw (never delete) every PUBLIC listing of one dealership-programme tenant. 'publishable' is
-- exactly the canonical unpublish target: off the public surface, still the seller's, availability
-- untouched. One append-only event records how many listings left the public surface and why.
CREATE FUNCTION dealer_withdraw_tenant_public_listings(p_tenant_id UUID, p_reason TEXT, p_actor TEXT)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_count INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dealer_approved_seed_links WHERE tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'NOT_A_DEALERSHIP_PROGRAMME_TENANT';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    -- DBA review #3: a withdrawal must see rows committed by concurrent publishers.
    RAISE EXCEPTION 'DEALER_LISTING_WITHDRAWAL_REQUIRES_READ_COMMITTED';
  END IF;
  -- R6 DBA #4: concurrent withdrawals of one tenant take its VINs in the same (ascending) order.
  PERFORM dealer_lock_tenant_programme_vins(p_tenant_id);
  WITH withdrawn AS (
    UPDATE vehicles SET publication_status = 'publishable'
     WHERE tenant_id = p_tenant_id AND publication_status = 'published'
     RETURNING vin
  ) SELECT count(*)::int INTO v_count FROM withdrawn;
  IF v_count > 0 THEN
    INSERT INTO dealer_listing_authority_events(tenant_id, event_type, reason_code, affected_listings, actor_id)
    VALUES (p_tenant_id, 'PUBLIC_LISTINGS_WITHDRAWN', p_reason, v_count, p_actor);
  END IF;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION dealer_withdraw_tenant_public_listings(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_withdraw_tenant_public_listings(UUID, TEXT, TEXT) TO service_role;

-- (b) Data-layer listing guard on the canonical vehicles table.
CREATE FUNCTION dealer_guard_canonical_listing_write()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_link dealer_approved_seed_links%ROWTYPE; v_old_programme BOOLEAN := false; v_entering BOOLEAN;
BEGIN
  -- Programme stock may LEAVE its dealer only to "no tenant" (a completed canonical ownership
  -- transfer clears tenant_id); it can never be re-homed into another tenant.
  IF TG_OP = 'UPDATE' AND OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    SELECT true INTO v_old_programme FROM dealer_approved_seed_links WHERE tenant_id = OLD.tenant_id;
    IF coalesce(v_old_programme, false) AND NEW.tenant_id IS NOT NULL THEN
      RAISE EXCEPTION 'DEALER_TENANT_INVENTORY_REASSIGNMENT_REFUSED';
    END IF;
  END IF;
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;
  IF current_setting('transaction_isolation') <> 'read committed'
     AND EXISTS (SELECT 1 FROM dealer_approved_seed_links WHERE tenant_id = NEW.tenant_id) THEN
    -- DBA review #3: under REPEATABLE READ/SERIALIZABLE the authority read could use a stale snapshot.
    RAISE EXCEPTION 'DEALER_LISTING_WRITE_REQUIRES_READ_COMMITTED';
  END IF;
  -- FOR SHARE serialises against a concurrent suspension that holds the link FOR UPDATE: this write
  -- either commits first (and is then withdrawn by the suspension) or sees the suspension's result.
  SELECT * INTO v_link FROM dealer_approved_seed_links WHERE tenant_id = NEW.tenant_id FOR SHARE;
  IF NOT FOUND THEN RETURN NEW; END IF;  -- legacy tenants: untouched
  -- Moving INTO a programme tenant is checked exactly like an INSERT.
  v_entering := TG_OP = 'INSERT' OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id;
  -- A governed current-seller relationship on a dealership-programme VIN may only ever name the
  -- approved legal owner, and only while operating authority is current. Staff never inherit it.
  IF NEW.current_seller_id IS NOT NULL AND
     (v_entering OR NEW.current_seller_id IS DISTINCT FROM OLD.current_seller_id) THEN
    IF NEW.current_seller_id <> v_link.claimant_user_id THEN
      RAISE EXCEPTION 'DEALER_SELLER_RELATIONSHIP_REQUIRES_APPROVED_OWNER';
    END IF;
    IF v_link.operating_status <> 'ACTIVE' OR NOT dealer_tenant_listing_authority_current(v_link.tenant_id) THEN
      RAISE EXCEPTION 'DEALER_LISTING_AUTHORITY_NOT_CURRENT';
    END IF;
  END IF;
  -- Moving INTO the public surface requires current authority and the owner as governed seller.
  -- Moving OUT (unpublish / withdrawal) is never blocked.
  IF NEW.publication_status = 'published' AND
     (v_entering OR OLD.publication_status IS DISTINCT FROM 'published') THEN
    IF v_link.operating_status <> 'ACTIVE' OR NOT dealer_tenant_listing_authority_current(v_link.tenant_id) THEN
      RAISE EXCEPTION 'DEALER_LISTING_AUTHORITY_NOT_CURRENT';
    END IF;
    IF NEW.current_seller_id IS DISTINCT FROM v_link.claimant_user_id THEN
      RAISE EXCEPTION 'DEALER_PUBLICATION_REQUIRES_APPROVED_OWNER_SELLER';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dealer_guard_canonical_listing_write
  BEFORE INSERT OR UPDATE OF publication_status, current_seller_id, tenant_id ON vehicles
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_canonical_listing_write();

-- (c) Immediate withdrawal when authority is lost through any of the three governed records.
CREATE FUNCTION dealer_withdraw_listings_on_link_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.operating_status = 'ACTIVE' AND NEW.operating_status <> 'ACTIVE' THEN
    PERFORM dealer_withdraw_tenant_public_listings(NEW.tenant_id,
      'OPERATING_LINK_' || NEW.operating_status, NULL);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dealer_withdraw_listings_on_link_change
  AFTER UPDATE OF operating_status ON dealer_approved_seed_links
  FOR EACH ROW EXECUTE FUNCTION dealer_withdraw_listings_on_link_change();

CREATE FUNCTION dealer_withdraw_listings_on_tenant_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT ((OLD.status IS NOT DISTINCT FROM 'active' AND NEW.status IS DISTINCT FROM 'active')
          OR NEW.type IS DISTINCT FROM OLD.type) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM dealer_approved_seed_links WHERE tenant_id = NEW.id) THEN
    RETURN NEW;  -- legacy tenants: untouched
  END IF;
  -- R6 lock order: the tenant's VINs, then the operating link (so a concurrent publish cannot slip
  -- between check and withdrawal, and a concurrent VIN write cannot deadlock against us).
  PERFORM dealer_lock_tenant_programme_vins(NEW.id);
  PERFORM 1 FROM dealer_approved_seed_links WHERE tenant_id = NEW.id FOR UPDATE;
  IF FOUND AND NOT dealer_tenant_listing_authority_current(NEW.id) THEN
    PERFORM dealer_withdraw_tenant_public_listings(NEW.id,
      'TENANT_' || upper(regexp_replace(coalesce(NEW.status, 'none'), '[^A-Za-z0-9]', '_', 'g')), NULL);
  END IF;
  RETURN NEW;
END;
$$;
-- R6 DBA review 2 #10: WHEN skips no-op updates (SET status = status) before any plpgsql call.
CREATE TRIGGER dealer_withdraw_listings_on_tenant_change
  AFTER UPDATE OF status, type ON tenants
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.type IS DISTINCT FROM NEW.type)
  EXECUTE FUNCTION dealer_withdraw_listings_on_tenant_change();

CREATE FUNCTION dealer_withdraw_listings_on_profile_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM dealer_approved_seed_links WHERE dealer_profile_id = NEW.id;
  IF v_tenant IS NULL THEN RETURN NEW; END IF;  -- legacy / not-yet-activated profiles: untouched
  PERFORM dealer_lock_tenant_programme_vins(v_tenant);  -- R6 lock order: VINs, then the link
  PERFORM 1 FROM dealer_approved_seed_links WHERE tenant_id = v_tenant FOR UPDATE;
  IF NOT dealer_tenant_listing_authority_current(v_tenant) THEN
    PERFORM dealer_withdraw_tenant_public_listings(v_tenant, 'DEALER_PROFILE_AUTHORITY_LOST', NULL);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dealer_withdraw_listings_on_profile_change
  AFTER UPDATE OF identity_status, compliance_review_state, active_state, restriction_state,
    suspension_state, investigation_state, expiry_date, user_id ON dealer_profiles
  FOR EACH ROW WHEN (OLD.identity_status IS DISTINCT FROM NEW.identity_status
    OR OLD.compliance_review_state IS DISTINCT FROM NEW.compliance_review_state
    OR OLD.active_state IS DISTINCT FROM NEW.active_state
    OR OLD.restriction_state IS DISTINCT FROM NEW.restriction_state
    OR OLD.suspension_state IS DISTINCT FROM NEW.suspension_state
    OR OLD.investigation_state IS DISTINCT FROM NEW.investigation_state
    OR OLD.expiry_date IS DISTINCT FROM NEW.expiry_date
    OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION dealer_withdraw_listings_on_profile_change();

-- A country policy that stops being current (suspended, withdrawn, re-dated) withdraws the stock of
-- every dealer whose legal review relies on it.
CREATE FUNCTION dealer_withdraw_listings_on_policy_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tenants UUID[]; v_tenant UUID;
BEGIN
  SELECT array_agg(l.tenant_id ORDER BY l.tenant_id) INTO v_tenants
    FROM dealer_approved_seed_links l
    JOIN dealer_legal_application_reviews r ON r.legal_review_id = l.legal_review_id
   WHERE r.country_code = NEW.country_code AND r.policy_version = NEW.policy_version;
  IF v_tenants IS NULL THEN RETURN NEW; END IF;
  -- R6 lock order across several dealers: every VIN in ascending (tenant_id, vin) — the order
  -- the lapse sweep and a single-dealer suspension also use — then links (ascending tenant_id).
  PERFORM 1 FROM vehicles WHERE tenant_id = ANY (v_tenants)
   ORDER BY tenant_id, vin FOR NO KEY UPDATE;
  PERFORM 1 FROM dealer_approved_seed_links WHERE tenant_id = ANY (v_tenants)
   ORDER BY tenant_id FOR UPDATE;
  FOREACH v_tenant IN ARRAY v_tenants LOOP
    IF NOT dealer_tenant_listing_authority_current(v_tenant) THEN
      PERFORM dealer_withdraw_tenant_public_listings(v_tenant, 'COUNTRY_POLICY_NOT_CURRENT', NULL);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dealer_withdraw_listings_on_policy_change
  AFTER UPDATE OF policy_state, effective_at, expires_at ON dealer_country_legal_policy_authority
  FOR EACH ROW WHEN (OLD.policy_state IS DISTINCT FROM NEW.policy_state
    OR OLD.effective_at IS DISTINCT FROM NEW.effective_at OR OLD.expires_at IS DISTINCT FROM NEW.expires_at)
  EXECUTE FUNCTION dealer_withdraw_listings_on_policy_change();

-- The approved owner losing (or changing) their tenant membership ends authority immediately.
CREATE FUNCTION dealer_withdraw_listings_on_owner_membership_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tenant UUID;
BEGIN
  SELECT l.tenant_id INTO v_tenant FROM dealer_approved_seed_links l
   WHERE l.tenant_id = OLD.tenant_id AND l.claimant_user_id = OLD.user_id;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;  -- not the approved owner's membership: untouched
  PERFORM dealer_lock_tenant_programme_vins(v_tenant);  -- R6 lock order: VINs, then the link
  PERFORM 1 FROM dealer_approved_seed_links WHERE tenant_id = v_tenant FOR UPDATE;
  IF NOT dealer_tenant_listing_authority_current(v_tenant) THEN
    PERFORM dealer_withdraw_tenant_public_listings(v_tenant, 'OWNER_MEMBERSHIP_CHANGED', NULL);
  END IF;
  RETURN NULL;
END;
$$;
-- Two triggers: WHEN cannot name NEW for a DELETE, and a no-op UPDATE must not fire.
CREATE TRIGGER dealer_withdraw_listings_on_owner_membership_change
  AFTER UPDATE OF role, tenant_id, user_id ON tenant_users
  FOR EACH ROW WHEN (OLD.role IS DISTINCT FROM NEW.role OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION dealer_withdraw_listings_on_owner_membership_change();
CREATE TRIGGER dealer_withdraw_listings_on_owner_membership_delete
  AFTER DELETE ON tenant_users
  FOR EACH ROW EXECUTE FUNCTION dealer_withdraw_listings_on_owner_membership_change();

-- Time lapses (legal approval, country policy or profile expiry) change no row, so no trigger can
-- see them. Operations (or the dealer's own next workspace read) runs this sweep; publication and
-- seller-relationship writes are refused by the guard above the instant authority lapses anyway.
-- R6 DBA review 2 #2/#4: tenants are swept in ascending tenant_id (VINs therefore in ascending
-- (tenant_id, vin), the policy trigger's order), each in its own subtransaction with a 2 s lock
-- wait. A dealer transaction that holds one tenant's VIN (or a residual deadlock) skips THAT tenant
-- only — recorded as an append-only LAPSE_SWEEP_TENANT_SKIPPED event — instead of stalling the
-- sweep for every dealer. The next run (10 minutes) retries it; the guard keeps refusing new
-- publication for it meanwhile.
CREATE FUNCTION dealer_withdraw_lapsed_listing_authority(p_actor TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET lock_timeout = '2s'
AS $$
DECLARE v RECORD; v_tenants INTEGER := 0; v_total INTEGER := 0; v_n INTEGER;
  v_skipped INTEGER := 0; v_reason TEXT;
BEGIN
  FOR v IN SELECT DISTINCT l.tenant_id FROM dealer_approved_seed_links l
            JOIN vehicles x ON x.tenant_id = l.tenant_id AND x.publication_status = 'published'
           ORDER BY l.tenant_id LOOP
    v_reason := NULL;
    BEGIN
      IF NOT dealer_tenant_listing_authority_current(v.tenant_id) THEN
        v_n := dealer_withdraw_tenant_public_listings(v.tenant_id, 'OPERATING_AUTHORITY_LAPSED', p_actor);
        v_tenants := v_tenants + 1; v_total := v_total + v_n;
      END IF;
    EXCEPTION
      WHEN lock_not_available THEN v_reason := 'LOCK_NOT_AVAILABLE';
      WHEN deadlock_detected THEN v_reason := 'DEADLOCK_DETECTED';
    END;
    IF v_reason IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      INSERT INTO dealer_listing_authority_events(tenant_id, event_type, reason_code, affected_listings, actor_id)
      VALUES (v.tenant_id, 'LAPSE_SWEEP_TENANT_SKIPPED', v_reason, 0, p_actor);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('tenants_withdrawn', v_tenants, 'listings_withdrawn', v_total,
    'tenants_skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION dealer_withdraw_lapsed_listing_authority(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_withdraw_lapsed_listing_authority(TEXT) TO service_role;

-- Where pg_cron is installed (staging/production), the sweep runs every 10 minutes so pure time
-- lapses also leave the public Marketplace without waiting for a write. Disposable fixtures without
-- pg_cron skip this; nothing is scheduled until a governed apply of this migration.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- R6 DBA review 2 #2: the whole run is bounded (5 min, half the cadence; worst case is
    -- ~104 programme dealers x 2 s lock wait); a cancelled run withdraws nothing and the next retries.
    PERFORM cron.schedule('carup-dealer-listing-lapse-sweep', '*/10 * * * *',
      'SET statement_timeout = ''300s''; SELECT public.dealer_withdraw_lapsed_listing_authority(''pg_cron'')');
  END IF;
END
$cron$;

-- (d) A new inquiry may reach a dealership-programme tenant only while that dealer's operating
-- authority is current. Whether the listing itself may receive buyers is the canonical inquiry
-- service's rule (it requires a governed current seller, which only an approved owner can hold on
-- dealership stock — see the guard above). (Legacy tenants: untouched.)
CREATE FUNCTION dealer_guard_marketplace_inquiry()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_link dealer_approved_seed_links%ROWTYPE; v_tenant UUID;
BEGIN
  -- R6: guard EVERY tenant the enquiry can reach. seller_tenant_id is free TEXT, so it is
  -- parsed only when UUID-shaped (any case) and compared natively as uuid — an upper-case
  -- or omitted value can no longer skip the guard — and the listed VIN's own tenant is
  -- checked as well. The vehicle row is read, never locked (lock order: VIN before link).
  FOR v_tenant IN
    SELECT DISTINCT t FROM (VALUES
      (CASE WHEN btrim(coalesce(NEW.seller_tenant_id,'')) ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN btrim(NEW.seller_tenant_id)::uuid END),
      ((SELECT x.tenant_id FROM vehicles x
         WHERE coalesce(NEW.listing_type,'vehicle') = 'vehicle' AND x.vin = NEW.listing_id)))
      AS c(t) WHERE t IS NOT NULL
  LOOP
    IF current_setting('transaction_isolation') <> 'read committed'
       AND EXISTS (SELECT 1 FROM dealer_approved_seed_links WHERE tenant_id = v_tenant) THEN
      -- R6 DBA review 2 #6: as the vehicle guard — under REPEATABLE READ/SERIALIZABLE the authority
      -- read could use a snapshot older than a committed suspension.
      RAISE EXCEPTION 'DEALER_INQUIRY_REQUIRES_READ_COMMITTED';
    END IF;
    SELECT * INTO v_link FROM dealer_approved_seed_links WHERE tenant_id = v_tenant FOR SHARE;
    IF FOUND AND NOT dealer_tenant_listing_authority_current(v_link.tenant_id) THEN
      RAISE EXCEPTION 'DEALER_INQUIRY_AUTHORITY_NOT_CURRENT';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dealer_guard_marketplace_inquiry
  BEFORE INSERT ON marketplace_inquiries
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_marketplace_inquiry();

-- (e) No self-certification of a dealership-programme VIN's evidence (a VERIFIED outcome is the
-- only one that can unlock publication, so it is the one that must come from an independent reviewer).
CREATE FUNCTION dealer_guard_vehicle_evidence_review()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_link dealer_approved_seed_links%ROWTYPE;
BEGIN
  IF NEW.verification_status IS DISTINCT FROM 'verified' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.verification_status = 'verified' THEN RETURN NEW; END IF;
  END IF;
  SELECT l.* INTO v_link FROM dealer_approved_seed_links l
    JOIN vehicles x ON x.tenant_id = l.tenant_id
   WHERE x.vin = NEW.vin;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.verified_by IS NULL OR NEW.verified_by = NEW.uploaded_by
     OR NEW.verified_by = v_link.claimant_user_id
     OR EXISTS (SELECT 1 FROM tenant_users tu
                 WHERE tu.tenant_id = v_link.tenant_id AND tu.user_id = NEW.verified_by) THEN
    RAISE EXCEPTION 'DEALER_VEHICLE_EVIDENCE_REQUIRES_INDEPENDENT_REVIEWER';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dealer_guard_vehicle_evidence_review
  BEFORE INSERT OR UPDATE OF verification_status ON vehicle_evidence
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_vehicle_evidence_review();

-- (e') The other way to satisfy Seller Authority is a 'confirmed' governed decision; on programme stock it
-- must come from someone who is neither the seller, the approved owner nor any member of the dealer.
CREATE FUNCTION dealer_guard_seller_authority_decision()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_link dealer_approved_seed_links%ROWTYPE;
BEGIN
  IF NEW.status IS DISTINCT FROM 'confirmed' THEN RETURN NEW; END IF;
  SELECT l.* INTO v_link FROM dealer_approved_seed_links l
    JOIN vehicles x ON x.tenant_id = l.tenant_id
   WHERE x.vin = NEW.vin;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.decided_by IS NULL OR NEW.decided_by = NEW.seller_user_id
     OR NEW.decided_by = v_link.claimant_user_id
     OR EXISTS (SELECT 1 FROM tenant_users tu
                 WHERE tu.tenant_id = v_link.tenant_id AND tu.user_id = NEW.decided_by) THEN
    RAISE EXCEPTION 'DEALER_SELLER_AUTHORITY_REQUIRES_INDEPENDENT_REVIEWER';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dealer_guard_seller_authority_decision
  BEFORE INSERT OR UPDATE OF status, decided_by ON vehicle_seller_authority
  FOR EACH ROW EXECUTE FUNCTION dealer_guard_seller_authority_decision();

-- (a) Prepare one private tenant VIN draft as a canonical seller listing candidate. The vehicle stays
-- unpublished; only the canonical publish route (and its completeness gate) can make it public.
CREATE FUNCTION dealer_prepare_canonical_listing(
  p_actor_id TEXT, p_vin TEXT, p_branch_id UUID, p_price NUMERIC, p_currency TEXT,
  p_chassis_number TEXT, p_engine_number TEXT, p_registration_status TEXT, p_plate_number TEXT,
  p_listing_city TEXT, p_listing_province TEXT, p_location_visibility TEXT,
  p_public_seller_display BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_link dealer_approved_seed_links%ROWTYPE;
  v_vehicle RECORD; v_country TEXT; v_plate TEXT; v_row RECORD;
  v_chassis TEXT := upper(btrim(coalesce(p_chassis_number, '')));
  v_engine TEXT := upper(btrim(coalesce(p_engine_number, '')));
  v_city TEXT := btrim(coalesce(p_listing_city, ''));
  v_province TEXT := nullif(btrim(coalesce(p_listing_province, '')), '');
  v_currency TEXT := upper(btrim(coalesce(p_currency, '')));
  v_status TEXT := lower(btrim(coalesce(p_registration_status, '')));
BEGIN
  -- R6 lock order: the VIN row before the operating link, exactly as the canonical write guard.
  PERFORM 1 FROM vehicles WHERE vin = p_vin FOR UPDATE;
  SELECT * INTO v_link FROM dealer_approved_seed_links
   WHERE claimant_user_id = p_actor_id AND operating_status = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ACTIVE_CANONICAL_DEALER_MEMBERSHIP'; END IF;
  IF NOT dealer_tenant_listing_authority_current(v_link.tenant_id) THEN
    RAISE EXCEPTION 'DEALER_LISTING_AUTHORITY_NOT_CURRENT';
  END IF;
  IF p_price IS NULL OR p_price <= 0 OR p_price > 10000000 THEN RAISE EXCEPTION 'DEALER_DECLARED_PRICE_REQUIRED'; END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'DEALER_DECLARED_CURRENCY_REQUIRED'; END IF;
  IF v_chassis !~ '^[A-Z0-9-]{4,40}$' OR v_engine !~ '^[A-Z0-9-]{4,40}$' THEN
    RAISE EXCEPTION 'DEALER_DECLARED_IDENTITY_NUMBERS_REQUIRED';
  END IF;
  IF v_status NOT IN ('import_in_transit','arrived_customs_pending','customs_cleared_cvr_pending',
       'cvr_plate_pending','locally_registered','temporary_foreign_tip','reregistration_pending','unknown') THEN
    RAISE EXCEPTION 'DEALER_DECLARED_REGISTRATION_STAGE_REQUIRED';
  END IF;
  v_plate := nullif(upper(btrim(coalesce(p_plate_number, ''))), '');
  IF v_plate IS NOT NULL AND v_plate !~ '^[A-Z0-9 -]{2,16}$' THEN RAISE EXCEPTION 'INVALID_DECLARED_PLATE'; END IF;
  IF length(v_city) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'DEALER_DECLARED_LISTING_CITY_REQUIRED'; END IF;
  IF coalesce(p_location_visibility, '') NOT IN ('public', 'province_only', 'withheld') THEN
    RAISE EXCEPTION 'DEALER_LISTING_LOCATION_VISIBILITY_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM dealer_branches b
                  WHERE b.id = p_branch_id AND b.dealer_id = v_link.dealer_profile_id) THEN
    RAISE EXCEPTION 'BRANCH_NOT_OWNED_BY_APPROVED_DEALER';
  END IF;
  SELECT r.country_code INTO v_country FROM dealer_legal_application_reviews r
   WHERE r.legal_review_id = v_link.legal_review_id;
  SELECT vin, tenant_id, status, publication_status, currency, current_seller_id, owner_id
    INTO v_vehicle FROM vehicles WHERE vin = p_vin FOR UPDATE;
  IF NOT FOUND OR v_vehicle.tenant_id::text IS DISTINCT FROM v_link.tenant_id::text THEN
    RAISE EXCEPTION 'TENANT_VEHICLE_NOT_FOUND';
  END IF;
  IF v_vehicle.publication_status = 'published' THEN RAISE EXCEPTION 'LISTING_ALREADY_PUBLIC_UNPUBLISH_FIRST'; END IF;
  -- Moderation quarantine (Banned/Suspended/Flagged), a reservation or a sale is never overwritten here.
  IF v_vehicle.status NOT IN ('Pending', 'Available') THEN RAISE EXCEPTION 'VEHICLE_STATUS_NOT_LISTABLE'; END IF;
  IF v_vehicle.owner_id IS NOT NULL THEN RAISE EXCEPTION 'PRIVATE_OWNER_VEHICLE_NOT_DEALER_STOCK'; END IF;
  IF v_vehicle.current_seller_id IS NOT NULL AND v_vehicle.current_seller_id <> p_actor_id THEN
    RAISE EXCEPTION 'DEALER_SELLER_RELATIONSHIP_REQUIRES_APPROVED_OWNER';
  END IF;
  -- A currency is stated once. Re-preparing may restate the same one, never redenominate.
  IF v_vehicle.currency IS NOT NULL AND v_vehicle.current_seller_id IS NOT NULL
     AND v_vehicle.currency <> v_currency THEN
    RAISE EXCEPTION 'CURRENCY_ALREADY_STATED';
  END IF;
  UPDATE vehicles SET
    current_seller_id = p_actor_id,
    current_seller_type = 'Dealer',
    current_seller_type_source = 'dealer_declared',
    status = 'Available',
    price = p_price,
    currency = v_currency,
    currency_source = 'dealer_declared',
    chassis_number = v_chassis,
    engine_number = v_engine,
    plate_number = v_plate,
    registration_status = v_status,
    registration_status_source = 'dealer_declared',
    registration_country = v_country,
    registration_country_source = 'dealer_declared',
    listing_city = v_city,
    listing_province = v_province,
    listing_country = v_country,
    listing_location_source = 'dealer_declared',
    listing_location_visibility = p_location_visibility,
    listing_location_recorded_at = clock_timestamp(),
    public_seller_display_enabled = coalesce(p_public_seller_display, false),
    publication_status = CASE WHEN publication_status = 'publishable' THEN 'publishable' ELSE 'draft' END
  WHERE vin = p_vin
  RETURNING vin, status, publication_status, price, currency, current_seller_id, current_seller_type
    INTO v_row;
  INSERT INTO dealer_vehicle_branch_assignments(vin, tenant_id, branch_id, assigned_by)
  VALUES (p_vin, v_link.tenant_id, p_branch_id, p_actor_id)
  ON CONFLICT (vin) DO UPDATE SET branch_id = EXCLUDED.branch_id,
    assigned_by = EXCLUDED.assigned_by, assigned_at = clock_timestamp()
  WHERE dealer_vehicle_branch_assignments.tenant_id = EXCLUDED.tenant_id;
  INSERT INTO dealer_listing_authority_events(tenant_id, vin, event_type, reason_code, actor_id)
  VALUES (v_link.tenant_id, p_vin, 'LISTING_CANDIDATE_PREPARED', 'OWNER_DECLARED_LISTING_FACTS', p_actor_id);
  RETURN jsonb_build_object(
    'vin', v_row.vin, 'status', v_row.status, 'publication_status', v_row.publication_status,
    'price', v_row.price, 'currency', v_row.currency, 'current_seller_type', v_row.current_seller_type,
    'governed_seller_is_approved_owner', v_row.current_seller_id = p_actor_id,
    'branch_id', p_branch_id, 'facts_source', 'dealer_declared',
    'published', false, 'canonical_publication_gate_required', true,
    'independent_vehicle_review_required', true);
END;
$$;
REVOKE ALL ON FUNCTION dealer_prepare_canonical_listing(TEXT, TEXT, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_prepare_canonical_listing(TEXT, TEXT, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN)
  TO service_role;

-- Dealer storefront association: ONLY the VINs a currently approved full storefront may show —
-- current storefront publication, current operating authority, published, and the approved owner as
-- governed seller. VINs only: the caller renders each through the canonical public Marketplace
-- detail service, so this function cannot widen what a vehicle discloses.
CREATE FUNCTION dealer_storefront_public_listing_vins(p_seed_dealer_id TEXT, p_limit INTEGER DEFAULT 12)
RETURNS TABLE(vin TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT x.vin
    FROM dealer_full_storefront_current s
    JOIN dealer_approved_seed_links l ON l.seed_dealer_id = s.seed_dealer_id AND l.operating_status = 'ACTIVE'
    JOIN vehicles x ON x.tenant_id = l.tenant_id
   WHERE s.seed_dealer_id = p_seed_dealer_id
     AND dealer_tenant_listing_authority_current(l.tenant_id)
     AND x.publication_status = 'published'
     AND x.current_seller_id = l.claimant_user_id
     -- Only listings whose seller display the dealer explicitly consented to are tied to its storefront.
     AND x.public_seller_display_enabled IS TRUE
   ORDER BY x.created_at DESC, x.vin
   LIMIT least(greatest(coalesce(p_limit, 12), 1), 48)
$$;
REVOKE ALL ON FUNCTION dealer_storefront_public_listing_vins(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dealer_storefront_public_listing_vins(TEXT, INTEGER) TO service_role;

-- +migrate Down
-- R6 DBA review 2 #1: a Down takes ACCESS EXCLUSIVE on canonical tables (FKs, triggers, policies);
-- never queue readers behind it indefinitely. Fails with 55P03 after 3 s; re-run the rollback.
SET LOCAL lock_timeout = '3s';
SET LOCAL carup.dealer_migration_txn = 'on';
DO $txnguard$
BEGIN
  -- R6 DBA review 3 N2: SET LOCAL is a silent no-op outside a transaction block, so a migration
  -- run statement by statement in autocommit (plain `psql -f`) would lose its lock_timeout and
  -- could apply half-way. Refuse, and end the session so the client cannot run the remaining
  -- statements. Apply with backend/scripts/dealership/applyDealerMigrations.mjs or
  -- `psql -1 -v ON_ERROR_STOP=1` (one transaction per migration section).
  IF current_setting('carup.dealer_migration_txn', true) IS DISTINCT FROM 'on' THEN
    RAISE WARNING 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION: use the dealership migration runner or psql -1 -v ON_ERROR_STOP=1';
    BEGIN
      PERFORM pg_terminate_backend(pg_backend_pid());
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE EXCEPTION 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION';
  END IF;
END
$txnguard$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dealer_listing_authority_events)
     OR EXISTS (SELECT 1 FROM dealer_vehicle_branch_assignments) THEN
    RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_DEALER_LISTING_CUSTODY';
  END IF;
END;
$$;
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('carup-dealer-listing-lapse-sweep');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END
$cron$;
DROP FUNCTION IF EXISTS dealer_storefront_public_listing_vins(TEXT, INTEGER);
DROP TRIGGER IF EXISTS dealer_guard_seller_authority_decision ON vehicle_seller_authority;
DROP FUNCTION IF EXISTS dealer_guard_seller_authority_decision();
DROP TRIGGER IF EXISTS dealer_withdraw_listings_on_owner_membership_delete ON tenant_users;
DROP TRIGGER IF EXISTS dealer_withdraw_listings_on_owner_membership_change ON tenant_users;
DROP FUNCTION IF EXISTS dealer_withdraw_listings_on_owner_membership_change();
DROP TRIGGER IF EXISTS dealer_withdraw_listings_on_policy_change ON dealer_country_legal_policy_authority;
DROP FUNCTION IF EXISTS dealer_withdraw_listings_on_policy_change();
DROP FUNCTION IF EXISTS dealer_prepare_canonical_listing(TEXT, TEXT, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN);
DROP TRIGGER IF EXISTS dealer_guard_vehicle_evidence_review ON vehicle_evidence;
DROP FUNCTION IF EXISTS dealer_guard_vehicle_evidence_review();
DROP TRIGGER IF EXISTS dealer_guard_marketplace_inquiry ON marketplace_inquiries;
DROP FUNCTION IF EXISTS dealer_guard_marketplace_inquiry();
DROP FUNCTION IF EXISTS dealer_withdraw_lapsed_listing_authority(TEXT);
DROP TRIGGER IF EXISTS dealer_withdraw_listings_on_profile_change ON dealer_profiles;
DROP FUNCTION IF EXISTS dealer_withdraw_listings_on_profile_change();
DROP TRIGGER IF EXISTS dealer_withdraw_listings_on_tenant_change ON tenants;
DROP FUNCTION IF EXISTS dealer_withdraw_listings_on_tenant_change();
DROP TRIGGER IF EXISTS dealer_withdraw_listings_on_link_change ON dealer_approved_seed_links;
DROP FUNCTION IF EXISTS dealer_withdraw_listings_on_link_change();
DROP TRIGGER IF EXISTS dealer_guard_canonical_listing_write ON vehicles;
DROP FUNCTION IF EXISTS dealer_guard_canonical_listing_write();
DROP FUNCTION IF EXISTS dealer_withdraw_tenant_public_listings(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS dealer_lock_tenant_programme_vins(UUID);
DROP FUNCTION IF EXISTS dealer_tenant_listing_authority_current(UUID);
DROP TABLE IF EXISTS dealer_vehicle_branch_assignments;
DROP TABLE IF EXISTS dealer_listing_authority_events;
