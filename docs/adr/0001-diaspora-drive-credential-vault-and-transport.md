# ADR 0001 — Diaspora Drive: credential vault, injectable transport, and what still gates live use

- **Status:** Accepted (engineering complete; live activation gated on owner credentials)
- **Date:** 2026-07-27
- **Programme:** CarUp Diaspora GTM, Issue #127 — Drive lane
- **Supersedes:** the `EXTERNAL_ACTIVATION_REQUIRED` stubs in `backend/services/diaspora/drive/googleDriveProvider.js`

## Context

Ledger #21 (`database/migrations/20260727120000_diaspora_gtm_activation_foundation.sql`) created two
tables the Drive integration needs and then left them unused:

- `diaspora_credential_references` — an opaque handle per (tenant, user, purpose), with CHECK
  constraints that refuse anything shaped like a Google refresh/access token, a provider key, a JWT
  or a PEM block.
- `diaspora_drive_sync_attempts` — durable retry/backoff/dead-letter state per Drive operation.

Meanwhile the live provider threw `EXTERNAL_ACTIVATION_REQUIRED` from all six of its methods. The
integration was honest about being incomplete, but "we cannot build this until the owner provisions
OAuth credentials" was not actually true: everything except the credentials themselves could be
built, and built in a way that is testable without them.

## Decisions

### 1. The database holds an opaque handle; a vault holds the secret

`CredentialVault` (`backend/services/diaspora/drive/credentialVault.js`) is a four-method interface —
`put` / `get` / `rotate` / `destroy`. `put` takes secret material and returns an opaque reference;
`get` is the only route back, and only provider transport code calls it.

The handle is built from fresh randomness, **not** from a hash of the secret. A hash would still be an
offline oracle against a low-entropy secret, and it would tempt future code into treating "same
secret ⇒ same handle" as a feature.

`assertOpaqueReference` mirrors the SQL CHECK in JavaScript and runs on every write path *before* the
value can reach a driver. The CHECK constraint is a last line of defence, not the only one: by the
time it fires, the value has already been marshalled into a query and possibly logged by the client.
`backend/services/diaspora/drive/driveVaultRegex.js` records, per pattern, the exact SQL fragment it
mirrors, and `database/test/diaspora_drive_vault_reference_check.mjs` runs one corpus through both
gates on real PostgreSQL to prove they still agree.

The invariant is deliberately one-directional: **JS must never accept what SQL rejects.** JS being
stricter is safe, and it is (client secrets, AWS/GitHub/Slack tokens, bare `Bearer` headers).

### 2. Backends, and failing closed

Implemented: `InMemoryCredentialVault` (tests/dev) and a read-only `EnvCredentialVault` (single-
operator local dev). Managed backends (AWS Secrets Manager, GCP Secret Manager, Azure Key Vault,
HashiCorp Vault, Supabase Vault) are **not** implemented.

`resolveVault()` therefore throws `VAULT_NOT_CONFIGURED` in production rather than falling back to the
in-memory adapter. The fallback would be worse than an outage: every user's Drive connection would
silently die on the next restart while the database continued to report them `active`.

### 3. An injectable HTTP transport, not a mock provider

`backend/services/diaspora/drive/httpTransport.js` defines the seam. Below it, the provider speaks
real Google: real endpoints, real `application/x-www-form-urlencoded` token requests, real
`multipart/related` upload framing, real `{ error: { code, message, errors: [{ reason }] } }`
envelopes. Tests replace **only the socket**.

This is the difference between testing the integration and testing a fixture. `MockDriveProvider`
still exists for feature-level tests, but it proves nothing about how CarUp talks to Google;
`backend/tests/helpers/googleDriveFixtures.js` provides a fake *server* that enforces Google's actual
rules (exact redirect match, PKCE verification, bearer auth, revocation) and the production provider
runs against it unmodified.

The transport returns non-2xx as **data** and throws only on transport-level failure, so the provider
decides deliberately what an HTTP error means. It also never logs: request headers carry bearer
tokens, and a single `console.debug(headers)` there would defeat the entire design.

### 4. PKCE on a confidential client

CarUp holds a client secret, so PKCE is not strictly required by the spec. It is applied anyway
because the authorization **code** travels back through the user's browser. Signed state proves the
callback belongs to a flow we started; it does not stop an attacker who intercepted the code in that
browser (a malicious extension, a shared machine, a leaked `Referer`) from redeeming it. Only the
verifier — which never left the server — does that.

The verifier is secret material, so it goes into the vault; `diaspora_oauth_states.metadata` holds
only the public challenge and an opaque handle. The verifier is destroyed after exactly one exchange,
success or failure, because a verifier that outlives its exchange is a replay primitive.

### 5. Four independent layers on the handshake

| Layer | Covers |
|---|---|
| Signed state (HMAC over user + tenant + nonce + expiry) | the callback belongs to a flow we started, for this user, in this tenant |
| One-time nonce, consumed by `UPDATE … WHERE consumed_at IS NULL` | replay, enforced by the database rather than by a timing assumption |
| PKCE | a code stolen from the browser cannot be redeemed |
| Exact redirect-URI match against an allow-list | open redirect → account takeover |

Redirect matching is byte-for-byte: no prefix matching, no trailing-slash tolerance, no case folding.
Plaintext `http` is permitted only for loopback development.

Tenant binding was added to the state: a user who belongs to two tenants must not be able to start
authorization in one and land the connection — and therefore every document synced through it — in
the other.

### 6. Error mapping keeps "slow down" apart from "you are revoked"

`mapDriveError` reads Google's `errors[0].reason`, not just the status. A `403 rateLimitExceeded` and
a `403 insufficientFilePermissions` are the same status and completely different events; conflating
them is how a rate limit wrongly disconnects a user's account. Only `REVOKED`,
`INSUFFICIENT_SCOPE` and `SCOPE_ESCALATION` mark a connection revoked.

A `401` is retried exactly once after a forced refresh — enough to distinguish an expired access token
from a revoked grant, not enough to loop.

Every string leaving the provider passes through `redactSecretMaterial`, which scrubs both registered
secret values and credential *shapes*. The shape patterns used for scrubbing are kept separate from,
and far more specific than, the reference-rejection patterns: an unanchored JWT pattern eats the word
"keyboard.".

### 7. Durable sync attempts

`driveSyncQueue.js` gives every upload a row whose state a user can be told the truth about.
Idempotency is the database's — `uq_diaspora_drive_attempt_idem` means a concurrent duplicate loses
the insert race with 23505 and is read back — rather than a SELECT-then-INSERT with a race window.
Retryability comes from the provider error's own `retryable` flag. Backoff is exponential with full
jitter (synchronised retries reproduce the overload that caused the failure) and honours a provider
`Retry-After` hint. Dead-lettering clears `next_attempt_at` so it is a terminus, and writes a CRITICAL
audit row, because a file that will never arrive is exactly what that trail is for.

### 8. Known limitation: tenant-scoped durability

`diaspora_credential_references.tenant_id` and `diaspora_drive_sync_attempts.tenant_id` are both
`NOT NULL`, and `uq_diaspora_drive_attempt_idem` depends on that (a NULL tenant would make duplicate
idempotency keys collide-free and silently break the guarantee).

A user with no tenant context therefore gets a working Drive connection but **no** registry row and
**no** durable attempt tracking. This is reported truthfully rather than papered over:
`credentialRegistry: { recorded: false, reason: 'no_tenant_context' }` on the connect audit, and
`durableTracking: false` on the upload response. Inventing a placeholder tenant UUID would corrupt
every tenant-scoped query that followed.

## What still gates live use

None of this enables live Drive. Activation requires, from the owner:

1. **A Google Cloud project with the Drive API enabled**, and an OAuth client of type "Web
   application".
2. **`GOOGLE_CLIENT_ID`** and **`GOOGLE_CLIENT_SECRET`** for that client.
3. **`GOOGLE_DRIVE_REDIRECT_URI`** (optionally `GOOGLE_DRIVE_REDIRECT_URIS`, comma separated)
   registered byte-identically in the Google console and in the environment. A mismatch fails closed
   with `REDIRECT_URI_MISMATCH`.
4. **OAuth consent screen configuration** for the `drive.file` scope. `drive.file` is a
   non-sensitive scope, so it does not require Google verification — this is why the integration uses
   per-file access rather than full-drive.
5. **`DIASPORA_DRIVE_STATE_SECRET`** — required in production; `driveStateSecret()` throws without it.
6. **A production credential vault.** `DIASPORA_CREDENTIAL_VAULT_BACKEND` must name a managed backend,
   and a client for it must be implemented — `resolveVault()` currently throws
   `VAULT_NOT_CONFIGURED` for every managed backend because none is written yet. **This is the one
   piece of remaining engineering work, and it cannot be finished without knowing which vault the
   owner will use.**
7. **`DIASPORA_DRIVE_ENABLED=true`** — the feature flag, still off.

Until (2) and (3) are present, `getDriveStatus` reports
`activation: { credentialsConfigured: false, pending: true }` so the UI can say "not yet activated"
instead of showing a Connect button that can only fail.

## Verification

```bash
# unit + service tests (offline, deterministic)
NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=test-service-role-key \
  SUPABASE_ANON_KEY=test-anon-key JWT_SECRET=test-jwt-secret ALLOW_OCR_MOCK=true \
  node --test backend/tests/*.test.js

# real-PostgreSQL check that the JS gate and the SQL CHECK still agree
node database/test/diaspora_drive_vault_reference_check.mjs

# secret scan (now recognises Google/Stripe/AWS/GitHub/Slack credential shapes)
node scripts/cr1-secret-scan.mjs
```

The token-absence proof lives in `backend/tests/diaspora-drive-token-absence.test.js`. It patches every
console method and both raw output streams, runs a hostile Google that echoes bearer tokens back
inside its responses, and sweeps the entire mock database, every returned object (including
non-enumerable Error properties and stacks) and every captured log line — asserting on 20-character
fragments as well as whole tokens, so a partial redaction still fails. Two control cases prove the
detector and the output capture can actually fail, so the assertions are not vacuous.

## Consequences

- The Drive integration is code-complete and testable end-to-end without any credential.
- A future managed-vault client is a single class implementing four methods; nothing else changes.
- The CR-1 secret scanner now blocks committed Google/Stripe/AWS/GitHub/Slack credentials. Its patterns
  all require a long credential-alphabet suffix, so naming a prefix (`ya29.`) in a regex definition or
  a negative assertion is not a violation — which is what lets the scanner be hardened without
  creating pressure to allow-list test files. New negative-assertion fixtures assemble
  credential-shaped values at runtime for the same reason.
