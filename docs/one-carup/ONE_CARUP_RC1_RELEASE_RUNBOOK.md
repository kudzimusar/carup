# One CarUp — RC1 release runbook

**Status: NOT EXECUTED.** This is the ordered plan for releasing the RC1 source (`integration/one-carup-source-rc1`, Draft PR #220).

- Nothing in it has been run.
- Every step that touches staging, production, a database or a provider needs the authorization its owner column names, at the time it runs.
- Each step lists its verification and the condition on which to **stop**. Stop means: halt the release, record why, and return to the moderator.

**Fixed points:**

| Item | Value |
|---|---|
| Canonical staging | Supabase `carup-staging`, `eoyenigwevnxwwhyhaer`. Never replaced, never substituted. |
| Production | Supabase `vhmnajoeicasaigiophh`. It serves `78303ed6` (`dpl_HDk3…`) as of 2026-10-04. |
| Deployments | Release-only. Vercel Git deployments stay disabled (`git.deploymentEnabled: false`). |
| Ledger hash | `CARUP_LEDGER_HASH_VERSION` stays `1` until the staged ledger migration is separately authorized. |

## Steps

### 1. Moderator review of RC1
- **Owner:** Programme moderator
- **Action:** Multi-domain code review of PR #220 against the phase records in `docs/one-carup/`.
- **Verify:**
  - The review is recorded.
  - RC1's exact head is named.
- **Stop if:** any authority conflict, or any P0/P1, is raised.

### 2. Owner decisions that RC1 surfaces
- **Owner:** Product owner
- **Action:** Decide the residual-scan findings:
  - **A** — whether PartSentry service writes for non-mechanic roles accept a dealership membership, or use the governed Dealer decision;
  - **C** — whether each lane registers its notification templates before release, or the release accepts those notifications dead-lettering.
- **Note:** Findings B and D need no release-time decision, but must be scheduled. Separately decide #208's blocked items (X4, X5A, step-up UI) and #213 D; none of them blocks RC1.
- **Verify:** The decisions are written down.
- **Stop if:** a decision changes RC1's code — that becomes a new RC.

### 3. Restore canonical staging
- **Owner:** Owner (Supabase and Vercel access)
- **Action:**
  1. Restore or unpause `eoyenigwevnxwwhyhaer`.
  2. Make the staging backend serve again; it answered 500 `FUNCTION_INVOCATION_FAILED` on 2026-10-04.
- **Verify:**
  - The project's DNS resolves.
  - `/api/health` answers 200 with `supabase.status: healthy`.
- **Stop if:** restoring would need a substitute project or a new identity.

### 4. Credential hygiene
- **Owner:** Owner
- **Action:**
  1. Confirm the database password once leaked in old git history has been rotated.
  2. Confirm the Cloudflare token is scoped to Workers AI.
  3. Mint smoke credentials (`CARUP_SMOKE_SESSION_TOKEN` for a staging smoke account) for steps 11 and 12 only.
- **Verify:** Rotation is confirmed. No credential is in the tree; the `oc4f-no-committed-credentials` guard is green.
- **Stop if:** an unrotated credential is found anywhere.

### 5. Read-only staging migration inventory
- **Owner:** Operator
- **Action:** Compare staging's applied-migration ledger with RC1's `database/migrations`. Use catalogue reads only.
- **Verify:** A written list of pending files. At minimum it includes `20261004150000_o2_dealer_compliance_decision_template.sql`, plus whatever staging has not received since it last tracked `main`.
- **Stop if:** staging's ledger holds a file RC1 does not have (drift).

### 6. Review the migration candidates
- **Owner:** Moderator and owner
- **Action:** Decide whether to promote the candidates from `database/migration-candidates/`:
  - **OC-3D:** ledger hardening;
  - **OC-4A:** evidence-history protection, and `ai_fraud_scans` advisory state.

  Each is proven on PGlite in its suite. Promotion means moving the file into `database/migrations` as a new reviewed change.
- **Verify:** The decision is recorded for each candidate.
- **Stop if:** a candidate would need a guessed or destructive change.

### 7. Apply the pending migrations to staging only
- **Owner:** Operator (with owner authorization)
- **Action:** Use the staging runner and an explicit apply-list (`database/scripts/apply_migrations_staging.mjs`). Before applying, run the migration-integrity, migration-hygiene and RLS suites.
- **Verify:**
  - Every file is recorded in the ledger.
  - The governed template `dealer_compliance_decision_v1` is `active`, with one `approved` version.
- **Stop if:** any statement fails. Do not retry blindly.

### 8. Configure the staging runtime
- **Owner:** Operator
- **Action:** Set the backend environment from `ONE_CARUP_PROVIDER_READINESS.md` (by name):
  - Cloudflare account and token;
  - `CARUP_OCR_PROVIDER` absent or `cloudflare`;
  - `CARUP_AI_*` pinned;
  - `ALLOW_OCR_MOCK` and `CARUP_ALLOW_X_USER_ID_FALLBACK` **unset**;
  - `CARUP_LEDGER_HASH_VERSION=1`;
  - the custody secrets.

  Set `NODE_ENV=production`. A past staging incident ran `NODE_ENV=test`, which opened the x-user-id bypass.
- **Verify:** The values are visible to the operator only. Nothing is pasted into a ticket or log.
- **Stop if:** the custody rollout contract is not `FINALIZED` at the runtime's generation.

### 9. Deploy RC1 to staging, exact SHA, paired
- **Owner:** Operator
- **Action:** Use the release-only CLI to deploy RC1's exact head to the staging backend and the staging frontend. The frontend's build-time API pairing must point at **this** backend deployment.
- **Verify:** Two deployment ids, both built from the same SHA.
- **Stop if:** any deployment builds from a different SHA.

### 10. Prove deployed provenance and pairing
- **Owner:** Operator
- **Action:**
  1. Check `/api/health` → `build.commit_sha` equals RC1's SHA.
  2. Prove the frontend's pairing from the **served bundle** and from a captured runtime request. A build-time pairing input proves nothing unless the deployment's own SHA contains it.
- **Verify:** Both captures are recorded.
- **Stop if:** the frontend talks to any other backend.

### 11. Provider smoke on staging
- **Owner:** Operator (authorized per run)
- **Action:**
  1. `one-carup-provider-smoke.mjs --env staging` in PLAN mode.
  2. LIVE mode with `--expected-sha`.
  3. LIVE mode with `--provider-calls` — exactly one Gemma call.
- **Verify:** The verdict is `PASS`, and the JSON report is kept.
- **Stop if:** any check fails — in particular, OCR not on Qwen, a mock reachable, or anonymous inference.

### 12. Deployed product journeys on staging
- **Owner:** Operator and owner
- **Action:** Walk the OC-4E journeys against the paired staging deployment:

  | Journey | What it shows |
  |---|---|
  | Identity | A human decides |
  | People & Compliance | No self-review |
  | Owner / Evidence | Custody |
  | Ledger | The empty state, then a recorded event |
  | Garage | The odometer reading is a candidate |
  | AI | Advisory; an anonymous visitor costs nothing |
  | Seller | Private seller, and Dealer — the governed dealership lists, its mechanic is refused |
  | Buyer | No owner or seller identity in public |
  | Diaspora | Scenario Lab, dry-run only |
  | Mechanic | PartSentry → Ledger |

  Use fake VINs and staging fixture accounts.
- **Verify:** The evidence is captured per journey. Nothing is fabricated: a step not run is recorded as not run.
- **Stop if:** a gate would send a **real** WhatsApp or SMS without deconfliction, or any journey breaks its governing law.

### 13. Bounded live OCR accuracy
- **Owner:** Operator (authorized)
- **Action:** Dispatch `o2-live-ocr-accuracy.yml` once, manually, against the staging pairing.
- **Verify:** Corpus results are recorded, and Cloudflare usage stays within the daily allocation.
- **Stop if:** accuracy regresses below the recorded grader threshold.

### 14. Communications readiness
- **Owner:** Each lane owner
- **Action:**
  - Register the governed templates each lane owns (finding C), or record that the release accepts those notifications dead-lettering on registry environments.
  - Check the outbox backlog.
  - Never repoint the production communications cron.
- **Verify:** `communication-event-coverage` is green, and `KNOWN_UNREGISTERED` has shrunk or is accepted in writing.
- **Stop if:** a template would be authored outside its owning lane.

### 15. Production read-only audit
- **Owner:** Operator (read-only credential, authorized)
- **Action:** Use catalogue metadata and aggregate counts **only** — no PII, no row dumps, no DML, DDL or RPC writes. Gather:
  - migration versions;
  - constraints, triggers, functions and indexes;
  - `tenant_users` role counts (finding B);
  - the shape of dealer memberships — admin of an active dealership-typed tenant (Dealer continuity);
  - identity sessions where reviewer equals subject (P6);
  - PartSentry logs without a ledger event (finding D).
- **Verify:** An aggregate-only report.
- **Stop if:** any query would return personal data.

### 16. Owner UAT on staging
- **Owner:** Product owner
- **Action:** UAT of the People & Compliance workspace, the Dealer flows, Garage odometer capture, and Buyer AI on the paired staging RC1.
- **Verify:** The UAT result is recorded, with pass/fail per step.
- **Stop if:** there is any blocking finding — that means a new RC.

### 17. Production migration plan
- **Owner:** Operator and owner
- **Action:** Write the exact, ordered production apply-list. Production is many releases behind (`78303ed6`), so this is large. For each file:
  - Down-block availability;
  - lock and duration risk;
  - pre-checks (for example, the role count before #209's catalogue, when that ships).

  Back up first. Rehearse on a production branch or clone if the owner provides one.
- **Verify:** The plan is approved in writing.
- **Stop if:** any step would have to be guessed.

### 18. Production release window
- **Owner:** Owner (explicit approval)
- **Action:**
  1. Apply the approved production migrations, using the production runner and the explicit apply-list.
  2. Deploy RC1's exact SHA to the production backend and frontend with the release-only CLI.

  Merging to `main` does **not** release production; deployment does.
- **Verify:**
  - Both deployment ids are built from RC1's SHA.
  - Migrations are recorded.
- **Stop if:** any migration fails — then roll back per step 20.

### 19. Production verification
- **Owner:** Operator
- **Action:**
  1. Check `/api/health`: provenance, `ocr.*`, `ai.*`, `supabase.healthy`, `sentry.enabled`.
  2. Run a manual read-only checklist. The smoke harness refuses production by design, so use the same checks by hand:
     - verify-ledger on a fake VIN answers 401 anonymously;
     - the legacy `/api/verification` router and `/api/ai/ocr` answer as retired.
  3. Decide whether the OC-P0L edge firewall rule is still needed. Confirm it at the edge, not through the configuration API.
- **Verify:** Each check is recorded.
- **Stop if:** any check fails — then roll back.

### 20. Roll back or close out
- **Owner:** Owner
- **If verification failed:**
  1. Run a Vercel instant rollback to the previous production deployment (`dpl_HDk3…`, `78303ed6`).
  2. Run the reviewed Down blocks for any migration this release applied, in reverse order. Only where safe; otherwise leave the schema forward-compatible and record it.
- **If verification passed:**
  1. Mark PR #220 ready, merge it, so `main` matches production. It is 0 behind, so the merge is a fast-forward.
  2. Record the release.
  3. Retire the superseded hotfix branch `hotfix/oc-p0l-verify-ledger-containment`.
- **Verify:** `main`, the production deployment and the release record all name the same SHA.
