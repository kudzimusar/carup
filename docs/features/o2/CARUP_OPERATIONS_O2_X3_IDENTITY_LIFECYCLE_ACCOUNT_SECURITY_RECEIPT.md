# O2-X3 — Identity Lifecycle + Account Security: Certification Receipt

- **Branch:** `feat/operations-o2-people-compliance`
- **Starting head:** `0fcf358b` (X2 docs) · **Date:** 2026-09-03
- **Scope executed:** X3 ONLY. X4–X7 not started; **P7 remains BLOCKED / NOT EXECUTED**;
  P1/P1-C, X1 and X2 untouched and re-proven green.
- **The two questions, answered separately and never collapsed:**

> **Identity proofing:** who did CarUp establish this person to be? — 7C history, immutable.
> **Authentication:** is the person using this account NOW sufficiently authenticated for this
> action? — session assurance, server-derived.

## 1. Current lifecycle model (historical proof / current state separation)

`identity_lifecycle_events` — append-only identity-domain ledger, **enforced in the database**
(UPDATE/DELETE raise; monotonic `seq` so "latest" never rides a timestamp tie). Current state =
latest row; a ledgerless user with a historical approval is `verified`; without one,
`not_established`. A previously approved session remains, verbatim, "approved at time T, using
evidence E, by reviewer R" — proven byte-identical across transitions. Every row carries:
subject · previous/next state · reason code · trigger source · actor (kind/id/role) ·
`identity_lifecycle.v1` · evidence reference · timestamp. No unexplained booleans exist.

## 2. Transition matrix (total; unlisted pairs refuse BY NAME)

| From | May become |
|---|---|
| `not_established` | `verified` (approval hook only) |
| `verified` / `recovered` | `reverification_required` · `suspended` · `compromised` · `disputed` · `revoked` |
| `reverification_required` | `verified`/`recovered` (approval hook only) · `suspended` · `compromised` · `revoked` |
| `suspended` | `verified` · `reverification_required` · `revoked` |
| `compromised` | `reverification_required` · `recovered` (approval hook) · `suspended` · `revoked` |
| `disputed` | `verified` · `reverification_required` · `revoked` |
| `revoked` | **`reverification_required` ONLY** |

Guarantees pinned: the subject can never act on their own lifecycle; `verified`/`recovered`
cannot be hand-minted by any human endpoint — only `onVerificationApproved` (called by the 7C
decision recorder after a durable APPROVE; from `compromised` it lands as `recovered`); **an
approval landing on `revoked` is REFUSED** — no auto-resurrection from an old approval;
transitions demand the `operations.identity.lifecycle` capability on a proven session; every
transition is audited (ledger row + `trust_audit_events`), and re-verification creates a NEW 7C
journey rather than rewriting the old one.

## 3. Triggers implemented

| Trigger | Status |
|---|---|
| Document expiry | **Derived overlay**: a real, parseable `expiry` in the approving evidence past due → `effective_state = reverification_required` (`DOCUMENT_EXPIRED`); no expiry → nothing fabricated; the ledger is untouched |
| Account recovery | **Classified**: routine reset = authentication event (all prior sessions revoked — pre-existing pinned behaviour; identity proofing untouched; the recovery router imports no lifecycle code, source-pinned) vs suspected takeover = governed `compromised` transition (`SUSPECTED_ACCOUNT_TAKEOVER`) |
| Security event | Governed reviewer transition (`SECURITY_REVIEW`) |
| Material identity change | **Designed, refused-by-absence**: no self-service profile/credential-change route exists in the repository today, so there is no write path to hook; the reason code + policy exist and any future account-edit route must call the lifecycle hook (recorded obligation) |
| Privileged/high-risk operation | **Step-up, not reverification**: the action classes below — proofing state unchanged |

## 4. Authentication assurance (`authentication_assurance.v1`)

Session columns (additive migration, server-written only): `auth_method` · `step_up_at` ·
`step_up_method`. Strengths `session < recent_reauth < strong_authenticator`. Classes:

```
ordinary_action            → valid proven session
sensitive_action           → + password re-proof within 15 minutes
critical_authority_action  → + password re-proof within 5 minutes
                             (strong_authenticator once one EXISTS — see §5)
```

Derivation reads ONLY the user_sessions row the presented token resolves to; forged
headers/body claims are proven inert; an unknown `step_up_method` value is worth nothing.
`POST /api/auth/step-up` verifies the stored credential server-side (same evaluator as login)
and stamps the presenting session; it is the ONLY writer of step-up state.

## 5. Passkey/WebAuthn: DEFERRED, fail-closed, never faked

Exact-head inspection confirmed **no WebAuthn, passkey or MFA implementation exists** in this
repository. Accordingly: `STRONG_AUTHENTICATOR_AVAILABLE = false` is a build-time fact (not a
flag); the step-up method allowlist contains only `password_reauth`, so **no code path can
record a strength that does not exist** (`webauthn` is refused, test-pinned); the critical
class's fallback to fresh password re-proof is EXPLICIT policy
(`deferredStrongAuthenticator: true`, test-pinned). When a real authenticator lands (its own
scope), availability flips in one place and the critical class tightens with no route changes.
Device biometrics used through a future passkey are AUTHENTICATION — deliberately distinct
from X4's identity-proofing biometrics.

## 6. Step-up action map (one guard — `requireAuthenticationAssurance`)

| Action | Class |
|---|---|
| `PATCH /api/ownership-transfers/:transferId` (every authority-changing transition) | **critical** |
| `POST /api/vehicles/:vin/seller-authority/review` | sensitive |
| `PATCH /api/admin/dealers/:id/decision` | sensitive |
| `GET  /api/admin/identity/…/evidence/:side/preview` (raw identity evidence) | sensitive |
| `POST /api/admin/identity/lifecycle/:userId/transition` | sensitive |
| `POST /api/admin/account-security/:userId/revoke-sessions` | sensitive |
| `POST /api/auth/sessions/revoke-others` (self) | sensitive |

The guard composes AFTER the role/capability layers and substitutes for none of them —
proven at runtime: a stepped-up non-privileged session is still refused by authorization, and
a stepped-up admin reaching the transfer domain is then refused by the domain's own completion
contract. An x-user-id-asserted identity is refused on every security surface in any
environment.

## 7. Session compromise and revocation

Governed revocation over the existing `is_valid` contract — scopes **one / others / all**;
self-service revoke-others keeps the presenting session; operations revocation sits behind
`operations.account.security` + step-up. **`compromised` revokes every live session of the
subject in the same governed action** (proven: 2/2 revoked, other accounts untouched).
Audit carries who/why/which-session-ids/when — **never token material** (asserted on the audit
bytes). Invalidated sessions are re-proven rejected by the unchanged authMiddleware.

## 8. Dormant `next_actor` / `required_action`

**Derivation chosen** (the preferred rule): lifecycle responsibility projects at read time via
`lifecycleToResponsibilityProjection` (who-must-act matrix updated); the dormant session
columns stay dormant and no competing persisted source was introduced.

## 9. Code changed

**New:** `identityLifecycleService.js` · `authenticationAssuranceService.js` ·
`sessionSecurityService.js` · `stepUpMiddleware.js` · `authSecurityRoutes.js` ·
`identityLifecycleAdminRoutes.js` · migrations `20260903200000` + `20260903201000` · three
test suites. **Edited:** decisionRecorder (approval → lifecycle hook, best-effort/loud);
registrationJourneyService + `/onboarding` page (lifecycle-aware ladder/UI);
operationsAuthorizationService (+2 capabilities); sessionRow (+`auth_method`); server.js
(mounts); the four guarded routes; three test harnesses (session mocks gained step-up rows;
the sessions-contract suite now covers the widened contract).

## 10. Gates (final tree; CI env; full suites run sequentially, uncontended)

| Gate | Result |
|---|---|
| New X3 suites (lifecycle PGlite 7 · assurance/step-up 10 · journey-lifecycle 5) | **22/22** (all migrations executed against real PostgreSQL in-suite) |
| 7C identity suites (through the new approval hook) | **67/67** |
| Certified-lane batch (P1-C former-seller 11/11 · transfer supersession · O2 core · seller · v16 runtime convergence · phase-3 trust · v16 authority hardening · diaspora-ocr) | **165/165** |
| Auth contract batch (auth-session · sessions-contract · recovery-security · phase-6 session governance · auth-middleware · migration-integrity) | **69 pass / 0 fail** (1 live-staging check skipped as always) |
| X1 guards + X2 suites | green in-batch (22/22 X2; 6/6 X1) |
| Dealer routes (harness upgraded to real session + step-up) | **9/9** |
| **Full backend suite** | **5839 / 0 fail / 21 skipped** (X2 baseline 5817 + exactly the 22 new tests) |
| **Full web suite** | **1570 / 1570** (X2 baseline 1568 + exactly the 2 new page tests) |
| `tsc --noEmit` (web) | clean |
| Lint regression gate vs branch origin | **NET_NEW 0/0** |

Gates NOT run, and why: the staging UAT workflows (exact-head pairing deliberately absent
while #194 is unmerged — the standing P7 blocker) and GitHub-hosted workflows without
`workflow_dispatch` (each step reproduced locally above). The new migrations are outside
`migration_pglite_check.mjs`'s frozen NEW_MIGRATIONS list — the same posture as P1-C's
migration: they are executed end-to-end by their own PGlite suite here.

## Stop condition

The current Identity Lifecycle exists and is governed; historical 7C truth is immutable;
transitions are audited; compromised/reverification states drive Progressive Trust correctly;
revocation is proven; high-risk actions sit behind a real server-side step-up policy; no fake
MFA/passkey state exists anywhere. **X4 was not begun.**
