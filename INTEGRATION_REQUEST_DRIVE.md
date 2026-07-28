# Integration requests — Google Drive lane (Issue #127)

Branch: `claude/gtm-drive-lane`. These are edits to files the Drive lane does not own. Nothing here is
required for the lane's own tests or gates to pass — the lane is green without any of it. Items 1 and
2 are documentation/ledger hygiene; item 3 is the only one with user-visible effect, and the backend
degrades correctly without it (the endpoint simply goes uncalled).

---

## 1. `backend/env.example` — document three new environment variables

Not integration-owned, but outside the Drive lane's write list. The Drive block currently ends at
`GOOGLE_DRIVE_REDIRECT_URI` (around line 87). Please append:

```
# GOOGLE_DRIVE_REDIRECT_URIS=            # optional: additional callbacks, comma separated; matched byte-for-byte
# DIASPORA_CREDENTIAL_VAULT_BACKEND=     # aws_secrets_manager | gcp_secret_manager | azure_key_vault |
#                                        #   hashicorp_vault | supabase_vault. REQUIRED in production —
#                                        #   resolveVault() throws VAULT_NOT_CONFIGURED without it and
#                                        #   never falls back to the in-memory store.
# DIASPORA_DRIVE_MAX_SYNC_ATTEMPTS=5     # retries before a Drive sync attempt is dead-lettered
```

Rationale: an operator reading `env.example` today would not learn that production Drive needs a vault
backend at all, and would discover it as a runtime `VAULT_NOT_CONFIGURED` instead.

---

## 2. `docs/DIASPORA_TRADE_OS_MIGRATION_LEDGER.md` — no new migration, one new harness

The Drive lane added **no** migration. It consumes ledger #21's existing
`diaspora_credential_references` and `diaspora_drive_sync_attempts` tables as designed.

If the ledger tracks verification artefacts, please note against ledger #21:

> Verified additionally by `database/test/diaspora_drive_vault_reference_check.mjs` (Issue #127, Drive
> lane) — 76 assertions on real PostgreSQL 17.5 (PGlite) proving that the JS opaque-reference gate in
> `backend/services/diaspora/drive/credentialVault.js` never accepts a value the
> `ck_diaspora_credential_reference_not_a_secret` CHECK rejects, that the CHECK still contains every
> fragment the JS mirror list claims to mirror, that `uq_diaspora_credential_active` permits exactly
> one active credential per (tenant, user, purpose) while keeping superseded rows, that
> `uq_diaspora_drive_attempt_idem` enforces idempotency, and that `anon`/`authenticated` hold no
> privilege on either table with RLS enabled.

---

## 3. Frontend — surface durable sync state (optional, backend is complete without it)

New backend endpoint, already mounted in `backend/routes/diasporaDriveRoutes.js`:

```
GET /api/diaspora/drive/sync-attempts/:entityType/:entityId
  → { data: { attempts: DriveSyncAttempt[], durableTracking: boolean, reason?: string } }
```

`GET /api/diaspora/drive/status` also gained two fields:

```ts
credential: {
  id, purpose, vaultBackend, keyVersion, scopes, status,
  externalAccountLabel, expiresAt, lastRefreshedAt, lastErrorCode, revokedAt
} | null

activation: { credentialsConfigured: boolean, redirectUris: number, pending: boolean }
```

Requested edits, if and when the Drive UI is picked up:

- **`web/src/types/index.ts`** — add `DriveSyncAttempt`:
  ```ts
  export interface DriveSyncAttempt {
    id: string;
    operation: 'ensure_folder' | 'upload' | 'update' | 'metadata' | 'revoke';
    entityType: string | null;
    entityId: string | null;
    idempotencyKey: string;
    state: 'pending' | 'in_flight' | 'succeeded' | 'failed' | 'dead_lettered';
    attempts: number;
    nextAttemptAt: string | null;
    providerFileId: string | null;
    providerFolderId: string | null;
    bytes: number | null;
    contentChecksum: string | null;
    lastErrorCode: string | null;
    lastError: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string | null;
  }
  ```
  These field names are exactly what `sanitizeSyncAttempt` in
  `backend/services/diaspora/drive/driveSyncQueue.js` emits. No credential field exists on the shape,
  by design — `vault_reference` is never projected to any API consumer.

- **`web/src/hooks/useCarUpApi.ts`** — add a reader for the endpoint above.

- **UI behaviour, whoever builds it.** Two truths the backend now provides that the UI should not
  discard:
  - When `activation.pending` is true, render "Drive is not yet activated" rather than a Connect
    button. Without owner credentials, Connect can only fail with `NOT_CONFIGURED`.
  - A `dead_lettered` attempt means the user's file did **not** reach Drive and will **not** be
    retried automatically. It must not render as a warning-coloured "syncing"; it is a failure that
    needs the user to act. `state: 'failed'` with a `nextAttemptAt` is the retrying case.

---

## 4. Nothing needed from the other integration-owned files

For the record, the Drive lane needs **no** change to:
`web/src/App.tsx`, `web/src/config/featureRegistry.ts`, `web/src/config/featureIcons.tsx`,
`shared/navigation/feature-manifest.json`, `shared/navigation/navigation-nodes.json`,
`backend/middleware/securityMiddleware.js` (the callback is a GET and the mutating Drive routes are
pre-existing, so CSRF and rate-limit posture are unchanged), or `tests/agents/*`.

---

## 5. One change was made to a shared script — please review

`scripts/cr1-secret-scan.mjs` was **hardened, not weakened**, as the lane directive requires. It now
also blocks committed Google OAuth refresh/access tokens, Google API keys and client secrets, Stripe
keys, webhook signing secrets, AWS access key ids, GitHub and Slack tokens, and PEM private key
blocks.

Two things worth a reviewer's eye:

1. Every new pattern requires a long credential-alphabet suffix (15–30+ characters). This is
   deliberate: it lets a file mention a *prefix* (`ya29.`, `GOCSPX-`) in a regex definition or a
   negative assertion without tripping the scanner, so hardening the scanner never creates pressure to
   allow-list a test file. The Drive lane's own fixtures assemble credential-shaped values at runtime
   for the same reason and need no exemption.
2. Exactly **one** file was added to a new `PROVIDER_CRED_ALLOWLIST`:
   `database/test/diaspora_gtm_migration_check.mjs`. That is the pre-existing ledger #21 harness whose
   purpose is to feed credential-shaped literals at the CHECK constraint and prove it refuses them.
   The Drive lane cannot edit it (`database/test/**` is new-files-only for this lane), so an exemption
   was the only option. If the integrator prefers, the fix is to convert that file's `SECRET_SHAPES`
   array to runtime-assembled strings and drop the allow-list entry entirely.

Scan result after the change: `CR-1 secret scan clean (1536 tracked files)`.
