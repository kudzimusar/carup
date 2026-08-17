# RLS / grants audit — the 23 flagged tables

Issue #164, Canonical Vehicle Truth Closure — **Phase 0 containment**.

Migration: `database/migrations/20260817090000_issue164_phase0_flagged_table_containment.sql`
Measured against: staging Supabase ref `eoyenigwevnxwwhyhaer`, PostgreSQL 17.6.

---

## The exposure

23 tables in the `public` schema have `rowsecurity = false` **and** grant all seven
privileges `information_schema` can report — `SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
REFERENCES, TRIGGER` — to **both** `anon` and `authenticated`. Those are the Supabase Data
API roles, so every one of those grants is reachable by anyone holding the browser
publishable key, which ships in the client bundle.

Row counts are small, which bounds *disclosure*. It does not bound *write* exposure: an
empty `kyc_profiles` is still an insertable, updatable and truncatable table, and a
`fraud_alerts` a caller can `DELETE` is a fraud control that can be switched off from a
browser console.

## Why the disposition is "revoke + enable RLS", with **no policies**

Four facts decide this, and each one was verified rather than assumed.

1. **The backend does not use these grants.** `backend/db/supabase.js` connects with
   `SUPABASE_SERVICE_ROLE_KEY`. `service_role` holds `BYPASSRLS`, so enabling RLS changes
   nothing for the backend, and the `anon`/`authenticated` grants are not on its path.

2. **No live product surface reads any of the 23 with the browser key.** `web/src`,
   `mobile/` and `shared/` contain **zero** references to any of the 23 table names. The
   only live anon-key call in the frontend is a token-based signed-URL storage upload in
   `useCommunicationProductApi.ts`, which no table grant affects. `web/src/hooks/useVehicles.ts`
   is the one hook that queries tables directly with the anon key and it has **zero
   consumers** — dead code.

3. **`authenticated` is not a role CarUp ever occupies.** `web/src/lib/supabase.ts` creates
   the browser client with the plain anon key, and there is no `supabase.auth.signIn*` /
   `setSession` call anywhere in `web/`, `mobile/` or `shared/`. CarUp runs **custom backend
   auth, not Supabase Auth**, so no Supabase JWT is ever minted and every browser request
   reaches PostgREST as `anon`. A policy written `TO authenticated` would today match
   **zero real callers** — it would be decoration that reads like protection.

4. **RLS alone is not sufficient, and grants alone are not sufficient.** RLS never governs
   `TRUNCATE`, and all 23 carry the `TRUNCATE` bit for both roles — only `REVOKE` closes
   that. Conversely `REVOKE` alone leaves the table one accidental `GRANT` away from being
   open again. Both controls are applied, in one transaction.

Adding zero policies is therefore the **correct** end state, not an oversight. The Supabase
advisor will report "RLS enabled, no policy" on all 23; that warning is **expected and
intended**. Do not silence it by adding a permissive policy — that would re-open exactly
what this closes. The migration enforces this: its postcondition **refuses to commit** if a
policy exists on any of the 23.

`FORCE ROW LEVEL SECURITY` is deliberately **not** applied. It constrains the table *owner*,
not the API roles, so with zero policies it would deny `postgres` as well — breaking
owner-rights views, `SECURITY DEFINER` functions and dump/restore — while buying no
containment against `anon`. This matches the standing decision in
`20260814090000_issue101_p0_rls_and_view_hardening.sql`.

---

## Disposition table

**On the `rows` column:** only five row counts were individually captured. The rest are
known collectively to fall in 0–7 but were not measured per table, so they are recorded as
`unknown (0–7)` rather than given an invented number. Unknown stays unknown.

**On the `intended actor` column:** `service_role` counts are live `.from('<table>')` calls
in `backend/` (excluding tests). Every one of the 23 has **zero** `web/`, `mobile/` or
`shared/` references.

| # | table | rows | current grants (anon / authenticated) | intended actor | disposition | reasoning |
|---|---|---|---|---|---|---|
| 1 | `kyc_profiles` | 0 (confirmed) | all 7 / all 7 | `service_role` (2 calls, `trust-service/trustService.js`) | revoke + enable | Holds `national_id_number`, `date_of_birth`, legal names and address — raw identity, the most sensitive row in the set. **Flagged for Phase 6/8:** a user reading their *own* KYC status is a legitimate future authenticated self-read. |
| 2 | `device_sessions` | 0 (confirmed) | all 7 / all 7 | `service_role` (1 call, `fraud-service/fraudService.js`) | revoke + enable | Session/device inventory feeding the fraud engine; anon `UPDATE` would let a caller un-revoke a session. **Flagged for Phase 6/8:** "sign out my other devices" is a genuine future authenticated self-read/write. |
| 3 | `trusted_devices` | 0 (confirmed) | all 7 / all 7 | none in `backend/` | revoke + enable | Holds `device_fingerprint`. Anon `INSERT` would let a caller mark an attacker device as trusted — a direct auth bypass primitive. **Flagged for Phase 6/8** alongside `device_sessions`. |
| 4 | `role_switch_logs` | unknown (0–7) | all 7 / all 7 | none in `backend/` | revoke + enable | Audit trail of role changes. Audit tables must never be writable or deletable by the audited party. Service-role only, permanently. |
| 5 | `tenant_api_keys` | 0 (confirmed) | all 7 / all 7 | none in `backend/` | revoke + enable | A **credential store** (`key_hash`). Anon `INSERT` mints a working tenant API key; anon `SELECT` enumerates them. Must never be reachable by any client role — no future policy, ever. |
| 6 | `tenant_branding` | unknown (0–7) | all 7 / all 7 | `service_role` (1 call, `server.js`) | revoke + enable | White-label logo/colours/`custom_domain`. Anon `UPDATE` is a phishing primitive (repoint a tenant's branding). **Flagged for Phase 6/8:** this is the one table with a plausible genuine *anonymous* read story — branding must resolve before login on a custom domain. It is backend-served today; if it ever goes direct, it needs a narrow `SELECT`-only policy, not a blanket grant. |
| 7 | `tenant_feature_flags` | unknown (0–7) | all 7 / all 7 | none in `backend/` | revoke + enable | Flags decide what a tenant may do (`enable_api_access`, `enable_custom_roles`). They are authorization, not presentation — a client that can write its own flags grants itself capabilities. Keep backend-mediated; no future client policy. |
| 8 | `organization_profiles` | unknown (0–7) | all 7 / all 7 | none in `backend/` | revoke + enable | Organization directory. Backend-mediated today. Part of the org cohort flagged below. |
| 9 | `organization_roles` | unknown (0–7) | all 7 / all 7 | none in `backend/` | revoke + enable | **Is** the authorization model. Anon `UPDATE` is privilege escalation by definition. |
| 10 | `organization_users` | unknown (0–7) | all 7 / all 7 | `service_role` (5 calls: `server.js`, `auditLogger.js`, `eventBus/listeners.js`) | revoke + enable | Membership and role assignment — the most-referenced table of the org cohort and the one an attacker would target to add themselves to an org. |
| 11 | `organization_permissions` | unknown (0–7) | all 7 / all 7 | none in `backend/` | revoke + enable | Permission grants. Same escalation reasoning as `organization_roles`. |
| 12 | `organization_branches` | unknown (0–7) | all 7 / all 7 | `service_role` (2 calls, `server.js`) | revoke + enable | Org structure. Backend-mediated. Part of the org cohort flagged below. |
| 13 | `organization_departments` | unknown (0–7) | all 7 / all 7 | none in `backend/` | revoke + enable | Org structure. Backend-mediated. Part of the org cohort flagged below. |
| 14 | `organization_settings` | unknown (0–7) | all 7 / all 7 | none in `backend/` | revoke + enable | Per-org configuration; writable settings are an authorization surface. |
| 15 | `organization_ai_agents` | unknown (0–7) | all 7 / all 7 | none in `backend/` | revoke + enable | Agent configuration. Anon `UPDATE` could repoint an agent's behaviour — config-as-code with no review path. |
| 16 | `insurance_records` | 0 (confirmed) | all 7 / all 7 | `service_role` (2 calls: `insurance/insuranceService.js`, `trustGraph/trustGraphService.js`) | revoke + enable | Regulated insurance data, and a **trust-graph input** — a forged row propagates into vehicle trust scoring, which is precisely the canonical-truth invariant #164 exists to protect. |
| 17 | `insurance_claims` | unknown (0–7) | all 7 / all 7 | `service_role` (4 calls: `adminRoutes.js`, `claimsRoutes.js`, `scripts/phase5_endpoints.js`) | revoke + enable | Claims are money. Anon `INSERT`/`UPDATE` is claims fraud with no authentication step. **Flagged for Phase 6/8:** a claimant tracking their *own* claim is a legitimate future authenticated self-read. |
| 18 | `stakeholder_profiles` | unknown (0–7) | all 7 / all 7 | `service_role` (8 calls: `finance/`, `insurance/`, `reputation/`, `trust-service/trustEnforcementEngine.js`) | revoke + enable | The most widely consumed table in the set. Feeds finance, insurance, reputation and trust *enforcement* — a writable counterparty profile turns into real money decisions. |
| 19 | `compliance_reports` | unknown (0–7) | all 7 / all 7 | `service_role` (1 call, `server.js`) | revoke + enable | Compliance verdicts. A caller who can write these can manufacture a compliant vehicle. |
| 20 | `fraud_alerts` | unknown (0–7) | all 7 / all 7 | `service_role` (2 calls, `server.js`) | revoke + enable | A fraud control that anon can `DELETE` is not a control. Highest-leverage `DELETE` exposure in the set. |
| 21 | `registry_verifications` | unknown (0–7) | all 7 / all 7 | `service_role` (2 calls, `routes/complianceRoutes.js`) | revoke + enable | Government registry verification outcomes — canonical vehicle truth. Writable here means vehicle provenance is forgeable, defeating the programme's core invariant. |
| 22 | `server_health` | unknown (0–7) | all 7 / all 7 | `service_role` (1 call, `routes/adminRoutes.js`) | revoke + enable | Operational telemetry behind an admin route. No client consumer; service-role only. |
| 23 | `vehicle_telemetry` | unknown (0–7) | all 7 / all 7 | `service_role` (1 call, `server.js`) | revoke + enable | Vehicle-linked movement data — location-adjacent personal data. **Flagged for Phase 6/8 (lower priority):** an owner viewing their own vehicle's telemetry is a plausible future authenticated self-read. |

**All 23: `revoke + enable`. None requires a policy now.**

### Flagged for Phase 6/8 — where a real actor policy may later be needed

These are the only tables where a future user-facing feature would legitimately read the
table *directly* rather than through the Express backend. Nothing is required today; they
are listed so Phase 6/8 can pick them up deliberately rather than discovering them under
deadline.

| table | future actor | shape the policy would need |
|---|---|---|
| `kyc_profiles` | authenticated self | `SELECT` only, `USING (user_id = <caller>)` |
| `device_sessions` | authenticated self | `SELECT` + narrow `UPDATE` (revoke own session), `USING (user_id = <caller>)` |
| `trusted_devices` | authenticated self | `SELECT` + `DELETE` own device, `USING (user_id = <caller>)` |
| `insurance_claims` | authenticated claimant | `SELECT` only, scoped to the claimant |
| `vehicle_telemetry` | authenticated vehicle owner | `SELECT` only, scoped through vehicle ownership |
| `tenant_branding` | **anonymous**, pre-login | `SELECT` only, non-secret columns, resolved by `custom_domain` |
| `organization_*` (profiles, branches, departments) | authenticated org member | `SELECT` only, scoped to the caller's org membership |

**Blocking prerequisite for every row above:** CarUp uses custom backend auth, so there is
no Supabase JWT and `auth.uid()` is null for every real caller. A self-scoped policy cannot
be written until either (a) CarUp issues Supabase-compatible JWTs, or (b) the read stays
behind the Express backend — which is the current, working design. **Until then, adding any
of these policies would produce a control that silently matches nobody.** Keep them
backend-mediated.

Explicitly **not** on this list, and never to be granted a client policy:
`tenant_api_keys` (credentials), `tenant_feature_flags` (authorization), `role_switch_logs`,
`fraud_alerts`, `compliance_reports`, `registry_verifications` (audit and verdicts),
`organization_roles`, `organization_permissions` (the authorization model itself).

### Accepted finding — `authenticated` is an empty role at CarUp

Confirmed in review and accepted into the record. **CarUp runs custom backend auth and never
mints a Supabase JWT.** `web/src/lib/supabase.ts` builds the browser client with the plain
publishable key, and there is no `supabase.auth.signIn*` or `setSession` call anywhere in
`web/`, `mobile/` or `shared/`. Consequently **every browser request reaches PostgREST as
`anon`**, and the `authenticated` role is never occupied by a real CarUp user — it exists in
the database and holds grants, but no live caller ever assumes it.

**Consequence for policy design:** any future `auth.uid()`-scoped policy on these tables
would match **zero callers today**. It would look like protection in the catalog while
governing nobody, and the feature it was written for would appear broken rather than denied.
That failure mode is worse than no policy, because it reads as done.

Therefore every read in the Phase 6/8 table above **must remain backend-mediated** — served
by the Express service-role path — until CarUp issues Supabase-compatible JWTs. This does not
weaken Phase 0: `anon` is the role that actually carries the exposure, and it is fully
revoked, so containment does not depend on this at all.

> **Phase 6/8 prerequisite.** Issuing Supabase-compatible JWTs (or a decision that CarUp
> never will) is a gate on any client-direct read of these tables. Phase 6/8 must settle it
> **before** writing a single actor policy; writing policies first produces controls that
> silently match nobody.

---

## Verification SQL

### 1. Pre-change inventory — capture this **before** applying

The migration's `Down` section is deliberately non-executable; this receipt is the rollback
source of truth. Read-only.

Like the migration, these queries read the role list from `pg_roles` rather than naming
roles literally: `has_table_privilege` **raises** on a role that does not exist, so a
hardcoded name would turn a partial-role database into a query error instead of a reading.

```sql
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
       r.rolname AS grantee,
       string_agg(p.priv, ',' ORDER BY p.priv) AS privileges
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
 CROSS JOIN (SELECT rolname::text FROM pg_catalog.pg_roles
              WHERE rolname IN ('anon','authenticated','service_role')) AS r(rolname)
 CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE',
                         'REFERENCES','TRIGGER','MAINTAIN']) AS p(priv)
 WHERE c.relname IN (
         'compliance_reports','device_sessions','fraud_alerts','insurance_claims',
         'insurance_records','kyc_profiles','organization_ai_agents','organization_branches',
         'organization_departments','organization_permissions','organization_profiles',
         'organization_roles','organization_settings','organization_users',
         'registry_verifications','role_switch_logs','server_health','stakeholder_profiles',
         'tenant_api_keys','tenant_branding','tenant_feature_flags','trusted_devices',
         'vehicle_telemetry')
   AND has_table_privilege(r.rolname, c.oid, p.priv)
 GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity, c.oid, r.rolname
 ORDER BY c.relname, r.rolname;
```

### 2. Proof of containment — run this **after** applying

This is the single query that proves the Phase 0 claim: `rowsecurity = true` and **zero**
`anon`/`authenticated` privileges for all 23. It returns **one row per table** and the
gate is `PASS` in every row.

`has_table_privilege` resolves privileges inherited from `PUBLIC`, so this also proves the
`PUBLIC` revoke landed. `MAINTAIN` is included because `information_schema.role_table_grants`
**cannot report it** on PostgreSQL 17 — a check built on that view would certify "no
privileges survive" while `MAINTAIN` quietly did.

```sql
WITH targets(name) AS (
  VALUES ('compliance_reports'),('device_sessions'),('fraud_alerts'),('insurance_claims'),
         ('insurance_records'),('kyc_profiles'),('organization_ai_agents'),
         ('organization_branches'),('organization_departments'),('organization_permissions'),
         ('organization_profiles'),('organization_roles'),('organization_settings'),
         ('organization_users'),('registry_verifications'),('role_switch_logs'),
         ('server_health'),('stakeholder_profiles'),('tenant_api_keys'),('tenant_branding'),
         ('tenant_feature_flags'),('trusted_devices'),('vehicle_telemetry')
), api_roles(role) AS (
  SELECT rolname::text FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated')
)
SELECT t.name,
       c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
       (SELECT count(*) FROM api_roles r,
                             unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE',
                                          'REFERENCES','TRIGGER','MAINTAIN']) AS p(priv)
         WHERE has_table_privilege(r.role, c.oid, p.priv)) AS api_table_privs,
       (SELECT count(*) FROM pg_attribute a, api_roles r,
                             unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS p(priv)
         WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
           AND has_column_privilege(r.role, c.oid, a.attnum, p.priv)) AS api_column_privs,
       (SELECT count(*) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE',
                                          'REFERENCES','TRIGGER','MAINTAIN']) AS p(priv)
         WHERE has_table_privilege('service_role', c.oid, p.priv)) AS service_role_privs,
       CASE
         WHEN c.relrowsecurity
          AND (SELECT count(*) FROM api_roles r,
                                    unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE',
                                                 'REFERENCES','TRIGGER','MAINTAIN']) AS p(priv)
                WHERE has_table_privilege(r.role, c.oid, p.priv)) = 0
         THEN 'PASS' ELSE 'FAIL'
       END AS gate
  FROM targets t
  JOIN pg_class c ON c.oid = to_regclass('public.' || quote_ident(t.name))
 ORDER BY t.name;
```

On staging and production `api_roles` yields both roles, so `api_table_privs` counts across
16 role/privilege combinations. On a database holding only one it counts across 8, and on one
holding neither the `gate` degenerates to an RLS-only check — read it together with the
`NOTICE` the migration emitted, which names the roles it actually found.

**Expected result: 23 rows, every one of them**

| column | expected |
|---|---|
| `rls_enabled` | `true` |
| `policies` | `0` |
| `api_table_privs` | `0` |
| `api_column_privs` | `0` |
| `service_role_privs` | `8` |
| `gate` | `PASS` |

Fewer than 23 rows means a table is absent from that database — the migration skips absent
tables by design and emits a `NOTICE` naming them.

### 3. One-line pass/fail

```sql
SELECT count(*) FILTER (WHERE NOT c.relrowsecurity) AS rls_still_off,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM pg_catalog.pg_roles r
          WHERE r.rolname IN ('anon','authenticated')
            AND has_table_privilege(r.rolname, c.oid, 'SELECT'))) AS still_readable
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
 WHERE c.relname IN (
   'compliance_reports','device_sessions','fraud_alerts','insurance_claims','insurance_records',
   'kyc_profiles','organization_ai_agents','organization_branches','organization_departments',
   'organization_permissions','organization_profiles','organization_roles','organization_settings',
   'organization_users','registry_verifications','role_switch_logs','server_health',
   'stakeholder_profiles','tenant_api_keys','tenant_branding','tenant_feature_flags',
   'trusted_devices','vehicle_telemetry');
```

Both counters must be `0`.

---

## Fail-loud paths a reviewer may hit

The migration refuses rather than half-applies. Each refusal is diagnostic, and the
enclosing transaction rolls back so nothing is partially contained.

| condition | behaviour |
|---|---|
| `anon` and `authenticated` both absent | `NOTICE`, skips entirely — no Data API means no exposure to contain, and enabling RLS on a database whose access model is unknown is a risk with no benefit |
| **exactly one of `anon` / `authenticated` present** | `NOTICE` naming the one found, then **full containment of that role**; the absent role is never named in any statement. Not a failure — see the correction below |
| `service_role` absent or lacks `BYPASSRLS` | `RAISE EXCEPTION` before any change — enabling RLS would break every backend read and write |
| a target table absent | `NOTICE` naming it, continues — a fresh database has not created all 23 |
| a **policy** exists on any of the 23 | `RAISE EXCEPTION` — default-deny with zero policies is the intended end state; see the migration header before adding one |
| any surviving privilege for a Data API role that exists | `RAISE EXCEPTION`, transaction rolls back |
| `service_role` lost a privilege | `RAISE EXCEPTION`, transaction rolls back |

Re-running is safe: `ENABLE ROW LEVEL SECURITY` on an enabled table is a no-op, and
`REVOKE`/`GRANT` converge on the same ACL from any starting point.

### Correction — partial-role databases (review finding D7)

The first version of this migration probed the role model with
`EXISTS (… rolname IN ('anon','authenticated'))`. That asks *"is at least one present?"* and
then acted as though **both** were: the containment statement was a literal
`REVOKE ALL … FROM PUBLIC, anon, authenticated`, and the postcondition called
`has_table_privilege('anon', …)` and `has_table_privilege('authenticated', …)` unconditionally.

Naming a role that does not exist is a hard `ERROR` in PostgreSQL, not a no-op. So a database
holding only **one** of the two roles passed the guard and then aborted mid-migration —
contradicting this document's own "a fresh database and staging both apply cleanly" claim.
The same latent defect was present in the postcondition, not only in the `REVOKE`.

**The fix: each role is resolved independently.** All three blocks now read the roles that
`pg_catalog.pg_roles` actually reports into an array, and:

* the revoke list is assembled from that array, always led by `PUBLIC` —
  `REVOKE ALL ON TABLE public.<t> FROM PUBLIC[, anon][, authenticated]`;
* the postcondition's privilege and column-privilege assertions iterate the same array, so
  every role that exists is checked and no absent role is ever probed;
* an empty array (neither role) still skips the whole migration with a `NOTICE`.

`PUBLIC` is unconditional and stays in the revoke list in every case — it is a built-in
pseudo-role that is always present, and it is the inheritance path that would otherwise
re-open the exposure.

Every prior guarantee is preserved and re-proved: transactional, idempotent, forward-only,
`service_role` grants restated, absent tables skipped with a `NOTICE`, and a postcondition
that still **refuses to commit** if any privilege survives for a role that exists, or if any
policy is present on a covered table.

**Behavioural proof** (in-memory PGlite, PostgreSQL 17, no network and no real database) —
the full role matrix `both` / `anon`-only / `authenticated`-only / `neither` applies cleanly,
containment and idempotency hold in each, and under a single role the postcondition still
blocks a planted permissive policy and a re-granted privilege. A counter-proof confirms the
pre-fix statement forms admit an `anon`-only database and then fail with
`role "authenticated" does not exist`.

---

## Residual risk not closed by this migration

1. **The grant layer is closed; the schema is still advertised.** PostgREST will stop
   returning data, but the 23 table names may remain visible in the OpenAPI schema output.
   Removing them from the exposed schema is a Supabase project setting, not a migration.

2. **Row counts for 18 of the 23 were not individually captured.** They are known
   collectively to be 0–7, so the disclosure bound holds, but if any of those tables is
   later found to be non-trivially populated the *disclosure* assessment (not the
   containment) should be revisited.

3. **Whether the exposure was ever exercised is not determined here.** This migration
   closes the door; it does not tell you whether anyone walked through it. If that question
   matters, it needs PostgREST request-log analysis for the 23 table paths, which is a
   separate read-only investigation.

4. **Production posture is unverified.** All measurements above are staging
   (`eoyenigwevnxwwhyhaer`). The same 23 tables should be measured on production with query
   (1) before this migration is promoted — the grants may differ.
