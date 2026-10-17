-- +migrate Up
-- OC-5A (RC1 residual finding B) — bound the tenant-role namespace.
--
-- `tenant_users.role` has been unconstrained TEXT since 002_multi_tenant_and_auth_schema.sql. It is the
-- role a person holds INSIDE ONE ORGANISATION; `users.role` is the PLATFORM role, and the two share
-- spellings. The server used to let a verified membership lend any of its values except 'admin' as the
-- caller's effective role, so a row reading 'government' or 'reviewer' was platform authority. The code
-- rule is now an allow-list (backend/services/auth/tenantRoleCatalogue.js: only 'mechanic' and 'dealer'
-- are lendable). This constraint closes the other half: no new row can carry a value outside the
-- governed catalogue into a table some future gate may consult.
--
-- Reconciled with PR #209 GMO-5: the catalogue is the one it designed (admin | mechanic | dealer |
-- member) under the SAME constraint name, so an environment that already applied #209's
-- 20260906220000 (staging) keeps its constraint and this is a no-op there. #209's file is superseded by
-- this one and is not ported.
--
-- NOT VALID, deliberately. #209 validated the existing rows against staging only, and production has
-- never been measured. NOT VALID enforces the catalogue for every INSERT and UPDATE from now on without
-- refusing to apply over a pre-catalogue row; the code allow-list already refuses such a row any lent
-- authority. VALIDATE CONSTRAINT is a separate, recorded runtime step, taken only after the role counts
-- on staging and production have been read (docs/one-carup/ONE_CARUP_RC2_RELEASE_RUNBOOK.md).

DO $$
BEGIN
  IF to_regclass('public.tenant_users') IS NULL THEN
    RAISE EXCEPTION 'tenant_users is absent: 002_multi_tenant_and_auth_schema.sql must be applied first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_users_role_catalogue'
      AND conrelid = 'public.tenant_users'::regclass
  ) THEN
    ALTER TABLE public.tenant_users
      ADD CONSTRAINT tenant_users_role_catalogue
      CHECK (role IN (
        'admin',     -- administrator OF THIS ORGANISATION. Never a CarUp administrator, never lendable.
        'mechanic',  -- works on vehicles for this organisation. Lendable as the effective role.
        'dealer',    -- the dealer role inside a dealership. Lendable as the effective role.
        'member'     -- belongs, with no operating capability. The column default.
      )) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.tenant_users.role IS
  'The role held INSIDE this organisation, from a bounded catalogue (admin | mechanic | dealer | member). '
  'This is NOT the platform role namespace in users.role, even where a spelling is shared: a tenant '
  '''admin'' administers one organisation and is never a CarUp administrator. Only mechanic and dealer '
  'may be lent as an effective role (backend/services/auth/tenantRoleCatalogue.js).';

-- +migrate Down
ALTER TABLE public.tenant_users DROP CONSTRAINT IF EXISTS tenant_users_role_catalogue;
COMMENT ON COLUMN public.tenant_users.role IS NULL;
