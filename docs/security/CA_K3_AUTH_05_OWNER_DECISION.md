# CA-K3-AUTH-05: authentication authority infrastructure decision

Disposition: CA_K3_AUTH_05_OWNER_DECISION_REQUIRED.

This is a source audit and proposed boundary, not an implemented remediation or security pass.
No live database was queried. No session impersonation experiment was executed.

## Custody

- Product base: 082c73d85c1ae9e9d3b64674cdcb9d8dccbcd568.
- Certification authority: 15b08700ad51451968ba3b728a48c7bb2b9cd329.
- Both objects fetched directly from kudzimusar/carup.
- PR #229 read back as Draft/Open at the certification authority; untouched.
- Branch: fix/ca-k3-auth-05-session-authority.
- Isolated clone: /private/tmp/carup-ca-k3-auth-05.

## Findings and infrastructure gate

`backend/db/supabase.js` constructs the shared database client from
SUPABASE_SERVICE_ROLE_KEY. The runtime uses custom authentication against
public.users and public.user_sessions, rather than Supabase Auth.

The historical migration
20260613000000_phase7b_supabase_auth_and_identity.sql explicitly grants ALL on
user_sessions to service_role. This is source evidence, not a fresh live ACL
measurement. The moderator supplied the live SELECT/INSERT/UPDATE/DELETE and
BYPASSRLS finding. No after-state privilege claim is made.

The proposed separation must include more than session writes:

- Session rows contain the bearer token itself. General access to that column must
  end; a new writer credential with general token reads retained is insufficient.
- Login and step-up read users.password_hash through the shared client.
- Password recovery updates that hash and consumes auth_action_tokens using the
  shared client. These credential and recovery dependencies need protection too.
- General updates to account identity/contact fields used by recovery need a
  narrowly authorized boundary. Effective grants, column grants, inherited roles,
  security-definer functions, views, and ownership must all be checked.

OWNER_INFRASTRUCTURE_DECISION_REQUIRED: provision a separate authentication
database identity and backend-only secret, independently revocable and not
derivable from SUPABASE_SERVICE_ROLE_KEY. Recommended transport is a dedicated
PostgreSQL login with a separate connection secret (proposed name:
CARUP_AUTH_DATABASE_URL), NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE, no membership or
SET ROLE path from service_role, and privileges limited to approved auth
operations. Do not reuse the general service-role key or a database-owner login.
The owner must approve its runtime custody and credential/recovery scope before
the coordinated cutover is finalized. No secret was created or read here.

No grant-revocation migration is supplied in isolation: the existing runtime
depends on these grants and applying revocation alone would break login/logout.

## Writer map at the frozen product base

All runtime writers below use the shared service-role client (or an injected
client whose runtime default is that client). The role is an implementation
dependency today, not a requirement of the business operation.

| Operation | Source / entry | Session columns | Identity provenance |
|---|---|---|---|
| Login | backend/server.js:2570 /api/auth/login; insert at 2598 | buildSessionRow columns below | user selected by email; password evaluated server-side |
| Registration | backend/server.js:2820 /api/auth/register; insert at 2886 | buildSessionRow columns | generated account id and assigned role |
| Role switch | backend/server.js:594 /api/auth/switch-role; insert at 668 | buildSessionRow columns, verified tenant | body userId must equal authenticated requester; role/tenant checked |
| Logout | backend/server.js:2678 /api/auth/logout | is_valid=false | presenting token + authenticated user id + valid filter |
| Active tenant selection | backend/server.js:2759; rollback 2779; invalidation 2787 | active_organization_id; is_valid on rollback failure | presenting token + authenticated user id; membership checked |
| Password reauth / A1 | backend/routes/authSecurityRoutes.js:53 -> authenticationAssuranceService.js:148 | step_up_at, step_up_method | route verifies current password for authenticated user; service accepts supplied token/userId from trusted caller |
| A1 audit rollback | authenticationAssuranceService.js:174 | clear step_up_at/step_up_method | exact row id and conditional stamp match |
| Revoke others | authSecurityRoutes.js:88 -> sessionSecurityService.js:64 | is_valid=false | own user id; requires recent step-up; excludes presenting token |
| Administrative revocation | identityLifecycleAdminRoutes.js:101 -> same service | is_valid=false | governed admin caller selects subject user; service itself accepts explicit userId |
| Identity lifecycle security action | identityLifecycleService.js:444 -> same service | is_valid=false | governed lifecycle subject |
| Corporate compromise handling | corporateMembershipGovernanceService.js:297 -> same service | is_valid=false | governed subject; failure must remain visible to Corporate flow |
| Password reset | authRecoveryRoutes.js:157 | is_valid=false for all live subject sessions | consumed single-use recovery token user_id |
| Restoration | /api/auth/me, authMiddleware.js | no session write identified | validate presenting token and current row |
| Refresh / expiry | searched auth routes and direct session references | no independent refresh/extension writer identified | creation uses 24-hour expiry; validation reads expiry |
| Test fixtures | backend/tests/run-tests.js:918,930,1208; PGlite fixtures and test worlds | inserts, updates, deletes as fixture setup | arbitrary synthetic ids; must never establish runtime authority |
| Golden bootstrap | backend/scripts/issue164-golden-uat-auth.mjs | no direct session writer in executable body | updates fixture password hashes; normal login creates sessions; header comment describes that downstream write |

buildSessionRow writes id, user_id, active_role, active_organization_id, token,
ip_address, user_agent, created_at, expires_at, is_valid.
No runtime direct DELETE was identified in the scoped direct-reference search.
Generic dbInsert/dbUpdate/dbDelete helpers also exist; this map is not a proof
against dynamic SQL or every possible dependency. Complete that audit before
claiming removal of every equivalent authority route.

## Proposed design and acceptance contract

Use a dedicated authentication repository/client for session creation, validation,
assurance and revocation, with a protected credential/recovery store. Authenticate
the user independently before minting or stamping a session; never expose a
service-role-callable mint function accepting only a claimed user id.

Preserve the public Web/Native session contract through backend adapters. Keep
Corporate SQL assurance reads and temporal checks unchanged where possible.
Do not grant the new auth identity broad Corporate permission assignment powers.
Check Corporate callable function privileges separately; session-table isolation
alone is not a complete review of caller identity binding in privileged functions.

The desired ACL is no general INSERT/UPDATE/DELETE/TRUNCATE or bearer-token
SELECT on session authority, no equivalent RPC, no credential/recovery authority,
and no role inheritance escape. The new auth identity receives only necessary
operations. Password verification, self scoping, audit failure, revocation,
expiry and replay protections remain mandatory at the application boundary.

| Privilege | Before evidence | After |
|---|---|---|
| Session SELECT / INSERT / UPDATE / DELETE | explicit historical ALL grant + moderator live finding | unchanged; remediation pending |
| RLS bypass | moderator live finding; shared client documents service-role use | unchanged; no RLS-only fix proposed |
| Session function privileges | not exhaustively recertified | pending disposable PostgreSQL catalog audit |
| Credential/recovery privileges | shared-client read/write call sites identified; effective ACL unmeasured | pending protected-boundary implementation |

## Tests and integrity

Command: node --test backend/tests/auth-session-row.test.js.
Runtime: Node v22.23.2. Result: 4 passed, 0 failed.
This is an existing row-construction baseline, not lifecycle certification.

I1-I4: not executed; no post-remediation denial claim.
I5: no impersonation exploit constructed; future certification should use
defensive authorization assertions without a reusable impersonation chain.
I6: full legitimate lifecycle suite not run; implementation pending.
Corporate/Web/Native regressions: not run; no product changes made.
Pre-remediation executable impersonation reproduction: not performed.

Phase-C migration:
database/migrations/20261015010000_ca_k3_auth_04_corporate_permission_authority.sql
Git blob before and after: 747404734641952ca7f80ccaddb2ee2eafa0a677.
No certification harness changes. Product files remain byte-identical to base.

Migrations created: none. Staging migrations: NO. Production touched: NO.
Deployment: NO. Merge: NO. Workflow 38698121501 approval: NO.
No changes to PR #222 or #229. No activation authority asserted.

The security blocker remains open. This document records the owner infrastructure
decision needed for implementation and does not satisfy CA_K3_AUTH_05_PASS.
