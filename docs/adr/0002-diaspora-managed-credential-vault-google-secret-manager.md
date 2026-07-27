# ADR 0002 — The managed credential vault is Google Secret Manager

- **Status:** Accepted (engineering complete; live use gated on owner cloud provisioning — §6)
- **Date:** 2026-07-31
- **Programme:** CarUp Diaspora GTM, Issue #127 — Phase 2D
- **Extends:** ADR 0001 §2 and §"What still gates live use" item 6, which named the missing managed
  vault client as *"the one piece of remaining engineering work, and it cannot be finished without
  knowing which vault the owner will use."*

## Context

ADR 0001 built the whole credential indirection — the four-method `CredentialVault` interface, the
opaque-handle discipline, the SQL CHECK that refuses a token-shaped `vault_reference`, and the JS
mirror that fires before the value can reach a driver — and then implemented only the two adapters
that cannot be used in production: an in-memory map and a read-only environment reader.
`resolveVault()` therefore threw `VAULT_NOT_CONFIGURED` for `aws_secrets_manager`,
`gcp_secret_manager`, `azure_key_vault`, `hashicorp_vault` and `supabase_vault` alike.

Failing closed there was correct — a fallback to the in-memory adapter would have silently killed
every user's Drive connection on the next restart while the database still reported them `active` —
but it also meant the Drive lane could not be activated at all, no matter what the owner provisioned.

## Decision

**Google Secret Manager is the managed credential vault.** It is implemented in
`backend/services/diaspora/drive/googleSecretManagerVault.js` against the existing interface, and
`resolveVault()` now returns it when `DIASPORA_CREDENTIAL_VAULT_BACKEND=gcp_secret_manager`.

### Why this one, and what was checked first

The repository was searched for an authoritative decision that would contradict this. There is none:

- `docs/adr/0001-diaspora-drive-credential-vault-and-transport.md` **enumerates** five candidate
  backends and explicitly declines to choose, deferring to the owner.
- `docs/adr/ADR-001-diaspora-subscription-provider.md` is about payment rails. It says nothing about
  secret storage and does not constrain this decision.
- No other ADR, migration comment or runbook expresses a preference.

What the repository *does* already assume is Google Secret Manager specifically. The ledger #21
real-PostgreSQL fixtures — `database/test/diaspora_gtm_migration_check.mjs` and
`database/test/diaspora_drive_vault_reference_check.mjs` — insert `gcp_secret_manager` rows with
`gcpsm://projects/…/secrets/…` references. Those fixtures described a backend that did not exist.
They now describe this one, and the reference format in this ADR is the one they already assert.

The substantive argument is about identity boundaries, not features:

| Option | Assessment |
|---|---|
| **Google Secret Manager** (chosen) | The secret being stored **is a Google OAuth refresh token**, minted by a Google OAuth client that ADR 0001 already requires the owner to create, in a Google Cloud project that already has the Drive API enabled. Secret Manager is a service of that same project — no new vendor, no new billing relationship, no new identity system, and one blast radius instead of two. On GCE/GKE/Cloud Run it needs no key file at all (workload identity). |
| AWS Secrets Manager | Technically fine, and the cheapest at low volume. But it introduces a second cloud account, a second IAM model and a second set of rotation credentials **for one secret type that is already Google's**. Compromise of either cloud now compromises Drive access. Rejected on blast radius, not capability. |
| Azure Key Vault | Same objection as AWS, with no offsetting advantage for this workload. |
| HashiCorp Vault | The most capable option (dynamic secrets, fine-grained leases) and the only one that would justify itself if CarUp had many secret classes across many clouds. It is also a service somebody must run, monitor, unseal and patch. For a single credential type on a serverless deployment, the operational cost is not repaid. |
| Supabase Vault | **Rejected on the threat model.** The entire point of the handle indirection is that reading `diaspora_credential_references` must not yield the credential. Supabase Vault stores the material in the same database, reachable with the same service-role key. It would make the handle a formality. |

If the owner overrides this, the cost is bounded by design: a backend is one class implementing four
methods plus one `registerManagedVaultBackend` call. Nothing else in the system changes.

## What the implementation guarantees

### 1. The handle is fresh randomness, never derived from the secret

`secretId` is `{prefix}-{purpose}-{tenant}-{48 hex characters of crypto.randomBytes(24)}`.

This is a security property, not a style choice. A handle derived from the secret — even a truncated
hash — is an **offline oracle**: the handle column is non-secret, replicated into backups, logs and
analytics, and anyone holding a copy could test candidate secrets locally at whatever rate their
hardware allows, with no request to us and nothing to rate-limit. The test suite stores the *same*
secret twice and asserts the two handles are unrelated, and separately asserts that no hex or base64
digest of the secret under sha256/sha1/md5/sha512 appears anywhere in the handle.

### 2. Every reference is tenant-bound, and the binding is checked locally

`put` **refuses** to store a credential with no tenant context (`VAULT_TENANT_REQUIRED`) — an unbound
credential is one that can never be authorized on read. The tenant is part of the resource name, and
`get` / `rotate` / `destroy` recompute the expected prefix and compare **before any request leaves the
process**. A binding check that depends on reading a label back from Google fails open exactly when
Google is slow, and costs a round trip on the hot path.

`vault.forTenant(tenantId)` returns a scoped view, and `resolveVault({ tenantId })` hands that view to
callers who know their tenant — so "remember to pass the tenant" stops being a per-call-site
discipline. `diasporaDriveSyncService` uses the scoped form on both halves of the OAuth handshake.

A reference naming a **different project** is refused as `VAULT_REFERENCE_NOT_FOUND`; without that, a
tampered database row could redirect a read at somebody else's project.

### 3. The transport is injectable and the wire is real

The module speaks real Secret Manager below the same `httpTransport.js` seam the Drive provider uses:
real `https://secretmanager.googleapis.com/v1` paths, the real `?secretId=` create form, the real
`:addVersion` / `:access` / `:destroy` custom verbs, real base64 payloads, and the real
`{ error: { code, message, status } }` envelope mapped by its **canonical status** rather than by HTTP
code alone — because a `403 PERMISSION_DENIED` (an operator problem, never retry) and a
`403 RESOURCE_EXHAUSTED` (a quota bounce, retry with backoff) are the same status code and completely
different events.

`backend/tests/helpers/googleSecretManagerFixtures.js` is a fake **server**, not a fake vault: it
enforces bearer auth, `ALREADY_EXISTS` on a duplicate id, `NOT_FOUND` after deletion,
`FAILED_PRECONDITION` on destroying a destroyed version, and it **verifies the RS256 service-account
assertion with the matching public key**. Every test is offline and deterministic; no test touches a
network.

### 4. CRC32C is verified

`versions/latest:access` returns `dataCrc32c` beside the payload and the vault checks it. A truncated
or corrupted refresh token would otherwise be stored, used, rejected by Google as `invalid_grant`, and
reported to the user as "reconnect required" — indistinguishable from a genuine revocation. A
mismatch raises `VAULT_INTEGRITY_FAILED` and **returns nothing**.

### 5. Rotation keeps the handle and destroys the dead version

`rotate` adds a new *version* under the same handle, because the reference is written into
`diaspora_credential_references` and `diaspora_drive_connections` and rotating it would mean a
multi-row update that can half-succeed. The superseded version is then **destroyed** (best effort — a
rotation that succeeded is never reported as failed because the tidy-up of an already-dead version
returned `FAILED_PRECONDITION`). `DIASPORA_VAULT_GCP_DESTROY_PREVIOUS_VERSION=false` keeps a rollback
window for operators who want one.

`destroy` deletes the **secret**, not the latest version: destroying one version of a multi-version
secret leaves every earlier refresh token intact and accessible, which is precisely what a user
pressing "disconnect" asked to be rid of.

### 6. Nothing is logged, and nothing leaks

The module contains no logging call of any kind. Every message that could carry upstream text goes
through `redactSecretMaterial` first, and the service-account private key and every minted access
token are registered for redaction. The test suite runs a full lifecycle against a **hostile** Secret
Manager that echoes the secret back inside its error bodies, sweeps captured console output, every
returned object, every error stack and the stored labels — and opens with **positive controls** that
prove the detector and the output capture can actually fail, so none of the assertions are vacuous.

### 7. It still fails closed

Missing project, missing credentials, an unparseable key file, a foreign project, a tenant mismatch
and a CRC mismatch are all errors. `resolveVault()` in production with nothing configured still
throws, and a backend with no registered client still throws `no client is implemented in this build`.
The in-memory and env adapters are unchanged and still refuse to run in production.

### 8. Why a registry rather than an import

`credentialVault.js` does **not** import the backend. `resolveVault` is synchronous
(`GoogleDriveProvider.vault` is a getter, so it cannot await), which rules out a dynamic import, and a
static import would create a core → backend → core cycle whose child evaluates
`class … extends CredentialVault` while that binding is in its temporal dead zone. Whether that throws
depends on which module the process happened to load first — the worst possible property for the code
path that decides where refresh tokens live. Backends therefore call `registerManagedVaultBackend` on
import, and `drive/vaultBackends.js` is the single explicit place that pulls them in.

## External activation — what the owner must provision

None of this enables live Drive on its own. Everything below is owner-only.

### Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `DIASPORA_CREDENTIAL_VAULT_BACKEND` | **yes** | Set to `gcp_secret_manager`. Anything else (or unset) keeps `resolveVault()` failing closed in production. |
| `DIASPORA_VAULT_GCP_PROJECT_ID` | yes¹ | The Google Cloud project that holds the secrets. Falls back to `GOOGLE_CLOUD_PROJECT`, `GCLOUD_PROJECT`, then the `project_id` inside the service-account key. |
| `DIASPORA_VAULT_GCP_SERVICE_ACCOUNT_JSON` | yes² | The service-account key file, as raw JSON **or** base64-wrapped JSON. Base64 is accepted because a PEM private key inside a JSON string inside a platform environment variable is routinely mangled by newline handling. |
| `DIASPORA_VAULT_GCP_USE_METADATA_SERVER` | no² | `true` on GCE / GKE / Cloud Run, where workload identity means **no key file exists at all**. Strongly preferred wherever the runtime supports it. Vercel's serverless runtime does **not**. |
| `DIASPORA_VAULT_GCP_SECRET_PREFIX` | no | Defaults to `carup`. Only change it to share a project with another application. |
| `DIASPORA_VAULT_GCP_REPLICA_LOCATIONS` | no | Comma-separated GCP locations, e.g. `europe-west2`. Empty (default) means automatic replication. Set this if data-residency policy requires it — it cannot be changed after a secret is created. |
| `DIASPORA_VAULT_GCP_DESTROY_PREVIOUS_VERSION` | no | Defaults to `true`. `false` keeps superseded versions for a rollback window, at the cost of retaining dead credential material. |
| `DIASPORA_VAULT_GCP_TIMEOUT_MS` | no | Per-request timeout; defaults to 15 000 ms. |

¹ or resolvable from one of the fallbacks. ² one of the two credential paths is required.

**`DIASPORA_VAULT_GCP_SERVICE_ACCOUNT_JSON` is a private key. It must be set as a secret in the
deployment platform, never committed, never echoed in CI logs, and never placed in `.env` in the
repository.** The CR-1 scanner blocks PEM private-key blocks in tracked files.

### Google Cloud provisioning

1. **Enable the Secret Manager API** on the project: `secretmanager.googleapis.com`.
2. **Create a dedicated service account** (e.g. `carup-diaspora-vault@…`). Do not reuse the OAuth
   client or an existing broad-permission account.
3. **Grant it, project-scoped, the minimum this integration actually uses:**

   | Permission | Used by |
   |---|---|
   | `secretmanager.secrets.create` | `put` |
   | `secretmanager.secrets.delete` | `destroy`, and the orphan cleanup when `addVersion` fails |
   | `secretmanager.versions.add` | `put`, `rotate` |
   | `secretmanager.versions.access` | `get` |
   | `secretmanager.versions.destroy` | `rotate` (superseded version) |

   The simplest correct grant is a **custom role** containing exactly those five permissions.
   `roles/secretmanager.admin` also works and is what most operators will reach for, but it additionally
   grants IAM policy management on every secret in the project, which this integration never needs.
   The commonly-suggested combination of `roles/secretmanager.secretAccessor` +
   `roles/secretmanager.secretVersionManager` is **not sufficient** — neither grants
   `secretmanager.secrets.create` or `.delete`.
4. **If deploying to GCE / GKE / Cloud Run**, attach that service account to the workload and set
   `DIASPORA_VAULT_GCP_USE_METADATA_SERVER=true` instead of exporting a key. There is then no
   long-lived private key to leak.
5. **If deploying to Vercel** (the current target), a key file is unavoidable. Create it, set it as an
   encrypted environment variable, and schedule its rotation — Google recommends at most 90 days.
6. **Decide data residency** before the first secret is written. Replication policy is fixed at
   creation time; changing `DIASPORA_VAULT_GCP_REPLICA_LOCATIONS` later affects only new secrets.
7. **Enable audit logging** for `secretmanager.googleapis.com` DATA_READ, so every `access` of a
   customer's refresh token is attributable. Cloud Audit Logs does not record DATA_READ by default.

### Still gated after this ADR

Everything ADR 0001 listed remains gated: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_DRIVE_REDIRECT_URI`, OAuth consent configuration for `drive.file`,
`DIASPORA_DRIVE_STATE_SECRET`, and `DIASPORA_DRIVE_ENABLED=true`. This ADR closes item 6 of that list
and nothing else.

## Known limitation

ADR 0001 §8 recorded that a user with **no tenant context** gets a working Drive connection but no
registry row and no durable attempt tracking. Under this backend that becomes a hard refusal: `put`
raises `VAULT_TENANT_REQUIRED` rather than storing a credential nobody can later authorize a read
against. This is a deliberate tightening — an unbound secret is not safely storable — but it is a
behaviour change for tenant-less users and is reported truthfully rather than papered over.

The Drive **provider's** `refreshAccessToken` and `revoke` paths still call the vault without a tenant
(their signatures carry only a `credentialReference`), so on those two paths the binding is present in
the reference but not re-verified. The verification is available (`get(reference, { tenantId })`) and
is used wherever the tenant is in scope; threading it through those two provider methods is
follow-up work, not a gap in the stored data.

## Verification

```bash
# the new suite: 33 tests, offline, deterministic, positive controls first
NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=test-service-role-key \
  SUPABASE_ANON_KEY=test-anon-key JWT_SECRET=test-jwt-secret ALLOW_OCR_MOCK=true \
  node --test backend/tests/diaspora-vault-gcp-secret-manager.test.js

# the reference format this backend emits, against the real SQL CHECK
node database/test/diaspora_drive_vault_reference_check.mjs

# secret scan
node scripts/cr1-secret-scan.mjs
```
