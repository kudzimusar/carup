# One CarUp — RC2 release runbook

**Status: NOT EXECUTED.** This is the ordered plan for releasing the RC2 source
(`integration/one-carup-source-rc2`, Draft PR #221). It supersedes `ONE_CARUP_RC1_RELEASE_RUNBOOK.md`,
which stays as the RC1 record.

- Nothing in it has been run.
- Every step that touches staging, production, a database or a provider needs the authorization its
  owner column names, at the time it runs.
- Each step lists its verification and the condition on which to **stop**. Stop means: halt the release,
  record why, and return to the moderator.

**Fixed points:**

| Item | Value |
|---|---|
| Canonical staging | Supabase `carup-staging`, `eoyenigwevnxwwhyhaer`. Never replaced, never substituted. |
| Production | Supabase `vhmnajoeicasaigiophh`. It serves `78303ed6` (`dpl_HDk3…`) as last recorded. |
| Deployments | Release-only. Vercel Git deployments stay disabled (`git.deploymentEnabled: false`). |
| Ledger hash | `CARUP_LEDGER_HASH_VERSION` stays `1` until the staged ledger migration is separately authorized. |
| Evidence levels | `ONE_CARUP_EVIDENCE_CERTIFICATION_POLICY.md`. A step's evidence is recorded as a receipt at the level it actually reached, and never above. |

## Steps

### 1. Moderator review of RC2
- **Owner:** Programme moderator
- **Action:** Review PR #221 against the phase records in `docs/one-carup/` (OC-5C … OC-5J), the
  residual scan and the disposition.
- **Verify:** The review is recorded, and RC2's exact head is named.
- **Stop if:** an authority conflict, or any P0/P1, is raised.

### 2. Owner decisions RC2 surfaces
- **Owner:** Product owner (the moderator signs off where noted)
- **Action:** Decide the residual scan's EXPLICIT OWNER BLOCKERs:
  - #213 **D**, the production inquiry path. It decides whether spec 48's Communications phase may
    ever run.
  - #213 **O**, the Intelligence panels.
  - `leadership_welcome_v1`'s governed copy (Email Experience lane).
  - PDF identity documents.
  - `readListingOwners`: degrade silently, or fail the day (moderator sign-off).
  - The moderator's free text in notification payloads.
  - The trust-audit target schema.
  - The #137 portal switcher.
  - Candidate migration promotion: OC-3D, OC-4A, OC-5C X5A and X4.
  - Review of the OC-5G copy: the two new bodies and the seller-authority correction.
- **Verify:** The decisions are written down.
- **Stop if:** a decision changes RC2's code. That becomes a new RC.

### 3. Restore canonical staging, and resolve staging identity
- **Owner:** Owner (Supabase and Vercel access)
- **Action:**
  1. Restore `eoyenigwevnxwwhyhaer`.
  2. Make the staging backend serve again.
  3. Confirm `STAGING_UAT_PASSWORD` and `DIASPORA_STAGING_DATABASE_URL` are set for the staging-only
     gates.
- **Verify:** `/api/health` answers 200 with `supabase.status: healthy`.
- **Stop if:** restoring would need a substitute project or a new identity.

### 4. Credential hygiene
- **Owner:** Owner
- **Action:** As RC1 step 4.
  1. Confirm rotations.
  2. Confirm the Cloudflare token is scoped to Workers AI.
  3. Mint smoke credentials for steps 11 and 12 only.
- **Verify:** No credential is in the tree, and `oc4f-no-committed-credentials` is green.
- **Stop if:** an unrotated credential is found.

### 5. Read-only staging migration inventory
- **Owner:** Operator
- **Action:** Compare staging's applied-migration ledger with RC2's `database/migrations`, using
  catalogue reads only. RC2's own files at minimum:

  | Phase | Migrations |
  |---|---|
  | RC1 | `20261004150000` |
  | OC-5A | `20261004160000..160200` |
  | OC-5C | `20261004170000`, `170100`, `172000` |
  | OC-5D | `20261004180000..180800` |
  | OC-5E | `20261004190000..190300` |
  | OC-5F | `20261004200000` |
  | OC-5G | `20261004210000` |

  Note: staging already holds `seller_daily_metrics.compare_adds`. #213's gate run 36393616046 applied
  it directly and recorded no ledger row. `20261004200000` is idempotent, so applying it records the
  row and changes nothing.
- **Verify:** A written list of pending files.
- **Stop if:** staging's ledger holds a file RC2 does not have (drift).

### 6. Count before you constrain
- **Owner:** Operator
- **Action:** Read, aggregate only:
  - `tenant_users` role counts. OC-5A's catalogue CHECK is `NOT VALID`; `VALIDATE` waits on this
    count.
  - Whether any garage tables or functions exist from #197/#209 previews.
  - Whether any of OC-5G's six template keys is already registered. If one is, the existing
    registration governs, and OC-5G adds nothing beside it.
- **Verify:** An aggregate-only note.
- **Stop if:** a count contradicts a migration's premise.

### 7. Apply the pending migrations to staging only
- **Owner:** Operator (with owner authorization)
- **Action:** Use the staging runner with an explicit apply-list, in file order. Before applying, run
  the `migration-integrity`, `migration-hygiene`, RLS and `oc5*` migration suites.
- **Verify:**
  - Every file is recorded in the ledger.
  - The GMO functions are executable by `service_role` only.
  - `garage_invitations` has RLS forced.
  - The OC-5G templates are `active` with approved versions (`in_app` for the four capped policies,
    `default` for trust and SafeTrade).
  - `service_case_status_v1` and `dealer_compliance_decision_v1` are active.
- **Stop if:** any statement fails. Do not retry blindly.

### 8. Configure the staging runtime
- **Owner:** Operator
- **Action:** As RC1 step 8. In addition:
  - `CARUP_EVIDENCE_VISION_PROVIDER` stays **unset**: evidence analysis is honestly
    `not_configured` (OC-5B);
  - `NODE_ENV=production`.
- **Verify:** The values are visible to the operator only.
- **Stop if:** the custody rollout is not `FINALIZED` at the runtime's generation.

### 9. Govern the RC2 preview pair, and deploy RC2's exact SHA to staging
- **Owner:** Operator
- **Action:**
  1. Add `integration/one-carup-source-rc2` to `web/preview-frontend-pairing.json` and
     `web/preview-backend-pairing.json`. This is a reviewed change, and the only thing that makes the
     staging-pair gates runnable.
  2. Deploy RC2's exact head to the staging backend and frontend with the release-only CLI.
- **Verify:** Two deployment ids, both built from the same SHA.
- **Stop if:** any deployment builds from a different SHA.

### 10. Prove deployed provenance and pairing
- **Owner:** Operator
- **Action:** As RC1 step 10: `build.commit_sha`, the served bundle, and a captured runtime request.
- **Verify:** Both captures are recorded.
- **Stop if:** the frontend talks to any other backend.

### 11. Provider smoke on staging
- **Owner:** Operator (authorized per run)
- **Action:** As RC1 step 11: PLAN, then LIVE with `--expected-sha`, then exactly one Gemma call.
- **Verify:** The verdict is `PASS`. Record a LIVE-PROVIDER receipt only for what ran.
- **Stop if:** OCR is not on Qwen, a mock is reachable, or there is anonymous inference.

### 12. Deployed journeys and the staging gates
- **Owner:** Operator and owner
- **Action:**
  - Walk OC-4E's journeys and OC-5H's J1–J5 against the pair.
  - Run the gates, each on its own command line:
    - the Diaspora deployed UAT, three shards;
    - spec 38;
    - spec 42 (serialised with the others — it rotates shared passwords);
    - spec 43;
    - **spec 48**, through its own workflow and config. Phase Q stays `fixme` unless decision D
      allows it;
    - the Marketplace Reference Regression (exact-head reference and staging certification). It
      watches `backend/services/report/**`, and OC-5F changed that path. RC2's PR is the first time
      it ran on this lineage rather than being cancelled by the shared lock, and it refused the
      ungoverned pair.
  - Re-certify as sibling gates:
    - GMO-8 (golden journey, activation race, step-up);
    - #208's P7, X7 and mobile UAT, with #208's spec 45 renumbered (RC2's spec 45 is Trade OS).
  - Use fake VINs and staging fixture accounts.
- **Verify:** Evidence per journey and per gate. A DEPLOYED receipt only where every DEPLOYED field is
  real. A step not run is recorded as not run.
- **Stop if:** a gate would send a **real** WhatsApp or SMS, or any journey breaks its governing law.

### 13. rollup@2 recompute (staging)
- **Owner:** Operator
- **Action:** Follow `OC5F_SELLER_INTELLIGENCE_ROLLUP2.md`'s plan.
  - Preconditions: the migration is applied, then the code is deployed.
  - Recompute oldest block first, at most 31 days a call, then yesterday, then today.
  - Verify agreement between rollup@1 and rollup@2.
- **Verify:**
  - `rollup-status` shows completed rollup@2 runs;
  - seller `compare_adds` equals the listing totals;
  - reservations are counted by `seller_id`;
  - the report reads `kpi_catalogue@2`.
- **Stop if:** any day fails. With F1 in place, a refused write fails loudly.

### 14. Bounded live OCR accuracy
- **Owner:** Operator (authorized)
- **Action:** As RC1 step 13: one manual dispatch.
- **Verify:** Corpus results recorded, within the Cloudflare allocation.
- **Stop if:** accuracy regresses below the grader threshold.

### 15. Communications readiness
- **Owner:** Communications and each lane owner
- **Action:**
  - Confirm `communication-event-coverage` is green. It is strict: no known-unregistered list.
  - Decide whether to replay events that dead-lettered before OC-5G. Replaying sends stale SafeTrade
    stages and trust changes.
  - Check the outbox backlog.
  - Never repoint the production communications cron.
- **Verify:** Decisions recorded.
- **Stop if:** a template would be authored outside its lane's review.

### 16. Production read-only audit
- **Owner:** Operator (read-only credential, authorized)
- **Action:** As RC1 step 15: catalogue metadata and aggregate counts **only**, with no PII, DML, DDL
  or RPC writes. In addition:
  - `tenant_users` role counts (OC-5A `VALIDATE`);
  - whether garage or Service Network objects exist;
  - template registration for OC-5G's keys;
  - `seller_daily_metrics` columns.
- **Verify:** An aggregate-only report.
- **Stop if:** any query would return personal data.

### 17. Owner UAT on staging
- **Owner:** Product owner
- **Action:** UAT on the paired staging RC2:
  - choosing an organisation;
  - the Service Network: request, authorize, record, history;
  - garage onboarding: apply, review, activate, invite, join;
  - Seller Intelligence;
  - notifications in-app;
  - People & Compliance;
  - Dealer flows;
  - mobile, including the home page at 393 px (the #208 P2).
- **Verify:** The UAT result is recorded with pass/fail per step. An OWNER-UAT receipt names the human.
- **Stop if:** there is any blocking finding. That means a new RC.

### 18. Production migration plan
- **Owner:** Operator and owner
- **Action:** Write the exact, ordered production apply-list (production is many releases behind).
  For each file:
  - Down-block availability;
  - lock and duration risk;
  - pre-checks (the role counts before `VALIDATE`; template keys).

  Back up first. Rehearse on a branch or clone if provided.
- **Verify:** The plan is approved in writing.
- **Stop if:** any step would have to be guessed.

### 19. Production release window
- **Owner:** Owner (explicit approval)
- **Action:** Apply the approved production migrations, then deploy RC2's exact SHA with the
  release-only CLI. Merging to `main` does **not** release production; deployment does.
- **Verify:** Both deployment ids are built from RC2's SHA, and the migrations are recorded.
- **Stop if:** any migration fails. Roll back per step 21.

### 20. Production verification
- **Owner:** Operator
- **Action:**
  - The checks from RC1 step 19.
  - Garage routes refuse without a selected garage.
  - `/api/health` shows `evidenceVision.state` `not_configured`.
  - The ledger-intent backlog is a count.
- **Verify:** Each check is recorded.
- **Stop if:** any check fails. Roll back.

### 21. Roll back or close out
- **Owner:** Owner
- **If verification failed:**
  1. Run a Vercel instant rollback to the previous production deployment.
  2. Run the reviewed Down blocks in reverse order, only where safe.
- **If verification passed:**
  1. Mark the RC2 PR ready and merge it. It is 0 behind `main` today, so it is a fast-forward unless
     `main` moves.
  2. Close #220 as superseded. Only now: it stays open as the RC1 checkpoint until RC2 is released.
  3. Record the release.
- **Verify:** `main`, the production deployment and the release record all name the same SHA.
