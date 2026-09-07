-- +migrate Up
-- Bound the tenant-role namespace.
--
-- `tenant_users.role` has been unconstrained TEXT since 002_multi_tenant_and_auth_schema.sql, with a
-- comment listing example values and nothing enforcing them. `users.role` is a separate namespace —
-- the PLATFORM one — and the two share spellings.
--
-- That overlap became load-bearing during GMO-5. A change that let a verified tenant membership
-- satisfy a route's role list collapsed the two namespaces on the string 'admin', and an
-- adversarial review executed the result: a garage founder read the entire user table from
-- /api/users/management and suspended the real platform administrator. The route gate is now opt-in
-- per route, which closes that. This closes the other half.
--
-- What this can and cannot do. It CANNOT remove the 'admin' overlap — PO-1 makes the founding
-- garage operator a tenant-scoped `admin`, deliberately reusing the existing role rather than
-- inventing one. What it CAN do is make the overlap a bounded, known set of four values instead of
-- an open string, so no future row can carry 'super_admin', 'platform_admin', 'government' or
-- 'owner' into a table that some gate may one day consult. Convention became a vulnerability once;
-- a constraint cannot be forgotten.
--
-- Existing data was checked before writing this: the table holds only 'mechanic', 'admin' and
-- 'dealer'. 'member' is included because it is the column's own DEFAULT, so omitting it would make
-- the default unwritable.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_users_role_catalogue'
      AND conrelid = 'public.tenant_users'::regclass
  ) THEN
    ALTER TABLE public.tenant_users
      ADD CONSTRAINT tenant_users_role_catalogue
      CHECK (role IN (
        'admin',     -- administrator OF THIS ORGANIZATION. Never a CarUp administrator.
        'mechanic',  -- works on vehicles for this garage
        'dealer',    -- the dealer role inside a dealer tenant
        'member'     -- belongs, with no operating capability. The column default.
      ));
  END IF;
END $$;

COMMENT ON COLUMN public.tenant_users.role IS
  'The role held INSIDE this organization, from a bounded catalogue (admin | mechanic | dealer | '
  'member). This is NOT the platform role namespace in users.role, even where a spelling is shared: '
  'a tenant ''admin'' is an administrator of one organization and never a CarUp administrator. Only '
  'routes gated with authorizeTenantRole consult this column for access.';
