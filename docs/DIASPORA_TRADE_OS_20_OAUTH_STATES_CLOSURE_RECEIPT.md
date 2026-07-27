# Ledger #20 — diaspora_oauth_states Grant Hardening Closure Receipt (2026-07-27)

> Owner authorizations: **"APPROVE #20 DIASPORA OAUTH STATES GRANT HARDENING"** (2026-07-27) and
> **"merged / credential ready"**. Closes EB-5 cutover receipt residual §5.1. No secret values
> appear in this document. No application code was deployed — #20 is database ACL hardening only.

## Migration

`20260727090000_diaspora_oauth_states_client_grant_hardening.sql` — frozen sha256:12
`c9515b888c30`, merged to main in PR #126 (squash `b0b568d`). Root cause (same class as #19): the
H6 migration (#10) only ran `ENABLE ROW LEVEL SECURITY` — every privilege on the nonce store came
from Supabase `ALTER DEFAULT PRIVILEGES`. #20 runs `REVOKE ALL` from PUBLIC, `anon`, and
`authenticated` and `GRANT ALL` to `service_role`; the zero-policy default-deny RLS posture is
intentionally unchanged (service-role-only one-time OAuth state nonce store).

## Proof chain

- **Real-Postgres harness 44/44** (`backend/tests/realpg/phase8-9-acl-realpg.mjs`), #20 section
  14 proofs including both owner-required adversarial rejections: the verifier flags
  `GRANT UPDATE, TRIGGER … TO PUBLIC` (3 violations, caught via effective-privilege inheritance +
  relacl grantee=0) and a pre-existing policy (zero-policy invariant), then verifies clean again
  after restoration.
- **Corrected fail-closed verifier** (both review findings closed at PR head `96f9a4a`):
  absolute zero-policy invariant (pre-gate abort + post ==0, incl. verify-only runs); EFFECTIVE
  privileges via `has_table_privilege` across all 8 PG17 table privileges
  (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) for both client roles
  (captures PUBLIC inheritance); PUBLIC relacl check (`aclexplode` grantee=0); column belt over
  `pg_attribute.attacl` including PUBLIC entries.
- **CI:** 18/18 checks green on the corrected head.

## Application (staging first, then production)

| Target | Run / mode | Result |
|---|---|---|
| Staging `eoyenigwevnxwwhyhaer` | workflow run 30228326291 (dispatch from main `b0b568d`) | APPLY+VERIFY PASS — one transaction, official ledger row `20260727090000` recorded |
| Production `vhmnajoeicasaigiophh` (PG 17.6) | fail-closed local applier, checksum re-verified | APPLY+VERIFY PASS — one transaction, ledger row recorded (`statements=1`) |

**Verified contract on both targets:** anon and authenticated hold **zero effective privileges**
across all 8 PG17 table privileges; PUBLIC holds no table or column ACL entry; service_role
retains full access (all 8 effective); RLS enabled; **exactly 0 policies** before and after; row
count unchanged (0); live probes denied with 42501 (anon SELECT, authenticated SELECT, anon
INSERT); production `vehicles` anon SELECT (public marketplace) intact.

## Hygiene

The temporary production credential file was deleted at completion; no `~/.db.*` credential file
remains on the operator machine. The production DB password used post-rotation was never printed,
stored, or shared.

## Verdict

**#20 COMPLETE — DIASPORA OAUTH STATES HARDENED**
