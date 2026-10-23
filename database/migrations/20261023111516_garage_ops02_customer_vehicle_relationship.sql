-- GARAGE-1.0-OPS02. Garage-local relationship metadata only. Users, vehicles,
-- Service Cases, work orders and Communications remain their own authorities.
-- +migrate Up

CREATE TABLE IF NOT EXISTS garage_customer_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  party_kind TEXT NOT NULL CHECK (party_kind IN ('registered','external','walk_in')),
  origin TEXT NOT NULL CHECK (origin IN ('service_case','communications','walk_in')),
  registered_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  external_identity_id UUID REFERENCES channel_identities(id) ON DELETE RESTRICT,
  -- A walk-in name is an unverified Garage prospect label, never a users row.
  prospect_name TEXT CHECK (char_length(prospect_name) BETWEEN 1 AND 120),
  customer_reference_code TEXT GENERATED ALWAYS AS
    ('CUS-' || upper(substr(replace(id::text, '-', ''), 1, 12))) STORED,
  relationship_status TEXT NOT NULL CHECK (relationship_status IN ('active','inactive','prospect')),
  customer_category TEXT CHECK (customer_category IN ('individual','business','fleet','other')),
  preferred_branch_id UUID,
  assigned_staff_user_id TEXT,
  internal_notes TEXT CHECK (char_length(internal_notes) <= 2000),
  tags TEXT[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(tags) <= 12),
  first_relationship_at TIMESTAMPTZ NOT NULL,
  follow_up_at TIMESTAMPTZ,
  follow_up_status TEXT CHECK (follow_up_status IN ('pending','completed','cancelled')),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_customer_party_truth CHECK (
    (party_kind = 'registered' AND origin = 'service_case' AND registered_user_id IS NOT NULL
      AND external_identity_id IS NULL AND prospect_name IS NULL)
    OR (party_kind = 'external' AND origin = 'communications' AND registered_user_id IS NULL
      AND external_identity_id IS NOT NULL AND prospect_name IS NULL)
    OR (party_kind = 'walk_in' AND origin = 'walk_in' AND registered_user_id IS NULL
      AND external_identity_id IS NULL AND prospect_name IS NOT NULL)
  ),
  CONSTRAINT garage_customer_follow_up_pair CHECK (
    (follow_up_at IS NULL) = (follow_up_status IS NULL)
  ),
  CONSTRAINT garage_customer_preferred_branch_tenant_fk
    FOREIGN KEY (preferred_branch_id, tenant_id)
    REFERENCES garage_branches(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT garage_customer_advisor_tenant_fk
    FOREIGN KEY (tenant_id, assigned_staff_user_id)
    REFERENCES garage_workforce_profiles(tenant_id, user_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_customer_registered
  ON garage_customer_relationships(tenant_id, registered_user_id)
  WHERE registered_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_customer_external
  ON garage_customer_relationships(tenant_id, external_identity_id)
  WHERE external_identity_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_garage_customer_reference
  ON garage_customer_relationships(tenant_id, customer_reference_code);
CREATE INDEX IF NOT EXISTS idx_garage_customer_follow_up
  ON garage_customer_relationships(tenant_id, follow_up_at)
  WHERE follow_up_status = 'pending';

CREATE OR REPLACE FUNCTION garage_ops02_validate_relationship()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.party_kind IS DISTINCT FROM OLD.party_kind
    OR NEW.origin IS DISTINCT FROM OLD.origin
    OR NEW.registered_user_id IS DISTINCT FROM OLD.registered_user_id
    OR NEW.external_identity_id IS DISTINCT FROM OLD.external_identity_id
    OR NEW.prospect_name IS DISTINCT FROM OLD.prospect_name
    OR NEW.first_relationship_at IS DISTINCT FROM OLD.first_relationship_at
    OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'GARAGE_CUSTOMER_IDENTITY_IMMUTABLE';
  END IF;

  IF NEW.party_kind = 'external' AND NOT EXISTS (
    SELECT 1 FROM channel_identities ci
    WHERE ci.id = NEW.external_identity_id
      AND ci.tenant_id = NEW.tenant_id::text AND ci.user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'GARAGE_CUSTOMER_EXTERNAL_IDENTITY_NOT_IN_GARAGE';
  END IF;
  IF NEW.party_kind = 'registered' AND NOT EXISTS (
    SELECT 1 FROM service_cases sc
    WHERE sc.garage_tenant_id = NEW.tenant_id
      AND sc.requester_user_id = NEW.registered_user_id
  ) THEN
    RAISE EXCEPTION 'GARAGE_CUSTOMER_SERVICE_ORIGIN_REQUIRED';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.preferred_branch_id IS DISTINCT FROM OLD.preferred_branch_id)
    AND NEW.preferred_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM garage_branches b
    WHERE b.id = NEW.preferred_branch_id AND b.tenant_id = NEW.tenant_id AND b.is_active
  ) THEN
    RAISE EXCEPTION 'GARAGE_CUSTOMER_ACTIVE_SITE_REQUIRED';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.assigned_staff_user_id IS DISTINCT FROM OLD.assigned_staff_user_id)
    AND NEW.assigned_staff_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM garage_workforce_profiles p
    JOIN tenant_users tu ON tu.tenant_id = p.tenant_id AND tu.user_id = p.user_id
    WHERE p.tenant_id = NEW.tenant_id AND p.user_id = NEW.assigned_staff_user_id
      AND p.employment_status = 'active'
  ) THEN
    RAISE EXCEPTION 'GARAGE_CUSTOMER_ACTIVE_ADVISOR_REQUIRED';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops02_validate_relationship ON garage_customer_relationships;
CREATE TRIGGER trg_garage_ops02_validate_relationship
  BEFORE INSERT OR UPDATE ON garage_customer_relationships
  FOR EACH ROW EXECUTE FUNCTION garage_ops02_validate_relationship();

-- The authoritative audit write shares the relationship transaction. A failed audit
-- rolls back the mutation; notes are represented only by presence/change flags.
CREATE OR REPLACE FUNCTION garage_ops02_audit_relationship()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_actor_id TEXT;
  v_actor_role TEXT;
  v_actor_type TEXT;
  v_source_route TEXT;
  v_event TEXT;
  v_before JSONB;
  v_after JSONB;
BEGIN
  v_actor_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by_user_id ELSE NEW.updated_by_user_id END;
  IF TG_OP = 'INSERT' AND NEW.party_kind = 'registered'
     AND NEW.origin = 'service_case' AND v_actor_id = NEW.registered_user_id THEN
    v_actor_type := 'system';
    v_source_route := 'service_cases';
  ELSIF v_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM tenant_users tu JOIN tenants t ON t.id = tu.tenant_id
    WHERE tu.tenant_id = NEW.tenant_id AND tu.user_id = v_actor_id
      AND tu.role = 'admin' AND t.type = 'garage' AND t.status = 'active'
  ) THEN
    RAISE EXCEPTION 'GARAGE_CUSTOMER_ADMIN_AUDIT_ACTOR_REQUIRED';
  ELSE
    v_actor_type := 'user';
    v_source_route := '/api/garage/customers';
  END IF;
  SELECT role INTO v_actor_role FROM users WHERE id = v_actor_id;
  IF TG_OP = 'INSERT' THEN
    v_event := 'GARAGE_CUSTOMER_RELATIONSHIP_CREATED';
    v_before := NULL;
  ELSE
    v_before := jsonb_build_object(
      'relationship_id', OLD.id,
      'relationship_status', OLD.relationship_status,
      'customer_category', OLD.customer_category,
      'preferred_branch_id', OLD.preferred_branch_id,
      'assigned_staff_user_id', OLD.assigned_staff_user_id,
      'tags', OLD.tags,
      'follow_up_at', OLD.follow_up_at,
      'follow_up_status', OLD.follow_up_status,
      'notes_present', OLD.internal_notes IS NOT NULL
    );
    IF NEW.follow_up_at IS DISTINCT FROM OLD.follow_up_at
       OR NEW.follow_up_status IS DISTINCT FROM OLD.follow_up_status THEN
      v_event := 'GARAGE_CUSTOMER_FOLLOW_UP_CHANGED';
    ELSIF NEW.preferred_branch_id IS DISTINCT FROM OLD.preferred_branch_id THEN
      v_event := 'GARAGE_CUSTOMER_SITE_CHANGED';
    ELSIF NEW.assigned_staff_user_id IS DISTINCT FROM OLD.assigned_staff_user_id THEN
      v_event := 'GARAGE_CUSTOMER_STAFF_CHANGED';
    ELSIF NEW.relationship_status IS DISTINCT FROM OLD.relationship_status THEN
      v_event := 'GARAGE_CUSTOMER_STATUS_CHANGED';
    ELSE
      v_event := 'GARAGE_CUSTOMER_RELATIONSHIP_UPDATED';
    END IF;
  END IF;
  v_after := jsonb_build_object(
    'relationship_id', NEW.id,
    'relationship_status', NEW.relationship_status,
    'customer_category', NEW.customer_category,
    'preferred_branch_id', NEW.preferred_branch_id,
    'assigned_staff_user_id', NEW.assigned_staff_user_id,
    'tags', NEW.tags,
    'follow_up_at', NEW.follow_up_at,
    'follow_up_status', NEW.follow_up_status,
    'notes_present', NEW.internal_notes IS NOT NULL,
    'notes_changed', CASE WHEN TG_OP = 'INSERT' THEN NEW.internal_notes IS NOT NULL
      ELSE NEW.internal_notes IS DISTINCT FROM OLD.internal_notes END
  );
  INSERT INTO trust_audit_events
    (event_type, previous_value, new_value, actor_user_id, actor_role,
     actor_tenant_id, actor_type, source_route)
  VALUES
    (v_event, v_before, v_after, v_actor_id, v_actor_role,
     NEW.tenant_id::text, v_actor_type, v_source_route);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops02_audit_relationship ON garage_customer_relationships;
CREATE TRIGGER trg_garage_ops02_audit_relationship
  AFTER INSERT OR UPDATE ON garage_customer_relationships
  FOR EACH ROW EXECUTE FUNCTION garage_ops02_audit_relationship();

-- A Service Case is the governed origin for a registered customer relationship.
-- This sidecar trigger never changes the case or canonical user/vehicle authorities.
CREATE OR REPLACE FUNCTION garage_ops02_capture_service_case()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.requester_user_id IS NOT NULL THEN
    INSERT INTO garage_customer_relationships
      (tenant_id, party_kind, origin, registered_user_id, relationship_status,
       first_relationship_at, created_by_user_id)
    VALUES
      (NEW.garage_tenant_id, 'registered', 'service_case', NEW.requester_user_id,
       'active', COALESCE(NEW.requested_at, NEW.created_at), NEW.requester_user_id)
    ON CONFLICT (tenant_id, registered_user_id)
      WHERE registered_user_id IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_garage_ops02_capture_service_case ON service_cases;
CREATE TRIGGER trg_garage_ops02_capture_service_case
  AFTER INSERT ON service_cases
  FOR EACH ROW EXECUTE FUNCTION garage_ops02_capture_service_case();

-- Existing Service Cases supply real origin and the first observed relationship date.
INSERT INTO garage_customer_relationships
  (tenant_id, party_kind, origin, registered_user_id, relationship_status,
   first_relationship_at, created_by_user_id)
SELECT DISTINCT ON (sc.garage_tenant_id, sc.requester_user_id)
  sc.garage_tenant_id, 'registered', 'service_case', sc.requester_user_id,
  'active', COALESCE(sc.requested_at, sc.created_at), sc.requester_user_id
FROM service_cases sc
WHERE sc.requester_user_id IS NOT NULL
ORDER BY sc.garage_tenant_id, sc.requester_user_id, sc.requested_at, sc.id
ON CONFLICT (tenant_id, registered_user_id)
  WHERE registered_user_id IS NOT NULL DO NOTHING;

ALTER TABLE garage_customer_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE garage_customer_relationships FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE garage_customer_relationships FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE garage_customer_relationships TO service_role;
-- No direct client policies and no DELETE: relationship history stays attached to its Garage.

-- +migrate Down
DROP TRIGGER IF EXISTS trg_garage_ops02_capture_service_case ON service_cases;
DROP FUNCTION IF EXISTS garage_ops02_capture_service_case();
DROP TRIGGER IF EXISTS trg_garage_ops02_audit_relationship ON garage_customer_relationships;
DROP FUNCTION IF EXISTS garage_ops02_audit_relationship();
DROP TRIGGER IF EXISTS trg_garage_ops02_validate_relationship ON garage_customer_relationships;
DROP FUNCTION IF EXISTS garage_ops02_validate_relationship();
DROP TABLE IF EXISTS garage_customer_relationships;
