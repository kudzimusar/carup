# INTEGRATION_REQUEST_ENT — entitlements lane (Issue #127, phases 2B + 2C)

Three changes are needed in integration-owned files. The entitlements lane cannot make them itself.
Nothing below blocks the lane's own commits; each is a gap that will otherwise persist silently.

---

## 1. `.github/workflows/ci.yml` — run the ledger #26 real-Postgres proof

**Add one step**, next to the existing `node database/test/migration_pglite_check.mjs`:

```yaml
      - name: Diaspora ledger #26 — entitlement override re-grant (real Postgres)
        run: node database/test/diaspora_entitlement_override_regrant_check.mjs
```

**Why it matters.** `backend/tests/*.test.js` runs against the in-memory mock. The mock now models
`uq_diaspora_user_override`, but a mock modelling a constraint is a statement about the mock. The
thing that actually broke re-granting was the real constraint's *absence of a deleted_at predicate*,
and only the PGlite harness reads that from `pg_index` and reproduces the 23505 against real
PostgreSQL 17.5. It also proves the RPC ACL (`anon`/`authenticated`/PUBLIC have no EXECUTE) under
Supabase's DEFAULT PRIVILEGES hazard, which no unit test can observe.

Runs in ~10s, no services, no secrets. Exits non-zero on any failed check. Currently 50/50.

Optional, same reasoning: the other `database/test/diaspora_*_check.mjs` harnesses are also absent
from CI and are only ever run by hand.

---

## 2. `docs/DIASPORA_TRADE_OS_MIGRATION_LEDGER.md` — record ledger #26

The migration is `database/migrations/20260731090000_diaspora_entitlement_override_regrant.sql`
(sha256:12 = `93ab8f5ee95a` — recompute before pasting; it changes with any edit).

Row values for the ledger table:

| Field | Value |
|---|---|
| Ord | 26 |
| Filename | `20260731090000_diaspora_entitlement_override_regrant.sql` |
| Phase | Entitlement override re-grant (Issue #127) |
| Purpose | A revoked per-user entitlement override could never be granted again. `uq_diaspora_user_override UNIQUE (tenant_id, user_id, feature_key)` from ledger #12 has **no** `deleted_at` predicate (the only deleted_at-aware index on the table is a plain lookup index), so a soft-deleted row holds the unique slot forever; `applyAdminOverride` could not see the tombstone, took the INSERT branch and raised 23505, which surfaced as a 500 naming a Postgres constraint. Adds an apply RPC (row lock over the soft-deleted row + `INSERT … ON CONFLICT ON CONSTRAINT … DO UPDATE` clearing `deleted_at`) and the previously missing revoke RPC. Audit distinguishes GRANTED / UPDATED / REGRANTED / REVOKED, written inside the same transaction. Ledger #12 is NOT edited. |
| Tables / RPCs | 2 functions: `diaspora_apply_entitlement_override_atomic`, `diaspora_revoke_entitlement_override_atomic` |
| RLS / grants / search_path | grants Y (service_role-only EXECUTE; PUBLIC/anon/authenticated revoked) · search_path Y (`public, extensions, pg_temp`) |
| Down script | **Y** (drops both functions only; ledger #12 data untouched) |
| Staging | NOT APPLIED |
| Prod | NOT APPLIED |

Dependency: → ledger #12 (the table and the constraint) and the `diaspora_import_audit_log` table.

Verification evidence: `database/test/diaspora_entitlement_override_regrant_check.mjs`, 50/50 on
PostgreSQL 17.5 (PGlite), including the pre-#26 23505 reproduction, rollback atomicity, the
ON CONFLICT race path, tenant scoping, revoke idempotency and the ACL contract.

Version number: `20260731090000` was confirmed by the integrator as this lane's, ledger #26. Another
lane picked the same timestamp and is being renumbered.

---

## 3. Owner decision needed — the buyer/seller Drive tier is now thin

Not a code request. A product fact that phase 2C made visible and that someone should look at.

`PLAN_CATALOG` grants `diaspora.drive.connect: true` and `diaspora.drive.export: false` to
`diaspora_buyer` and `seller`. Both keys are now genuinely enforced:

- **connect** at `diasporaDriveSyncService.getAuthorizationUrl` + `handleOAuthCallback`;
- **export** at `diasporaDriveSyncService.uploadDriveFile` — the single funnel `exportToDrive` also
  calls, because `exportToDrive` adds no capability of its own and gating only the route named
  "export" would leave `POST /drive/upload` reaching the identical provider write.

The consequence, once `DIASPORA_SUBSCRIPTION_ENFORCEMENT` is switched on: a buyer or seller can link
their Google Drive and see connection status, but cannot put a single file in it. That is what the
catalog says today, and the lane enforced it as written rather than quietly widening the plan —
expanding an entitlement is a pricing decision, not a code cleanup.

If the intent was that connecting Drive implies being able to attach documents, the fix is a
one-line catalog change (`DRIVE_EXPORT: true` for `diaspora_buyer` and `seller`) plus a look at
whether the pro tier still differentiates. **The entitlements lane has deliberately NOT made that
change.** Flagging rather than deciding.

Related, already handled and not a question: `diaspora.api.access` was `true` on `enterprise` with no
diaspora API surface anywhere in the codebase to gate. Per the phase 2C rule (enforce it, or make it
unavailable and remove it from sellable plan claims) the claim was withdrawn — `false` on every plan,
mode `UNAVAILABLE` in the registry, and the word "API" removed from the enterprise plan description.
The enterprise price did not change; what changed is that the plan no longer advertises an API that
does not exist. Restoring it requires building the surface and wiring the guard together.

---

## Resolution status (2026-08-08, reunification audit)
- §1 CI step: **SATISFIED** — `.github/workflows/ci.yml` runs the globbed "Diaspora ledger harnesses"
  step covering `database/test/diaspora_*_check.mjs` (includes the #26 harness; 50/50 locally on 2026-08-08).
- §2 ledger row: **SATISFIED** — row #26 present with sha256:12 `93ab8f5ee95a`.
